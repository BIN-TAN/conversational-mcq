# Conversational MCQ

Classroom prototype for a conversation-based MCQ formative assessment system. The current implemented scope includes the Phase 4B student initial-administration UI, the Phase 5A read-only teacher_researcher session-review platform, the Phase 5B summative outcome import plus master CSV export tools, Phase 6A LLM infrastructure scaffolding, Phase 6A.5 classroom LLM access/usage safeguards, Phase 6B Student Profiling Agent integration, Phase 6C Formative Value and Planning Agent integration, Phase 6D1 first-round Follow-up Agent conversation, Phase 6D2A assessment availability plus asynchronous automatic workflow startup, Phase 6D2B iterative follow-up evidence updating inside the current concept unit, Phase 6D3 student-led concept progression plus final assessment completion, Phase 7A roster/student-account management, Phase 7B complete master CSV export coverage for persisted platform records, Phase 7C Response Collection Agent integration for student free-text messages during initial administration, Phase 7D Item Verification Agent governance for teacher-authored item sets, Phase 7E1 internal mock evaluation harness for the five active agents, Phase 7E2A guarded live-evaluation canary support with annotation adjudication, Phase 7E2B full-pilot evaluation infrastructure, Phase 7E2C targeted remediation/regression tooling, and Phase 8A default-off guarded operational agent integration with disabled/mock/guarded-live modes. Item generation, item rewriting, classroom live model activation, adaptive concept routing, countdown timers, public deployment, email/SMS delivery, and student self-registration remain intentionally unimplemented.

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

5. Leave OpenAI variables blank for normal local development. Mock mode is the default unless live calls are explicitly enabled server-side.

6. `COURSE_TIMEZONE` defaults to `America/Edmonton`. Assessment release/close inputs use this IANA timezone while PostgreSQL stores UTC timestamps.

7. Keep `DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED=false` and `ALLOW_MANUAL_REVIEW_STUDENT_STARTS=false` for normal classroom behavior. Development smoke tests opt into these only when needed.

8. Keep `ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW=false` for ordinary local classroom-style workflow. Set it to `true` only for explicit Response Collection Agent infrastructure testing with the mock provider.

9. Keep `OPERATIONAL_AGENT_MODE=disabled` for ordinary local/classroom-style workflow. `mock` is for local development/testing, and `guarded_live` remains blocked unless the approved manifest, config hash, usage guard, database, exact model snapshot, and server-side live-call checks all pass. The legacy `OPERATIONAL_AGENT_INTEGRATION_ENABLED` flag is deprecated and must not conflict with `OPERATIONAL_AGENT_MODE`.

