import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Attr


dynamodb = boto3.resource("dynamodb")
ses = boto3.client("ses")
lambda_client = boto3.client("lambda")
leave_table = dynamodb.Table(os.environ["LEAVE_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])
TOKEN_SECRET = os.environ["TOKEN_SECRET"]
SES_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL", "")
HR_APPROVAL_FUNCTION = os.environ.get("HR_APPROVAL_FUNCTION", "HRApproval")
FINALIZE_FUNCTION = os.environ.get("FINALIZE_FUNCTION", "FinalizeLeave")


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


def scan_all(table, **kwargs):
    items = []
    response = table.scan(**kwargs)
    items.extend(response.get("Items", []))
    while "LastEvaluatedKey" in response:
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"], **kwargs)
        items.extend(response.get("Items", []))
    return items


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
    rows = scan_all(leave_table, FilterExpression=Attr("request_id").eq(request_id))
    return rows[0] if rows else None


def send_stage_email(to_email, request_id, status, approval_stage, decision_by):
    if not SES_FROM_EMAIL or not to_email:
        return

    if status == "REJECTED" and decision_by == "MANAGER":
        subject = f"SmartLeave Update - Manager Rejected ({request_id})"
        body = (
            "Your leave request was rejected by your manager.\n\n"
            f"Request ID: {request_id}\n"
            "Status: REJECTED\n"
            "Approval Stage: FINAL\n"
        )
    elif status == "MANAGER_APPROVED":
        subject = f"SmartLeave Update - Manager Approved, Waiting HR ({request_id})"
        body = (
            "Your leave request was approved by your manager and is waiting for HR approval.\n\n"
            f"Request ID: {request_id}\n"
            "Status: MANAGER_APPROVED\n"
            "Approval Stage: HR\n"
        )
    elif status == "HR_APPROVED" and decision_by == "MANAGER":
        subject = f"SmartLeave Update - Leave Approved ({request_id})"
        body = (
            "Your leave request has been approved by your manager.\n\n"
            f"Request ID: {request_id}\n"
            "Status: HR_APPROVED\n"
            "Approval Stage: FINAL\n"
        )
    elif status == "HR_APPROVED" and decision_by == "HR":
        subject = f"SmartLeave Update - HR Approved ({request_id})"
        body = (
            "Your leave request has been approved by HR.\n\n"
            f"Request ID: {request_id}\n"
            "Status: HR_APPROVED\n"
            "Approval Stage: FINAL\n"
        )
    elif status == "REJECTED" and decision_by == "HR":
        subject = f"SmartLeave Update - HR Rejected ({request_id})"
        body = (
            "Your leave request was rejected by HR.\n\n"
            f"Request ID: {request_id}\n"
            "Status: REJECTED\n"
            "Approval Stage: FINAL\n"
        )
    else:
        subject = f"SmartLeave Update - Request {request_id} {status}"
        body = (
            "Your leave request status has changed.\n\n"
            f"Request ID: {request_id}\n"
            f"Status: {status}\n"
            f"Approval Stage: {approval_stage}\n"
        )

    body += f"\nUpdated At: {datetime.now(timezone.utc).isoformat()}\n"
    ses.send_email(
        Source=SES_FROM_EMAIL,
        Destination={"ToAddresses": [to_email]},
        Message={
            "Subject": {"Data": subject},
            "Body": {"Text": {"Data": body}},
        },
    )


def trigger_hr_approval_links(leave_item):
    payload = {
        "request_id": leave_item["request_id"],
        "employee_id": leave_item.get("employee_id", ""),
        "leave_type": leave_item.get("leave_type", ""),
        "start_date": leave_item.get("start_date", ""),
        "end_date": leave_item.get("end_date", ""),
        "total_days": int(leave_item.get("total_days", 0)),
    }
    lambda_client.invoke(
        FunctionName=HR_APPROVAL_FUNCTION,
        InvocationType="Event",
        Payload=json.dumps(payload).encode("utf-8"),
    )


def trigger_finalize(request_id):
    lambda_client.invoke(
        FunctionName=FINALIZE_FUNCTION,
        InvocationType="Event",
        Payload=json.dumps({"request_id": request_id}).encode("utf-8"),
    )


def lambda_handler(event, context):
    try:
        data = parse_payload(event)
        request_id = data.get("request_id")
        decision = str(data.get("decision", "")).upper()
        token = data.get("token") or data.get("signed_token")

        if decision not in ["APPROVED", "REJECTED"]:
            return json_response(400, {"error": "Invalid decision"})

        actor_role = None
        if token:
            token_payload = verify_token(token)
            token_request_id = token_payload.get("request_id")
            if not request_id:
                request_id = token_request_id
            if token_request_id != request_id:
                return json_response(400, {"error": "Token does not match request"})
            if str(token_payload.get("decision", "")).upper() != decision:
                return json_response(400, {"error": "Token decision does not match request"})
            if int(token_payload.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
                return json_response(401, {"error": "Signed token expired"})
            actor_role = str(token_payload.get("actor_role", "MANAGER")).upper()
            if actor_role not in ["MANAGER", "HR_ADMIN", "HR"]:
                return json_response(400, {"error": "Invalid token actor role"})
        else:
            try:
                identity = resolve_identity(event)
            except Exception:
                return json_response(401, {"error": "Missing authentication context"})
            actor_role = identity.get("role")
            if actor_role not in ["Manager", "HR_Admin"]:
                return json_response(403, {"error": "Forbidden"})

        if not request_id:
            return json_response(400, {"error": "Missing request_id"})

        leave_item = find_request(request_id)
        if not leave_item:
            return json_response(404, {"error": "Leave request not found"})

        total_days = int(leave_item.get("total_days", 0))
        current_status = leave_item.get("status", "PENDING")
        current_stage = leave_item.get("approval_stage", "MANAGER")

        # One-time decision protection: do not allow changing finalized requests.
        if current_stage == "FINAL" or current_status in ["HR_APPROVED", "REJECTED", "AUTO_REJECTED", "APPROVED"]:
            return json_response(
                409,
                {
                    "error": "Decision already finalized",
                    "request_id": request_id,
                    "status": current_status,
                    "approval_stage": current_stage,
                },
            )

        # Signed links are stage-bound by token actor role.
        if token and actor_role == "MANAGER" and current_stage != "MANAGER":
            return json_response(409, {"error": "Manager decision already recorded; awaiting HR or finalized"})
        if token and actor_role in ["HR", "HR_ADMIN"] and current_stage != "HR":
            return json_response(409, {"error": "Request is not in HR decision stage"})

        # Stage/role guardrails for authenticated dashboard actions.
        if not token:
            if current_stage == "MANAGER" and actor_role != "Manager":
                return json_response(403, {"error": "Only Manager can decide at manager stage"})
            if current_stage == "HR" and actor_role != "HR_Admin":
                return json_response(403, {"error": "Only HR can decide at HR stage"})

        decision_by = "MANAGER" if actor_role in ["Manager", "MANAGER"] else "HR"

        hr_notification_triggered = False

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
                ":current_status": current_status,
                ":current_stage": current_stage,
            },
            ConditionExpression="#status = :current_status AND approval_stage = :current_stage",
        )

        # Immediate transition action: manager approve for >5 days sends HR links now.
        finalize_triggered = False
        if next_status == "MANAGER_APPROVED" and next_stage == "HR":
            trigger_hr_approval_links(leave_item)
            hr_notification_triggered = True
        elif next_status == "HR_APPROVED" and next_stage == "FINAL":
            trigger_finalize(request_id)
            finalize_triggered = True

        # Requirement: notify employee at stage changes.
        send_stage_email(
            leave_item.get("employee_email", ""),
            request_id,
            next_status,
            next_stage,
            decision_by,
        )

        return json_response(
            200,
            {
                "message": "Decision recorded",
                "request_id": request_id,
                "status": next_status,
                "approval_stage": next_stage,
                "decision_by": decision_by,
                "hr_notification_triggered": hr_notification_triggered,
                "finalize_triggered": finalize_triggered,
            },
        )
    except leave_table.meta.client.exceptions.ConditionalCheckFailedException:
        return json_response(409, {"error": "Request already changed by another action"})
    except Exception as err:
        return json_response(500, {"error": str(err)})
