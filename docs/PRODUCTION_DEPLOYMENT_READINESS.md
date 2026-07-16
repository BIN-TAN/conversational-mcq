# Production Deployment Readiness

Phase 31b prepares the fixed IRT, chat-native MVP for a future public HTTPS deployment. The classroom access plan is Canvas-link only: Canvas may host a hyperlink to the public Conversational MCQ website, but Conversational MCQ owns login, activity delivery, teacher review, and export. This is not a public launch approval, classroom-validity claim, Canvas LTI implementation, or authorization to use real student data before institutional approval.

Run the no-live readiness smoke:

```bash
npm run student:production-deployment-readiness-smoke
npm run student:render-staging-readiness-smoke
```

The smoke prints only safe booleans, variable names, status labels, counts, and output hashes. It must not print `DATABASE_URL`, OpenAI keys, session secrets, raw provider output, raw prompts, answer keys, correct options, or correctness labels. Missing production-only values are reported as documented gaps rather than leaked values.

The smoke also reports:

```json
{
  "canvas_access_mode": "external_link",
  "canvas_lti_required": false,
  "canvas_grade_passback_supported": false,
  "public_https_required_for_classroom": true
}
```

## Recommended Architecture

Use one deployment instance per course or pilot cohort unless a later multi-course tenancy layer is explicitly designed.

For the first public HTTPS staging deployment, the recommended path is Render Web Service plus Render Postgres using the checked-in `render.yaml` Blueprint. This is the shortest supported path for Canvas-link classroom access because it provides a public HTTPS URL, a managed Node runtime, and managed PostgreSQL without adding Canvas integration code.

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

Staging should mirror production infrastructure with synthetic accounts and synthetic or approved pilot-test data only. For Phase 31c, use Render Web Service plus Render Postgres as the first staging path. Run migrations with `npm run prisma:migrate:deploy` through Render's pre-deploy step, seed only safe staging accounts, run the production and Render readiness smokes, and perform a browser walkthrough from a non-developer device.

### Production

Production should use a managed database, HTTPS, server-managed secrets, backups, and explicit classroom/IRB/school approval before real students use the system. Production should not use local demo secrets, local database passwords, `.env.local` files copied from development, or generated `.data/` artifacts.

Production `APP_BASE_URL` must be a public HTTPS URL. `localhost`, `127.0.0.1`, and non-HTTPS origins are not valid for classroom access.

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

`NEXT_PUBLIC_APP_BASE_URL` is allowed only because it is harmless browser-visible public URL configuration. Do not put OpenAI keys, database URLs, session secrets, cookies, access-code hashes, authorization headers, or auth tokens in any `NEXT_PUBLIC_` variable.

## Render Staging Deployment

The repository includes `render.yaml` for a Render Blueprint staging deployment:

- Web Service: native Node runtime, `npm ci --include=dev && npm run prisma:generate && npm run build`, `npm run start`.
- Database: Render Postgres, wired to `DATABASE_URL` with `fromDatabase.connectionString`.
- Migration step: `npm run prisma:migrate:deploy` in Render pre-deploy.
- Health check: `/api/health`.
- Secret and deployment-specific fields: marked `sync: false` for Render Dashboard entry.

Run the no-network Render config smoke locally:

```bash
npm run student:render-staging-readiness-smoke
```

Use non-free, staging-friendly Render plans for classroom pilot testing. Free or sleep-prone resources can interrupt student sessions and should not be used for a classroom dry run. Confirm current Render plan names and limits in the Render Dashboard before applying the Blueprint.

For step-by-step Dashboard instructions, see `docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md`.

## Canvas-Link Classroom Access

Canvas is used only as a place to post the public Conversational MCQ URL.

Access model:

```text
Canvas assignment page or Canvas module item
-> public HTTPS Conversational MCQ URL
-> student enters classroom ID and access code/password
-> student completes activity inside Conversational MCQ
-> teacher/researcher reviews and exports data inside Conversational MCQ
```

