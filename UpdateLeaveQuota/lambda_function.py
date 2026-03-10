import json
import os
from datetime import datetime, timezone

import boto3


dynamodb = boto3.resource("dynamodb")
balance_table = dynamodb.Table(os.environ["BALANCE_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])


def resolve_identity(event):
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    user_sub = claims["sub"]
    row = directory_table.get_item(Key={"user_sub": user_sub}).get("Item")
    if not row:
        raise Exception("User not registered")
    return row


def lambda_handler(event, context):
    try:
        identity = resolve_identity(event)
        if identity.get("role") != "HR_Admin":
            return {"statusCode": 403, "body": json.dumps({"error": "Only HR can update leave quotas"})}

        body = json.loads(event["body"]) if isinstance(event.get("body"), str) else event.get("body", {})
        employee_id = body["employee_id"]
        leave_type = body["leave_type"].lower()
        new_quota = int(body["new_quota"])
        year = str(body.get("year", datetime.now(timezone.utc).year))

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

        return {"statusCode": 200, "body": json.dumps({"message": "Leave quota updated successfully"})}
    except Exception as err:
        return {"statusCode": 500, "body": json.dumps({"error": str(err)})}
