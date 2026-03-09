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

## Repo artifacts
- DynamoDB schema: `infra/dynamodb-schema.md`
- State machine definition: `infra/step-functions/leave-approval-state-machine.asl.json`
- Balance logic walkthrough: `docs/balance-logic-walkthrough.md`
- Edge case report: `docs/edge-case-report.md`
