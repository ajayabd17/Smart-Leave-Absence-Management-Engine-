import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3


dynamodb = boto3.resource("dynamodb")
ses = boto3.client("ses")

balance_table = dynamodb.Table(os.environ["BALANCE_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])
config_table = dynamodb.Table(os.environ["CONFIG_TABLE"])
SENDER_EMAIL = os.environ.get("SENDER_EMAIL") or os.environ.get("SES_FROM_EMAIL", "")
DEFAULT_YEAR = os.environ.get("DEFAULT_YEAR")


def scan_all(table, **kwargs):
    items = []
    response = table.scan(**kwargs)
    items.extend(response.get("Items", []))
    while "LastEvaluatedKey" in response:
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"], **kwargs)
        items.extend(response.get("Items", []))
    return items


def to_int(value, default=0):
    if value is None:
        return default
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(value)
    except Exception:
        return default


def to_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ["1", "true", "yes", "y"]
    return bool(value)


def get_config_map(year):
    rows = scan_all(config_table)
    config_map = {}
    for row in rows:
        if str(row.get("year")) != str(year):
            continue
        leave_type = str(row.get("leave_type", "")).lower().strip()
        if not leave_type:
            continue
        config_map[leave_type] = row
    return config_map


def get_active_users():
    users = scan_all(directory_table)
    by_emp = {}
    for user in users:
        employee_id = user.get("employee_id")
        if not employee_id:
            continue
        if str(user.get("status", "ACTIVE")).upper() != "ACTIVE":
            continue
        by_emp[employee_id] = user
    return by_emp


def send_summary(email, employee_id, year, lines):
    if not email or not SENDER_EMAIL:
        return False
    body = [
        "SmartLeave Weekly Balance Summary",
        "",
        f"Employee ID: {employee_id}",
        f"Year: {year}",
        "",
    ] + lines
    ses.send_email(
        Source=SENDER_EMAIL,
        Destination={"ToAddresses": [email]},
        Message={
            "Subject": {"Data": f"SmartLeave Weekly Balance Summary - {employee_id}"},
            "Body": {"Text": {"Data": "\n".join(body)}},
        },
    )
    return True


def lambda_handler(event, context):
    now = datetime.now(timezone.utc)
    year = int(DEFAULT_YEAR) if DEFAULT_YEAR else now.year

    config_map = get_config_map(year)
    users_by_emp = get_active_users()

    balances = scan_all(balance_table)
    balances_by_key = {}
    for row in balances:
        employee_id = row.get("employee_id")
        type_year = row.get("leave_type#year", "")
        if not employee_id or "#" not in str(type_year):
            continue
        leave_type, leave_year = str(type_year).split("#", 1)
        if str(leave_year) != str(year):
            continue
        balances_by_key[(employee_id, leave_type.lower())] = row

    updates = 0
    errors = 0
    summary_by_employee = {employee_id: [] for employee_id in users_by_emp.keys()}

    for employee_id in users_by_emp.keys():
        for leave_type, cfg in config_map.items():
            # Unpaid must not accrue as quota.
            if leave_type == "unpaid":
                continue
            if not to_bool(cfg.get("is_active", True), True):
                continue
            if not to_bool(cfg.get("accrual_enabled", True), True):
                continue

            accrual_per_week = to_int(cfg.get("accrual_per_week", cfg.get("weekly_accrual", 0)), 0)
            if accrual_per_week <= 0:
                continue

            total_quota = to_int(cfg.get("annual_quota", cfg.get("quota", 0)), 0)
            max_balance_cfg = to_int(cfg.get("max_balance", total_quota), total_quota)
            max_balance = max(total_quota, max_balance_cfg)
            key = (employee_id, leave_type)

            existing = balances_by_key.get(key)
            current_remaining = to_int(existing.get("remaining_balance"), 0) if existing else 0
            used_days = to_int(existing.get("used_days"), 0) if existing else 0
            type_year = f"{leave_type}#{year}"

            new_remaining = min(current_remaining + accrual_per_week, max_balance)
            if new_remaining != current_remaining or not existing:
                try:
                    balance_table.update_item(
                        Key={"employee_id": employee_id, "leave_type#year": type_year},
                        UpdateExpression=(
                            "SET remaining_balance=:r, total_quota=:q, used_days=:u, updated_at=:t"
                        ),
                        ExpressionAttributeValues={
                            ":r": new_remaining,
                            ":q": total_quota,
                            ":u": used_days,
                            ":t": now.isoformat(),
                        },
                    )
                    updates += 1
                except Exception:
                    errors += 1
                    continue

            summary_by_employee[employee_id].append(
                f"- {leave_type.upper()}: {new_remaining}/{total_quota} remaining"
            )

    emails_sent = 0
    for employee_id, lines in summary_by_employee.items():
        if not lines:
            continue
        user = users_by_emp.get(employee_id, {})
        email = user.get("email") or user.get("email_lower") or ""
        try:
            if send_summary(email, employee_id, year, lines):
                emails_sent += 1
        except Exception:
            errors += 1

    return {
        "message": "Weekly accrual processed",
        "year": year,
        "employees_processed": len(users_by_emp),
        "balance_updates": updates,
        "emails_sent": emails_sent,
        "errors": errors,
    }