10. Keep `EVAL_LIVE_CALLS_ENABLED=false` for Phase 7E1. `EVAL_TARGET_MODEL=gpt-5.4-mini` is future live-evaluation metadata only and does not trigger OpenAI calls.

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
npm run summative:import-smoke
npm run export:master-smoke
npm run export:master-complete-smoke
npm run llm:contracts-smoke
npm run llm:execution-smoke
npm run llm:redaction-smoke
npm run llm:usage-smoke
npm run llm:status-smoke
npm run agent:response-collection-smoke
npm run response-collection:fallback-smoke
npm run response-collection:service-fallback-smoke
npm run student:initial-chat-ui-smoke
npm run response-collection:mode-smoke
npm run agent:item-verification-smoke
npm run content:verification-publish-smoke
npm run item:verification-ui-smoke
npm run agent:item-verification-rename-smoke
npm run eval:harness-smoke
npm run operational:approval-manifest:verify
npm run operational:agents:preflight
npm run operational:guarded-integration-status
npm run operational:guarded-integration-smoke
npm run operational:approval-manifest-smoke
npm run operational:agent-execution-smoke
npm run operational:workflow-integration-smoke
npm run operational:fallback-smoke
npm run operational:idempotency-smoke
npm run operational:student-payload-smoke
npm run operational:teacher-audit-smoke
npm run operational:nonintervention-smoke
npm run operational:isolation-smoke
npm run agent:profiling-smoke
npm run agent:planning-smoke
npm run agent:followup-smoke
npm run student:followup-ui-smoke
npm run assessment:availability-smoke
npm run workflow:automation-smoke
npm run workflow:worker-smoke
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
npm run student:followup-update-ui-smoke
npm run concept:progression-smoke
npm run assessment:completion-smoke
npm run classroom:nonintervention-smoke
npm run student:progression-ui-smoke
npm run roster:import-smoke
npm run student:account-smoke
npm run student:account-ui-smoke
npm run auth:account-status-smoke
npm run typecheck
npm run lint
npm run build
npm run dev
```

Async workflow commands:

```bash
npm run workflow:drain-once
npm run workflow:worker
```

`workflow:drain-once` is useful for local tests. `workflow:worker` is the continuous local worker for automatic sessions.

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

Student account management routes:

- `/teacher/students`
- `/teacher/students/new`
- `/teacher/students/import`
- `/teacher/students/[userId]`

Roster/account commands:

```bash
npm run demo:roster
npm run demo:roster:cleanup
npm run roster:import-smoke
npm run student:account-smoke
npm run student:account-ui-smoke
npm run auth:account-status-smoke
```

Students are created by the teacher_researcher. Students do not self-register and do not need email addresses. Student login uses `user_id` plus an assigned access code. Access codes are stored only as hashes and plaintext codes are shown only immediately after create/import/reset.

Model evaluation routes:

- `/teacher/evals`
- `/teacher/evals/suites`
- `/teacher/evals/runs`
- `/teacher/evals/runs/[runPublicId]`
- `/teacher/evals/run-items/[runItemPublicId]`

Evaluation commands:

```bash
npm run eval:seed-fixtures
npm run eval:mock-run
npm run eval:harness-smoke
npm run eval:cleanup-fixtures
```

Phase 7E1 evaluation uses synthetic cases only, runs the mock provider only, and stores outputs only in evaluation tables. It does not call OpenAI, does not require an API key, and does not mutate classroom workflow records.

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

Outside Phase 1 and 1.5 scope:

- LLM agent calls
- OpenAI API integration
- formative follow-up conversation

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

## Phase 6B Student Profiling Verification

Phase 6B connects only the Student Profiling Agent after initial concept-unit completion. The default path uses the mock provider and does not call OpenAI.

```bash
npm run agent:profiling-smoke
```

The smoke test creates temporary completed initial concept-unit sessions, builds allowlisted profiling input from response-package evidence, verifies prohibited secret/auth fields are absent, executes `student_profiling_agent` through `executeAgent`, persists a validated `student_profiles` row, updates the latest profile pointer, transitions the session to `profiling_completed`, verifies teacher-only trigger authorization, confirms student-facing payloads do not expose profile labels, checks idempotency, invalid-output handling, usage-blocked handling, and cleans up only its temporary records.

Live OpenAI profiling is disabled unless server-side environment variables explicitly set `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY`, and `OPENAI_MODEL_PROFILING`, and the usage guard allows the call.

## Phase 6C Formative Planning Verification

Phase 6C connects only the Formative Value and Planning Agent after a saved student profile. The default path uses the mock provider and does not call OpenAI.

```bash
npm run agent:planning-smoke
```

The smoke test creates temporary profiled concept-unit sessions, builds allowlisted planning input, verifies summative outcomes and secret/auth fields are absent, derives the default formative value from the integrated diagnostic profile, executes planning through `executeAgent`, semantically validates mapping metadata and nonempty fields, persists a `formative_decisions` row, updates the latest decision pointer, transitions the session to `planning_completed`, verifies teacher-only trigger authorization, confirms student-facing payloads do not expose planning/profile labels, checks idempotency, mapping-deviation behavior, invalid-output/refusal/incomplete/usage-blocked handling, and cleans up only its temporary records.

Live OpenAI planning is disabled unless server-side environment variables explicitly set `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY`, and `OPENAI_MODEL_PLANNING`, and the usage guard allows the call.

See `docs/FORMATIVE_PLANNING_AGENT.md` for the Phase 6C planning contract.

## Phase 6D1 Follow-Up Verification

Phase 6D1 connects only the Follow-up Agent for the first open-ended follow-up conversation round after a saved profile and saved formative decision exist. The default path uses the mock provider and does not call OpenAI.

```bash
npm run agent:followup-smoke
npm run student:followup-ui-smoke
```

The smoke tests create temporary planned concept-unit sessions, start a teacher-triggered follow-up round, verify allowlisted follow-up input, strict output validation, semantic validation, idempotent student messages, bounded provider context, usage-blocked handling, agent-call audit, process-event logging, teacher review display, student-safe conversation state, stop behavior, no profile updates, no replanning, no next concept-unit start, and no OpenAI network calls.

Live OpenAI follow-up is disabled unless server-side environment variables explicitly set `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY`, and `OPENAI_MODEL_FOLLOWUP`, and the usage guard allows the call.

See `docs/FOLLOWUP_AGENT.md` and `docs/FOLLOWUP_CONVERSATION.md` for the Phase 6D1 contracts.

## Phase 6D2B Follow-Up Evidence Updates

Phase 6D2B adds iterative evidence updating inside the current concept unit only. Meaningful student follow-up evidence can create a `followup_evidence_update_package`, stage an updated Student Profiling Agent output, stage an updated Formative Value and Planning Agent output, and atomically activate both only after the full update cycle succeeds.

```bash
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
npm run student:followup-update-ui-smoke
```

The update cycle uses the existing mock-provider LLM path by default and does not call OpenAI. The student sees only a neutral update-pending state while backend updating is in progress. Teachers can review update cycles and, in manual-review mode, trigger an eligible follow-up update from the session detail page.

`FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE` defaults to `3`. It is a technical fallback for evidence updating, not a pedagogical maximum number of turns.

See `docs/FOLLOWUP_EVIDENCE_UPDATES.md`, `docs/ITERATIVE_FOLLOWUP_UPDATES.md`, and `docs/FOLLOWUP_UPDATE_ATOMICITY.md` for the Phase 6D2B contract.

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

## Phase 5B Data Management And Phase 7B Master Export

Phase 5B adds teacher_researcher-only data management for supervised summative outcomes and one merged master assessment CSV export. Phase 7B completes that master CSV for persisted platform records through Phase 7A, including account status, assessment availability, activated profiles/decisions, follow-up rounds, update cycles, progression, completion, workflow jobs, agent audit metadata, and summative outcomes.

The export is read-only. It does not call OpenAI, run agents, create profiles, create decisions, create follow-up rounds, modify student records, or fabricate values. Failed/staged update outputs remain audit/history data and do not populate active/latest scalar columns.

Teacher routes:

- `/teacher/data`
- `/teacher/data/summative-outcomes`
- `/teacher/data/export`

Summative outcome APIs:

- `POST /api/teacher/summative-outcomes/import/preview`
- `POST /api/teacher/summative-outcomes/import/[batchPublicId]/commit`
- `GET /api/teacher/summative-outcomes/import-batches`
- `GET /api/teacher/summative-outcomes/import-batches/[batchPublicId]`
- `GET /api/teacher/summative-outcomes/outcome-names`
- `POST /api/teacher/summative-outcomes/[outcomePublicId]/replace`

Master export APIs:

- `POST /api/teacher/export/master-csv`
- `GET /api/teacher/export/jobs`
- `GET /api/teacher/export/[exportPublicId]`
- `GET /api/teacher/export/[exportPublicId]/download`

Outcome import CSV columns:

```text
user_id,outcome_name,outcome_score,max_score,assessment_date,notes
```

Create the development data/export fixture:

```bash
npm run demo:data-export
```

Cleanup only fixture-owned data/export records and fixture export files:

```bash
npm run demo:data-export:cleanup
```

Clean up expired local export files:

```bash
npm run export:cleanup
```

Phase 5B verification:

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
npm run summative:import-smoke
npm run export:master-smoke
npm run export:master-complete-smoke
npm run typecheck
npm run lint
npm run build
```

