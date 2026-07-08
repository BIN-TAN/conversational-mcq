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
```

`DATABASE_URL` should be wired from Render Postgres by the Blueprint. If Render cannot wire it automatically, use the internal Render Postgres connection string from the database page and set it only in Render's server-side environment variable UI.

Never set `OPENAI_API_KEY`, `DATABASE_URL`, or `SESSION_SECRET` as `NEXT_PUBLIC_` variables.

Screenshot placeholder: Render Environment variables screen with values hidden.

## Step 8: Deploy

Apply the Blueprint and start the first deploy. Render should run:

```bash
npm ci && npm run prisma:generate && npm run build
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

Create or verify the classroom and approved student accounts/access codes for the staging pilot. Do not import a real roster unless the pilot approval explicitly covers it.

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
6. Choose another activity or move on.

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

## Boundaries

This runbook does not implement or require:

- Canvas LTI;
- Canvas OAuth;
- Canvas grade passback;
- Canvas roster sync;
- Canvas Developer Key configuration;
- Canvas API integration;
- public self-registration;
- email/SMS delivery;
- classroom-validity claims.
