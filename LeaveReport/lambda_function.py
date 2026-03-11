import base64
import io
import json
import os
from datetime import datetime

import boto3
from boto3.dynamodb.conditions import Attr


dynamodb = boto3.resource("dynamodb")
leave_table = dynamodb.Table(os.environ["LEAVE_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])


def json_response(status_code, payload):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload),
    }


def scan_all(table, **kwargs):
    items = []
    response = table.scan(**kwargs)
    items.extend(response.get("Items", []))
    while "LastEvaluatedKey" in response:
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"], **kwargs)
        items.extend(response.get("Items", []))
    return items


def normalize_groups(claims):
    groups = claims.get("cognito:groups", [])
    if isinstance(groups, list):
        return [str(g).strip() for g in groups]
    if isinstance(groups, str):
        cleaned = groups.replace("[", "").replace("]", "")
        return [g.strip() for g in cleaned.split(",") if g.strip()]
    return []


def resolve_identity(event):
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    if not claims:
        raise PermissionError("Missing JWT claims. Configure route authorization as JWT.")

    user_sub = claims.get("sub")
    if not user_sub:
        raise PermissionError("Missing user sub in JWT claims")

    row = directory_table.get_item(Key={"user_sub": user_sub}).get("Item")
    if not row:
        raise PermissionError("User not registered in employee_directory")

    role = str(row.get("role", "")).strip()
    if not role:
        groups = normalize_groups(claims)
        if "HR_Admin" in groups:
            role = "HR_Admin"
        elif "Manager" in groups:
            role = "Manager"
        else:
            role = "Employee"

    email = str(row.get("email") or claims.get("email", "")).strip().lower()
    return {"role": role, "email": email}


def row_visible_for_identity(row, identity):
    role = str(identity.get("role", "")).strip()
    if role == "HR_Admin":
        return True
    if role == "Manager":
        manager_email = str(row.get("manager_email", "")).strip().lower()
        # If row has manager assignment, scope strictly; if missing, keep visible for backward compatibility.
        return not manager_email or manager_email == identity.get("email", "")
    return False


def parse_query(event):
    return event.get("queryStringParameters") or {}


def build_rows(items):
    rows = []
    for item in items:
        rows.append(
            {
                "employee_id": str(item.get("employee_id", "")),
                "leave_type": str(item.get("leave_type", "")).lower(),
                "start_date": str(item.get("start_date", "")),
                "end_date": str(item.get("end_date", "")),
                "status": str(item.get("status", "")),
                "approval_stage": str(item.get("approval_stage", "")),
                "total_days": int(item.get("total_days", 0) or 0),
                "created_at": str(item.get("created_at", "")),
                "manager_email": str(item.get("manager_email", "")),
            }
        )
    rows.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return rows


def escape_csv(value):
    return '"' + str(value).replace('"', '""') + '"'


def build_csv(rows):
    headers = [
        "employee_id",
        "leave_type",
        "start_date",
        "end_date",
        "total_days",
        "status",
        "approval_stage",
        "created_at",
    ]
    out = [",".join(headers)]
    for row in rows:
        out.append(
            ",".join(
                [
                    escape_csv(row.get("employee_id", "")),
                    escape_csv(row.get("leave_type", "")),
                    escape_csv(row.get("start_date", "")),
                    escape_csv(row.get("end_date", "")),
                    escape_csv(row.get("total_days", "")),
                    escape_csv(row.get("status", "")),
                    escape_csv(row.get("approval_stage", "")),
                    escape_csv(row.get("created_at", "")),
                ]
            )
        )
    return "\n".join(out)


