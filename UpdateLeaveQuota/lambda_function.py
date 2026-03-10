import json
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


dynamodb = boto3.resource("dynamodb")
balance_table = dynamodb.Table(os.environ["BALANCE_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])


def json_response(code, payload):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload),
    }


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


def lambda_handler(event, context):
    try:
        identity = resolve_identity(event)
        if identity.get("role") != "HR_Admin":
            return json_response(403, {"error": "Only HR can update leave quotas"})

        body = json.loads(event["body"]) if isinstance(event.get("body"), str) else (event.get("body") or {})
        employee_id = body["employee_id"]
        leave_type = body["leave_type"].lower()
        new_quota = int(body["new_quota"])
        year = str(body.get("year", datetime.now(timezone.utc).year))
        if new_quota < 0:
            return json_response(400, {"error": "new_quota must be >= 0"})

        key = {"employee_id": employee_id, "leave_type#year": f"{leave_type}#{year}"}
        existing = balance_table.get_item(Key=key).get("Item", {})
        used_days = int(existing.get("used_days", 0))
        remaining = max(new_quota - used_days, 0)

        balance_table.put_item(
            Item={
                "employee_id": employee_id,
                "leave_type#year": f"{leave_type}#{year}",
                "total_quota": new_quota,
                "used_days": used_days,
                "remaining_balance": remaining,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": identity["employee_id"],
            }
        )

        return json_response(200, {"message": "Leave quota updated successfully"})
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
