# Production Deployment Readiness

Phase 31b prepares the fixed IRT, chat-native MVP for a future public HTTPS deployment. It is not a public launch approval, classroom-validity claim, Canvas LTI implementation, or authorization to use real student data before institutional approval.

Run the no-live readiness smoke:

```bash
npm run student:production-deployment-readiness-smoke
```

The smoke prints only safe booleans, variable names, status labels, counts, and output hashes. It must not print `DATABASE_URL`, OpenAI keys, session secrets, raw provider output, raw prompts, answer keys, correct options, or correctness labels. Missing production-only values are reported as documented gaps rather than leaked values.

## Recommended Architecture

Use one deployment instance per course or pilot cohort unless a later multi-course tenancy layer is explicitly designed.

Recommended production shape:

- Next.js Node server, either directly managed by a platform that supports long-running Node apps or packaged as the included Docker container.
- Managed PostgreSQL with automated backups, point-in-time recovery where available, and restricted network access.
- HTTPS domain controlled by the deployment owner.
- Server-side OpenAI credential stored only in the hosting provider's secret manager or an equivalent server-side environment mechanism.
- Export and backup storage outside public web roots.
- Application logs that capture status, public IDs, safe error codes, and counts only.
- Monitoring for `/api/health`, database connectivity, failed login spikes, LLM readiness failures, provider validation failures, and export failures.

The browser must never receive OpenAI credentials, database URLs, session secrets, raw provider payloads, answer keys, correct options, correctness labels, raw distractor metadata, or internal database UUIDs.

## Environments

### Local

Local development uses Docker PostgreSQL, `.env.local`, and `npm run dev` or the local launcher. It may use mock mode or explicitly configured live smoke commands. Generated artifacts belong under `.data/` and remain ignored.

### Staging

Staging should mirror production infrastructure with synthetic accounts and synthetic or approved pilot-test data only. Run migrations with `npm run prisma:migrate:deploy`, seed only safe staging accounts, run the production readiness smoke, and perform a browser walkthrough from a non-developer device.

### Production

Production should use a managed database, HTTPS, server-managed secrets, backups, and explicit classroom/IRB/school approval before real students use the system. Production should not use local demo secrets, local database passwords, `.env.local` files copied from development, or generated `.data/` artifacts.

## Required Environment Variables

Deployment-critical server-side variables:

```text
DATABASE_URL
SESSION_SECRET
LLM_PROVIDER
LLM_LIVE_CALLS_ENABLED
OPENAI_API_KEY or OPENAI_API_KEY_FILE
OPENAI_MODEL_ITEM_ADMIN or OPENAI_MODEL_FOLLOWUP
OPENAI_MODEL_PROFILE_INTEGRATION
OPENAI_MODEL_PLANNING
OPENAI_MODEL_FOLLOWUP
APP_BASE_URL or NEXT_PUBLIC_APP_BASE_URL
COURSE_TIMEZONE
```

Operationally recommended variables:

```text
APP_ENV=staging or production
APP_BASE_URL=https://<deployment-domain>
NEXT_PUBLIC_APP_BASE_URL=https://<deployment-domain>
OPENAI_REQUEST_TIMEOUT_MS
OPENAI_MAX_RETRIES
LLM_DAILY_CLASS_CALL_LIMIT
LLM_DAILY_CLASS_TOKEN_LIMIT
LLM_DAILY_STUDENT_CALL_LIMIT
LLM_DAILY_STUDENT_TOKEN_LIMIT
LLM_SESSION_CALL_LIMIT
LLM_SESSION_TOKEN_LIMIT
LLM_AGENT_CALL_LIMIT_PER_SESSION
WORKFLOW_JOB_MAX_ATTEMPTS
WORKFLOW_JOB_BASE_RETRY_MS
WORKFLOW_JOB_MAX_RETRY_MS
WORKFLOW_JOB_LEASE_TIMEOUT_MS
WORKFLOW_JOB_POLL_INTERVAL_MS
```

Use `.env.example` only as a template. Do not commit real values.

## Secret Rules

- Do not commit `.env`, `.env.local`, credential files, generated review packets, export files, logs, backups, or `.data/`.
- Do not place OpenAI keys, database URLs, auth secrets, cookies, access-code hashes, or bearer tokens in any `NEXT_PUBLIC_` variable.
- `NEXT_PUBLIC_` variables may contain only harmless browser-visible configuration such as the public app origin.
- Do not paste secrets into chat, browser forms, documentation, issue trackers, screenshots, or terminal logs.
- Do not expose raw provider responses, prompts, headers, request bodies, or hidden metadata in student-facing UI.
- Rotate credentials immediately if a secret is suspected to have been exposed.

