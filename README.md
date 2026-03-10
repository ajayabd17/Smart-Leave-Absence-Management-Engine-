# SmartLeave End-to-End

This repository now includes:
- Frontend static app (`index.html`, `employee.html`, `manager.html`, `hr-admin.html` + JS)
- Backend Lambda source (`backend/src`)
- IaC template for API + Lambda + DynamoDB + Step Functions + Scheduler (`infra/template.yaml`)
- Tests (`backend/tests`)
- Deployment scripts (`scripts`)

## API Contract

- `POST /leave/apply`
- `GET /leave/balance`
- `GET /leave/history`
- `GET /leave/pending`
- `POST /leave/approve`
- `GET /leave/calendar`
- `GET /leave/config`
- `POST /leave/config/update`
- `POST /leave/update-quota`
- `GET /identity/me`

Identity rule:
- Employee-facing endpoints never accept `employee_id` from frontend.
- Backend resolves employee identity from JWT + `employee_directory`.

## Backend Structure

- `backend/src/lib.py`: shared helpers (auth, identity resolution, serialization, tokens, notifications)
- `backend/src/handlers.py`: all Lambda handlers

## Local Tests

```powershell
.\scripts\run-tests.ps1
```

## Deploy

```powershell
.\scripts\deploy.ps1 `
  -StackName smartleave-dev `
  -S3Bucket <your-sam-artifact-bucket> `
  -CognitoUserPoolId <your-user-pool-id> `
  -CognitoClientId <your-app-client-id> `
  -SesFromEmail <verified@domain.com> `
  -ApprovalTokenSecret <strong-random-secret> `
  -AllowedOrigin http://localhost:8000 `
  -ApprovalBaseUrl http://localhost:8000 `
  -Region ap-south-1
```

## Frontend Configuration

`common.js` uses:
- `API_BASE_URL = https://<api-id>.execute-api.<region>.amazonaws.com`

For local development:
- Add `http://localhost:8000` in API CORS allow origins.
- Serve static frontend from repository root.

## AWS Notes

- `leave_config` uses partition key `year`, sort key `leave_type`.
- `leave_requests` has GSI `request_id-index` for decision lookup.
- `employee_directory` has GSI `email_lower-index`.
- Weekly accrual schedule is defined as `cron(0 9 ? * MON *)`.