Manual browser flow:

1. Run `npm run db:up`.
2. Run `npm run prisma:seed`.
3. Run `npm run demo:data-export`.
4. Run `npm run dev`.
5. Sign in as `teacher_demo` with `teacher_demo_password`.
6. Open `/teacher/data/summative-outcomes`, preview a valid or invalid CSV, inspect validation results, and commit a valid preview.
7. Open `/teacher/data/export`, select the demo assessment and primary outcome, generate the export, and download `master_assessment_export.csv`.
8. Sign out, sign in as `student_demo` with `student_demo_access_code`, and confirm data/export pages and APIs are forbidden.

See `docs/SUMMATIVE_OUTCOMES.md`, `docs/MASTER_CSV_EXPORT.md`, and `docs/MASTER_EXPORT_DATA_DICTIONARY.md` for the detailed data/export contracts.

## Phase 6A And 6A.5 LLM Infrastructure

Phase 6A adds generic LLM infrastructure. Phase 6A.5 adds classroom LLM access controls, usage limits, live-call readiness checks, and teacher-visible usage monitoring. These phases do not run agents on real classroom data, create profiles, create formative decisions, create follow-up rounds, alter `profiling_pending` sessions, or call OpenAI during normal verification.

Teacher route and API:

- `/teacher/system/llm`
- `GET /api/teacher/system/llm-status`

Students never provide OpenAI API keys and never need OpenAI accounts. Future live calls must use a backend-controlled server-side API key and pass authentication, authorization, readiness, usage guard, and audit logging.

LLM verification:

```bash
npm run llm:contracts-smoke
npm run llm:execution-smoke
npm run llm:redaction-smoke
npm run llm:usage-smoke
npm run llm:status-smoke
```

Optional synthetic live connectivity check:

```bash
npm run llm:connectivity
```

The connectivity script requires `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY`, and `OPENAI_MODEL_CONNECTIVITY_TEST`. It sends only fixed synthetic data and is not part of the offline verification path.

