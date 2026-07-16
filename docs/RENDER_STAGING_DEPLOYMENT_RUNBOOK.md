# Render Staging Deployment Runbook

This runbook is for a first Render staging deployment of Conversational MCQ so Canvas can link students to a public HTTPS website. It is written for an operator who is using the Render Dashboard, not a command-line cloud deployment.

This is not a public-launch approval, not a classroom-validity claim, and not a Canvas integration. Canvas is only a place to post the public Conversational MCQ URL.

## What Render Will Host

The repository includes `render.yaml`, a Render Blueprint that defines:

- one native Node Render Web Service named `conversational-mcq-staging`;
- one Render Postgres database named `conversational-mcq-staging-db`;
- `DATABASE_URL` wired from the Render Postgres internal connection string;
- a build command that installs dependencies, generates Prisma Client, and builds Next.js;
- a pre-deploy command that runs `npm run prisma:migrate:deploy`;
- a start command that runs `npm run start`;
- secret and deployment-specific values marked `sync: false` so they are filled in the Render Dashboard.

The blueprint intentionally does not use free resources for a classroom pilot. Confirm the current paid Render Web Service and Postgres plan names in the Render Dashboard before creating the Blueprint resources.

## Before You Start

You need:

- a private GitHub repository containing this project;
- access to create Render Web Service and Render Postgres resources;
- a server-side OpenAI API key kept outside Git;
- a generated `SESSION_SECRET`;
- approval to run a staging classroom pilot with the selected synthetic or approved pilot accounts.

Do not paste secrets into chat, docs, GitHub issues, screenshots, or browser-visible `NEXT_PUBLIC_` variables.

## Step 1: Create a Render Account

Open the Render website and create or sign in to your Render account.

Screenshot placeholder: Render Dashboard home.

## Step 2: Put the Repo on GitHub

Create a private GitHub repository for this project and push the latest committed code. Do not push `.env`, `.env.local`, `.data`, generated exports, logs, or credential files.

Screenshot placeholder: GitHub private repository settings.

## Step 3: Connect Render to GitHub

In the Render Dashboard, connect your GitHub account or organization and grant Render access to the private repository.

Screenshot placeholder: Render GitHub connection screen.

## Step 4: Create a Blueprint

In Render:

1. Click `New`.
2. Choose `Blueprint`.
3. Select the private GitHub repository.
4. Confirm the Blueprint path is `render.yaml`.
5. Review the resources Render plans to create.

Screenshot placeholder: Render New Blueprint form.

## Step 5: Confirm Web Service and Postgres

The Blueprint should show:

- Web Service: `conversational-mcq-staging`
- Database: `conversational-mcq-staging-db`

If Render reports a Blueprint validation error, do not continue. Fix the committed `render.yaml` first.

Screenshot placeholder: Render Blueprint resource review.

## Step 6: Choose Non-Free Plans

Use non-free, staging-friendly plans for classroom pilot testing. Free or sleep-prone resources can interrupt student sessions and can invalidate a classroom dry run.

The checked-in Blueprint uses small paid defaults, but Render plan names and limits can change. Confirm the plan choices in the Dashboard before applying the Blueprint.

Screenshot placeholder: Render plan selection.

## Step 7: Fill Environment Variables

Render will prompt for `sync: false` variables. Fill them in the Render Dashboard only.

Required staging variables:

```text
APP_BASE_URL=https://<your-render-web-service>.onrender.com
NEXT_PUBLIC_APP_BASE_URL=https://<your-render-web-service>.onrender.com
SESSION_SECRET=<generated server-side secret>
LLM_LIVE_CALLS_ENABLED=true
OPENAI_API_KEY=<set in Render only>
OPENAI_MODEL_ITEM_ADMIN=<model>
OPENAI_MODEL_PROFILE_INTEGRATION=<model>
OPENAI_MODEL_PLANNING=<model>
OPENAI_MODEL_FOLLOWUP=<model>
LLM_DAILY_CLASS_CALL_LIMIT=<pilot limit>
LLM_DAILY_CLASS_TOKEN_LIMIT=<pilot limit>
LLM_DAILY_STUDENT_CALL_LIMIT=<pilot limit>
LLM_DAILY_STUDENT_TOKEN_LIMIT=<pilot limit>
LLM_SESSION_CALL_LIMIT=<pilot limit>
LLM_SESSION_TOKEN_LIMIT=<pilot limit>
LLM_AGENT_CALL_LIMIT_PER_SESSION=<pilot limit>
RESEARCH_PSEUDONYMIZATION_KEY=<generated server-side research-export HMAC key>
RESEARCH_PSEUDONYMIZATION_VERSION=hmac_sha256_v1
```

