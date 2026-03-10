import os
from datetime import datetime, timezone

import boto3


dynamodb = boto3.resource("dynamodb")
ses = boto3.client("ses")

balance_table = dynamodb.Table(os.environ["BALANCE_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])
config_table = dynamodb.Table(os.environ["CONFIG_TABLE"])
sender_email = os.environ["SENDER_EMAIL"]


def get_leave_config_map(year):
    rows = config_table.scan().get("Items", [])
    result = {}
    for row in rows:
        if str(row.get("year")) == str(year):
            result[row.get("leave_type", "").lower()] = row
    return result


def send_summary(email, lines):
    if not email:
        return
    ses.send_email(
        Source=sender_email,
        Destination={"ToAddresses": [email]},
        Message={
            "Subject": {"Data": "Weekly Leave Balance Summary"},
            "Body": {"Text": {"Data": "\n".join(lines)}},
        },
    )


def lambda_handler(event, context):
    now = datetime.now(timezone.utc)
    year = now.year
    config_map = get_leave_config_map(year)
    balances = balance_table.scan().get("Items", [])
    users = directory_table.scan().get("Items", [])
    user_by_emp = {u.get("employee_id"): u for u in users}

    summary_by_employee = {}

    for row in balances:
        employee_id = row["employee_id"]
        leave_type, leave_year = row["leave_type#year"].split("#", 1)
        if str(leave_year) != str(year):
            continue

        cfg = config_map.get(leave_type.lower(), {})
        weekly_accrual = int(cfg.get("weekly_accrual", 1 if leave_type.lower() == "earned" else 0))
        max_quota = int(row.get("total_quota", 0))
        if weekly_accrual <= 0:
            continue

        current = int(row.get("remaining_balance", 0))
        new_value = min(current + weekly_accrual, max_quota)
        if new_value != current:
            balance_table.update_item(
                Key={"employee_id": employee_id, "leave_type#year": row["leave_type#year"]},
                UpdateExpression="SET remaining_balance=:new, updated_at=:updated",
                ExpressionAttributeValues={":new": new_value, ":updated": now.isoformat()},
            )

        summary_by_employee.setdefault(employee_id, [])
        summary_by_employee[employee_id].append(
            f"{leave_type} ({year}): {new_value}/{max_quota} remaining"
        )

    for employee_id, lines in summary_by_employee.items():
        email = (user_by_emp.get(employee_id) or {}).get("email_lower", "")
        send_summary(email, [f"Employee: {employee_id}"] + lines)

    return {"message": "Weekly accrual processed successfully", "employees_notified": len(summary_by_employee)}
