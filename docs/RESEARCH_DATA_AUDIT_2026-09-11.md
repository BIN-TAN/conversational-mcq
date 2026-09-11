# Research Data Collection and Analysis-Readiness Audit

Date: 2026-09-11
Source: `5ce6805bd7797d924477c1dbe800acb406a61a27`
Scope: browser instrumentation, response persistence, timing derivation,
research ZIP, dictionary, content history, and formative provenance.

## Decision

**Not ready for unqualified process-data analysis.** The tested raw response
records are retained, and important isolation/privacy/provenance controls pass.
However, several exported measures and join identifiers are wrong or incomplete.
Review of raw answers and conversations can proceed with the limitations below;
automatic analysis of the affected counters/timing variables should wait.

This is a local engineering audit, not a certification of classroom data quality,
psychometric validity, research consent, or LLM instructional judgments. No live
classroom database was examined. No provider/model-auth request, real dispatch
checkpoint, Render operation, commit, push, or activation was performed.

Only this report and `prisma/research-data-quality-audit.ts` were added. No
application behavior, schema, prompt, historical evaluation, or raw research
record was changed. Corrections below are recommendations, not implemented fixes.

## Confirmed findings

### R1. P1: Delivery failures silently lose browser process evidence

`src/components/student-assessment/api.ts:803` ignores a false `sendBeacon`
return, and its fetch path at line 809 does not check the HTTP response status.
`src/components/student-assessment/process-events.ts:44` suppresses rejection;
typing summaries are reset after sending, without a durable acknowledged queue.

Reproduced with in-memory transport stubs: HTTP 500 and a refused beacon both
resolve as apparent success. No HTTP request was actually sent by these probes.
Browser closure/offline conditions can therefore lose observations without an
exported delivery-gap marker. This is different from losing an accepted answer:
the response submission path is separate.

Priority: acknowledged bounded delivery with stable client event IDs,
idempotent server ingestion, retained retry state, explicit gaps, and per-tab
identity for timing. Do not simply add retries: generic process events currently
lack the display-acknowledgement deduplication boundary. Events that never reached
the database cannot be reconstructed later or assumed not to have occurred.

### R2. P1: Summary counts disagree with accepted responses

`src/lib/services/teacher-research-data/analysis-ready-export.ts:964` identifies
initial responses using `item_order <= 3`. The actual classroom path supports
larger mini tests. Eight items completed through the real local service produced
eight response rows but `actual_initial_item_count=3` and
`completed_initial_item_count=3` in the session summary.

At line 1296, `confidence_selection_count` adds `confidence_selected` and
`confidence_clicked`. One ordinary action emits both
(`src/lib/services/student-assessment/service.ts:4529` and line 4559).
Every item in the eight-item fixture exported two selections for one accepted
confidence action. These are not two student decisions.

Priority: use the frozen administered item set/role and accepted action identity
for counts. Keep distinct event types for audit without summing aliases as
independent actions. Existing response rows can support corrected derivation.

### R3. P1: Some timing variables measure the wrong quantity

`src/lib/services/student-assessment/timing-contract.ts:403` through line 426:

| Synthetic condition | Current result | Required treatment |
|---|---|---|
| One 300-second inactivity period emits 120-second long-pause and 300-second inactivity signals | 420 seconds idle in a 300-second session | One interval, not the sum of overlapping threshold observations |
| 60 seconds active, 600 seconds paused/hidden, 60 seconds active | Active window 120 seconds; visible window 0 | Intersect visibility with active windows; the paused interval must not be subtracted twice |
| No browser visibility evidence during a 60-second session | 60 seconds visible; overall timing quality `valid` | Unknown visibility, not measured full visibility |

The first error also affects `total_idle_time_ms` and `idle_ratio` in
`analysis-ready-export.ts:967` and line 1133. A ratio can exceed one.
There is a separate `page_hidden_timing_quality_status=partial` in the
no-evidence case, but the numeric visible-time estimate and general valid flag
remain misleading. Active interaction itself correctly stays null.

At `timing-contract.ts:213` and line 236, only the first typing summary is used.
Two supplied active-typing summaries of 2,000 and 3,000 ms yield 2,000 ms, while
the dictionary at `dictionary.ts:1924` describes a sum. This probe tests the
helper's documented contract, not a claim that the ordinary browser supplies
validated active intervals: it currently sends elapsed `duration_ms`, which is
not active typing time.

Priority: version interval-union/intersection derivations and their dictionary;
keep absence/invalid ordering explicit. Never substitute zero for missing
instrumentation. Retain old export versions so a changed timing definition is
not silently mixed into an earlier analysis.

### R4. P1: Process-event joins are not stable or resolvable as advertised

`analysis-ready-export.ts:1396` derives `event_public_id` from export ordering,
not immutable event identity. A later-arriving event with an earlier client
timestamp changes an existing event from `:event:1` to `:event:2`. Incremental
merges or human annotations keyed by that value can point to another event.

