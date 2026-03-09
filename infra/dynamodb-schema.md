# DynamoDB Schema

## 1) `leave_requests`
- `PK`: `employee_id` (String)
- `SK`: `request_id` (String, ULID/UUID)
- Attributes:
- `leave_type` (String: `SICK|CASUAL|EARNED|UNPAID`)
- `start_date` (String, `YYYY-MM-DD`)
- `end_date` (String, `YYYY-MM-DD`)
- `total_days` (Number)
- `reason` (String)
- `status` (String: `SUBMITTED|MANAGER_APPROVED|HR_APPROVED|APPROVED|REJECTED|AUTO_REJECTED`)
- `approval_stage` (String: `MANAGER|HR|FINAL`)
- `manager_id` (String)
- `hr_admin_id` (String, optional)
- `decision_reason` (String, optional)
- `created_at` (String, ISO timestamp)
- `updated_at` (String, ISO timestamp)
- `expires_at` (Number, epoch seconds for TTL on stale pending requests, optional)

Recommended GSIs:
- `GSI1` (`status`, `created_at`) for pending queue.
- `GSI2` (`manager_id`, `status`) for manager workload.
- `GSI3` (`start_date`, `end_date`) for calendar/report windows.

## 2) `leave_balances`
- `PK`: `employee_id` (String)
- `SK`: `leave_type#year` (String, e.g., `EARNED#2026`)
- Attributes:
- `leave_type` (String)
- `year` (Number)
- `total_quota` (Number)
- `remaining_balance` (Number)
- `carry_forward` (Number, optional)
- `last_accrual_at` (String, ISO timestamp, optional)
- `updated_at` (String, ISO timestamp)

Rule: balance decrement happens only at final approval state.

## 3) `leave_type_config`
- `PK`: `leave_type` (String)
- `SK`: `config_version` (String; use `active`)
- Attributes:
- `display_name` (String)
- `annual_quota` (Number)
- `requires_balance` (Boolean)
- `allow_carry_forward` (Boolean)
- `max_continuous_days` (Number, optional)
- `requires_hr_after_days` (Number; default `5`)
- `is_active` (Boolean)
- `updated_by` (String)
- `updated_at` (String, ISO timestamp)

No leave rules are hardcoded in Lambda; all leave-type behavior is read from this table.
