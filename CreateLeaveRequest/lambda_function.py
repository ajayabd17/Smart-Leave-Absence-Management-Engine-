import json
import os
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key


dynamodb = boto3.resource("dynamodb")
stepfunctions = boto3.client("stepfunctions")
sns = boto3.client("sns")
ses = boto3.client("ses")

leave_table = dynamodb.Table(os.environ["LEAVE_TABLE"])
balance_table = dynamodb.Table(os.environ["BALANCE_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])
config_table = dynamodb.Table(os.environ["CONFIG_TABLE"])

STATE_MACHINE_ARN = os.environ["STATE_MACHINE_ARN"]
SNS_TOPIC_ARN = os.environ["SNS_TOPIC_ARN"]
SES_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL", "")


def decimal_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError


def to_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ["1", "true", "yes", "y"]
    return bool(value)


def json_response(code, payload):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload, default=decimal_default),
    }


def resolve_identity(event):
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    user_sub = claims["sub"]
    email = (claims.get("email") or "").strip().lower()

    row = directory_table.get_item(Key={"user_sub": user_sub}).get("Item")
    if not row and email:
        by_email = directory_table.scan(
            FilterExpression=Attr("email_lower").eq(email),
            Limit=1,
        )
        rows = by_email.get("Items", [])
        row = rows[0] if rows else None

    if not row:
        raise Exception("User not registered in employee_directory")
    if row.get("status") != "ACTIVE":
        raise Exception("User is inactive")

    return {
        "employee_id": row["employee_id"],
        "user_sub": user_sub,
        "email": email or row.get("email_lower") or row.get("email") or "",
        "manager_email": row.get("manager_email", ""),
    }


def parse_body(event):
    if "body" not in event:
        return event
    if isinstance(event["body"], str):
        return json.loads(event["body"])
    return event["body"]


def calculate_days(start, end):
    start_date = date.fromisoformat(start)
    end_date = date.fromisoformat(end)
    if end_date < start_date:
        raise ValueError("End date cannot be before start date")
    return (end_date - start_date).days + 1


def check_overlap(employee_id, start_date, end_date):
    req_start = date.fromisoformat(start_date)
    req_end = date.fromisoformat(end_date)

    response = leave_table.query(KeyConditionExpression=Key("employee_id").eq(employee_id))
    for item in response.get("Items", []):
        if item.get("status") not in ["APPROVED", "PENDING", "MANAGER_APPROVED", "HR_PENDING", "HR_APPROVED"]:
            continue

        existing_start = date.fromisoformat(item["start_date"])
        existing_end = date.fromisoformat(item["end_date"])
        if req_start <= existing_end and req_end >= existing_start:
            return True
    return False


def get_leave_config(leave_type, year):
    row = config_table.get_item(Key={"leave_type": leave_type, "year": year}).get("Item")
    if row:
        return row

    query = config_table.scan(
        FilterExpression=Attr("leave_type").eq(leave_type) & Attr("year").eq(str(year)),
        Limit=1,
    )
    rows = query.get("Items", [])
    return rows[0] if rows else None


def send_auto_reject_email(employee_email, request_id, reason):
    if not employee_email or not SES_FROM_EMAIL:
        return
    ses.send_email(
        Source=SES_FROM_EMAIL,
        Destination={"ToAddresses": [employee_email]},
        Message={
            "Subject": {"Data": "Leave request auto-rejected"},
            "Body": {"Text": {"Data": f"Request {request_id} was auto-rejected: {reason}"}},
        },
    )


def send_submitted_email(employee_email, request_id, leave_type, start_date, end_date, total_days):
    if not employee_email or not SES_FROM_EMAIL:
        return
    ses.send_email(
        Source=SES_FROM_EMAIL,
        Destination={"ToAddresses": [employee_email]},
        Message={
            "Subject": {"Data": "Leave request submitted"},
            "Body": {
                "Text": {
                    "Data": (
                        f"Your leave request has been submitted.\n"
                        f"Request ID: {request_id}\n"
                        f"Leave Type: {leave_type}\n"
                        f"Dates: {start_date} to {end_date}\n"
                        f"Total Days: {total_days}\n"
                        f"Status: PENDING"
                    )
                }
            },
        },
    )


