import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr


dynamodb = boto3.resource("dynamodb")
config_table = dynamodb.Table(os.environ["CONFIG_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])


def decimal_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError


def resolve_identity(event):
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    user_sub = claims["sub"]
    row = directory_table.get_item(Key={"user_sub": user_sub}).get("Item")
    if not row:
        raise Exception("User not registered")
    return row


def parse_body(event):
    if "body" not in event:
        return event
    if isinstance(event["body"], str):
        return json.loads(event["body"])
    return event["body"]


def lambda_handler(event, context):
    try:
        method = (event.get("requestContext", {}).get("http", {}).get("method") or "").upper()
        if method == "GET":
            year = (event.get("queryStringParameters") or {}).get("year", str(datetime.now(timezone.utc).year))
            rows = config_table.scan(FilterExpression=Attr("year").eq(year)).get("Items", [])
            return {
                "statusCode": 200,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps(rows, default=decimal_default),
            }

        identity = resolve_identity(event)
        if identity.get("role") != "HR_Admin":
            return {"statusCode": 403, "body": json.dumps({"error": "Only HR can update leave configuration"})}

        body = parse_body(event)
        leave_type = body["leave_type"].lower()
        annual_quota = int(body["annual_quota"])
        year = str(body.get("year", datetime.now(timezone.utc).year))

        config_table.put_item(
            Item={
                "leave_type": leave_type,
                "year": year,
                "annual_quota": annual_quota,
                "requires_balance": bool(body.get("requires_balance", leave_type != "unpaid")),
                "requires_hr_after_days": int(body.get("requires_hr_after_days", 5)),
                "weekly_accrual": int(body.get("weekly_accrual", 0)),
                "is_active": bool(body.get("is_active", True)),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": identity["employee_id"],
            }
        )

        return {"statusCode": 200, "body": json.dumps({"message": "Leave configuration updated successfully"})}
    except Exception as err:
        return {"statusCode": 500, "body": json.dumps({"error": str(err)})}
