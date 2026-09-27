# Initial feedback failure continuation verification

This release adds an explicit student choice after initial AI feedback fails.
It does not raise token budgets, weaken output validation, or claim that skipped
learning support was completed. All retained test fixtures are synthetic;
external AI requests were blocked. Deployment evidence is recorded separately
in the change and deployment ledger.

## Final checks

- `prisma/initial-feedback-failure-smoke-test.ts`: seven assertion groups passed
  with a 96 MiB old-space / 4 MiB semi-space budget. They cover immediate stopping
  on a persisted token-limit failure, ownership and pause guards, four concurrent
  continuation requests, unchanged sealed responses/packages/call audits, no
  fabricated profile or learning gain, teacher flags and research CSVs,
  multi-topic progression to a real next item, replay safety, tampered source
  rejection, old failure isolation, and racing retry versus continuation.
- `prisma/initial-preparation-smoke-test.ts`: 17 groups passed at the same memory
  budget, including lease recovery, concurrency, independent workers, bounded
  retries, and valid opening publication.
- `prisma/attempt-policy-database-smoke-test.ts`: 12 groups passed.
- `prisma/student-formative-live-validation-smoke-test.ts --initial-profile-only`:
  provider-boundary simulations passed at 96 MiB. No real provider requests.
- `scripts/initial-preparation-ux-smoke.mjs`: 11 browser groups passed. The
  production build returned submission acknowledgement in 127 ms in the local
  synthetic fixture. Checks include read-only polling, connection recovery,
  worker completion, failed preparation retry, typing/paste aggregates in the
  database and exported CSVs, the capacity-error message, explicit continuation,
  persistence across refresh, return navigation, and supervised launcher exit.
  Desktop 1440 px and mobile 390/320 px had no horizontal overflow. Failure and
  completed-state screenshots were visually inspected.
- `npm run typecheck`, `npm run lint`, `git diff --check`, and final production
  build passed. Lint retains five pre-existing warnings and no errors. Build
  generated 83 static pages; existing cache and unused-import warnings remain.
- Every isolated database was dropped and child web/worker processes stopped.
- After push, four additional existing suites passed against the same application
  source: analysis-ready export, selected-session export, research export integrity,
  and readable process-data summary. See `research-results.json` and their logs.
  No application changes were made for this additional check.

Retained raw `.log` files match the report hashes, including their original
trailing whitespace and blank lines. The final staged source whitespace check
excludes these unmodified output files; it passes for code and documentation.

## Failed checks and corrections

The first new service test used top-level await in a CommonJS-transformed file;
it failed before running and passed after being wrapped in an async main. The
first browser extension omitted a required item-version fixture field; this was
corrected without relaxing the schema. Review also corrected a return-link typo.
The next browser run found a real integration error: terminal read-only review
hid the new completion notice. The notice was moved into the existing review
banner and the entire browser suite passed on the rebuilt application.

The first local build exhausted the default 4 GiB heap. An 8 GiB build passed;
this changes only the local builder budget, not the Render runtime or service
plan. A later rebuild initially failed at sandbox IPC setup, then passed with
the required local build permission. None of these failures is reported as a
successful first run or evidence of a production out-of-memory event.

## Data and scope

The new backend `initial_feedback_skipped` event records an explicit student
choice, source-package hash, job, safe failure category, destination, and policy
version. Sessions with this event have an `incomplete_technical_failure` support
summary and a teacher-review flag. It is not evidence of misconception resolution,
low motivation, or learning gain. Detailed definitions are in DATA_LOGGING_SPEC
and the exported dictionary. Raw product data and failed calls remain unchanged.

One separately authorized production fresh-start operation closed a failed
attempt and restored one chance without recovering its prior conversation.
Four stored item-response rows and one sealed response package had identical
complete-record hashes before and after. No new attempt was started for the
student. Identifiers, hashes of real student records, and transcripts are not
included in this report.

This scope is initial-feedback preparation. A continuation moves to the next
topic or finishes the attempt without that topic's AI support. Source-integrity
conflicts still require teacher intervention. Later chat errors retain their
existing controls. The previous approved-configuration mismatch and the requested
30,000-token override were not changed; no live AI success or pedagogical-validity
claim is made by these mechanical tests.
