import json
import os
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key


dynamodb = boto3.resource("dynamodb")
balance_table = dynamodb.Table(os.environ["BALANCE_TABLE"])
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
        response = balance_table.query(
            KeyConditionExpression=Key("employee_id").eq(identity["employee_id"])
        )
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(response.get("Items", []), default=decimal_default),
        }
    except Exception as err:
        return {"statusCode": 500, "body": json.dumps({"error": str(err)})}