At line 1403, an item event uses `<item>:event` as `item_snapshot_public_id`,
whereas response/content rows use `<item>:v<version>`. In the final fixture,
0/134 item-scoped event snapshot references resolve to assessment content.
All 8/8 response-to-content composite snapshot joins do resolve.

Priority: immutable opaque event IDs and actual administered snapshot joins.
Ordering belongs in a separate field. Raw database identity exists, so these
export defects can be repaired without altering historical responses.

### R5. P1: Recorded detail is missing from the standard dataset

`analysis-ready-export.ts:1724` emits only options A-D. The content validator
allows 2-6 options (`src/lib/services/content/validation.ts:76`). A six-option
item completed through the local service loses E/F option text from
`assessment_content.csv`. The snapshot retains it, but a reviewer with only the
standard ZIP cannot reconstruct the complete administered item.

The browser stores summarized key/backspace/enter counts and paste-length
bands, but `processEventRows` (line 1383) exports neither those safe fields nor
the raw payload. A persisted synthetic typing count of 17/backspace count of 3
and a paste-length band of `21_100` are absent from the standard event CSV.
Only the occurrence and some generic duration information survive.

Priority: lossless option representation and explicitly allow-listed process
summary columns with source/method/missingness definitions. Do not solve the
gap by dumping unrestricted payload JSON, clipboard text, or keystrokes.

### R6. P1: Missing and false are conflated

`analysis-ready-export.ts:1426` evaluates `payload.no_tempting_option === true`
for every event. A typing event with no such field exports `false`, not null.
Thus an inapplicable observation looks like an evaluated response. Similarly,
some evidence booleans/default sums require an availability check before they
can be interpreted as measured negatives or complete totals.

Priority: tri-state serialization and applicability checks by event/record
type. Preserve explicit false, missing, skipped, and not-applicable separately.
The no-temption case was directly reproduced; additional defaults were inspected
as follow-up review targets, not counted as separately reproduced failures.

### R7. P2: The usual ZIP is not a self-contained reproducibility package

`analysis-ready-export.ts:2555` through line 2694 emits 16 CSV files for the
standard selected-assessment export, without a manifest containing file hashes,
per-file counts, selection/omission policy, and snapshot/cutoff provenance.
Counts are returned to the caller; the API stores an aggregate count and some
job metadata (`src/app/api/teacher/research-data/analysis-ready/route.ts:157`).
Source identity is present in session rows, so provenance is not entirely absent.
The selected-session diagnostic manifest and legacy archive are separate formats.

Priority: ship a manifest and analysis README in the standard ZIP and validate
all file hashes, counts, join keys, and expected coverage before release.
The audit's separately generated hash file is evidence of this audit only; it
does not retroactively add a manifest to the product's ZIP.

## Other limitations to carry into review

- **Finalization interruption:** the tutor turn/receipt can be completed before
  telemetry and profile-evidence persistence (`formative-conversation/runtime.ts:1700`,
  line 1720, line 1739; `formative-conversation/service.ts:1487`). Normal replay
  and transition tests pass; process death between those stages was not tested.
  A completed exchange alone is not proof that every intended evidence record
  was finalized. This risk was already identified in the classroom audit.
- **Initial-action interruption:** `student-assessment/service.ts:1836` wraps
  multiple committed operations, not one atomic response/evidence transaction.
  Complete failure-injection coverage of every initial action remains absent.
- **Historical multi-topic sessions:** `packageEvidenceByItem` at
  `analysis-ready-export.ts:810` uses only the newest initial package across a
  session. Earlier topic package evidence needs dedicated coverage. New
  single-section authoring does not make existing multi-topic records equivalent.
- **Observation versus display:** persisted item/prompt timestamps do not prove
  browser paint or that the student read the prompt. Browser and server clocks
  are different sources. The export must not call their difference pure
  cognitive response time without validated endpoints/clock quality.
- **Formative timing:** the browser's `response_time_ms` is first input to
  submission, including intervening pauses (`assessment-session-client.ts:2599`).
  Tutor rows use call latency instead. `typing_duration_method` preserves this
  distinction. Do not pool student and tutor durations or call elapsed input
  duration active typing or prompt-reading time.
- **Consent/cohort:** runtime consent/withdrawal filtering is explicitly not
  implemented (`docs/DATA_LOGGING_SPEC.md:432`). Teacher authorization is not
  research consent. A separately controlled eligible cohort and exclusion of
  trials/synthetic attempts are required before research use. This audit did
  not examine any consent records or assert that a real participant was exported
  without consent.
- **Pseudonymization is not anonymity:** free-text answers can identify a
  student. Default ZIP identity minimization does not authorize unrestricted
  sharing. Legacy teacher/master downloads use different identifier policies.
