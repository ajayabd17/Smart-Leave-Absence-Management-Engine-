import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone

import boto3


sns = boto3.client("sns")

TOPIC_ARN = os.environ["SNS_TOPIC_ARN"]
APPROVAL_API_BASE = os.environ["APPROVAL_API_BASE"]
TOKEN_SECRET = os.environ["TOKEN_SECRET"]


def create_token(payload):
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    signature = hmac.new(TOKEN_SECRET.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8").rstrip("=")
    return f"{encoded}.{signature}"


def lambda_handler(event, context):
    employee_id = event["employee_id"]
    request_id = event["request_id"]
    manager_email = event.get("manager_email", "")
    total_days = int(event.get("total_days", 0))

    expires_at = int((datetime.now(timezone.utc) + timedelta(hours=48)).timestamp())
    approve_token = create_token({"request_id": request_id, "decision": "APPROVED", "exp": expires_at})
    reject_token = create_token({"request_id": request_id, "decision": "REJECTED", "exp": expires_at})

    approve_link = f"{APPROVAL_API_BASE}/leave/approve?request_id={request_id}&decision=APPROVED&token={approve_token}"
    reject_link = f"{APPROVAL_API_BASE}/leave/approve?request_id={request_id}&decision=REJECTED&token={reject_token}"

    message = {
        "employee_id": employee_id,
        "manager_email": manager_email,
        "request_id": request_id,
        "total_days": total_days,
        "expires_at": expires_at,
        "approve_link": approve_link,
        "reject_link": reject_link,
    }

    sns.publish(
        TopicArn=TOPIC_ARN,
        Subject="Leave approval required",
        Message=json.dumps(message),
    )

    return {
        "employee_id": employee_id,
        "request_id": request_id,
        "total_days": total_days,
        "manager_email": manager_email,
        "manager_approval_sent": True,
    }
