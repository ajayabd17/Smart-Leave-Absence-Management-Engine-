import base64
import hashlib
import hmac
import json
import os
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

try:
    import boto3
    from boto3.dynamodb.conditions import Attr, Key
except ModuleNotFoundError:
    boto3 = None
    Attr = None
    Key = None


if boto3:
    dynamodb = boto3.resource("dynamodb")
    ddb_client = boto3.client("dynamodb")
    lambda_client = boto3.client("lambda")
    ses_client = boto3.client("ses")
    sns_client = boto3.client("sns")
    sf_client = boto3.client("stepfunctions")
else:
    dynamodb = None
    ddb_client = None
    lambda_client = None
    ses_client = None
    sns_client = None
    sf_client = None


def get_table(env_key: str):
    if not dynamodb:
        raise RuntimeError("boto3 is required for DynamoDB table operations")
    return dynamodb.Table(os.environ[env_key])


def decimal_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def json_response(status_code: int, payload: Dict[str, Any]):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload, default=decimal_default),
    }


def parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    body = event.get("body") or "{}"
    if isinstance(body, str):
        return json.loads(body)
    return body


def get_claims(event: Dict[str, Any]) -> Dict[str, Any]:
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )


def normalize_groups(claims: Dict[str, Any]) -> List[str]:
    groups = claims.get("cognito:groups", [])
    if isinstance(groups, list):
        return groups
    if not groups:
        return []
    groups = str(groups).strip()
    if groups.startswith("[") and groups.endswith("]"):
        groups = groups[1:-1]
    return [g.strip().strip("'").strip('"') for g in groups.split(",") if g.strip()]


def require_groups(event: Dict[str, Any], allowed: List[str]):
    claims = get_claims(event)
    groups = normalize_groups(claims)
    if not any(group in groups for group in allowed):
        raise PermissionError("Forbidden")
    return claims


def resolve_employee_identity(event: Dict[str, Any]) -> Dict[str, str]:
    claims = get_claims(event)
    if not claims:
        raise PermissionError("Missing JWT claims")

    sub = claims.get("sub")
    email = (claims.get("email") or "").strip().lower()
    employee_id = claims.get("custom:employee_id")

    directory_table = get_table("EMPLOYEE_DIRECTORY_TABLE")

    if employee_id:
        return {"employee_id": employee_id, "sub": sub, "email": email}

    if sub:
        by_sub = directory_table.get_item(Key={"user_sub": sub}).get("Item")
        if by_sub and by_sub.get("employee_id"):
            return {"employee_id": by_sub["employee_id"], "sub": sub, "email": email}

    if email:
        email_index = os.environ.get("EMPLOYEE_EMAIL_INDEX", "email_lower-index")
        query = directory_table.query(
            IndexName=email_index,
            KeyConditionExpression=Key("email_lower").eq(email),
            Limit=1,
        )
        if query.get("Items"):
            matched = query["Items"][0]
            return {"employee_id": matched["employee_id"], "sub": sub or "", "email": email}

    raise PermissionError("Employee identity mapping not found")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def days_between(start_date: str, end_date: str) -> int:
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    if end < start:
        raise ValueError("end_date cannot be before start_date")
    return (end - start).days + 1


def overlaps(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    left_a = date.fromisoformat(a_start)
    right_a = date.fromisoformat(a_end)
    left_b = date.fromisoformat(b_start)
    right_b = date.fromisoformat(b_end)
    return not (right_a < left_b or right_b < left_a)


def year_from_date(value: str) -> str:
    return str(date.fromisoformat(value).year)


def leave_key(leave_type: str, year: str) -> str:
    return f"{leave_type.lower()}#{year}"


def create_signed_token(payload: Dict[str, Any], secret: str) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    sig = hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8").rstrip("=")
    return f"{encoded}.{sig}"


def verify_signed_token(token: str, secret: str) -> Dict[str, Any]:
    encoded, signature = token.split(".", 1)
    padded = encoded + ("=" * (-len(encoded) % 4))
    raw = base64.urlsafe_b64decode(padded).decode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise ValueError("Invalid token signature")
    return json.loads(raw)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def notify_async(payload: Dict[str, Any]):
    fn_name = os.environ.get("NOTIFICATION_FUNCTION_NAME")
    if not fn_name or not lambda_client:
        return
    lambda_client.invoke(
        FunctionName=fn_name,
        InvocationType="Event",
        Payload=json.dumps(payload).encode("utf-8"),
    )


def get_request_by_id(request_id: str) -> Optional[Dict[str, Any]]:
    request_table = get_table("LEAVE_REQUESTS_TABLE")
    request_index = os.environ.get("LEAVE_REQUEST_ID_INDEX", "request_id-index")
    try:
        response = request_table.query(
            IndexName=request_index,
            KeyConditionExpression=Key("request_id").eq(request_id),
            Limit=1,
        )
        if response.get("Items"):
            return response["Items"][0]
    except Exception:
        pass

    scan = request_table.scan(
        FilterExpression=Attr("request_id").eq(request_id),
        Limit=1,
    )
    items = scan.get("Items", [])
    return items[0] if items else None