- **Study linkage:** the standard ZIP has no summative-outcome table and does
  not expose a full objective/evidence blueprint or assessment revision-family
  lineage. Summative outcomes and correction lineage exist elsewhere. A study
  requiring external achievement or cross-version analysis needs an authorized,
  documented linkage export; do not join named legacy CSVs casually to HMAC IDs.
- **Deletion/retention:** permanent account/session/assessment cleanup can remove
  research evidence. Trial cleanup and consented research retention must be
  distinguished operationally; review/export retained evidence before deletion.

## What passed

- Eight submitted responses survived as eight rows, including selected answer,
  reasoning, confidence, and per-attempt identity.
- All eight response/content composite snapshot joins and tested session joins.
- Parsed CSV row counts match counts returned by the builder; multiline quoted
  text survives with spreadsheet-formula neutralization.
- All 16 ZIP entries pass archive integrity checks.
- Raw account username/UUID absent from the synthetic standard export; default
  key columns excluded; explicit restricted mode retains scored outcomes.
- Deactivation retains historical rows and the same pseudonym.
- Existing tests: process-event batch rollback, ownership isolation, duplicate
  display-ack handling, consistent export database snapshot, content revision
  history, readable transcript, and selected-session exports.
- Current formative pipeline: stable claim/evidence IDs, zero duplicate
  transitions on replay, teacher/export parity, no initial-assessment turns
  counted as formative turns, and no legacy activity contamination.

## Verification and evidence

- New diagnostic: **25 checks; 11 passed, 14 failed expectations**, grouped into
  R1-R7 above. Nonzero exit is intentional while these defects remain.
- Existing focused scripts: **18/21 passed**. The three failures are dictionary
  test-contract issues, not three additional proven data corruption defects:
  `student-data-dictionary-specificity` and `student-data-dictionary-semantic-audit`
  reject the otherwise explicit method "Read from the raw ProcessEvent.visibility_duration_ms
  field for audit only" through a wording blacklist. The
  `student-data-dictionary-agent-activity-applicability` test still expects a
  reserved/null activity prompt, whereas the serializer and dictionary now
  project `safe_activity_prompt`. Correct the tests without relaxing real
  source/missingness checks.
- Dictionary inventory: 383 ordinary/restricted variables and 225 event types;
  no undocumented declared columns or ordinary direct-PII fields in that
  inventory check. Coverage checks do not establish formula correctness.
- `npm run typecheck`: passed. `npm run lint`: passed with five existing unused
  variable warnings in historical V18 files. No production build or browser
  visual test is needed for this report/diagnostic-only addition.
- Provider calls = 0; model-auth requests = 0; real dispatch checkpoints = 0.
  Transport failure probes used in-memory stubs. External HTTP was guarded;
  database tests used a disposable loopback database with 61 existing migrations.

Evidence is retained locally, outside Git, under
`.data/research-data-audit/20260911/`: `results.json`,
`synthetic-research-dataset.zip`, `synthetic-file-hashes.json`,
`dictionary-audit.json`, `cmcq-research-regressions-results.json`, and the
focused regression log. These contain synthetic evidence, not participant data.

Reproduce with a fresh disposable database whose name starts with
`conversational_mcq_classroom_audit_`, apply the committed migrations, set mock
LLM/development configuration and fake local credentials, preload
`scripts/classroom-audit-network-guard.mjs`, and run
`npx tsx prisma/research-data-quality-audit.ts`. The script refuses other database
hosts/names and writes diagnostics under `/tmp` unless a permitted local audit
output directory is supplied. Do not run existing database smoke fixtures
against production. The audit fixtures were cleaned up; the disposable audit
database was removed after verification.

## Analysis handoff rules

1. Freeze the study inclusion/consent list, data cutoff, app/export version,
   pseudonym version, and item-version policy before generating an analysis set.
2. Use `research_student_id` for persons, `session_public_id` for attempts,
   and `assessment_snapshot_public_id` plus `item_snapshot_public_id` for
   administered response/content joins. Keep repeated attempts separate; never
   concatenate repeated full exports as new observations.
3. Do not use the affected initial counts, confidence-selection counts, idle
   totals/ratios, visible-window estimates, active-typing sums, or event snapshot
   keys until corrected and validated. Raw event occurrence counts remain
   observations received by the server, not guaranteed complete behavior counts.
4. Keep student responses, scored outcomes, and LLM interpretations separate.
   Use only persisted validated transitions for formative outcomes; missing
   transitions are not "no learning". Audit failed/pending exchanges separately.
5. Preserve nulls and record applicability/collection failure. Do not impute
   missing confidence, timing, or profile output as low confidence, zero time,
   low understanding, disengagement, or misconduct.
6. Keep free text restricted and review quotations before publication. Obtain a
   deliberate HMAC-compatible linkage process if external grades are needed.

Recommended implementation order: delivery and finalization reliability first;
then counters/timing, stable joins and lossless safe export fields; then a
self-contained manifest/dictionary and a whole-export acceptance test. Preserve
raw records and version corrected derivations rather than rewriting history.
