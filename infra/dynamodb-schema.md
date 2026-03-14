# DynamoDB Schema

This is the delivery schema used by the deployed SmartLeave flow.

## 1) `leave_requests`
- `PK`: `employee_id` (String)
- `SK`: `request_id` (String, UUID)

Common attributes:
- `request_id` (String)
- `employee_id` (String)
- `employee_email` (String)
- `manager_email` (String)
- `leave_type` (String: `sick|casual|earned|unpaid`)
- `start_date` (String, `YYYY-MM-DD`)
- `end_date` (String, `YYYY-MM-DD`)
- `total_days` (Number)
- `reason` (String)
- `status` (String: `PENDING|MANAGER_APPROVED|HR_APPROVED|APPROVED|REJECTED|AUTO_REJECTED`)
- `approval_stage` (String: `MANAGER|HR|FINAL`)
- `created_at` (String, ISO timestamp)
- `updated_at` (String, ISO timestamp)

Notes:
- Overlap detection is performed per `employee_id`.
- Balance is decremented only when request reaches final approval (`APPROVED` via `FinalizeLeave`).

## 2) `leave_balances`
- `PK`: `employee_id` (String)
- `SK`: `leave_type#year` (String, example `earned#2026`)

Common attributes:
- `total_quota` (Number)
- `used_days` (Number)
- `remaining_balance` (Number)
- `updated_at` (String, ISO timestamp)
- `updated_by` (String, optional)

Notes:
- `unpaid` leave does not require quota deduction.
- Quota updates are increment-based and capped by `leave_config`.

## 3) `leave_config`
- `PK`: `leave_type` (String)
- `SK`: `year` (String)

Common attributes:
- `annual_quota` or `quota` (Number)
- `requires_balance` (Boolean; unpaid false)
- `requires_hr_after_days` (Number, default `5`)
- `weekly_accrual` (Number)
- `is_active` (Boolean)
- `updated_at` (String, ISO timestamp)

Notes:
- Leave behavior is configuration-driven (no hardcoded type rules in UI/handlers).

## 4) `employee_directory`
- `PK`: `user_sub` (String, Cognito subject)

Common attributes:
- `employee_id` (String)
- `email` / `email_lower` (String)
- `role` (String: `Employee|Manager|HR_Admin`)
- `manager_email` (String, optional)
- `manager_employee_id` (String, required for manager team scoping)

Notes:
- Backend resolves identity and role from JWT + `employee_directory`.