def lambda_handler(event, context):
    try:
        body = parse_body(event)
        leave_type = body["leave_type"].lower()
        start_date = body["start_date"]
        end_date = body["end_date"]
        reason = body.get("reason", "")

        identity = resolve_identity(event)
        employee_id = identity["employee_id"]

        start = date.fromisoformat(start_date)
        if start < date.today():
            return json_response(400, {"error": "Cannot apply leave for past dates"})

        total_days = calculate_days(start_date, end_date)
        year = str(start.year)

        # Unpaid leave is always allowed and does not require config/quota records.
        if leave_type == "unpaid":
            config = {
                "leave_type": "unpaid",
                "is_active": True,
                "requires_balance": False,
                "requires_hr_after_days": 5,
            }
        else:
            config = get_leave_config(leave_type, year)
            if not config:
                return json_response(400, {"error": "Leave type not configured"})
            if not bool(config.get("is_active", True)):
                return json_response(400, {"error": "Leave type inactive"})

        if check_overlap(employee_id, start_date, end_date):
            return json_response(400, {"error": "Leave request overlaps with existing leave"})

        request_id = str(uuid.uuid4())
        status = "PENDING"
        approval_stage = "MANAGER"
        auto_reason = ""

        requires_balance = to_bool(config.get("requires_balance", leave_type != "unpaid"), leave_type != "unpaid")
        if requires_balance:
            balance_key = f"{leave_type}#{year}"
            balance_row = balance_table.get_item(
                Key={"employee_id": employee_id, "leave_type#year": balance_key}
            ).get("Item")
            if not balance_row:
                status = "AUTO_REJECTED"
                approval_stage = "FINAL"
                auto_reason = "MISSING_BALANCE_RECORD"
            else:
                remaining = int(balance_row.get("remaining_balance", 0))
                if remaining < total_days:
                    status = "AUTO_REJECTED"
                    approval_stage = "FINAL"
                    auto_reason = "INSUFFICIENT_BALANCE"

        item = {
            "employee_id": employee_id,
            "request_id": request_id,
            "user_sub": identity["user_sub"],
            "employee_email": identity["email"],
            "leave_type": leave_type,
            "start_date": start_date,
            "end_date": end_date,
            "total_days": total_days,
            "reason": reason,
            "status": status,
            "approval_stage": approval_stage,
            "auto_reject_reason": auto_reason,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        leave_table.put_item(Item=item)

        if status == "AUTO_REJECTED":
            send_auto_reject_email(identity["email"], request_id, auto_reason)
            return json_response(
                200,
                {
                    "message": "Leave request auto-rejected",
                    "request_id": request_id,
                    "status": status,
                    "reason": auto_reason,
                },
            )

        sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=f"SmartLeave Request Submitted - {employee_id} ({leave_type.upper()})",
            Message=(
                "A new leave request has been submitted and entered the approval workflow.\n\n"
                f"Employee ID: {employee_id}\n"
                f"Request ID: {request_id}\n"
                f"Leave Type: {leave_type.upper()}\n"
                f"Dates: {start_date} to {end_date}\n"
                f"Total Days: {total_days}\n\n"
                "Manager action links are sent by the approval workflow notification."
            ),
        )

        stepfunctions.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            input=json.dumps(
                {
                    "employee_id": employee_id,
                    "request_id": request_id,
                    "leave_type": leave_type,
                    "start_date": start_date,
                    "end_date": end_date,
                    "total_days": total_days,
                    "employee_email": identity["email"],
                    "manager_email": identity["manager_email"],
                    "requested_at": datetime.now(timezone.utc).isoformat(),
                }
            ),
        )

        # Requirement: employee receives email at submission stage.
        send_submitted_email(
            identity["email"],
            request_id,
            leave_type,
            start_date,
            end_date,
            total_days,
        )

        return json_response(
            200,
            {"message": "Leave request submitted successfully", "request_id": request_id, "status": "PENDING"},
        )
    except Exception as err:
        return json_response(500, {"error": str(err)})