## Database Deployment

Production deployment should use migration deployment, not `prisma migrate dev`.

Before each deployment:

1. Confirm a recent database backup exists and restore has been tested.
2. Build from a clean commit.
3. Run `npm run prisma:generate`.
4. Run `npm run prisma:migrate:deploy` against the production database.
5. Run `npm run production:readiness`.
6. Start or restart the app.
7. Verify `/api/health` over HTTPS.
8. Run a staging or synthetic browser walkthrough before admitting classroom users.

Do not reset a production database. Do not run local seed commands against production unless a specific production seed procedure has been reviewed.

## Health Checks

### App Health

`GET /api/health` returns safe deployment status:

- application identifier;
- app status;
- database reachable boolean;
- safe migration/readiness indicator;
- safe LLM-readiness instruction;
- environment name;
- server time.

It does not return raw database URLs, credentials, OpenAI keys, provider responses, prompts, token usage, answer keys, or user data.

### Database Health

`/api/health` checks a minimal `SELECT 1`. Use `npm run prisma:migrate:deploy` and `npx prisma migrate status` for migration state. The production readiness smoke runs `npx prisma validate` and invokes `npx prisma migrate status` while suppressing raw output.

### LLM Readiness

Use the CLI:

```bash
npm run llm:readiness
```

This may perform a lightweight authenticated model metadata check when live configuration is present. It must not generate model output. It prints only safe readiness fields and key fingerprints, never the key value.

### Export Readiness

Verify teacher/research export integrity without provider calls:

```bash
npm run student:research-export-integrity-smoke
```

Generated export artifacts remain under ignored local paths and must not be committed.

## Classroom Web Access Plan

1. Deploy a staging HTTPS URL.
2. Run `npm run student:production-deployment-readiness-smoke`.
3. Run `npm run prisma:migrate:deploy`.
4. Confirm `/api/health` returns `200`.
5. Confirm `npm run llm:readiness` reports the intended server-side live readiness before a live pilot.
6. Log in as `teacher_researcher`.
7. Create or import approved student accounts.
8. Give students the public HTTPS URL and approved login/access-code instructions.
9. Have a student open the URL from a non-development device/network.
10. Complete the three protected initial items.
11. Complete the activity response and move-on/choose-another path.
12. Have the teacher inspect readable transcript, structured event log, session evidence audit, and research export.
13. Download research data and run export integrity checks.
14. Record only safe pass/fail observations, public IDs, status fields, and limitations.

Fallback if LLM is unavailable:

- Do not silently reveal internal errors to students.
- Preserve session progress where possible.
- Use the approved safe unavailable messages in the student UI.
- Do not replace live formative activity with review-only deterministic templates.
- Teacher/research review should show sanitized status and audit flags only.

## Data Protection Checklist

Before real classroom use:

- FERPA, IRB, school, and instructor approvals are complete.
- Data retention and deletion procedures are documented.
- Backup policy and restore drill are documented.
- Access to production database and export downloads is restricted.
- Teacher/research export endpoints require `teacher_researcher` authorization.
- Student endpoints do not expose answer keys, correctness labels, distractor metadata, raw provider payloads, prompt text, internal labels, or agent audit metadata.
- Logs exclude raw student reasoning unless explicitly approved by research protocol and protected by the deployment environment.
- Exports exclude restricted item keys by default.
- Restricted item-key export is explicitly requested and handled only by authorized teacher/research users.
- `.env`, `.env.local`, `.data`, credentials, generated exports, and logs are not staged or committed.

## Docker Deployment Path

The included `Dockerfile` builds the Next.js app and runs `npm run start` on port `3000`. It does not include `.env.local`, `.data`, logs, or local generated artifacts because `.dockerignore` excludes them.

Example build:

```bash
docker build -t conversational-mcq:production .
```

Example run shape:

```bash
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e APP_BASE_URL=https://<deployment-domain> \
  -e DATABASE_URL=<managed-postgres-url> \
  -e SESSION_SECRET=<server-secret> \
  conversational-mcq:production
```

Use a managed PostgreSQL service, not the local Docker Compose database, for production. Run migrations before starting or before routing traffic to a new deployment:

```bash
npm run prisma:migrate:deploy
```

## Phase 31b Boundary

Phase 31b adds readiness checks and deployment documentation. It does not implement Canvas LTI, email/SMS delivery, public self-registration, production monitoring integrations, cloud-provider provisioning, or classroom validity. Those require separate approval.
