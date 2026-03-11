import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Attr


dynamodb = boto3.resource("dynamodb")
balance_table = dynamodb.Table(os.environ["BALANCE_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])
config_table = dynamodb.Table(os.environ.get("CONFIG_TABLE", "leave_config"))


def json_response(code, payload):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload),
    }


def to_int(value, default=0):
    if value is None:
        return default
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(value)
    except Exception:
        return default


def get_config(leave_type, year):
    row = config_table.get_item(Key={"leave_type": leave_type, "year": str(year)}).get("Item")
    if row:
        return row
    query = config_table.scan(
        FilterExpression=Attr("leave_type").eq(leave_type) & Attr("year").eq(str(year)),
        Limit=1,
    )
    rows = query.get("Items", [])
    return rows[0] if rows else None


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
        identity = resolve_identity(event)
        if normalize_role(identity.get("role")) != "HR_Admin":
            return json_response(403, {"error": "Only HR can update leave quotas"})

        body = json.loads(event["body"]) if isinstance(event.get("body"), str) else (event.get("body") or {})
        employee_id = body["employee_id"]
        leave_type = body["leave_type"].lower()
        year = str(body.get("year", datetime.now(timezone.utc).year))
        if leave_type == "unpaid":
            return json_response(400, {"error": "Unpaid leave does not support quota allocation"})

        increment_days = to_int(
            body.get("increment_days", body.get("add_days", body.get("new_quota"))),
            0,
        )
        if increment_days <= 0:
            return json_response(400, {"error": "increment_days must be > 0"})

        config = get_config(leave_type, year)
        if not config:
            return json_response(400, {"error": f"Leave config not found for {leave_type} in {year}"})

        max_quota = to_int(config.get("annual_quota", config.get("quota", 0)), 0)
        if max_quota <= 0:
            return json_response(400, {"error": f"Invalid configured max quota for {leave_type}"})

        key = {"employee_id": employee_id, "leave_type#year": f"{leave_type}#{year}"}
        existing = balance_table.get_item(Key=key).get("Item", {})
        current_total = to_int(existing.get("total_quota", 0), 0)
        used_days = to_int(existing.get("used_days", 0), 0)

        new_total = min(current_total + increment_days, max_quota)
        actually_added = new_total - current_total
        if actually_added <= 0:
            return json_response(
                400,
                {"error": f"Quota cap reached. Cannot exceed configured max of {max_quota} for {leave_type}."},
            )
        remaining = max(new_total - used_days, 0)

        balance_table.put_item(
            Item={
                "employee_id": employee_id,
                "leave_type#year": f"{leave_type}#{year}",
                "total_quota": new_total,
                "used_days": used_days,
                "remaining_balance": remaining,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": identity["employee_id"],
            }
        )

        return json_response(
            200,
            {
                "message": "Leave quota incremented successfully",
                "employee_id": employee_id,
                "leave_type": leave_type,
                "year": year,
                "increment_requested": increment_days,
                "increment_applied": actually_added,
                "total_quota": new_total,
                "remaining_balance": remaining,
                "max_quota": max_quota,
            },
        )
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
