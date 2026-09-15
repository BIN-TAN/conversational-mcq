# Background Initial Preparation

The student `complete-initial` endpoint saves the completed response package and a
`prepare_initial_conversation` workflow job in one short database transaction,
then returns HTTP 202 and the saved student state. It does not call a provider.
The existing synchronous completion function remains available to internal
evaluation harnesses; the browser route no longer uses it directly.

## Execution and Recovery

- `npm start` and `npm run dev` supervise Next and the dedicated preparation
  worker together. If either process stops unexpectedly, the service exits so
  its host can restart it. Builds do not start workers.
- Apply `20260914193000_initial_preparation_job` before starting the updated app.
  This adds one job type to the existing workflow table, not a new data table.
- The accompanying optimizations also require
  `20260914210000_prepared_assessment_context`; see `LATENCY_OPTIMIZATIONS.md`.
- `INITIAL_PREPARATION_CONCURRENCY` defaults to 2 jobs per service instance and
  accepts 1-8. All existing provider, approval, model, and usage gates still apply.
  Increase concurrency only after checking database and provider capacity.
- Only the dedicated worker claims this job type. It does not drain legacy
  workflow jobs. Claims use row locks, heartbeats, and attempt-specific ownership.
- Jobs survive browser closure and process restarts. Expired leases are retried
  within the existing workflow attempt/backoff limits. Replayed stages reuse
  saved packages, profiles, calls, and validated openings.
- A failed job stays failed until an explicit authorized retry. Retries keep the
  same job and monotonic attempt history. Source-identity conflicts require
  teacher review and cannot be retried by the student.
- Paused attempts defer preparation without consuming their failure budget.
  Ending an attempt cancels pending/running preparation atomically. Guards
  between preparation stages and existing transcript-write boundaries prevent
  late results from reopening the attempt.
- A worker crash during an external request cannot prove the provider did not
  receive that request. Existing agent invocation/receipt recovery remains
  authoritative; durable scheduling is not a guarantee of exactly-once external
  provider billing. Completed, persisted stages must not be generated again.

## Student and Research Boundaries

The page polls the authenticated, read-only `preparation` endpoint, normally
every two seconds, with backoff after connection failures. It loads the full
state and transcript after preparation finishes. Polling never starts work or
creates response, message, submission, or engagement events. A refresh recovers
the same job. Students can review their submitted responses while waiting.

Rich response evidence and existing prompts are unchanged. Tutor replies become
visible only after full generation and validation. No partial-token streaming,
fabricated tutoring message, model switch, or smaller output cap is introduced.

The immutable response package is captured before background activity. Workflow
events record enqueue, claim, retry, and completion separately from student
submission/typing timestamps; job payloads contain references and a source hash,
not copied student evidence or credentials. Existing research exports continue to
use the authoritative response, profile, conversation, and process records.

## Focused Verification

`prisma/initial-preparation-smoke-test.ts` requires an isolated loopback database
named `conversational_mcq_classroom_audit_*`, mock providers, and live calls off.
Run it with `scripts/classroom-audit-network-guard.mjs` preloaded in `NODE_OPTIONS`
so its standalone worker inherits the network restriction. It covers concurrent
submission, transaction rollback, ownership, separate students, heartbeats,
lease recovery/fencing, bounded retry, pause/end, source integrity, and the full
validated mock pipeline with replay.

`scripts/initial-preparation-ux-smoke.mjs` covers the real submission/status
routes and browser recovery with mocked preparation, without provider calls.
It also checks submitted-response review, mobile layout, explicit retry, and the
supervised production launcher. Build the application before running it.

## Initial Verification Record (2026-09-14, Before Latency Optimizations)

- Background preparation: 15/15 checks passed with synthetic local fixtures.
- Browser: 8/8 checks passed against the production build, including 320px,
  390px, and 1440px layouts. The final local HTTP acknowledgement was 118ms.
  This is not a production latency measurement or a model-generation speedup.
- Existing service, workflow-worker, package-feedback recovery, profile handoff,
  attempt lifecycle, demo recovery, data-collection completeness, research-export
  integrity, and item-timing checks passed.
- The older `workflow:automation-smoke` fails at its initial enqueue assertion
  with `approved_manifest_invalid` in this local setup. The same failure was
  reproduced using the unchanged committed workflow implementation. No approval
  or activation gate was relaxed to make that historical test pass.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`
  passed. Lint reports five pre-existing unused-variable warnings in frozen
  evaluation files.
- No provider calls, production database access, Render changes, or deployment.
  The new migration was applied only to the isolated local test database.
- Prompts, rich evidence content, full-output validation, and historical live
  evaluation artifacts are unchanged.

The combined final local gate and deployment prerequisites are recorded in
`LATENCY_OPTIMIZATIONS.md`. The no-deployment statement above describes this
initial verification run, not the subsequent authorized deployment.

## Changed Areas

- `package.json`, `scripts/start-app.mjs`, and
  `prisma/initial-preparation-worker.ts`: supervised web/worker startup.
- `prisma/schema.prisma`, the `20260914193000_initial_preparation_job` migration,
  `src/lib/domain/enums.ts`, and `src/lib/env.ts`: durable job type and bounded
  worker concurrency.
- `src/lib/workflow/initial-preparation.ts`, `initial-preparation-status.ts`, and
  `jobs.ts`: queue claims, recovery, progress, and legacy-worker isolation.
- Student `complete-initial` and `preparation` routes; student assessment
  service, response-packages, process-events, and session-state services:
  transactional submission and evidence sealing.
- Profile integration, formative profile, opening orchestration, and projection:
  preparation guards and existing validated-result reuse.
- Student assessment client, client API, and UI types: read-only progress,
  submitted-response review, automatic arrival, retry, and long-title wrapping.
- `prisma/initial-preparation-smoke-test.ts`,
  `scripts/initial-preparation-ux-smoke.mjs`, and this document: verification and
  deployment guidance.
