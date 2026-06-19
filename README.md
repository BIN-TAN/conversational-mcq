# Conversational MCQ

Classroom prototype for a conversation-based MCQ formative assessment system. The current implemented scope includes the Phase 4B student initial-administration UI and the Phase 5A read-only teacher_researcher session-review platform. LLM agents, OpenAI API integration, follow-up conversation, CSV export, and summative outcome upload are intentionally not implemented yet.

## Local Setup

### Prerequisites

- Install Node.js LTS from `https://nodejs.org/` or your normal package manager.
- Install Docker Desktop or another Docker Compose-compatible runtime for local PostgreSQL.
- Verify Node and npm are on your shell PATH:

  ```bash
  node -v
  npm -v
  ```

If either command is missing, update your shell PATH according to your Node installer. This project should not rely on temporary npm copies under `/tmp`.

### Environment

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment placeholders:

   ```bash
   cp .env.example .env.local
   ```

3. Keep the local `DATABASE_URL` from `.env.example` if using the included Docker PostgreSQL service.

4. Replace `SESSION_SECRET` with a local random value of at least 32 characters.

5. Leave OpenAI variables blank until the later phases that implement model calls. They are placeholders only in the current backend phases.

Do not commit `.env`, `.env.local`, real session secrets, or real API keys.

### Database

Start local PostgreSQL:

```bash
npm run db:up
```

Apply the current migration stack and seed local demo users:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

Seeded local development credentials:

- teacher_researcher: `teacher_demo` / `teacher_demo_password`
- student: `student_demo` / `student_demo_access_code`

The seed stores only hashed credentials in PostgreSQL. Running it repeatedly updates the same demo users and does not create duplicates.

### Run And Verify

Full local setup verification command sequence:

```bash
npm install
npm run db:up
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run content:governance-smoke
npm run student:initial-admin-smoke
npm run student:ui-smoke
npm run teacher:review-smoke
npm run typecheck
npm run lint
npm run build
npm run dev
```

Auth sanity checks after `npm run dev`:

```bash
curl -i http://localhost:3000/api/auth/me
curl -i http://localhost:3000/api/student/session/current
curl -i http://localhost:3000/api/teacher/dashboard
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  --data '{"user_id":"student_demo"}'
```

Useful local endpoints:

- `GET /api/health`
- `GET /api/auth/me`
- `POST /api/auth/login`
- `POST /api/auth/logout`

Protected route shells:

- `/student/assessment` requires a student session.
- `/teacher/dashboard` requires a teacher_researcher session.

## Phase 1 And 1.5 Scope

Implemented:

- Next.js TypeScript skeleton
- Tailwind CSS setup
- student login route shell
- student assessment route shell
- teacher_researcher dashboard route shell
- auth login/logout/me API shells
- student session placeholder API routes
- teacher placeholder API routes
- Prisma/PostgreSQL setup
- minimal `users` table
- signed HTTP-only cookie session foundation
- environment validation
- specification lock document
- Docker Compose PostgreSQL configuration
- Prisma seed script for demo local users
- auth-protected student and teacher page shells
- health endpoint for app/database connectivity

Not implemented yet:

- LLM agent calls
- OpenAI API integration
- formative follow-up conversation
- CSV export
- summative outcome upload

## Phase 2A Database Verification

Phase 2A adds the normalized database schema and smoke test only. It does not implement services, agents, UI flows, or export.

```bash
npm run db:up
npm run prisma:generate
npm run prisma:migrate -- --name phase2a_core_schema
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run typecheck
npm run lint
npm run build
```

## Phase 2B Service Verification

Phase 2B adds foundational backend services only: process event logging, conversation turn logging, deterministic phase transitions, assessment session state persistence, response package creation, and service-level smoke testing.

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run db:smoke
npm run db:service-smoke
npm run prisma:seed
npm run typecheck
npm run lint
npm run build
```

The service smoke test creates temporary records, verifies phase transition acceptance/rejection, logs process events and conversation turns, creates an `initial_concept_unit_response_package`, checks event aggregation, and cleans up only the temporary records it created.

## Phase 3A Content Management Verification

Phase 3A adds backend-only teacher_researcher content management services, API routes, validation, JSON import, documentation, and smoke testing. It does not add the teacher item-management UI, student conversation UI, LLM calls, agents, follow-up loop, or CSV export.

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run typecheck
npm run lint
npm run build
```

The content smoke test creates temporary assessment content, validates concept-unit publishing rules, publishes a valid concept unit, checks invalid publish cases, verifies item version incrementing and archive behavior, confirms API-style service outputs do not expose internal UUID keys, and cleans up only its temporary records.

