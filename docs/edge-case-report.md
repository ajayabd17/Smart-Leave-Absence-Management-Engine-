# Edge Case Report

## 1) Insufficient balance
Scenario:
- Employee submits 4 days of sick leave with only 2 days remaining.

Expected behavior:
- Submission Lambda checks `leave_balances`.
- Request is created with status `AUTO_REJECTED`.
- `decision_reason = INSUFFICIENT_BALANCE`.
- Employee receives SES rejection email immediately.

Validation:
- Confirm no Step Functions execution starts for this request.
- Confirm balance remains unchanged.

## 2) Overlapping approved leave dates
Scenario:
- Employee already has approved leave on `2026-03-20` to `2026-03-22`.
- Employee submits a new request overlapping this interval.

Expected behavior:
- Submission Lambda detects overlap using approved history query.
- Request is rejected with `decision_reason = DATE_OVERLAP`.
- Employee is informed via SES.

Validation:
- Confirm request is not routed to manager.
- Confirm duplicate/overlap record not present in team calendar.

## 3) Manager inaction after 48 hours
Scenario:
- Manager does not act on pending request within 48 hours.

Expected behavior:
- Step Functions wait-and-check loop tracks elapsed hours.
- At `>= 48h`, workflow invokes escalation Lambda.
- Escalation sends reminder to manager and CC to HR admin.
- Request remains pending until manager/HR action.

Validation:
- Confirm escalation event in execution history.
- Confirm reminder email/SNS delivery logs.
- Confirm no balance deduction until final approval.
