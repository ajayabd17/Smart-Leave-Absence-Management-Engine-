import json
import os

import boto3


sns = boto3.client("sns")
TOPIC_ARN = os.environ["SNS_TOPIC_ARN"]


def lambda_handler(event, context):
    request_id = event.get("request_id", "")
    employee_id = event.get("employee_id", "")
    stage = str(event.get("stage", "MANAGER")).upper()
    note = event.get("note")
    if not note:
        note = (
            "Manager has not acted within 48 hours."
            if stage == "MANAGER"
            else "HR has not acted within 48 hours."
        )
    message = {
        "type": "MANAGER_INACTION_ESCALATION" if stage == "MANAGER" else "HR_INACTION_ESCALATION",
        "stage": stage,
        "request_id": request_id,
        "employee_id": employee_id,
        "note": note,
    }
    sns.publish(
        TopicArn=TOPIC_ARN,
        Subject=f"Escalation: Pending Leave Approval >48h ({stage})",
        Message=json.dumps(message),
    )
    return {"escalated": True, "request_id": request_id}
