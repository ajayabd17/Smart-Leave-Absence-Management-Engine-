import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone

import boto3


ses = boto3.client("ses")

APPROVAL_API_BASE = os.environ["APPROVAL_API_BASE"]
TOKEN_SECRET = os.environ["TOKEN_SECRET"]
SENDER_EMAIL = os.environ.get("SENDER_EMAIL") or os.environ.get("SES_FROM_EMAIL", "")
HR_EMAILS = [e.strip() for e in os.environ.get("HR_EMAILS", "").split(",") if e.strip()]


def create_token(payload):
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    signature = hmac.new(TOKEN_SECRET.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8").rstrip("=")
    return f"{encoded}.{signature}"


def lambda_handler(event, context):
    payload = event.get("Payload") if isinstance(event, dict) and "Payload" in event else event
    if not isinstance(payload, dict):
        raise ValueError("Invalid input payload")

    request_id = payload["request_id"]
    employee_id = payload.get("employee_id", "")
    leave_type = str(payload.get("leave_type", "")).upper()
    start_date = payload.get("start_date", "")
    end_date = payload.get("end_date", "")
    total_days = int(payload.get("total_days", 0))

    if not HR_EMAILS:
        return {"message": "No HR emails configured", "request_id": request_id, "hr_approval_sent": False}

    expires_at = int((datetime.now(timezone.utc) + timedelta(hours=48)).timestamp())
    approve_token = create_token(
        {
            "request_id": request_id,
            "decision": "APPROVED",
            "actor_role": "HR_ADMIN",
            "exp": expires_at,
        }
    )
    reject_token = create_token(
        {
            "request_id": request_id,
            "decision": "REJECTED",
            "actor_role": "HR_ADMIN",
            "exp": expires_at,
        }
    )

    approve_link = f"{APPROVAL_API_BASE}/leave/approve?request_id={request_id}&decision=APPROVED&token={approve_token}"
    reject_link = f"{APPROVAL_API_BASE}/leave/approve?request_id={request_id}&decision=REJECTED&token={reject_token}"

    body = (
        "SmartLeave - HR Approval Required\n\n"
        "A leave request has been manager-approved and now requires HR decision.\n\n"
        f"Employee ID: {employee_id}\n"
        f"Request ID: {request_id}\n"
        f"Leave Type: {leave_type}\n"
        f"Dates: {start_date} to {end_date}\n"
        f"Total Days: {total_days}\n"
        f"Link Expires At (UTC epoch): {expires_at}\n\n"
        "Approve Request:\n"
        f"{approve_link}\n\n"
        "Reject Request:\n"
        f"{reject_link}\n"
    )

    if SENDER_EMAIL:
        ses.send_email(
            Source=SENDER_EMAIL,
            Destination={"ToAddresses": HR_EMAILS},
            Message={
                "Subject": {"Data": f"SmartLeave HR Approval Required - {employee_id} ({leave_type})"},
                "Body": {"Text": {"Data": body}},
            },
        )

    return {"request_id": request_id, "hr_approval_sent": True, "hr_recipients": HR_EMAILS}
