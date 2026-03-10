import json
import os
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key


dynamodb = boto3.resource("dynamodb")
leave_table = dynamodb.Table(os.environ["LEAVE_TABLE"])
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


def lambda_handler(event, context):
    try:
        identity = resolve_identity(event)
        role = identity.get("role")
        if role not in ["Manager", "HR_Admin"]:
            return {"statusCode": 403, "body": json.dumps({"error": "Forbidden"})}

        approved = leave_table.scan(
            FilterExpression=Attr("status").eq("APPROVED")
        ).get("Items", [])

        if role == "HR_Admin":
            rows = approved
        else:
            team_rows = directory_table.scan(
                FilterExpression=Attr("manager_employee_id").eq(identity["employee_id"])
            ).get("Items", [])
            team_ids = {row["employee_id"] for row in team_rows}
            rows = [item for item in approved if item.get("employee_id") in team_ids]

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(rows, default=decimal_default),
        }
    except Exception as err:
        return {"statusCode": 500, "body": json.dumps({"error": str(err)})}
