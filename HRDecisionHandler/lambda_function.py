import json
import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Attr


dynamodb = boto3.resource("dynamodb")
leave_table = dynamodb.Table(os.environ["LEAVE_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])


def json_response(code, payload):
    return {"statusCode": code, "headers": {"Content-Type": "application/json"}, "body": json.dumps(payload)}


def resolve_identity(event):
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    user_sub = claims["sub"]
    row = directory_table.get_item(Key={"user_sub": user_sub}).get("Item")
    if not row:
        raise Exception("User not registered")
    return row


def find_request(request_id):
    scan = leave_table.scan(FilterExpression=Attr("request_id").eq(request_id), Limit=1)
    rows = scan.get("Items", [])
    return rows[0] if rows else None


def lambda_handler(event, context):
    try:
        identity = resolve_identity(event)
        if identity.get("role") != "HR_Admin":
            return json_response(403, {"error": "Only HR admin can process HR decisions"})

        body = json.loads(event["body"]) if isinstance(event.get("body"), str) else event.get("body", {})
        request_id = body["request_id"]
        decision = str(body["decision"]).upper()
        if decision not in ["APPROVED", "REJECTED"]:
            return json_response(400, {"error": "Invalid decision"})

        leave_item = find_request(request_id)
        if not leave_item:
            return json_response(404, {"error": "Leave request not found"})
        if leave_item.get("approval_stage") != "HR":
            return json_response(400, {"error": "Leave request is not in HR approval stage"})

        status = "HR_APPROVED" if decision == "APPROVED" else "REJECTED"
        stage = "FINAL"

        leave_table.update_item(
            Key={"employee_id": leave_item["employee_id"], "request_id": leave_item["request_id"]},
            UpdateExpression="SET #status=:status, approval_stage=:stage, updated_at=:updated",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": status,
                ":stage": stage,
                ":updated": datetime.now(timezone.utc).isoformat(),
            },
        )

        return json_response(200, {"request_id": request_id, "status": status})
    except Exception as err:
        return json_response(500, {"error": str(err)})