Generate the research key outside the repository, for example:

```bash
openssl rand -hex 32
```

Store the value only in Render's server-side environment variable UI. Do not
commit it, paste it into client code, or prefix it with `NEXT_PUBLIC_`.

Optional GPT-5.6 candidate values for a separately approved model-upgrade
evaluation/rollout only:

```text
OPENAI_MODEL_ITEM_VERIFICATION=gpt-5.6-terra
OPENAI_REASONING_EFFORT_ITEM_VERIFICATION=medium
OPENAI_MAX_OUTPUT_TOKENS_ITEM_VERIFICATION=3000
OPENAI_MODEL_ITEM_ADMIN=gpt-5.6-luna
OPENAI_REASONING_EFFORT_ITEM_ADMIN=low
OPENAI_MAX_OUTPUT_TOKENS_ITEM_ADMIN=1200
OPENAI_MODEL_RESPONSE_COLLECTION=gpt-5.6-luna
OPENAI_REASONING_EFFORT_RESPONSE_COLLECTION=low
OPENAI_MAX_OUTPUT_TOKENS_RESPONSE_COLLECTION=1500
OPENAI_MODEL_PROFILING=gpt-5.6-terra
OPENAI_REASONING_EFFORT_PROFILING=medium
OPENAI_MAX_OUTPUT_TOKENS_PROFILING=4000
OPENAI_MODEL_PROFILE_INTEGRATION=gpt-5.6-terra
OPENAI_REASONING_EFFORT_PROFILE_INTEGRATION=medium
OPENAI_MAX_OUTPUT_TOKENS_PROFILE_INTEGRATION=3000
OPENAI_MODEL_PLANNING=gpt-5.6-sol
OPENAI_REASONING_EFFORT_PLANNING=medium
OPENAI_MAX_OUTPUT_TOKENS_PLANNING=3000
OPENAI_MODEL_FORMATIVE_VALUE_DETERMINATION=gpt-5.6-terra
OPENAI_REASONING_EFFORT_FORMATIVE_VALUE_DETERMINATION=medium
OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_VALUE_DETERMINATION=2500
OPENAI_MODEL_FOLLOWUP=gpt-5.6-sol
OPENAI_REASONING_EFFORT_FOLLOWUP=medium
OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP=2500
OPENAI_MODEL_FORMATIVE_ACTIVITY_DIALOGUE=gpt-5.6-sol
OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_DIALOGUE=medium
OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_DIALOGUE=3500
OPENAI_MODEL_FORMATIVE_ACTIVITY_QUALITY_REVIEWER=gpt-5.6-sol
OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_QUALITY_REVIEWER=medium
OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_QUALITY_REVIEWER=2500
OPENAI_MODEL_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR=gpt-5.6-sol
OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR=medium
OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR=3000
OPENAI_MODEL_POST_ACTIVITY_EVIDENCE_EVALUATOR=gpt-5.6-sol
OPENAI_REASONING_EFFORT_POST_ACTIVITY_EVIDENCE_EVALUATOR=medium
OPENAI_MAX_OUTPUT_TOKENS_POST_ACTIVITY_EVIDENCE_EVALUATOR=3000
OPENAI_MODEL_STUDENT_COMMUNICATION=gpt-5.6-terra
OPENAI_REASONING_EFFORT_STUDENT_COMMUNICATION=medium
OPENAI_MAX_OUTPUT_TOKENS_STUDENT_COMMUNICATION=2500
OPENAI_MODEL_TOPIC_DIALOGUE=gpt-5.6-sol
OPENAI_REASONING_EFFORT_TOPIC_DIALOGUE=medium
OPENAI_MAX_OUTPUT_TOKENS_TOPIC_DIALOGUE=3500
OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING=gpt-5.6-terra
OPENAI_REASONING_EFFORT_MCQ_DIAGNOSTIC_AUTHORING=medium
OPENAI_MAX_OUTPUT_TOKENS_MCQ_DIAGNOSTIC_AUTHORING=2500
OPENAI_MODEL_MCQ_FORMATTING=gpt-5.6-luna
OPENAI_REASONING_EFFORT_MCQ_FORMATTING=low
OPENAI_MAX_OUTPUT_TOKENS_MCQ_FORMATTING=3000
OPENAI_MODEL_CONNECTIVITY_TEST=gpt-5.6-luna
OPENAI_REASONING_EFFORT_CONNECTIVITY_TEST=none
OPENAI_REQUEST_TIMEOUT_MS=90000
OPENAI_MAX_RETRIES=2
TOPIC_DIALOGUE_MAX_STUDENT_TURNS=10
TOPIC_DIALOGUE_RECENT_TURN_WINDOW=12
TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS=5000
TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS=true
STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED=true
TOPIC_DIALOGUE_LIVE_CALLS_ENABLED=true
```

