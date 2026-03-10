import json
import os

import boto3


ses = boto3.client("ses")
SENDER_EMAIL = os.environ["SENDER_EMAIL"]


def lambda_handler(event, context):
    employee_email = event.get("employee_email")
    if not employee_email:
        return {"message": "Skipped notification: no employee email"}

    request_id = event.get("request_id", "")
    leave_type = event.get("leave_type", "")
    start_date = event.get("start_date", "")
    end_date = event.get("end_date", "")
    status = event.get("status", "UPDATED")

    subject = f"Leave Request {status}"
    body = (
        f"Your leave request has been updated.\n\n"
        f"Request ID: {request_id}\n"
        f"Leave Type: {leave_type}\n"
        f"Start Date: {start_date}\n"
        f"End Date: {end_date}\n"
        f"Status: {status}\n"
    )

    ses.send_email(
        Source=SENDER_EMAIL,
        Destination={"ToAddresses": [employee_email]},
        Message={"Subject": {"Data": subject}, "Body": {"Text": {"Data": body}}},
    )

    return {"message": "Notification sent", "request_id": request_id, "status": status}