See `docs/ITEM_MANAGEMENT.md` for JSON import examples, validation rules, and teacher content route details.

## Phase 3B Manual Content UI

Phase 3B adds teacher_researcher UI pages for manual content management over the Phase 3A APIs. It does not add the student assessment conversation UI, LLM calls, agents, follow-up loop, full dashboard details, or CSV export.

Teacher pages:

- `/teacher/content`
- `/teacher/content/assessments`
- `/teacher/content/assessments/new`
- `/teacher/content/import-json`

Assessment, concept-unit, and item detail pages use public IDs in the route. The UI exposes correct options and distractor rationales only to teacher_researcher users.

Manual UI workflow:

1. Sign in as `teacher_demo` with `teacher_demo_password`.
2. Open `/teacher/content/assessments`.
3. Create an assessment.
4. Add a concept unit.
5. Add 3 to 4 MCQ items with distractor rationales, expected reasoning patterns, and possible misconception indicators.
6. Publish the concept unit and resolve any validation errors returned by the backend.
7. Publish the assessment when allowed.
8. Use `/teacher/content/import-json` for manual JSON import. See `docs/sample-concept-unit-import.json`.

Verification remains:

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run typecheck
npm run lint
npm run build
```

## Phase 3C Content Governance

Phase 3C adds content-governance and research-integrity rules only. It does not add Phase 4, student conversation UI, LLM calls, agents, follow-up, session review dashboard details, or CSV export.

Teacher researchers define assessment titles, concept boundaries, item membership, wording, options, correct answers, rationales, reasoning expectations, misconception indicators, ordering, and publication timing. The system checks only the minimum publishing and research-integrity requirements.

Governance rules:

- Draft concept units may contain more than 4 candidate items.
- Publishing a concept unit counts only active items marked `included_in_published_set`.
- A published concept unit must have exactly 3 to 4 included active items.
- Assessments publish only after at least one concept unit is actually published.
- Published unused assessments can explicitly return to draft before any student session starts.
- Published concept units can explicitly return to draft when the parent assessment is draft and no student session has started.
- Once any `assessment_sessions` row exists for an assessment, research-relevant content is read-only.
- Locked assessments may still be archived as a whole to prevent future new sessions while preserving records.

Phase 3C verification:

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run content:governance-smoke
npm run typecheck
npm run lint
npm run build
```

## Phase 4A Initial Administration Backend

Phase 4A adds backend services and student API routes for assessment availability, atomic session start/resume, deterministic initial concept-unit administration, safe item delivery, response persistence, revisions, explicit skips, missing-evidence repair, frontend process-event ingestion, and initial response-package creation.

It does not add the ChatGPT-style student assessment UI, OpenAI API integration, LLM agents, profiling, planning, follow-up, teacher session review, or CSV export.

Student API routes:

- `GET /api/student/assessments/available`
- `POST /api/student/assessments/[assessmentPublicId]/sessions/start`
- `GET /api/student/sessions/[sessionPublicId]/state`
- `POST /api/student/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/start`
- `POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/option`
- `POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/reasoning`
- `POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/confidence`
- `POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/submit`
- `POST /api/student/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/complete-initial`
- `POST /api/student/sessions/[sessionPublicId]/events`
- `POST /api/student/sessions/[sessionPublicId]/exit`

Phase 4A rules:

- Published, non-archived assessments are available to authenticated students when they contain at least one valid published concept unit.
- V1 uses one default attempt per student/assessment with `attempt_number = 1`.
- The database uniqueness rule is `user_db_id + assessment_db_id + attempt_number`, so future teacher-authorized retakes can use attempt 2 or later.
- Repeated Start requests resume the same existing non-completed attempt instead of creating duplicate sessions.
- Student routes use public IDs and never return internal UUIDs.
- Student item payloads exclude answer keys, correctness, distractor rationales, reasoning expectations, misconception indicators, teacher-only rules, profiles, and formative labels.
- Correctness is calculated by backend logic and stored as research evidence, but no correctness feedback is returned during initial administration.
- Revisions remain allowed until the concept unit's initial administration is completed.
- Missing evidence gets one repair opportunity; deliberate skips are stored as skipped flags.
- A skipped whole item stores `correctness = unanswered`.
- Frontend process events are browser-context evidence only, force `event_source = frontend`, and are not misconduct labels.
- Completing initial concept-unit administration creates one `initial_concept_unit_response_package` and moves the session to `profiling_pending` without calling a profiling model.

