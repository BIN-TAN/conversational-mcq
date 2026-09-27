# Research dataset audit, 27 September 2026

Subsequent local corrections and verification are recorded in
[FOLLOWUP.md](FOLLOWUP.md). This report preserves the original audit snapshot.

## Conclusion

The core response and transcript data checked are intact and correctly linked.
The dataset is not complete for every proposed behavioral or learning-outcome
measure. In particular, the current formative conversation UI has a confirmed
feedback-display acknowledgement gap. No historical observations were filled in
or inferred to hide that gap.

This audit checked current production aggregates, three existing production ZIPs,
and 20 isolated research regression suites. It did not perform learning analytics,
alter student attempts, run new AI calls, or deploy an application change.

## Scope and provenance

- Deployed application: `a0f587f74e8860e9d3e395bee2abaac3133a7fa6`.
- Local starting commit: `fffedbeff23a19c61fb3297f1d96ef2f73e3e984`.
- Production integrity snapshot: `2026-09-27T20:18:27.302Z`.
- Production timing snapshot: `2026-09-27T20:27:01.785Z`.
- Production queries used read-only, repeatable-read transactions with statement
  timeouts. Only aggregate counts and flags were returned. No student text,
  credentials, usernames, or email addresses are included in these artifacts.
- Synthetic database tests used a new disposable localhost database, migrations,
  fixtures, and the classroom network guard. The database was dropped after each
  run. The runner records confirm cleanup and blocked external AI access.
- Separate snapshots must not be treated as one atomic export. The observed
  current counts below are not the counts of the September 26 ZIP.

## Findings requiring attention

### 1. Feedback exposure is not captured in the current conversation UI

Severity: P2, confirmed collection gap, not loss of submitted responses.

Production has zero `student_display_acknowledged_at` values, despite 46 responses
marked `answer_explanation_revealed`. The latest saved ZIP has zero rows in
`feedback_exposure_events.csv`.

The display effect in
`src/components/student-assessment/assessment-session-client.tsx:2935` exits when
`state.formative_conversation` exists. The research export at
`src/lib/services/teacher-research-data/response-stage-export.ts:35` consumes the
legacy display events. Current conversation messages are therefore not covered
by that display acknowledgement path.

Recommended systemic correction: add visibility-aware acknowledgements tied to
the actual rendered feedback/message identity, use the durable event-delivery
queue, and test hidden tabs, scrolling, retries, reloads, and read-only review.
Record display only, never imply reading, attention, or understanding. Do not
backfill old display times from generation or message-persistence timestamps.
This application correction is not implemented in this audit-only task.

### 2. Final reassessment is unavailable for these retained conversations

There are eight formative conversations, 33 student messages, 41 tutor messages,
and 14 persisted evidence-reference records, but zero canonical final profile
transitions. All 14 evidence references have matching source calls/tutor turns
and existing referenced evidence turns; no cross-conversation mismatch was found.

The latest saved export explicitly classifies seven conversations as
`reassessment_incomplete` and one as `not_reassessed`. Pausing, exiting, or reading
feedback does not create a validated improvement outcome. This is a limitation of
the available evidence, not proof of lost final profiles. Current lifecycle counts
are five paused, six exited, and one active attempt; none is completed.

The current database contains 26 profile artifacts, not 26 independent learning
measurements: seven successful validated profiling-source records, one record
from an invalid-output profiling call, eight planning-source artifacts, and ten
object-form records without source-call links. The saved export distinguishes seven
validated, one fallback, and 16 intermediate records at its earlier snapshot.
Use `profile_valid_for_learning_analysis` and source provenance; do not treat
fallback/intermediate records as measurements. This flag establishes provenance
eligibility, not pedagogical validity.

### 3. Previously downloaded ZIPs are historical snapshots

The latest retained export was generated on September 26 at
`2026-09-26T23:20:46.469Z`, from application `108abf11d99a4b391531f74f34f75e6f67c3fb71`.
It contains 10 attempts, 42 item responses, 499 conversation turns, and 3,216
process events. The current database has newer records. This is expected snapshot
behavior, not evidence that current records were dropped. Generate a new dataset
for the latest cohort; include incomplete attempts when those are in scope.

The current production preflight is ready: database, schema/dictionary registry,
writable artifact directory, and production HMAC pseudonymization are configured.
A new full-production export was not verified in this task: direct remote audit
invocations returned neither their diagnostic markers nor an export result. The deployed
preflight, aggregate audit, and inspection of existing ZIPs succeeded. Do not
equate those successes with a newly generated production download.

### 4. Obsolete regression expectation corrected locally

`prisma/student-research-export-simplification-smoke-test.ts` still expected nine
files. The current dataset contains 35, including stage, profile, attempt,
coverage, and manifest files. The exact file-list assertion was updated to the
current contract without removing the no-provider-call assertions. The original
19-pass/1-fail run is retained; all 20 suites passed after this test-only change.
No application source or production data was changed.

## Current saved records

| Record | Count | Verification |
| --- | ---: | --- |
| Attempts | 12 | Unique attempt numbers within student/assessment |
| Item responses | 52 | 50 submitted; 2 unfinished records |
| Submitted answers | 50 | No unaccounted-for missing option, reasoning, or confidence |
| Item snapshots | 52 | None missing |
| Sealed initial packages | 10 | Counts consistent; no duplicate package per concept session |
| Sealed item responses | 46 | All link to saved responses; option, reasoning, confidence match exactly |
| Conversation turns | 591 | Session/concept links consistent |
| Process events | 3,988 | No duplicate nonempty client-event identity within a session |
| Formative input telemetry | 33 | Present for all 33 student formative messages |
| Formative evidence references | 14 | Source/evidence links resolve correctly |