Usage safeguard variables are documented in `.env.example` and `docs/LLM_USAGE_LIMITS.md`.

See `docs/LLM_INFRASTRUCTURE.md`, `docs/AGENT_CONTRACTS.md`, `docs/PROMPT_VERSIONING.md`, `docs/CLASSROOM_LLM_ACCESS.md`, `docs/LLM_USAGE_LIMITS.md`, `docs/STUDENT_PROFILING_AGENT.md`, `docs/FORMATIVE_PLANNING_AGENT.md`, `docs/FOLLOWUP_AGENT.md`, `docs/FOLLOWUP_CONVERSATION.md`, `docs/FOLLOWUP_EVIDENCE_UPDATES.md`, `docs/ITERATIVE_FOLLOWUP_UPDATES.md`, `docs/FOLLOWUP_UPDATE_ATOMICITY.md`, `docs/ITEM_VERIFICATION_AGENT.md`, and `docs/ITEM_VERIFICATION_WORKFLOW.md`.

## Phase 7E2A Live Evaluation Canary

Phase 7E2A adds a CLI-only live evaluation canary path for the internal evaluation harness. It does not enable classroom live calls.

Canary design:

- exact snapshot: `gpt-5.4-mini-2026-03-17`
- reasoning effort: `low`
- 5 active agents x 5 synthetic cases x 1 repetition = 25 run items
- hard budget: USD 50
- no GPT-5.5 comparison and no nano comparison

Manual paid canary procedure after editing `.env.local` locally:

```bash
npm run eval:live-canary:preflight
npm run eval:live-canary:dry-run
npm run eval:live-canary -- --confirm-paid-api --new-run
npm run eval:live-canary:report -- --run <run_public_id>
```

Paid execution requires explicit run selection. Use `--new-run` for a fresh
25-item canary or `--resume <run_public_id>` for a specific nonterminal run:

```bash
npm run eval:live-canary -- --confirm-paid-api --new-run
npm run eval:live-canary -- --confirm-paid-api --resume <run_public_id>
```

The runner never silently reuses a completed run. A fresh run receives a new
`run_public_id`; the separate `run_config_hash` records the frozen model,
manifest, prompt, schema, evaluator, budget, retry, timeout, concurrency, and Git
configuration for reproducibility.

Read-only inspection of an existing live canary run:

```bash
npm run eval:live-canary:inspect -- --run <run_public_id>
```

Read-only comparison of current canary configuration with a historical run:

```bash
npm run eval:live-canary:compare-config -- --run <run_public_id>
```

The inspect command makes no provider request. It reports run status, item statuses,
provider IDs when present, usage availability, sanitized errors, and whether a
fresh run is safer than resuming.

Generate a local blind expert-review packet for a completed 25-item live canary:

```bash
npm run eval:blind-review-export -- --run <run_public_id>
```

The command writes ignored files under `.data/eval-review/<run_public_id>/`:
`blind_review_packet.jsonl`, `review_reference.jsonl`, and
`annotation_template.csv`. It also writes `redaction_summary.json` with field
paths, detection categories, value lengths, and irreversible hashes for
export-only safety findings. The blind packet omits model/provider metadata,
case IDs, automated results, gold labels, token usage, costs, and existing
annotations; the separate reference file is for adjudication after blind review.

Inspect blind-review export safety without writing review files:

```bash
npm run eval:blind-review-export:inspect -- --run <run_public_id>
```

The inspect command does not print detected values. Standalone
credential-shaped tokens are redacted only in the exported review copy as
`[REDACTED_SECRET_LIKE_TOKEN]`; benign phrases such as `API key`, `system
prompt`, `hidden instructions`, and broad legacy false positives inside ordinary
words remain reviewable.

Import completed offline annotations as AI-assisted preliminary drafts:

```bash
npm run eval:annotations:import-draft -- \
  --run <run_public_id> \
  --annotations <completed_annotation_csv_path> \
  --reference .data/eval-review/<run_public_id>/review_reference.jsonl
```

Draft imports do not count as completed human review. In the teacher eval UI,
open `/teacher/evals/runs/<run_public_id>`, inspect/edit the proposed
annotations, type the required attestation, and confirm all reviewed drafts.
Readiness gates then use confirmed human pass/fail and human critical-failure
flags. Automated screening flags remain visible as separate adjudication
context and are not silently copied into human judgments.

The annotation importer validates structure and mapping, not expected outcomes.
It derives the expected row count from the target run, requires exactly one CSV
row and one reference record for each review item, validates rubric scores and
critical-failure flags, and then reports pass/fail totals as calculated results.
No pass/fail distribution is hardcoded; the same importer supports the 25-item
canary and future larger pilot runs.