Supported boundaries:

- Students leave Canvas and open the public Conversational MCQ website.
- Students authenticate in Conversational MCQ with the classroom ID and access code/password supplied by the instructor.
- Teacher/research data review happens in Conversational MCQ, not Canvas.
- Teacher/research export happens in Conversational MCQ, not Canvas.
- Canvas gradebook does not automatically receive completion, scores, statuses, or research data.
- No Canvas LTI, Canvas OAuth, Canvas grade passback, Canvas roster sync, Canvas Developer Key setup, or Canvas API integration is implemented in this phase.

### Canvas Assignment Page

1. Open the Canvas course.
2. Create or edit the assignment.
3. In the assignment description, use the Canvas Rich Content Editor.
4. Add an external hyperlink to the public HTTPS Conversational MCQ URL.
5. Include the classroom ID and access-code/password instructions approved for the pilot.
6. Tell students that completion and research review happen inside Conversational MCQ, not through Canvas grade passback.

Suggested wording:

```text
Open the Conversational MCQ activity using the link below. Use the classroom ID and access code provided by your instructor. Complete the activity in one sitting if possible. If the page says it could not safely review a response, follow the on-screen options to try again, choose another activity, or move on. Your teacher will review completion and research data inside the Conversational MCQ system, not through Canvas grade passback.
```

### Canvas Module Item

1. Open the Canvas module.
2. Add an item to the module.
3. Choose `External URL`.
4. Paste the public HTTPS Conversational MCQ URL.
5. Use `load in new tab` if desired.
6. Tell students to return to Canvas only after finishing the Conversational MCQ activity.

## Future Canvas LTI

Canvas LTI 1.3 may be considered later only after public-link classroom pilots are stable. LTI would require Canvas administrator support, Developer Key configuration, OIDC launch handling, deployment IDs, user/course mapping, grade/service decisions, and separate privacy review. It is not part of the current classroom pilot.

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

## First-Run Staging Bootstrap

Migrations create the database schema but do not automatically create the first pilot teacher account or student access codes. For Render staging, bootstrap must be a separate explicit operator command after migrations, not a Render pre-deploy command that runs on every deploy.

Use:

```bash
npm run staging:bootstrap-pilot
```

with these environment variables set for that command:

```text
BOOTSTRAP_ENABLED=true
BOOTSTRAP_TEACHER_USERNAME=<teacher-user-id>
BOOTSTRAP_TEACHER_PASSWORD=<teacher-password>
BOOTSTRAP_CLASSROOM_ID=<classroom-id>
BOOTSTRAP_CLASSROOM_NAME=<classroom-name>
BOOTSTRAP_STUDENT_COUNT=<number-of-students>
BOOTSTRAP_STUDENT_ROSTER_PATH=<optional-csv-path>
BOOTSTRAP_DEFAULT_ASSESSMENT_ID=assessment_mvp_irt_theta_invariance
```

Use either `BOOTSTRAP_STUDENT_COUNT` or `BOOTSTRAP_STUDENT_ROSTER_PATH`, not both. The current schema has no separate classroom table; `BOOTSTRAP_CLASSROOM_ID` is stored as safe bootstrap metadata and used in generated student IDs/access-code distribution. Student login continues to use `user_id` plus roster-issued access code/password.

The command is idempotent, creates or reuses the first teacher, creates only missing students, ensures the fixed IRT MVP assessment is published, and writes newly generated access codes under ignored `.data/bootstrap/`. It does not print raw passwords or access codes.

For Docker/Render Web Shell, the service directory is `/app`. Operator commands
must run there directly; `/opt/render/project/src` is not the Docker runner path.
The `tsx` package is a production dependency because production operator scripts
are TypeScript entrypoints and must still start after `npm prune --omit=dev`.

