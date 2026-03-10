import json
import os
import traceback
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key


dynamodb = boto3.resource("dynamodb")
leave_table = dynamodb.Table(os.environ["LEAVE_TABLE"])
directory_table = dynamodb.Table(os.environ["DIRECTORY_TABLE"])


def decimal_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError


def resolve_identity(event):
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    if not claims:
        raise PermissionError("Missing JWT claims")

    user_sub = claims.get("sub")
    if not user_sub:
        raise PermissionError("Missing user sub in JWT claims")

    row = directory_table.get_item(Key={"user_sub": user_sub}).get("Item")
    if not row:
        raise PermissionError("User not registered in employee_directory")

    if not row.get("role"):
        groups = claims.get("cognito:groups", [])
        if isinstance(groups, str):
            groups = [g.strip() for g in groups.replace("[", "").replace("]", "").split(",") if g.strip()]
        if "HR_Admin" in groups:
            row["role"] = "HR_Admin"
        elif "Manager" in groups:
            row["role"] = "Manager"
        else:
            row["role"] = "Employee"

    return row


def scan_all(table, filter_expression):
    rows = []
    response = table.scan(FilterExpression=filter_expression)
    rows.extend(response.get("Items", []))
    while "LastEvaluatedKey" in response:
        response = table.scan(
            FilterExpression=filter_expression,
            ExclusiveStartKey=response["LastEvaluatedKey"],
        )
        rows.extend(response.get("Items", []))
    return rows


def lambda_handler(event, context):
    try:
        print("Incoming event:", json.dumps(event))
        identity = resolve_identity(event)
        role = identity.get("role")
        print("Resolved identity:", identity)

        if role not in ["Manager", "HR_Admin"]:
            return {"statusCode": 403, "body": json.dumps({"error": "Forbidden"})}

        pending_rows = scan_all(
            leave_table,
            filter_expression=Attr("status").eq("PENDING")
            | Attr("status").eq("MANAGER_APPROVED")
        )
        print("Pending rows count:", len(pending_rows))

        if role == "HR_Admin":
            filtered = [item for item in pending_rows if item.get("approval_stage") in ["MANAGER", "HR"]]
        else:
            manager_emp_id = identity.get("employee_id")
            if not manager_emp_id:
                return {"statusCode": 403, "body": json.dumps({"error": "Manager employee_id missing"})}

            team_rows = scan_all(
                directory_table,
                filter_expression=Attr("manager_employee_id").eq(manager_emp_id),
            )
            print("Team rows count:", len(team_rows))
            team_ids = {row["employee_id"] for row in team_rows}
            filtered = [
                item
                for item in pending_rows
                if item.get("employee_id") in team_ids and item.get("approval_stage") == "MANAGER"
            ]
        print("Filtered rows count:", len(filtered))

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(filtered, default=decimal_default),
        }
    except PermissionError as err:
        print("Permission error:", str(err))
        return {"statusCode": 403, "body": json.dumps({"error": str(err)})}
    except Exception as err:
        print("Unhandled error:", str(err))
        print(traceback.format_exc())
        return {"statusCode": 500, "body": json.dumps({"error": str(err)})}