The four submitted items not yet in a sealed package belong to unfinished initial
packages. Both initial-in-progress concept sessions have no package; all ten
initial-completed concept sessions have a package. No negative item/session/AI
duration, invalid token sum, or unvalidated successful session AI call was found.
Nine relational checks and four duplicate-group checks returned zero violations.

## Actual process coverage

| Stage | Visits | Start present | Submission present | Closed present |
| --- | ---: | ---: | ---: | ---: |
| Answer | 55 | 55 | 52 | 54 |
| Reasoning | 55 | 55 | 53 | 54 |
| Confidence | 50 | 50 | 50 | 50 |
| Tempting option | 52 | 52 | 51 | 52 |
| Tempting reason | 26 | 26 | 23 | 26 |

All 238 stage visits have event identities and contiguous, nonduplicated observed
sequence numbers. All 248 backend outcomes link to browser submissions: 225
accepted and 23 validation-rejected. A visit without submission is not necessarily
missing data; it can be an abandoned, resumed, or still-open visit. Text-input
start is intentionally inapplicable to answer/confidence chips.

Observed behavioral events include 79 hidden-page events, 64 visible-page events,
24 long pauses, nine inactivity events, 30 paste events, 319 typing summaries,
14 explicit pauses, eight explicit resumes, and one response edit. Counts from
different aliases are not additive actions. For example, `option_clicked` and
`option_selected` describe overlapping accepted actions.

402 events labeled `frontend` lack browser identity fields because they are
server-recorded accepted UI action aliases. Actual browser observations are
separately identified. Do not classify every such alias as failed delivery.

In the September 26 saved ZIP, 190 of 192 derived stage visits are `valid`; two
are `partial` (one missing server outcome and one missing visit end). Item first
action is populated in 42/43 behavior rows; reasoning-start and confidence timing
are populated in 41/43. These are population rates, not eligible-record
completeness. Unavailable/inapplicable values must stay blank, not zero.

All 33 student chat turns have typing metadata. The 41 tutor turns legitimately
have no human typing measurements; a combined 33/74 population rate is not a
55% student-data loss. Browser visibility is not attention, elapsed input time
is not active typing, and absence of an event does not prove nonoccurrence.

## Export and stress verification

- Three existing production ZIPs passed ZIP CRC and all 34 manifest-entry hash,
  byte-count, and CSV row-count checks. Latest-export session joins and administered
  response/content snapshot joins also passed. Existing ZIPs remained unchanged.
- The complete isolated audit passed 28/28 checks, including concurrent telemetry
  retry deduplication, six-option preservation, multiline CSV round trip, formula
  neutralization, all eight submitted responses, stable event identity after a
  late event, restricted-field separation, manifests, and timing null semantics.
- All 20 regression suites passed in the final disposable database run. The list,
  elapsed times, exits, and log hashes are in `final-run/runner-results.json`.
- `npm run typecheck` passed. `npm run lint` passed with zero errors and five
  existing unused-variable warnings in unrelated formative/operational fixtures.
  `git diff --check` passed.
- Disk-backed and compatibility exports were equivalent in the isolated export
  test. Local streaming stress passed for 65,536 rows and 81,578,264 uncompressed
  bytes (712,487-byte ZIP). Observed test-process peak RSS was 222,871,552 bytes.
  This is not a classroom concurrency or Render whole-service memory guarantee;
  the stress verifier also reads the completed ZIP for independent checking.
- Current health check returned database/schema ready. Render memory counters
  checked during the audit reported zero OOM/OOM-kill events. The SSH transport
  printed a host-key proof warning on both successful and unsuccessful commands;
  exit status and actual results, not that warning alone, determine verification.

## Reproduction and artifacts

- `production-integrity.json`: current aggregate inventory, completeness,
  relationships, duplicates, source calls, and lifecycle results.
- `production-timing.json`: actual stage-event population, outcome joins, display
  acknowledgement absence, and formative evidence/input linkage.
- `saved-export-verification.json`: latest historical ZIP's hashes, row counts,
  joins, timing population, and provenance categories; no student content.
- `initial-run/`: original regression failure and other test evidence.
- `final-run/`: passing test logs, 28-check quality audit and synthetic file hashes.
- Each suite ran as `node --import tsx prisma/<label>.ts` under a fresh migrated
  localhost database and `scripts/classroom-audit-network-guard.mjs`.
- Streaming stress: `node --import ./scripts/classroom-audit-network-guard.mjs
  --import tsx prisma/research-export-streaming-smoke-test.ts --stress`.

The audit-runner setup initially failed because a space-containing import path
was not URL-encoded; that harness issue was corrected before any test suite ran.
Its disposable database was dropped. It was not an application failure.

No scientific validity, cohort consent, or de-identification of free-text content
is established by successful technical checks. Preserve the original evidence and
the collection/version/missingness flags when selecting an approved research
cohort. No historical student record was reset, deleted, rescored, or backfilled.

No push or Render deployment was performed for this audit. The Word release ledger
was therefore not advanced as though a new application release had occurred.
