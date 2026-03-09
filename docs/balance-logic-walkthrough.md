# Balance Logic Walkthrough

## Principle
Leave is deducted only after final approval (`APPROVED`), never on submission.

## Submission-time checks
1. Read active leave config from `leave_type_config`.
2. Validate leave type is active.
3. Validate date range and compute `total_days`.
4. Check overlap against employee's already approved requests.
5. If leave type requires balance:
- fetch `leave_balances` row by `employee_id` + `leave_type#year`
- if `remaining_balance < total_days`: mark request `AUTO_REJECTED` with reason `INSUFFICIENT_BALANCE`.
6. If checks pass, persist request as `SUBMITTED`.

## Approval path
1. Manager decision updates request state.
2. For requests where `total_days > requires_hr_after_days` (default 5), HR approval is mandatory.
3. When final state becomes `APPROVED`, run single atomic update:
- ConditionExpression: request still not finalized.
- decrement `remaining_balance` by `total_days`.
- mark request `finalized_at`.

## Why this prevents double counting
- Requests can be submitted and edited/rejected without touching balances.
- Deduction is done once, at finalization, with a conditional write guard.
- Retries are safe with idempotency key + conditional update.

## Weekly accrual and carry-forward
- EventBridge weekly schedule: `cron(0 9 ? * MON *)` (example).
- `AccrualProcessor`:
- applies carry-forward policy based on `leave_type_config`
- credits earned leave increments
- sends SES summary emails to employees.