Confirmed annotations may be amended only after explicit unblinded researcher
adjudication. The guarded CLI preserves pass/fail, overall rating, rubric
scores, annotation source, confirmer, confirmation timestamp, model outputs, and
automated findings; it writes `eval_annotation_revisions` before changing the
current confirmed annotation fields:

```bash
npm run eval:annotations:amend-confirmed -- \
  --run <run_public_id> \
  --case <case_id> \
  --remove-critical-flag <critical_failure_flag> \
  --confirm-researcher-instruction
```

Removing a human critical-failure flag does not convert a Fail into a Pass.

Do not paste the API key into chat or a browser form. Keep classroom settings as `LLM_PROVIDER=mock` and `LLM_LIVE_CALLS_ENABLED=false`.

Offline verification commands:

```bash
npm run eval:blind-review-export-smoke
npm run eval:blind-review-secret-scan-smoke
npm run eval:annotation-import-smoke
npm run eval:annotation-adjudication-smoke
npm run eval:confirmed-annotation-amendment-smoke
npm run eval:structured-output-compat-smoke
npm run eval:live-canary-runner-smoke
npm run eval:usage-parser-smoke
npm run eval:budget-smoke
npm run eval:live-isolation-smoke
npm run eval:canary-report-smoke
```

See `docs/LIVE_EVAL_CANARY.md`, `docs/EVAL_BUDGET_GUARD.md`, and `docs/EVAL_REPRODUCIBILITY.md`.

### Phase 7E2A Quality Patch

After baseline run `evr_20260623_1sjeh1q`, future canaries use updated prompt
versions and evaluator versions for known quality failures. The baseline run and
confirmed annotations remain frozen for audit.

Run the targeted regression check before any new fresh canary:

```bash
npm run eval:targeted-quality-regression-smoke
```

The next fresh canary should use the same exact snapshot and manifest, then run:

```bash
npm run eval:live-canary:preflight
npm run eval:live-canary:dry-run
npm run eval:live-canary:compare-config -- --run evr_20260623_1sjeh1q
```

Then start a fresh paid canary only after local API-key configuration:

```bash
npm run eval:live-canary -- --confirm-paid-api --new-run
```

Do not resume the baseline run. Fresh runs require fresh human annotation. See
`docs/CANARY_QUALITY_PATCH.md`.

### Phase 7E2B Full Pilot

The full pilot is a guarded, CLI-only live-evaluation path for eval tables only.
It uses `gpt-5.4-mini-2026-03-17`, `reasoning_effort=low`, 50 synthetic base
cases, two repetitions, and 100 total outputs. It requires an approved canary
run via `--approved-canary <run_public_id>` or
`EVAL_PILOT_APPROVED_CANARY_RUN_ID`.

Preflight and dry run make no provider request:

```bash
npm run eval:live-pilot:preflight -- --approved-canary <run_public_id>
npm run eval:live-pilot:dry-run -- --approved-canary <run_public_id>
```

Paid execution is not automatic and requires local `.env.local` configuration
plus explicit confirmation:

```bash
npm run eval:live-pilot -- --approved-canary <run_public_id> --confirm-paid-api --new-run
npm run eval:live-pilot -- --confirm-paid-api --resume <pilot_run_public_id>
npm run eval:live-pilot:report -- --run <pilot_run_public_id>
```

Pilot smoke tests use mock providers and make no OpenAI call:

```bash
npm run eval:pilot-manifest-smoke
npm run eval:live-pilot-runner-smoke
npm run eval:pilot-stability-smoke
npm run eval:pilot-blind-export-smoke
npm run eval:pilot-annotation-smoke
npm run eval:pilot-report-smoke
```

See `docs/FULL_LIVE_EVAL_PILOT.md`,
`docs/EVAL_STABILITY_ANALYSIS.md`, and
`docs/INTERNAL_HOLDOUT_LIMITATIONS.md`.

### Phase 7E2C Targeted Remediation

The completed full pilot run `evr_20260623_ga6kzai` remains frozen: 100 outputs,
91 confirmed human Pass, 9 confirmed human Fail, and zero confirmed human
critical failures after adjudication. Phase 7E2C does not rerun or alter that
pilot. It adds targeted remediations and a separate 22-output regression path
for the six failed base cases plus one unaffected control case per active
agent, each with two repetitions.

Targeted remediation updates:

- Response Collection prompt `response-collection-v5` captures exact valid reasoning segments in mixed reasoning-plus-correctness-request messages while still refusing correctness feedback.
- Formative Planning prompt `formative-planning-v2` treats the default formative-value mapping as backend-owned guidance; backend code canonicalizes `mapping_followed` and requires evidence-linked deviation reasons.
- Follow-up prompt `followup-v6` validates saved formative value compatibility, transfer/verification action compatibility, move-on technical final-update semantics, nullable evidence requests, and backend-owned process-event metadata.
- Item Verification prompt `item-verification-v4` keeps findings advisory and adds a deterministic supplementary duplicate warning that is stored separately from raw LLM verification.
- Evaluation validators are versioned as `eval-semantic-v3` and `eval-safety-v3`.

Offline smoke checks make no OpenAI call:

```bash
npm run eval:targeted-remediation-manifest-smoke
npm run eval:targeted-remediation-runner-smoke
npm run eval:targeted-remediation-report-smoke
npm run eval:targeted-remediation-blind-export-smoke
```

Manual targeted paid evaluation, if later approved, is CLI-only:

```bash
npm run eval:targeted-remediation:preflight
npm run eval:targeted-remediation:dry-run
npm run eval:targeted-remediation -- --confirm-paid-api --new-run
npm run eval:targeted-remediation -- --confirm-paid-api --resume <run_public_id>
npm run eval:targeted-remediation:inspect -- --run <run_public_id>
npm run eval:targeted-remediation:report -- --run <run_public_id>
npm run eval:targeted-remediation:diagnose -- --run <run_public_id>
```

The targeted path uses synthetic eval cases only, `gpt-5.4-mini-2026-03-17`,
low reasoning effort, 22 planned outputs, concurrency 1, max retries 1, max 35
provider requests, and a USD 10 hard limit. Classroom settings remain
`LLM_PROVIDER=mock` and `LLM_LIVE_CALLS_ENABLED=false`. The readiness label is a
guarded integration patch check, not classroom validity.

Phase 7E2C separates `raw_model_quality` from
`effective_system_readiness`. Raw-output annotations remain visible and are
stored with `review_target=raw_model_output`. Effective-system review uses
derived artifacts that include deterministic safeguards, backend
canonicalization, and safe fallbacks, and is stored separately with
`review_target=effective_system_output`.

Effective-system readiness now has its own versioned validation source:
`effective_validator_version=effective-validator-v1`. It evaluates the
student-facing effective message, backend-owned structured result, workflow
actions, process events, deterministic guards, and fallbacks. It does not
inherit raw semantic or raw safety failures as effective failures. A safe
refusal such as "I cannot provide a hint" or "I can't confirm whether that is
correct" is not answer leakage merely because it contains words like hint,
answer, explanation, or correctness. Actual answer delivery, correctness
feedback, hints, unauthorized option/confidence mutation, workflow mutation, or
secret/profile/misconduct exposure remain blocking failures. Metadata
inconsistencies that do not change student-facing behavior or workflow actions
are reported as nonblocking warnings.

For `evr_20260624_bltzgtq`, the raw-model AI review remains 20 Pass / 2 Fail.
The original effective-system artifact version `effective-system-eval-v1` is
also preserved with 20 Pass / 2 Fail; both Fail judgments were the two
`fua_move_on_offer_010` repetitions, where the v1 fallback ignored the
student's explicit move-on request and assigned another transfer task. The
corrected artifact version is `effective-system-eval-v2`; it keeps move-on
student-led and asynchronous by preparing the final update/progression path
without directly advancing the student or bypassing unresolved-evidence
confirmation. The v2 AI blind review for this run is stored as 22 Pass / 0 Fail
with zero critical-failure flags, and it must not reuse v1 judgments. The
report remains provisional engineering evidence with human review pending and
`classroom_validity=false`.

Because the final effective-validation correction did not change the v2
student-facing messages, structured effective results, workflow actions, process
events, or `effective_result_hash` values, no new blind review is required. The
v2 AI review remains reusable while the report now reads the independent
effective-validation fields for readiness gates.

Generate the effective-system blind packet with:

```bash
npm run eval:blind-review-export -- \
  --run <targeted_run_public_id> \
  --review-target effective_system_output
```

By default this writes `effective-system-eval-v2` artifacts under
`.data/eval-review/<targeted_run_public_id>/effective-system-v2/`. To reproduce
the preserved v1 packet, add:

```bash
  --effective-result-version effective-system-eval-v1
```

Confirm an externally reviewed effective-system packet with:

```bash
npm run eval:annotations:confirm-ai-review -- \
  --run <targeted_run_public_id> \
  --annotations <completed_effective_annotation_csv_path> \
  --reference .data/eval-review/<targeted_run_public_id>/effective-system-v2/review_reference.jsonl \
  --reviewer-model gpt-5.5-pro \
  --review-target effective_system_output \
  --review-artifact-version effective-system-eval-v2 \
  --confirm-ai-review
```

