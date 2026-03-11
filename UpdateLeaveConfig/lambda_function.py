import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Attr


dynamodb = boto3.resource("dynamodb")
config_table = dynamodb.Table(os.environ.get("CONFIG_TABLE", "leave_config"))
directory_table = dynamodb.Table(os.environ.get("DIRECTORY_TABLE", "employee_directory"))


def decimal_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError


def resolve_identity(event):
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    if not claims:
        raise PermissionError("Missing JWT claims. Configure route authorization as JWT.")

    user_sub = claims.get("sub")
    if not user_sub:
        raise PermissionError("Missing user sub in JWT claims")

    row = directory_table.get_item(Key={"user_sub": user_sub}).get("Item")
    if not row:
        raise PermissionError("User not registered in employee_directory")

    if not row.get("role"):
        groups = claims.get("cognito:groups", [])
        if isinstance(groups, str):
            groups = [g.strip() for g in groups.replace("[", "").replace("]", "").split(",") if g.strip()]
        if "HR_Admin" in groups:
            row["role"] = "HR_Admin"
        elif "Manager" in groups:
            row["role"] = "Manager"
        else:
            row["role"] = "Employee"

    return row


def parse_body(event):
    if "body" not in event:
        return event
    if isinstance(event["body"], str):
        return json.loads(event["body"])
    return event["body"]


def json_response(code, payload):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload, default=decimal_default),
    }


def normalize_role(role_value):
    value = str(role_value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if value in ["hr_admin", "hradmin"]:
        return "HR_Admin"
    if value == "manager":
        return "Manager"
    if value == "employee":
        return "Employee"
    return str(role_value or "")


def lambda_handler(event, context):
    try:
        method = (event.get("requestContext", {}).get("http", {}).get("method") or "").upper()
        if method == "GET":
            year = (event.get("queryStringParameters") or {}).get("year", str(datetime.now(timezone.utc).year))
            rows = config_table.scan(FilterExpression=Attr("year").eq(year)).get("Items", [])
            return json_response(200, rows)

        identity = resolve_identity(event)
        if normalize_role(identity.get("role")) != "HR_Admin":
            return json_response(403, {"error": "Only HR can update leave configuration"})

        body = parse_body(event)
        leave_type = body["leave_type"].lower()
        if leave_type == "unpaid":
            return json_response(400, {"error": "Unpaid leave does not require configurable quota"})
        annual_quota = int(body["annual_quota"])
        if annual_quota < 0:
            return json_response(400, {"error": "annual_quota must be >= 0"})
        year = str(body.get("year", datetime.now(timezone.utc).year))
        now_iso = datetime.now(timezone.utc).isoformat()
        item = {
            "leave_type": leave_type,
            "year": year,
            "annual_quota": annual_quota,
            "quota": annual_quota,
            "max_quota": annual_quota,
            "requires_balance": bool(body.get("requires_balance", True)),
            "requires_hr_after_days": int(body.get("requires_hr_after_days", 5)),
            "weekly_accrual": int(body.get("weekly_accrual", body.get("accrual_per_week", 0))),
            "accrual_per_week": int(body.get("accrual_per_week", body.get("weekly_accrual", 0))),
            "is_active": bool(body.get("is_active", True)),
            "updated_at": now_iso,
            "updated_by": identity["employee_id"],
        }

        try:
            # Preferred path for composite key table: {leave_type, year}
            config_table.update_item(
                Key={"leave_type": leave_type, "year": year},
                UpdateExpression=(
                    "SET annual_quota=:annual, quota=:quota, max_quota=:maxq, "
                    "requires_balance=:rb, requires_hr_after_days=:hrad, "
                    "weekly_accrual=:weekly, accrual_per_week=:apw, is_active=:active, "
                    "updated_at=:updated, updated_by=:updated_by"
                ),
                ExpressionAttributeValues={
                    ":annual": annual_quota,
                    ":quota": annual_quota,
                    ":maxq": annual_quota,
                    ":rb": item["requires_balance"],
                    ":hrad": item["requires_hr_after_days"],
                    ":weekly": item["weekly_accrual"],
                    ":apw": item["accrual_per_week"],
                    ":active": item["is_active"],
                    ":updated": now_iso,
                    ":updated_by": identity["employee_id"],
                },
            )
        except ClientError as err:
            code = err.response.get("Error", {}).get("Code", "")
            # Fallback for non-composite schema or key mismatch: overwrite/upsert item.
            if code == "ValidationException":
                config_table.put_item(Item=item)
            else:
                raise

        return json_response(200, {"message": "Leave configuration updated successfully"})
    except PermissionError as err:
        return json_response(403, {"error": str(err)})
    except KeyError as err:
        return json_response(400, {"error": f"Missing field: {str(err)}"})
    except ValueError as err:
        return json_response(400, {"error": str(err)})
    except ClientError as err:
        return json_response(500, {"error": f"DynamoDB error: {err.response.get('Error', {}).get('Message', str(err))}"})
    except Exception as err:
        return json_response(500, {"error": str(err)})
