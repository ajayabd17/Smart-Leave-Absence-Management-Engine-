# End-to-End Demo Checklist

## Demo flow
1. Employee logs in and submits leave request.
2. Manager receives signed approval link email and approves.
3. Step Functions execution shows branch:
- `<= 5 days`: manager approval to finalization
- `> 5 days`: manager approval to HR approval to finalization
4. Employee receives SES status email updates.

## Evidence to capture
- Screenshot: leave submission on employee UI.
- Screenshot: manager approval action.
- Screenshot: Step Functions execution graph.
- Screenshot: SES approval/rejection email in inbox.
- Screenshot: updated leave balance and calendar entry.

## Manager Dashboard E2E (Model Alignment)
1. Login as a `Manager` user.
2. Open `manager.html`.
3. Verify `Pending Approvals` list contains only manager-stage requests:
- `approval_stage=MANAGER` (or blank) and `status=PENDING`.
- No HR-stage request should be shown.
4. Verify notification bell:
- New manager requests appear as `NEW_PENDING`.
- Items removed from queue appear as `REMOVED_FROM_QUEUE`.
- HR-only requests must not appear.
5. Verify team leave calendar:
- Calendar shows approved absences only (no pending rows).
- Month navigation updates day markers and stats.
6. Verify report downloads:
- `CSV` download succeeds (API report or frontend fallback CSV).
- `PDF` download succeeds when `/leave/report?format=pdf` is available.

## Repo artifacts
- DynamoDB schema: `infra/dynamodb-schema.md`
- State machine definition: `infra/step-functions/leave-approval-state-machine.asl.json`
- Balance logic walkthrough: `docs/balance-logic-walkthrough.md`
- Edge case report: `docs/edge-case-report.md`
