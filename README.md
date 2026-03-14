# SmartLeave Leave Management System

Production-oriented serverless leave workflow on AWS:
- Employee applies for leave
- Manager approves/rejects via signed email links
- HR approval required when leave duration is greater than 5 days
- Final approval updates balances and notifications
- Weekly accrual via scheduler

## Delivery Artifacts
- DynamoDB schema: [infra/dynamodb-schema.md](infra/dynamodb-schema.md)
- Step Functions definition: [infra/LeaveRequestStateMachine.asl.json](infra/LeaveRequestStateMachine.asl.json)
- Balance rules walkthrough: [docs/balance-logic-walkthrough.md](docs/balance-logic-walkthrough.md)
- E2E checklist: [docs/e2e-demo-checklist.md](docs/e2e-demo-checklist.md)
- Edge-case report: [docs/edge-case-report.md](docs/edge-case-report.md)
- Architecture diagram slot: [docs/architecture.png](docs/architecture.png)
- Workflow diagram slot: [docs/workflow.png](docs/workflow.png)

## Repository Layout
```text
SmartLeaveSystem/
|
|-- backend/
|-- AccrualProcessor/
|-- CreateLeaveRequest/
|-- EscalateManagerInaction/
|-- FinalizeLeave/
|-- GetLeaveBalance/
|-- GetLeaveConfig/
|-- GetLeaveHistory/
|-- GetLeaveRequestStatus/
|-- GetPendingApprovals/
|-- HRApproval/
|-- HRDecisionHandler/
|-- LeaveReport/
|-- ManagerApproval/
|-- ManagerDecisionHandler/
|-- SendEmployeeNotification/
|-- TeamCalendarLambda/
|-- UpdateLeaveConfig/
|-- UpdateLeaveQuota/
|
|-- docs/
|   |-- architecture.png
|   |-- workflow.png
|   |-- balance-logic-walkthrough.md
|   |-- e2e-demo-checklist.md
|   -- edge-case-report.md
|
|-- frontend/
|   |-- index.html
|   |-- employee.html
|   |-- manager.html
|   |-- hr-admin.html
|   |-- common.js
|   |-- login.js
|   |-- employee.js
|   |-- manager.js
|   |-- hr-admin.js
|   |-- data-mock.js
|   -- style.css
|
|-- infra/
|   |-- LeaveRequestStateMachine.asl.json
|   |-- dynamodb-schema.md
|   -- template.yaml
|
|-- scripts/
|   |-- deploy.ps1
|   -- run-tests.ps1
|
|-- .github/
-- README.md
```

Structure notes:
- `frontend/` contains the complete static S3 site bundle. Upload the contents of this folder to the website bucket root.
- Lambda folders at the repo root mirror the direct AWS Toolkit upload flow, one function per folder.
- `backend/` keeps the shared SAM/local implementation and tests.
- `infra/` holds the canonical infrastructure artifacts used for delivery review.

## API Routes (current model)
- `POST /leave/apply`
- `GET /leave/balance`
- `GET /leave/history`
- `GET /leave/pending`
- `GET /leave/calendar`
- `GET /leave/config`
- `PUT /leave/config/update`
- `PUT /leave/quota/update`
- `GET /leave/approve` (signed token link flow)
- `GET /leave/report?format=csv|pdf`
- `GET /identity/me`

## Identity Rule
- Frontend must not send `employee_id` for employee operations.
- Backend resolves user identity from JWT + `employee_directory`.

## Deployment

### Option A: Repeatable stack deployment (recommended)
```powershell
.\scripts\deploy.ps1 `
  -StackName smartleave-dev `
  -S3Bucket <sam-artifact-bucket> `
  -CognitoUserPoolId <user-pool-id> `
  -CognitoClientId <app-client-id> `
  -SesFromEmail <verified-email> `
  -ApprovalTokenSecret <strong-secret> `
  -AllowedOrigin http://localhost:8000 `
  -ApprovalBaseUrl https://<api-id>.execute-api.ap-south-1.amazonaws.com `
  -Region ap-south-1
```

### Option B: Direct Lambda upload from VS Code AWS Toolkit
1. Open each function folder `lambda_function.py`.
2. Upload code to corresponding Lambda.
3. Update environment variables per function.
4. Update API Gateway route integrations and JWT auth.
5. Deploy API stage.
6. Update Step Functions definition from:
   - `infra/LeaveRequestStateMachine.asl.json` (canonical)

## Frontend Configuration
- `frontend/common.js` runtime config:
  - `API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com`
- Host static files in S3 (or local dev server).
- For local testing, serve from the repository root and open `frontend/index.html`, or serve the `frontend/` directory directly.
- Ensure API CORS allows both:
  - `http://localhost:8000`
  - your S3 website origin

## Local Validation
```powershell
.\scripts\run-tests.ps1
```

## Function Variables (key ones)
- `ManagerDecisionHandler`:
  - `LEAVE_TABLE`, `DIRECTORY_TABLE`, `TOKEN_SECRET`, `SES_FROM_EMAIL`, `HR_APPROVAL_FUNCTION`, `FINALIZE_FUNCTION`
- `FinalizeLeave`:
  - `LEAVE_TABLE`, `BALANCE_TABLE`
- `UpdateLeaveQuota`:
  - `BALANCE_TABLE`, `DIRECTORY_TABLE`, `CONFIG_TABLE`
- `SendEmployeeNotification`:
  - `SENDER_EMAIL`
- `LeaveReport`:
  - `LEAVE_TABLE`, `DIRECTORY_TABLE`

## Test and Validation
1. Employee apply flow
2. Manager signed-link decision
3. HR signed-link decision for `> 5 days`
4. Finalization + balance deduction only at final approval
5. SES mail confirmations
6. Report download (`csv`, `pdf`)
7. 48-hour escalation path

Use [docs/e2e-demo-checklist.md](docs/e2e-demo-checklist.md) for evidence capture.