Do not set the candidate values for classroom use until the candidate
evaluation and approval workflow outputs a new `OPERATIONAL_APPROVED_CONFIG_HASH`.

`DATABASE_URL` should be wired from Render Postgres by the Blueprint. If Render cannot wire it automatically, use the internal Render Postgres connection string from the database page and set it only in Render's server-side environment variable UI.

Never set `OPENAI_API_KEY`, `DATABASE_URL`, `SESSION_SECRET`, or
`RESEARCH_PSEUDONYMIZATION_KEY` as `NEXT_PUBLIC_` variables. The research
pseudonymization key is required for production research exports; if it is
missing, only research export generation fails closed. Login, account
management, and assessment pages should remain available.
Run `npm run research-export:preflight` from Render Shell after environment
changes. It prints ready/blocked, pseudonymization version, safe key
fingerprint, registry status, artifact-path status, and database readiness
without printing the key. If the key is missing, `/teacher/data/research`
shows an in-page readiness warning and failed export jobs can be retried after
the Render variable is corrected.

Screenshot placeholder: Render Environment variables screen with values hidden.

## Step 8: Deploy

Apply the Blueprint and start the first deploy. Render should run:

```bash
npm ci --include=dev && npm run prisma:generate && npm run build
npm run prisma:migrate:deploy
npm run start
```

Screenshot placeholder: Render deploy log.

## Step 9: Watch Logs

Watch for:

- successful dependency installation;
- successful Prisma Client generation;
- successful Next.js build;
- successful `prisma migrate deploy`;
- app listening on Render's assigned port;
- no printed secrets.

Do not copy logs containing secrets into tickets, chat, or public docs.

## Step 10: Confirm Migrations

In the deploy logs, confirm the pre-deploy step ran:

```text
npm run prisma:migrate:deploy
```

If migrations fail, stop and investigate before allowing students to open the link.

## Step 10b: Bootstrap the Fresh Database

Render `preDeployCommand` runs migrations only. It should not create users or temporary credentials automatically on every deploy.

After the first successful deploy against a fresh Render Postgres database, run the bootstrap command once as an explicit operator step from Render Shell or a one-off manual command with temporary environment variables set for that command:

```bash
BOOTSTRAP_ENABLED=true \
BOOTSTRAP_TEACHER_USERNAME=<teacher-user-id> \
BOOTSTRAP_TEACHER_PASSWORD=<teacher-password> \
BOOTSTRAP_CLASSROOM_ID=<classroom-id> \
BOOTSTRAP_CLASSROOM_NAME=<classroom-name> \
BOOTSTRAP_STUDENT_COUNT=<number-of-students> \
BOOTSTRAP_DEFAULT_ASSESSMENT_ID=assessment_mvp_irt_theta_invariance \
npm run staging:bootstrap-pilot
```

For a roster file instead of generated student IDs, set:

```text
BOOTSTRAP_STUDENT_ROSTER_PATH=<path-to-csv-with-user_id,display_name,email>
```

and omit `BOOTSTRAP_STUDENT_COUNT`.

The command is idempotent:

- existing teacher accounts are reused;
- existing student accounts are reused;
- the fixed IRT MVP assessment is created or refreshed as published;
- student temporary passwords/access codes are generated only for newly created students.

The command does not print raw passwords or access codes. If new student temporary credentials are generated, it writes a CSV under:

```text
.data/bootstrap/
```

That directory is ignored by Git. Copy the credential CSV to an approved secure location, then delete it from the shell environment if required by your data-handling plan.

Render Shell for the Docker image opens in `/app`. Run operator commands there
directly; do not change directory to `/opt/render/project/src`. The operator
scripts use the checked-in `tsx` production dependency so they are available
after Docker prunes dev dependencies.

If the deployed teacher username is later renamed, update
`BOOTSTRAP_TEACHER_USERNAME` to the current username or leave bootstrap disabled.
The production bootstrap path refuses to create a second teacher when the
configured teacher username does not match an existing teacher account.

If this database already had temporary-credential student accounts from an older deployment, run the repair command once after migrations/bootstrap:

```bash
MARK_STUDENT_PASSWORD_CHANGE_ENABLED=true npm run staging:mark-students-must-change-password
```

Optional filters are:

```text
MARK_STUDENT_USER_ID=<student-user-id>
MARK_STUDENT_CLASSROOM_ID=<classroom-id>
```

The repair marks only active student accounts that still have a temporary credential and no permanent password. It does not print passwords, access codes, hashes, database URLs, session secrets, or provider keys, and it does not affect teacher accounts.

Screenshot placeholder: Render Shell bootstrap command with secrets hidden.

## Step 11: Open the Render URL

Open the public Render URL, usually:

```text
https://<your-render-web-service>.onrender.com
```

Screenshot placeholder: Conversational MCQ landing/login page.

## Step 12: Check Health

Open:

```text
https://<your-render-web-service>.onrender.com/api/health
```

Expected: HTTP 200 with safe status fields. The response must not show secrets, database URLs, provider payloads, answer keys, or user data.

Screenshot placeholder: `/api/health` response.

## Step 13: Teacher Login

Log in as an approved teacher/research user. Confirm the teacher dashboard loads.

Screenshot placeholder: Teacher dashboard.

## Step 14: Create or Check Classroom and Student Codes

Create or verify the classroom and approved student accounts/temporary credentials for the staging pilot. In this schema version, the classroom ID is a deployment/course access label recorded in bootstrap metadata and credential-distribution materials; student login uses the existing `user_id` plus roster-issued temporary password/access code or a student-changed password. Temporary-credential students must choose a new password before assessment access. Teachers can add students, optionally record display name and email, reset forgotten temporary passwords, and deactivate/reactivate accounts from the student-account management pages. Email is optional teacher/research PII and is not a login identifier. Do not import a real roster unless the pilot approval explicitly covers it.

Screenshot placeholder: Classroom/student account management.

## Step 15: Student Login from Another Browser or Device

Open the Render URL from another browser profile or a separate device. Log in with a test student classroom ID and access code/password.

Screenshot placeholder: Student assessment dashboard.

## Step 16: Complete the Student Flow

As the student:

1. Start the fixed IRT MVP assessment.
2. Complete the three initial items.
3. Review/edit the response package if needed.
4. Continue to feedback/activity.
5. Submit an activity response.
6. Choose another activity and confirm a different activity appears immediately, or use End assessment and confirm the terminal dialog.

Confirm the student UI remains chat-native and does not expose correctness, answer keys, distractor metadata, raw provider output, internal labels, or audit metadata.

Screenshot placeholder: Student chat-native activity.

## Step 17: Teacher Review

As teacher/research user, open the session detail and inspect:

- readable transcript;
- structured event log;
- process-event timeline;
- response package;
- profile/formative/activity audit summaries;
- session evidence audit.

Screenshot placeholder: Teacher session detail.

## Step 18: Download Research Export

Download the research export from the app. Store it in an approved protected location. Do not commit export files.
For a single-session incident, open the session detail page and choose
**Export this session** before rerunning profiling, follow-up, or activity
logic. The selected-session ZIP includes the standard research CSVs plus a safe
`session_diagnostic_manifest.json` with workflow counts, timestamps, versions,
validation statuses, and included-file metadata.

Screenshot placeholder: Research export page.

