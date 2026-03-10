import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Attr, Key


dynamodb = boto3.resource("dynamodb")
leave_table = dynamodb.Table(os.environ["LEAVE_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])
TOKEN_SECRET = os.environ["TOKEN_SECRET"]


def json_response(code, payload):
    return {"statusCode": code, "headers": {"Content-Type": "application/json"}, "body": json.dumps(payload)}


def parse_payload(event):
    if event.get("httpMethod") == "GET" or event.get("queryStringParameters"):
        return event.get("queryStringParameters") or {}
    if "body" in event:
        body = event["body"]
        return json.loads(body) if isinstance(body, str) else body
    return event


def verify_token(token):
    encoded, signature = token.split(".", 1)
    padded = encoded + ("=" * (-len(encoded) % 4))
    raw = base64.urlsafe_b64decode(padded).decode("utf-8")
    expected = hmac.new(TOKEN_SECRET.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise Exception("Invalid token signature")
    return json.loads(raw)


def resolve_identity(event):
    request_context = event.get("requestContext", {})
    authorizer = request_context.get("authorizer", {})
    jwt_ctx = authorizer.get("jwt", {})
    claims = jwt_ctx.get("claims")
    if not claims:
        raise Exception("Missing JWT authorizer context")
    user_sub = claims["sub"]
    row = directory_table.get_item(Key={"user_sub": user_sub}).get("Item")
    if not row:
        raise Exception("User not registered")
    return row


def find_request(request_id):
    query = leave_table.scan(FilterExpression=Attr("request_id").eq(request_id), Limit=1)
    rows = query.get("Items", [])
    return rows[0] if rows else None


def lambda_handler(event, context):
    try:
        data = parse_payload(event)
        request_id = data.get("request_id")
        decision = str(data.get("decision", "")).upper()
        token = data.get("token") or data.get("signed_token")

        if decision not in ["APPROVED", "REJECTED"]:
            return json_response(400, {"error": "Invalid decision"})

        if token:
            token_payload = verify_token(token)
            if token_payload.get("request_id") != request_id:
                return json_response(400, {"error": "Token does not match request"})
            if str(token_payload.get("decision", "")).upper() != decision:
                return json_response(400, {"error": "Token decision does not match request"})
            if int(token_payload.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
                return json_response(401, {"error": "Signed token expired"})
        else:
            try:
                identity = resolve_identity(event)
            except Exception:
                return json_response(401, {"error": "Missing authentication context"})
            if identity.get("role") not in ["Manager", "HR_Admin"]:
                return json_response(403, {"error": "Forbidden"})

        leave_item = find_request(request_id)
        if not leave_item:
            return json_response(404, {"error": "Leave request not found"})

        total_days = int(leave_item.get("total_days", 0))
        current_stage = leave_item.get("approval_stage", "MANAGER")

        if decision == "REJECTED":
            next_status = "REJECTED"
            next_stage = "FINAL"
        elif current_stage == "HR":
            next_status = "HR_APPROVED"
            next_stage = "FINAL"
        elif total_days > 5:
            next_status = "MANAGER_APPROVED"
            next_stage = "HR"
        else:
            next_status = "HR_APPROVED"
            next_stage = "FINAL"

        leave_table.update_item(
            Key={"employee_id": leave_item["employee_id"], "request_id": leave_item["request_id"]},
            UpdateExpression="SET #status=:status, approval_stage=:stage, updated_at=:updated",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": next_status,
                ":stage": next_stage,
                ":updated": datetime.now(timezone.utc).isoformat(),
            },
        )

        return json_response(
            200,
            {
                "message": "Decision recorded",
                "request_id": request_id,
                "status": next_status,
                "approval_stage": next_stage,
            },
        )
    except Exception as err:
        return json_response(500, {"error": str(err)})