After a teacher username rename, update `BOOTSTRAP_TEACHER_USERNAME` to the
current username or do not rerun bootstrap. If the configured bootstrap teacher
username is absent while a teacher account already exists, the production
bootstrap path fails closed rather than creating a second teacher account.

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

`/api/health` checks database reachability and required production schema
readiness. If required additive account-security columns or tables are missing,
it returns `database_schema_ready=false` and
`migration_readiness=migration_required` without printing database URLs or raw
errors. Use `npm run prisma:migrate:deploy` before serving traffic and
`npx prisma migrate status` for detailed migration state. The production
readiness smoke runs `npx prisma validate` and invokes
`npx prisma migrate status` while suppressing raw output.

### LLM Readiness

Use the CLI:

```bash
npm run llm:readiness
```

This may perform a lightweight authenticated model metadata check when live configuration is present. It must not generate model output. It prints only safe readiness fields and key fingerprints, never the key value.

### Export Readiness

Verify teacher/research export integrity without provider calls:

```bash
npm run research-export:preflight
npm run student:research-export-integrity-smoke
```

Generated export artifacts remain under ignored local paths and must not be committed.

Production research exports require server-only
`RESEARCH_PSEUDONYMIZATION_KEY` for `hmac_sha256_v1` student pseudonyms. The
key must not appear in browser code, logs, CSVs, or commits. If the key is
missing, research export generation fails closed with a typed configuration
error; login, account management, assessment management, and ordinary non-export
pages remain available. The exported `pseudonymization_key_fingerprint` is only
a short one-way provenance marker for detecting key/configuration changes.
Generate a production key with a local secret manager or a command such as
`openssl rand -hex 32`, then store it only in the deployment provider's
server-side environment variables. Set it once and retain it securely; changing
the key changes future research pseudonyms. The Research data page now reads
the same readiness state as the API: when the key or export storage is blocked,
it disables dataset generation, keeps filter selections and dictionary access,
shows the safe blocking reason, and records failed export jobs with retryable
typed reasons. Completed prior export jobs remain downloadable. For incident
review, export the affected session before rerunning profiling or formative
workflows so existing profile, formative decision, follow-up, activity, process,
conversation, and agent-call records are preserved.

## Classroom Web Access Plan

1. Deploy a Render staging HTTPS URL with `render.yaml`.
2. Run `npm run student:render-staging-readiness-smoke`.
3. Run `npm run student:production-deployment-readiness-smoke`.
4. Confirm Render pre-deploy ran `npm run prisma:migrate:deploy`.
5. On a fresh database, run `npm run staging:bootstrap-pilot` once with explicit `BOOTSTRAP_*` values.
6. Confirm `/api/health` returns `200`.
7. Confirm `npm run llm:readiness` reports the intended server-side live readiness before a live pilot.
8. Log in as `teacher_researcher`.
9. Create or import the classroom if the deployment has a later classroom table; otherwise use the bootstrap classroom ID as the course/access label.
10. Create or import approved student accounts and access codes/passwords.
11. Copy the public HTTPS Conversational MCQ URL.
12. Add the URL to a Canvas assignment page or Canvas module item.
13. Have a student open the URL from a non-development device/browser profile.
14. Student signs in with classroom ID and access code/password.
15. Student completes the three protected initial items.
16. Student completes the activity response and move-on/choose-another path.
17. Have the teacher inspect session detail, readable transcript, structured event log, process events, session evidence audit, and research export.
18. Open `/teacher/data/research`, verify Research dataset and Data dictionary
    sections, then download the research dataset ZIP for a pilot data check.
19. In Data dictionary, verify the default section is Research dataset
    variables, records are collapsed, the Category guide is visible only for
    research variables, and each dictionary section has one context-sensitive
    download button.
20. Run export integrity review.
21. Complete `docs/POST_DEPLOYMENT_CLASSROOM_DRY_RUN.md`.
22. Record only safe pass/fail observations, public IDs, status fields, and limitations.

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
- Production research exports have a configured
  `RESEARCH_PSEUDONYMIZATION_KEY` and use `hmac_sha256_v1` pseudonymization.
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