def escape_pdf_text(text):
    return str(text).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_simple_pdf(lines):
    # Minimal PDF writer with text lines. No external dependency.
    page_width = 595
    page_height = 842
    margin_left = 40
    margin_top = 40
    line_height = 14
    max_lines = int((page_height - (margin_top * 2)) / line_height)

    pages = []
    current = []
    for line in lines:
        if len(current) >= max_lines:
            pages.append(current)
            current = []
        current.append(line)
    if current:
        pages.append(current)
    if not pages:
        pages = [["No records found."]]

    objects = []

    # 1: Catalog, 2: Pages
    objects.append("<< /Type /Catalog /Pages 2 0 R >>")

    page_obj_ids = []
    content_obj_ids = []
    next_id = 3

    for _ in pages:
        page_obj_ids.append(next_id)
        next_id += 1
        content_obj_ids.append(next_id)
        next_id += 1

    kids = " ".join([f"{pid} 0 R" for pid in page_obj_ids])
    objects.append(f"<< /Type /Pages /Count {len(page_obj_ids)} /Kids [{kids}] >>")

    font_obj_id = next_id
    next_id += 1

    for idx, page_lines in enumerate(pages):
        page_id = page_obj_ids[idx]
        content_id = content_obj_ids[idx]

        page_obj = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width} {page_height}] "
            f"/Resources << /Font << /F1 {font_obj_id} 0 R >> >> "
            f"/Contents {content_id} 0 R >>"
        )
        objects.append(page_obj)

        y = page_height - margin_top
        content_lines = ["BT", "/F1 10 Tf", f"{margin_left} {y} Td"]
        first = True
        for line in page_lines:
            if first:
                content_lines.append(f"({escape_pdf_text(line)}) Tj")
                first = False
            else:
                content_lines.append(f"0 -{line_height} Td")
                content_lines.append(f"({escape_pdf_text(line)}) Tj")
        content_lines.append("ET")
        stream_data = "\n".join(content_lines).encode("latin-1", errors="replace")
        content_obj = f"<< /Length {len(stream_data)} >>\nstream\n{stream_data.decode('latin-1')}\nendstream"
        objects.append(content_obj)

    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    # Build file
    output = io.BytesIO()
    output.write(b"%PDF-1.4\n")

    xref_offsets = [0]
    for i, obj in enumerate(objects, start=1):
        xref_offsets.append(output.tell())
        output.write(f"{i} 0 obj\n".encode("ascii"))
        output.write(obj.encode("latin-1", errors="replace"))
        output.write(b"\nendobj\n")

    xref_pos = output.tell()
    output.write(f"xref\n0 {len(xref_offsets)}\n".encode("ascii"))
    output.write(b"0000000000 65535 f \n")
    for offset in xref_offsets[1:]:
        output.write(f"{offset:010d} 00000 n \n".encode("ascii"))

    output.write(
        (
            "trailer\n"
            f"<< /Size {len(xref_offsets)} /Root 1 0 R >>\n"
            "startxref\n"
            f"{xref_pos}\n"
            "%%EOF\n"
        ).encode("ascii")
    )
    return output.getvalue()


def build_report_lines(rows, title):
    lines = [title, f"Generated: {datetime.utcnow().isoformat()}Z", "-" * 80]
    if not rows:
        lines.append("No records found.")
        return lines

    lines.append("EMPLOYEE | TYPE   | START      | END        | DAYS | STATUS")
    lines.append("-" * 80)
    for row in rows:
        lines.append(
            f"{row['employee_id'][:10]:<10} | "
            f"{row['leave_type'][:6]:<6} | "
            f"{row['start_date'][:10]:<10} | "
            f"{row['end_date'][:10]:<10} | "
            f"{str(row['total_days'])[:4]:<4} | "
            f"{row['status'][:20]}"
        )
    return lines


def lambda_handler(event, context):
    try:
        identity = resolve_identity(event)
        if identity["role"] not in ["Manager", "HR_Admin"]:
            return json_response(403, {"error": "Forbidden"})

        query = parse_query(event)
        fmt = str(query.get("format", "csv")).strip().lower()
        status_filter = str(query.get("status", "")).strip().upper()

        items = scan_all(leave_table)
        visible = [row for row in items if row_visible_for_identity(row, identity)]
        rows = build_rows(visible)

        if status_filter:
            rows = [row for row in rows if str(row.get("status", "")).upper() == status_filter]

        if fmt == "csv":
            csv_text = build_csv(rows)
            return {
                "statusCode": 200,
                "headers": {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": f'attachment; filename="leave-report-{datetime.utcnow().strftime("%Y-%m-%d")}.csv"',
                },
                "body": csv_text,
            }

        if fmt == "pdf":
            title = "SmartLeave Report"
            lines = build_report_lines(rows, title)
            pdf_bytes = build_simple_pdf(lines)
            return {
                "statusCode": 200,
                "isBase64Encoded": True,
                "headers": {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": f'attachment; filename="leave-report-{datetime.utcnow().strftime("%Y-%m-%d")}.pdf"',
                },
                "body": base64.b64encode(pdf_bytes).decode("ascii"),
            }

        return json_response(400, {"error": "Unsupported format. Use format=csv or format=pdf"})
    except PermissionError as err:
        return json_response(403, {"error": str(err)})
    except Exception as err:
        return json_response(500, {"error": str(err)})
