import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone

from boto3.dynamodb.conditions import Attr, Key

from lib import (
    create_signed_token,
    days_between,
    get_request_by_id,
    get_table,
    json_response,
    leave_key,
    notify_async,
    now_iso,
    overlaps,
    parse_body,
    require_groups,
    resolve_employee_identity,
    token_hash,
    verify_signed_token,
    year_from_date,
    sf_client,
    ses_client,
    get_claims,
    normalize_groups,
)


def get_leave_config_handler(event, context):
    try:
        require_groups(event, ["Employee", "Manager", "HR_Admin"])
        config_table = get_table("LEAVE_CONFIG_TABLE")
        year = (event.get("queryStringParameters") or {}).get("year", str(date.today().year))

        response = config_table.query(KeyConditionExpression=Key("year").eq(year))
        items = response.get("Items", [])
        return json_response(200, items)
    except PermissionError:
        return json_response(403, {"error": "Forbidden"})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def identity_me_handler(event, context):
    try:
        claims = get_claims(event)
        if not claims:
            return json_response(401, {"error": "Unauthorized"})
        groups = normalize_groups(claims)
        role = "Employee"
        if "HR_Admin" in groups:
            role = "HR_Admin"
        elif "Manager" in groups:
            role = "Manager"

        identity = resolve_employee_identity(event)
        return json_response(
            200,
            {
                "role": role,
                "groups": groups,
                "employee_id": identity["employee_id"],
                "email": identity["email"],
            },
        )
    except PermissionError:
        return json_response(403, {"error": "Forbidden"})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def update_leave_config_handler(event, context):
    try:
        require_groups(event, ["HR_Admin"])
        body = parse_body(event)

        leave_type = body["leave_type"].lower()
        annual_quota = int(body["annual_quota"])
        year = str(body.get("year", date.today().year))

        config_table = get_table("LEAVE_CONFIG_TABLE")
        config_table.put_item(
            Item={
                "year": year,
                "leave_type": leave_type,
                "annual_quota": annual_quota,
                "requires_balance": bool(body.get("requires_balance", leave_type != "unpaid")),
                "requires_hr_after_days": int(body.get("requires_hr_after_days", 5)),
                "weekly_accrual": int(body.get("weekly_accrual", 0)),
                "is_active": bool(body.get("is_active", True)),
                "updated_at": now_iso(),
            }
        )
        return json_response(200, {"message": "Leave configuration updated"})
    except PermissionError:
        return json_response(403, {"error": "Forbidden"})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def get_leave_balance_handler(event, context):
    try:
        identity = resolve_employee_identity(event)
        balance_table = get_table("LEAVE_BALANCES_TABLE")
        rows = balance_table.query(
            KeyConditionExpression=Key("employee_id").eq(identity["employee_id"])
        ).get("Items", [])
        return json_response(200, rows)
    except PermissionError:
        return json_response(403, {"error": "Forbidden"})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def get_leave_history_handler(event, context):
    try:
        identity = resolve_employee_identity(event)
        leave_table = get_table("LEAVE_REQUESTS_TABLE")
        rows = leave_table.query(
            KeyConditionExpression=Key("employee_id").eq(identity["employee_id"])
        ).get("Items", [])
        rows.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        return json_response(200, rows)
    except PermissionError:
        return json_response(403, {"error": "Forbidden"})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def create_leave_request_handler(event, context):
    try:
        identity = resolve_employee_identity(event)
        body = parse_body(event)

        leave_type = body["leave_type"].lower()
        start_date = body["start_date"]
        end_date = body["end_date"]
        reason = body.get("reason", "")
        manager_email = body.get("manager_email", "")
        total_days = days_between(start_date, end_date)
        year = year_from_date(start_date)

        leave_table = get_table("LEAVE_REQUESTS_TABLE")
        balance_table = get_table("LEAVE_BALANCES_TABLE")
        config_table = get_table("LEAVE_CONFIG_TABLE")

        cfg = config_table.get_item(Key={"year": year, "leave_type": leave_type}).get("Item")
        if not cfg or not cfg.get("is_active", True):
            return json_response(400, {"error": "Leave type not configured"})

        if date.fromisoformat(start_date) < date.today():
            return json_response(400, {"error": "Cannot apply for past dates"})

        existing = leave_table.query(
            KeyConditionExpression=Key("employee_id").eq(identity["employee_id"])
        ).get("Items", [])
        for row in existing:
            if row.get("status") not in ["PENDING", "SUBMITTED", "MANAGER_APPROVED", "HR_APPROVED", "APPROVED"]:
                continue
            if overlaps(start_date, end_date, row["start_date"], row["end_date"]):
                return json_response(400, {"error": "Leave request overlaps with existing leave"})

        requires_balance = bool(cfg.get("requires_balance", leave_type != "unpaid"))
        if requires_balance:
            balance_item = balance_table.get_item(
                Key={"employee_id": identity["employee_id"], "leave_type#year": leave_key(leave_type, year)}
            ).get("Item")
            if not balance_item:
                return json_response(400, {"error": "Leave balance not configured"})
            remaining = int(balance_item.get("remaining_balance", 0))
            if remaining < total_days:
                return json_response(400, {"error": "Insufficient leave balance"})

        request_id = str(uuid.uuid4())
        row = {
            "employee_id": identity["employee_id"],
            "request_id": request_id,
            "user_sub": identity["sub"],
            "employee_email": identity["email"],
            "leave_type": leave_type,
            "start_date": start_date,
            "end_date": end_date,
            "total_days": total_days,
            "reason": reason,
            "status": "PENDING",
            "approval_stage": "MANAGER",
            "manager_email": manager_email,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        leave_table.put_item(Item=row)

        sf_client.start_execution(
            stateMachineArn=os.environ["STATE_MACHINE_ARN"],
            input=json.dumps({"request_id": request_id, "employee_id": identity["employee_id"]}),
        )

        notify_async(
            {
                "to": identity["email"],
                "subject": "Leave request submitted",
                "text": f"Your leave request {request_id} was submitted.",
            }
        )

        return json_response(200, {"message": "Leave request submitted successfully", "request_id": request_id})
    except PermissionError:
        return json_response(403, {"error": "Forbidden"})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def get_pending_approvals_handler(event, context):
    try:
        claims = require_groups(event, ["Manager", "HR_Admin"])
        groups = claims.get("cognito:groups", [])
        if not isinstance(groups, list):
            groups = str(groups).split(",") if groups else []

        leave_table = get_table("LEAVE_REQUESTS_TABLE")
        rows = leave_table.scan(
            FilterExpression=Attr("status").eq("PENDING")
            | Attr("status").eq("MANAGER_APPROVED")
        ).get("Items", [])

        if "HR_Admin" not in groups:
            rows = [r for r in rows if r.get("approval_stage") == "MANAGER"]
        else:
            rows = [r for r in rows if r.get("approval_stage") in ["MANAGER", "HR"]]

        return json_response(200, rows)
    except PermissionError:
        return json_response(403, {"error": "Forbidden"})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def manager_decision_handler(event, context):
    try:
        claims = None
        body = parse_body(event)
        request_id = body.get("request_id")
        decision = body.get("decision", "").upper()
        signed_token = body.get("signed_token")

        if not signed_token:
            claims = require_groups(event, ["Manager", "HR_Admin"])

        if decision not in ["APPROVED", "REJECTED"]:
            return json_response(400, {"error": "Invalid decision"})

        if signed_token:
            token_data = verify_signed_token(signed_token, os.environ["APPROVAL_TOKEN_SECRET"])
            if token_data.get("request_id") != request_id:
                return json_response(400, {"error": "Token request mismatch"})
            if datetime.now(timezone.utc).timestamp() > int(token_data.get("exp", 0)):
                return json_response(401, {"error": "Signed token expired"})
            token_table = get_table("APPROVAL_TOKENS_TABLE")
            hash_key = token_hash(signed_token)
            token_row = token_table.get_item(Key={"token_hash": hash_key}).get("Item")
            if not token_row or token_row.get("used"):
                return json_response(401, {"error": "Signed token already used"})
            token_table.update_item(
                Key={"token_hash": hash_key},
                UpdateExpression="SET used=:u, used_at=:at",
                ExpressionAttributeValues={":u": True, ":at": now_iso()},
            )

        request = get_request_by_id(request_id)
        if not request:
            return json_response(404, {"error": "Request not found"})

        leave_table = get_table("LEAVE_REQUESTS_TABLE")
        if decision == "REJECTED":
            next_status = "REJECTED"
            next_stage = "FINAL"
        else:
            next_status = "MANAGER_APPROVED" if int(request.get("total_days", 0)) > 5 else "HR_APPROVED"
            next_stage = "HR" if int(request.get("total_days", 0)) > 5 else "FINAL"

        leave_table.update_item(
            Key={"employee_id": request["employee_id"], "request_id": request["request_id"]},
            UpdateExpression="SET #status=:status, approval_stage=:stage, updated_at=:updated",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={":status": next_status, ":stage": next_stage, ":updated": now_iso()},
        )

        notify_async(
            {
                "to": request.get("employee_email", ""),
                "subject": "Leave request updated",
                "text": f"Request {request_id} changed to {next_status}",
            }
        )
        return json_response(200, {"message": "Decision applied", "status": next_status})
    except PermissionError:
        return json_response(403, {"error": "Forbidden"})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def update_leave_quota_handler(event, context):
    try:
        require_groups(event, ["HR_Admin"])
        body = parse_body(event)

        employee_id = body["employee_id"]
        leave_type = body["leave_type"].lower()
        new_quota = int(body["new_quota"])
        year = str(body.get("year", date.today().year))
        balance_table = get_table("LEAVE_BALANCES_TABLE")

        key = {"employee_id": employee_id, "leave_type#year": leave_key(leave_type, year)}
        existing = balance_table.get_item(Key=key).get("Item", {})
        used = int(existing.get("used_days", 0))
        remaining = max(new_quota - used, 0)

        balance_table.put_item(
            Item={
                "employee_id": employee_id,
                "leave_type#year": leave_key(leave_type, year),
                "total_quota": new_quota,
                "used_days": used,
                "remaining_balance": remaining,
                "updated_at": now_iso(),
            }
        )
        return json_response(200, {"message": "Quota updated"})
    except PermissionError:
        return json_response(403, {"error": "Forbidden"})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def team_calendar_handler(event, context):
    try:
        require_groups(event, ["Manager", "HR_Admin"])
        leave_table = get_table("LEAVE_REQUESTS_TABLE")
        rows = leave_table.scan(
            FilterExpression=Attr("status").eq("APPROVED") | Attr("status").eq("HR_APPROVED")
        ).get("Items", [])
        return json_response(200, rows)
    except PermissionError:
        return json_response(403, {"error": "Forbidden"})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def send_employee_notification_handler(event, context):
    try:
        body = parse_body(event)
        to = body["to"]
        subject = body["subject"]
        text = body.get("text", "")
        html = body.get("html", f"<p>{text}</p>")

        ses_client.send_email(
            Source=os.environ["SES_FROM_EMAIL"],
            Destination={"ToAddresses": [to]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Text": {"Data": text, "Charset": "UTF-8"}, "Html": {"Data": html, "Charset": "UTF-8"}},
            },
        )
        return json_response(200, {"message": "Notification sent"})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def accrual_processor_handler(event, context):
    try:
        balance_table = get_table("LEAVE_BALANCES_TABLE")
        config_table = get_table("LEAVE_CONFIG_TABLE")
        year = str(date.today().year)
        cfg_rows = config_table.query(KeyConditionExpression=Key("year").eq(year)).get("Items", [])
        cfg_map = {row["leave_type"]: row for row in cfg_rows}

        rows = balance_table.scan().get("Items", [])
        updated = 0
        for row in rows:
            leave_type, key_year = row["leave_type#year"].split("#", 1)
            if key_year != year:
                continue
            cfg = cfg_map.get(leave_type)
            if not cfg:
                continue
            weekly = int(cfg.get("weekly_accrual", 0))
            if weekly <= 0:
                continue

            remaining = int(row.get("remaining_balance", 0)) + weekly
            total = int(row.get("total_quota", 0))
            remaining = min(remaining, total)

            balance_table.update_item(
                Key={"employee_id": row["employee_id"], "leave_type#year": row["leave_type#year"]},
                UpdateExpression="SET remaining_balance=:rb, updated_at=:updated",
                ExpressionAttributeValues={":rb": remaining, ":updated": now_iso()},
            )
            updated += 1

        return json_response(200, {"message": "Accrual complete", "updated_records": updated})
    except Exception as err:
        return json_response(500, {"error": str(err)})


def generate_manager_links_handler(event, context):
    try:
        body = parse_body(event)
        request_id = body["request_id"]
        manager_email = body["manager_email"]
        exp = int((datetime.now(timezone.utc) + timedelta(hours=48)).timestamp())

        token_payload_approve = {"request_id": request_id, "decision": "APPROVED", "exp": exp}
        token_payload_reject = {"request_id": request_id, "decision": "REJECTED", "exp": exp}
        secret = os.environ["APPROVAL_TOKEN_SECRET"]

        token_approve = create_signed_token(token_payload_approve, secret)
        token_reject = create_signed_token(token_payload_reject, secret)
        table = get_table("APPROVAL_TOKENS_TABLE")

        table.put_item(
            Item={"token_hash": token_hash(token_approve), "request_id": request_id, "decision": "APPROVED", "exp": exp, "used": False}
        )
        table.put_item(
            Item={"token_hash": token_hash(token_reject), "request_id": request_id, "decision": "REJECTED", "exp": exp, "used": False}
        )

        base_url = os.environ["APPROVAL_BASE_URL"]
        approve_link = f"{base_url}/manager.html?request_id={request_id}&decision=APPROVED&token={token_approve}"
        reject_link = f"{base_url}/manager.html?request_id={request_id}&decision=REJECTED&token={token_reject}"

        notify_async(
            {
                "to": manager_email,
                "subject": f"Leave approval required {request_id}",
                "text": f"Approve: {approve_link}\nReject: {reject_link}",
            }
        )
        return json_response(200, {"message": "Links generated"})
    except Exception as err:
        return json_response(500, {"error": str(err)})
