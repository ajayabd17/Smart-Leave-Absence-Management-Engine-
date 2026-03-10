import json
import boto3
import os
from decimal import Decimal
from boto3.dynamodb.conditions import Attr, Key

dynamodb = boto3.resource("dynamodb")

CONFIG_TABLE = os.environ.get("CONFIG_TABLE")

table = dynamodb.Table(CONFIG_TABLE)


def decimal_converter(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError


def lambda_handler(event, context):

    try:
        claims = (
            event.get("requestContext", {})
            .get("authorizer", {})
            .get("jwt", {})
            .get("claims", {})
        )
        if not claims:
            return {
                "statusCode": 401,
                "body": json.dumps({"error": "Unauthorized"})
            }

        query_params = event.get("queryStringParameters") or {}
        year = query_params.get("year")
        active_only = str(query_params.get("active_only", "true")).lower() == "true"

        items = []
        if year:
            # Preferred path if table uses (year, leave_type) key schema.
            try:
                response = table.query(
                    KeyConditionExpression=Key("year").eq(str(year))
                )
                items = response.get("Items", [])
            except Exception:
                # Fallback for alternate key schemas.
                response = table.scan(
                    FilterExpression=Attr("year").eq(str(year))
                )
                items = response.get("Items", [])
        else:
            response = table.scan()
            items = response.get("Items", [])

        # Scan pagination support
        while response.get("LastEvaluatedKey"):
            response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
            items.extend(response.get("Items", []))

        if active_only:
            items = [row for row in items if bool(row.get("is_active", True))]

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(items, default=decimal_converter)
        }

    except Exception as e:

        print("ERROR:", str(e))

        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "error": str(e)
            })
        }