Additional no-provider smoke checks:

```bash
npm run eval:effective-system-artifact-smoke
npm run eval:effective-move-on-fallback-smoke
npm run eval:effective-validation-source-smoke
npm run eval:effective-system-report-smoke
npm run eval:effective-system-blind-export-smoke
npm run eval:effective-system-annotation-smoke
```

AI-agent blind review can be confirmed as provisional engineering evidence
without labeling it as human review:

```bash
npm run eval:annotations:confirm-ai-review -- \
  --run <targeted_run_public_id> \
  --annotations <completed_annotation_csv_path> \
  --reference .data/eval-review/<targeted_run_public_id>/review_reference.jsonl \
  --reviewer-model gpt-5.5-pro \
  --confirm-ai-review
```

This stores `annotation_source=ai_agent_review` and
`annotation_status=ai_confirmed`, reviewer model, review method, reviewed time,
file hashes, source run ID, and import command version. It does not populate
human confirmer fields. Human researchers may later accept, edit, or replace
these judgments; that supersession writes an audit revision and preserves the
original AI-review provenance.

See `docs/FULL_PILOT_FAILURE_ADJUDICATION.md` and
`docs/TARGETED_REMEDIATION_EVAL.md`.

## Phase 8A Guarded Operational Integration

Phase 8A keeps the existing default-off outer guard and adds the actual operational executor behind explicit modes:

```text
OPERATIONAL_AGENT_MODE=disabled
OPERATIONAL_APPROVED_CONFIG_HASH=
OPERATIONAL_EFFECTIVE_RESULT_VERSION=effective-system-eval-v2
OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION=effective-validator-v1
```

Allowed modes are `disabled`, `mock`, and `guarded_live`. The default `disabled` mode makes no provider request and uses deterministic behavior or fallback. `mock` is for local development and injected-provider tests. `guarded_live` validates the approved manifest, exact model snapshot, reasoning effort, active configuration hash, usage guard, database readiness, and classroom live-call settings before any provider request could be permitted.

The approved manifest is `config/approved-operational-agent-config.json`. It freezes `gpt-5.4-mini-2026-03-17`, low reasoning effort, evaluated prompt/schema hashes, validator versions, deterministic guard versions, canonicalization versions, fallback versions, and evaluation evidence. Configuration changes require reevaluation.

Operational services consume only effective results. Raw provider output stays in `agent_calls`; backend-effective outputs are stored in `operational_agent_effective_results` with public IDs, version metadata, status fields, sanitized warnings, and an effective-result hash. Student payloads hide operational audit metadata, profile labels, formative-value labels, model/provider identity, prompts, answer keys, token usage, and cost.

Useful Phase 8A checks:

```bash
npm run operational:approval-manifest:verify
npm run operational:agents:preflight
npm run operational:guarded-integration-smoke
npm run operational:agent-execution-smoke
npm run operational:student-payload-smoke
npm run operational:teacher-audit-smoke
```

See `docs/GUARDED_OPERATIONAL_AGENT_INTEGRATION.md`,
`docs/APPROVED_OPERATIONAL_AGENT_CONFIG.md`,
`docs/OPERATIONAL_EFFECTIVE_RESULTS.md`,
`docs/OPERATIONAL_AGENT_FALLBACKS.md`, and
`docs/OPERATIONAL_AGENT_INTEGRATION.md`.

## Phase 8B Production-Like Synthetic E2E

Phase 8B adds a local, production-like E2E validation harness. It uses an
isolated PostgreSQL database whose name must end in `_e2e`, runs `next build`,
starts `next start` on `http://127.0.0.1:3100`, starts the real workflow worker,
and exercises synthetic student and teacher journeys with Playwright. It keeps
`OPERATIONAL_AGENT_MODE=mock`, `LLM_PROVIDER=mock`, and
`LLM_LIVE_CALLS_ENABLED=false`; no OpenAI call is made.

```bash
npm run e2e:production-like:preflight
npm run e2e:db:prepare
npm run e2e:db:reset
npm run e2e:production-like
npm run e2e:production-like:report -- --run <e2e_run_id>
```

Focused suites:

```bash
npm run e2e:browser-smoke
npm run e2e:worker-restart-smoke
npm run e2e:app-restart-smoke
npm run e2e:failure-matrix-smoke
npm run e2e:concurrency-smoke
npm run e2e:export-smoke
npm run e2e:privacy-smoke
```

Artifacts are written to `.data/e2e/<e2e_run_id>/` and are ignored by Git. See
`docs/PRODUCTION_LIKE_E2E_TESTING.md`,
`docs/SYNTHETIC_CLASSROOM_FIXTURE.md`, `docs/E2E_FAILURE_MATRIX.md`, and
`docs/E2E_ACCEPTANCE_GATES.md`.