## Step 19: Add Link to Canvas

In Canvas, add the Render URL as either:

- an Assignment description hyperlink; or
- a Module item using `External URL`.

Suggested Canvas wording:

```text
Open the Conversational MCQ activity using the link below. Use the classroom ID and access code provided by your instructor. Complete the activity in one sitting if possible. If the page says it could not safely review a response, follow the on-screen options to try again, choose another activity, or move on. Your teacher will review completion and research data inside the Conversational MCQ system, not through Canvas grade passback.
```

Canvas gradebook will not automatically receive completion, scores, statuses, or research data.

Screenshot placeholder: Canvas assignment/module link.

## Verification Commands

Before committing deployment changes locally:

```bash
npm run student:render-staging-readiness-smoke
npm run student:production-deployment-readiness-smoke
npm run student:classroom-pilot-readiness-smoke
npm run student:research-export-integrity-smoke
npm run student:mvp-e2e-smoke
npm run student:live-llm-smoke
```

The live smoke command skips by default unless explicitly opted in. Do not run paid live calls as part of this runbook unless the pilot operator intentionally enables them.

## Teacher Account Rename

Teacher/research login is username plus password. Public teacher forgot-password,
email-change, and email-verification flows are disabled for the classroom pilot,
so email provider configuration is not part of normal staging readiness.

Render `preDeployCommand` runs `npm run prisma:migrate:deploy`. If a Docker
service or manual deployment is used instead of the Blueprint, run the same
command before the app serves traffic.

To rename the existing deployed teacher account without creating a second
teacher, open Render Shell in the service directory (`/app`) and run:

```bash
TEACHER_USERNAME_RENAME_ENABLED=true \
CURRENT_TEACHER_USERNAME=teacher_staging_01 \
NEW_TEACHER_USERNAME=edpy507_instructor \
CONFIRM_TEACHER_USERNAME_RENAME=RENAME_TEACHER \
npm run operator:rename-teacher
```

The command updates the existing teacher row only. It preserves the database ID,
password hash, role, assessment ownership, student relationships, sessions,
responses, and historical audit records. A real rename increments
`auth_version`, invalidates older teacher sessions, invalidates outstanding
account-security tokens, and writes an account-security audit event. Output
contains only safe status fields. Rerunning the same command returns
`already_configured` without another session invalidation or duplicate audit
event.

After a rename, update the Render environment value `BOOTSTRAP_TEACHER_USERNAME`
to the new username before running bootstrap again, or do not rerun bootstrap.

Manual verification:

1. Log in with the new username and the existing password.
2. Confirm the old username no longer logs in.
3. Confirm Account settings still allows password change only.
4. Confirm previous teacher sessions are invalidated.
5. Confirm the same teacher still owns the assessments, student relationships,
   sessions, responses, and audit history.

## Boundaries

This runbook does not implement or require:

- Canvas LTI;
- Canvas OAuth;
- Canvas grade passback;
- Canvas roster sync;
- Canvas Developer Key configuration;
- Canvas API integration;
- public self-registration;
- SMS delivery;
- classroom-validity claims.

## Phase 31ao Optional Communication/Topic Variables

The Phase 31ao student communication and topic-dialogue roles are not approved
for live production use by default. Leave their model variables blank unless a
separate evaluation and approval workflow explicitly authorizes them:

- `OPENAI_MODEL_STUDENT_COMMUNICATION`
- `OPENAI_REASONING_EFFORT_STUDENT_COMMUNICATION`
- `OPENAI_MAX_OUTPUT_TOKENS_STUDENT_COMMUNICATION`
- `OPENAI_MODEL_TOPIC_DIALOGUE`
- `OPENAI_REASONING_EFFORT_TOPIC_DIALOGUE`
- `OPENAI_MAX_OUTPUT_TOKENS_TOPIC_DIALOGUE`
- `TOPIC_DIALOGUE_MAX_STUDENT_TURNS`
- `TOPIC_DIALOGUE_RECENT_TURN_WINDOW`

Rollback for this phase is to redeploy without those optional model variables
and keep the previous `OPERATIONAL_APPROVED_CONFIG_HASH`. The deterministic
student communication and bounded-dialogue smokes should pass without live
provider calls.
