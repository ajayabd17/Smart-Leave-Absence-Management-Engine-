import json
import os

import boto3
from boto3.dynamodb.conditions import Attr


dynamodb = boto3.resource("dynamodb")
leave_table = dynamodb.Table(os.environ["LEAVE_TABLE"])


def lambda_handler(event, context):
    request_id = event["request_id"]
    response = leave_table.scan(FilterExpression=Attr("request_id").eq(request_id), Limit=1)
    rows = response.get("Items", [])
    if not rows:
        return {"request_id": request_id, "found": False}

    item = rows[0]
    return {
        "request_id": request_id,
        "employee_id": item.get("employee_id"),
        "status": item.get("status"),
        "approval_stage": item.get("approval_stage"),
        "total_days": int(item.get("total_days", 0)),
        "leave_type": item.get("leave_type"),
        "start_date": item.get("start_date"),
        "end_date": item.get("end_date"),
        "employee_email": item.get("employee_email", ""),
        "found": True,
    }