Phase 31b adds readiness checks and deployment documentation for Canvas-link access. It does not implement Canvas LTI, Canvas OAuth, grade passback, roster sync, Canvas Developer Key configuration, Canvas API integration, email/SMS delivery, public self-registration, production monitoring integrations, cloud-provider provisioning, or classroom validity. Those require separate approval.

## Phase 31c Render Package Boundary

Phase 31c adds a Render staging Blueprint, Render readiness smoke, Render Dashboard runbook, and post-deployment dry-run checklist. It does not create a Render account, connect to Render, deploy the app, provision cloud resources, call provider APIs, modify runtime assessment logic, implement Canvas LTI, or claim classroom validity.

## Teacher Account Readiness

Teacher/research login uses username plus password. Public teacher
forgot-password, email-change, and email-verification flows are disabled for the
classroom pilot; email provider variables must not affect login or production
readiness. Students remain on the teacher-managed credential-reset workflow.

Production/staging readiness requires:

- `APP_BASE_URL` set to the canonical HTTPS origin.
- `npm run prisma:migrate:deploy` run before app traffic reaches Next.js.
- Existing teacher username configured correctly for bootstrap and operator
  workflows.

To rename the deployed teacher username without changing the password or
creating a second teacher, run from the deployed service directory, such as
Render Shell `/app`:

```bash
TEACHER_USERNAME_RENAME_ENABLED=true \
CURRENT_TEACHER_USERNAME=teacher_staging_01 \
NEW_TEACHER_USERNAME=edpy507_instructor \
CONFIRM_TEACHER_USERNAME_RENAME=RENAME_TEACHER \
npm run operator:rename-teacher
```

The command updates the existing teacher row. It must not create a second
teacher, change the password hash, change role, or detach assessment ownership,
student relationships, sessions, responses, or historical audit records. A real
rename increments `auth_version`, invalidates prior teacher sessions,
invalidates outstanding account-security tokens, and writes an account-security
audit event. Output is limited to safe status fields. Idempotent reruns return
`already_configured` without another `auth_version` increment or duplicate audit
event.

After renaming, update `BOOTSTRAP_TEACHER_USERNAME` to the new username or do not
rerun bootstrap. Do not manually edit the production database for this rename.

No-live checks:

```bash
npm run operator:teacher-rename-production-smoke
npm run operator:rename-teacher-smoke
npm run student:production-schema-readiness-smoke
npm run operator:production-runtime-smoke
```

## Per-Agent OpenAI Configuration and Rollback

Production must not switch models merely because a newer alias exists. The
approved baseline remains `gpt-5.4-mini-2026-03-17` with low reasoning effort.
Per-agent model and reasoning-effort overrides must be included in the active
configuration hash and must match the approved hash before guarded-live
operational calls can run.

No-live candidate checks:

```bash
npm run operational:model-upgrade:preflight
npm run operational:model-upgrade:dry-run
npm run operational:model-upgrade:compare
npm run operational:model-upgrade:report
```

Guarded paid evaluation is opt-in only:

```bash
RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL=1 \
npm run operational:model-upgrade:live-eval -- --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json --confirm-paid-api
```

The paid candidate evaluation is isolated from classroom data. It uses the
explicit candidate manifest, fixed synthetic fixtures, and writes durable
evidence under `.data/operational-model-upgrade/runs/<run_public_id>/`. It must
not be treated as candidate approval.

Review and approval sequence:

