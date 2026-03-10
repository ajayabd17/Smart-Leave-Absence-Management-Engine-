import json
import os

import boto3


sns = boto3.client("sns")
TOPIC_ARN = os.environ["SNS_TOPIC_ARN"]


def lambda_handler(event, context):
    request_id = event.get("request_id", "")
    employee_id = event.get("employee_id", "")
    message = {
        "type": "MANAGER_INACTION_ESCALATION",
        "request_id": request_id,
        "employee_id": employee_id,
        "note": "Manager has not acted within 48 hours.",
    }
    sns.publish(
        TopicArn=TOPIC_ARN,
        Subject="Escalation: Pending Leave Approval >48h",
        Message=json.dumps(message),
    )
    return {"escalated": True, "request_id": request_id}
