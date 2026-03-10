import json
import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Attr


dynamodb = boto3.resource("dynamodb")
leave_table = dynamodb.Table(os.environ["LEAVE_TABLE"])
balance_table = dynamodb.Table(os.environ["BALANCE_TABLE"])


def scan_all(table, **kwargs):
    items = []
    response = table.scan(**kwargs)
    items.extend(response.get("Items", []))
    while "LastEvaluatedKey" in response:
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"], **kwargs)
        items.extend(response.get("Items", []))
    return items


def find_request(request_id):
    rows = scan_all(leave_table, FilterExpression=Attr("request_id").eq(request_id))
    return rows[0] if rows else None


def lambda_handler(event, context):
    try:
        request_id = event["request_id"]
        leave_item = find_request(request_id)
        if not leave_item:
            return {"statusCode": 404, "body": json.dumps({"error": "Leave request not found"})}

        current_status = leave_item.get("status")
        total_days = int(leave_item.get("total_days", 0))
        leave_type = leave_item["leave_type"].lower()
        year = leave_item["start_date"].split("-")[0]

        if current_status not in ["HR_APPROVED", "APPROVED"]:
            return {"statusCode": 400, "body": json.dumps({"error": f"Cannot finalize from status {current_status}"})}
        if current_status == "APPROVED":
            return {"statusCode": 200, "body": json.dumps({"message": "Already finalized", "request_id": request_id})}

        if leave_type != "unpaid":
            balance_table.update_item(
                Key={"employee_id": leave_item["employee_id"], "leave_type#year": f"{leave_type}#{year}"},
                ConditionExpression="remaining_balance >= :d",
                UpdateExpression="SET remaining_balance = remaining_balance - :d, used_days = if_not_exists(used_days, :z) + :d, updated_at=:u",
                ExpressionAttributeValues={":d": total_days, ":z": 0, ":u": datetime.now(timezone.utc).isoformat()},
            )

        leave_table.update_item(
            Key={"employee_id": leave_item["employee_id"], "request_id": leave_item["request_id"]},
            ConditionExpression="#status = :allowed",
            UpdateExpression="SET #status=:approved, approval_stage=:final, updated_at=:u",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":allowed": "HR_APPROVED",
                ":approved": "APPROVED",
                ":final": "FINAL",
                ":u": datetime.now(timezone.utc).isoformat(),
            },
        )

        return {
            "employee_id": leave_item["employee_id"],
            "request_id": request_id,
            "leave_type": leave_type,
            "total_days": total_days,
            "status": "APPROVED",
        }
    except Exception as err:
        return {"statusCode": 500, "body": json.dumps({"error": str(err)})}