```bash
npm run operational:model-upgrade:review-export -- --candidate-run <run_public_id>
npm run operational:model-upgrade:review-confirm -- \
  --candidate-run <run_public_id> \
  --review-artifact .data/operational-model-upgrade/runs/<run_public_id>/review/review_records.jsonl \
  --confirm "I reviewed all required candidate outputs" \
  --decision approve \
  --reviewer <safe_identifier>
npm run operational:model-upgrade:approve -- \
  --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json \
  --candidate-run <run_public_id> \
  --expected-hash cc7448289c810eb1c8be2a3d96e3a8376ad73cc361fc984cd595bbfd1d3c6872 \
  --confirm "approve gpt-5.6 full operational candidate v2"
```

The approval command emits the exact `OPERATIONAL_APPROVED_CONFIG_HASH` value
only after the run is complete, all fixed cases are present, critical automated
findings are absent, and human review is approved. Apply the printed hash in
Render manually; the command does not mutate Render variables or `.env` files.

If a paid run is interrupted, resume it with the same run public ID:

```bash
RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL=1 \
npm run operational:model-upgrade:live-eval -- \
  --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json \
  --confirm-paid-api \
  --resume-run <run_public_id>
```

Rollback sequence:

1. Restore prior `OPENAI_MODEL_*` values or remove candidate overrides.
2. Restore prior `OPENAI_REASONING_EFFORT_*` values or leave them blank.
3. Restore the previous `OPERATIONAL_APPROVED_CONFIG_HASH`.
4. Redeploy.
5. Run `npm run operational:approval-manifest:verify` and
   `npm run operational:agents:preflight`.

## Phase 31AP Full GPT-5.6 Candidate Deployment Notes

The current full-v2 candidate moves every covered OpenAI-backed operational,
student-facing extension, teacher-tool, and connectivity role to a GPT-5.6
family model. It must remain inactive unless the candidate model configuration
has completed no-live tests, fixed synthetic live evaluation, human review of
student-facing outputs, and explicit operational approval with a matching
approved configuration hash.

Optional Render/server variables for candidate evaluation:

- `OPENAI_MODEL_STUDENT_COMMUNICATION`
- `OPENAI_REASONING_EFFORT_STUDENT_COMMUNICATION`
- `OPENAI_MAX_OUTPUT_TOKENS_STUDENT_COMMUNICATION`
- `OPENAI_MODEL_TOPIC_DIALOGUE`
- `OPENAI_REASONING_EFFORT_TOPIC_DIALOGUE`
- `OPENAI_MAX_OUTPUT_TOKENS_TOPIC_DIALOGUE`
- `OPENAI_MODEL_FORMATIVE_VALUE_DETERMINATION`
- `OPENAI_REASONING_EFFORT_FORMATIVE_VALUE_DETERMINATION`
- `OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_VALUE_DETERMINATION`
- `OPENAI_MODEL_FORMATIVE_ACTIVITY_DIALOGUE`
- `OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_DIALOGUE`
- `OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_DIALOGUE`
- `OPENAI_MODEL_FORMATIVE_ACTIVITY_QUALITY_REVIEWER`
- `OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_QUALITY_REVIEWER`
- `OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_QUALITY_REVIEWER`
- `OPENAI_MODEL_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR`
- `OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR`
- `OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR`
- `OPENAI_MODEL_POST_ACTIVITY_EVIDENCE_EVALUATOR`
- `OPENAI_REASONING_EFFORT_POST_ACTIVITY_EVIDENCE_EVALUATOR`
- `OPENAI_MAX_OUTPUT_TOKENS_POST_ACTIVITY_EVIDENCE_EVALUATOR`
- `TOPIC_DIALOGUE_MAX_STUDENT_TURNS`
- `TOPIC_DIALOGUE_RECENT_TURN_WINDOW`
- `TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS`
- `TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS`
- `OPENAI_REQUEST_TIMEOUT_MS`
- `OPENAI_MAX_RETRIES`

Do not add these values to public or browser-visible configuration. If a
candidate rollout must be reverted, remove the candidate variables, restore the
previous approved hash, redeploy, and rerun the no-live student communication
and topic-dialogue smoke tests before classroom use.