Phase 4A verification:

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run content:governance-smoke
npm run student:initial-admin-smoke
npm run typecheck
npm run lint
npm run build
```

Dev-server API checks:

```bash
npm run dev
curl -i http://localhost:3000/api/health
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  --data '{"user_id":"student_demo"}'
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  --data '{"user_id":"student_demo","access_code":"student_demo_access_code"}'
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  --data '{"user_id":"teacher_demo","password":"teacher_demo_password"}'
```

Use cookie jars for authenticated role checks, for example:

```bash
curl -i -c /tmp/student-cookie.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  --data '{"user_id":"student_demo","access_code":"student_demo_access_code"}'
curl -i -b /tmp/student-cookie.txt http://localhost:3000/api/teacher/dashboard
curl -i -b /tmp/student-cookie.txt -X POST http://localhost:3000/api/auth/logout
```

See `docs/INITIAL_ADMINISTRATION_BACKEND.md` for the detailed Phase 4A backend contract.

## Phase 4B Student Initial Administration UI

Phase 4B adds the protected student-facing platform for initial concept-unit administration. It does not add OpenAI integration, LLM agents, profiling, planning, follow-up, teacher session review, or CSV export.

Student routes:

- `/student/assessment`
- `/student/assessment/[sessionPublicId]`

The assessment list uses `GET /api/student/assessments/available`. Start and Resume open the session route with the public `session_public_id`. The session page uses a ChatGPT-style layout over deterministic backend state, clickable option buttons, free-text reasoning, low/medium/high confidence controls, missing-evidence repair, explicit skip confirmation, review/revision, Save and exit, resume, refresh recovery, and neutral awaiting-profiling state.

Create the development browser fixture:

```bash
npm run demo:student-assessment
```

Cleanup only the development demo assessment and its own records:

```bash
npm run demo:student-assessment:cleanup
```

Student browser process-event thresholds are configurable in `.env.local`:

```bash
NEXT_PUBLIC_LONG_PAUSE_MS=120000
NEXT_PUBLIC_INACTIVITY_MS=300000
```

These are technical defaults, not psychological thresholds.

Phase 4B verification:

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run content:governance-smoke
npm run student:initial-admin-smoke
npm run student:ui-smoke
npm run typecheck
npm run lint
npm run build
```

Manual browser flow:

1. Run `npm run db:up`.
2. Run `npm run prisma:seed`.
3. Run `npm run demo:student-assessment`.
4. Run `npm run dev`.
5. Sign in as `student_demo` with `student_demo_access_code`.
6. Open `/student/assessment`, start or resume the demo assessment, answer the initial questions, use Review Responses, Save and exit, resume, refresh, and complete the initial concept unit.
7. Confirm the final state is awaiting analysis/profiling and no correctness, profile, formative activity, or follow-up is shown.

See `docs/STUDENT_INITIAL_ADMINISTRATION_UI.md` for the Phase 4B UI contract.

## Phase 5A Teacher Session Review

Phase 5A adds a read-only teacher_researcher review platform for existing assessment sessions. It does not add Phase 5B CSV export, summative outcome upload, OpenAI integration, LLM agents, profiling, planning, follow-up conversation, or fabricated agent outputs.

Teacher routes:

- `/teacher/dashboard`
- `/teacher/sessions`
- `/teacher/sessions/[sessionPublicId]`

Teacher session-review APIs:

- `GET /api/teacher/sessions`
- `GET /api/teacher/sessions/[sessionPublicId]`
- `GET /api/teacher/sessions/[sessionPublicId]/item-responses`
- `GET /api/teacher/sessions/[sessionPublicId]/transcript`
- `GET /api/teacher/sessions/[sessionPublicId]/process-events`
- `GET /api/teacher/sessions/[sessionPublicId]/response-packages`

Create the development review fixture:

```bash
npm run demo:teacher-review
```

Cleanup only the teacher-review demo assessment/session records:

```bash
npm run demo:teacher-review:cleanup
```

Phase 5A verification:

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run content:governance-smoke
npm run student:initial-admin-smoke
npm run student:ui-smoke
npm run teacher:review-smoke
npm run typecheck
npm run lint
npm run build
```

Manual browser flow:

1. Run `npm run db:up`.
2. Run `npm run prisma:seed`.
3. Run `npm run demo:teacher-review`.
4. Run `npm run dev`.
5. Sign in as `teacher_demo` with `teacher_demo_password`.
6. Open `/teacher/dashboard`, then Student sessions.
7. Search for `student_demo`, use status/phase filters, open the demo session, and review Overview, Item responses, Conversation transcript, Process events, Response packages, and Future agent data.
8. Sign out, sign in as `student_demo` with `student_demo_access_code`, and confirm teacher pages/API routes are forbidden.

See `docs/TEACHER_SESSION_REVIEW.md` for the Phase 5A review contract.