## Phase 8C Guarded-Live Synthetic Operational Canary

Phase 8C adds CLI-only infrastructure for a small synthetic operational canary
against a dedicated database ending in `_live_canary_e2e`. It is disabled by
default and does not authorize real student use or public deployment.

Default local settings remain:

```text
OPERATIONAL_AGENT_MODE=disabled
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
OPERATIONAL_LIVE_CANARY_ENABLED=false
```

No-provider commands:

```bash
npm run operational:live-canary:preflight
npm run operational:live-canary:dry-run
npm run operational:live-canary-db-resolution-smoke
npm run operational:live-canary-guard-parity-smoke
npm run operational:live-canary-block-reason-smoke
npm run operational:live-canary-context-smoke
npm run operational:live-canary-actual-step-parity-smoke
npm run operational:live-canary-provenance-smoke
npm run operational:live-canary-dispatch-ledger-smoke
npm run operational:live-canary-accounting-smoke
npm run operational:live-canary-reconciliation-smoke
npm run operational:live-canary-recovery-smoke
npm run operational:live-canary-full-simulation-smoke
npm run operational:live-canary-transport-probe-smoke
```

The live-canary database resolver is idempotent: `conversational_mcq` resolves
to `conversational_mcq_live_canary_e2e`, while an already isolated
`conversational_mcq_live_canary_e2e` remains unchanged. Repeated malformed
suffixes such as `_live_canary_live_canary_e2e` are rejected. The parent
`DATABASE_URL` is not rewritten; canary Prisma clients and child processes
receive the isolated URL explicitly.

Preflight and operational execution use the same typed readiness evaluator. If
preflight is permitted, the runner stages the real run plus first step and
validates a canonical `operational-live-canary-context-v1` attestation before
creating the remaining executable steps. If that actual-step probe is blocked,
the canary makes no provider request and does not create a full 30-step run.
Dry run prepares and seeds the isolated database without dropping historical
canary runs.

Phase 8C execution-integrity hardening adds an immutable dispatch ledger. A
provider request counts only when `operational_live_canary_dispatch_attempts`
contains verified provider provenance, usage, and lifecycle status. Historical
completed rows without dispatch rows are preserved but classified as
`unknown_legacy_provenance`, not verified paid provider calls.

Transport probe hardening adds a local stage machine and transport objective.
Dry run validates the exact synthetic Response Collection input, output schema,
redaction, budget/readiness state, and OpenAI Responses transport descriptor
without making a provider request. Diagnosis is read-only and reports
unrecoverable historical errors without inventing a cause.

Reset-heavy smoke tests use `conversational_mcq_live_canary_smoke_e2e` and do
not reset the historical `_live_canary_e2e` database.

Future one-call paid transport probe, only after manual server-side
configuration:

```bash
npm run operational:live-canary:transport-probe:preflight
npm run operational:live-canary:transport-probe:dry-run
npm run operational:live-canary:transport-probe:diagnose -- --run <run_public_id>
npm run operational:live-canary:transport-probe -- --confirm-paid-api
```

Future full paid command, only after the successful transport probe exists:

```bash
npm run operational:live-canary -- --confirm-paid-api --new-run
npm run operational:live-canary -- --confirm-paid-api --resume <run_public_id>
```

Review/report commands:

```bash
npm run operational:live-canary:inspect -- --run <run_public_id>
npm run operational:live-canary:report -- --run <run_public_id>
npm run operational:live-canary:forensics -- --run <run_public_id>
npm run operational:live-canary:reconcile -- --run <run_public_id>
npm run operational:live-canary:review-export -- --run <run_public_id>
```

The manifest is
`tests/fixtures/operational-live-canary/manifest.json`; it freezes 5 synthetic
students, 1 synthetic teacher, 2 concept units, 8 items, 30 planned logical
invocations, a USD 15 budget cap, and an 80 provider-request cap.

See `docs/GUARDED_LIVE_SYNTHETIC_CANARY.md`,
`docs/OPERATIONAL_LIVE_CANARY_BUDGET.md`,
`docs/OPERATIONAL_LIVE_CANARY_EXECUTION_LIFECYCLE.md`,
`docs/OPERATIONAL_LIVE_CANARY_RECOVERY.md`,
`docs/OPERATIONAL_LIVE_CANARY_TRANSPORT_PROBE.md`,
`docs/OPERATIONAL_LIVE_CANARY_REVIEW.md`, and
`docs/OPERATIONAL_LIVE_CANARY_ACCEPTANCE.md`.
