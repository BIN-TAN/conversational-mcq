# Process and Product Data for Learning Analytics

## Readiness and Scope

The application retains product evidence (accepted student responses) alongside
process evidence (observed actions, timing, interruptions, and system events).
They are complementary, not interchangeable. A populated field is not proof of
its validity, and an empty field is not necessarily a collector failure.

The current browser collects response-stage observations for initial items,
optional transfer items, and in-flow/package-review edits. The formative chat
has its own turn, input, lifecycle, provider, and profile-transition records.
These are different instruments. Do not combine fields solely because their
names resemble each other.

New instrumentation cannot recover historical events that were never recorded.
Optional branches only produce data if reached. Existing historical activities
and transfer paths remain exportable, but the current conversational runtime
does not force students to take those paths. `package_review` is a reserved
stage value, not a separately instrumented dwell-time screen; review edits emit
`revision` with phase `review`.

The browser synchronizes the visible stage before recording input/submission,
including rapid transitions into a revision editor. Earlier collector builds
could attribute immediate editor input to the preceding stage. Re-export cannot
reliably reassign such historical events: inspect collection dates and stage/
phase, and exclude text-input timing attributed to chip-only stages. This fix
does not rewrite raw historical records or accepted response products.

## Start With These Datasets

| Research question | Dataset and variables | Availability and interpretation |
| --- | --- | --- |
| What was the student's answer and explanation before feedback? | `attempt_submission_items.csv`: first-recorded and final pre-feedback option, confidence, reasoning; `item_responses.csv`: accepted responses; administered snapshots | Available when the corresponding response/package exists. Prefer sealed pre-feedback evidence over current edited values for baseline analyses. Correctness/key-derived fields require authorized restricted export. |
| How did the student construct an answer? | `response_stage_visits.csv`: `response_stage`, `time_to_first_action_ms`, `input_start_latency_ms`, `input_elapsed_ms`, `response_elapsed_ms`, `time_to_accepted_submission_ms`, `submission_count` | New browser observations only. Chip selections have no text-input latency. First submission and first accepted result are different endpoints. |
| Did the student change an answer, justification, or confidence? | `response_revision_history.csv`: `changed_field`, `previous_value`, `new_value`, `revision_phase`, `changed_at`, `source_turn_sequence_index` | Newly accepted edits retain before/after evidence. Old edits may lack the previous value. One edit operation may yield several field-change rows. Unsubmitted drafts are intentionally not collected. |
| Did the student pause, return, lose focus, or experience network trouble? | `process_events.csv`, `formative_conversation_events.csv`; stage `hidden_count`, `return_count`, `focus_loss_count`, `offline_count`, duration and quality fields | Observed navigation/lifecycle evidence is available. Explicit backend pause/resume is stronger evidence than a browser close signal. No claim about destination website, attention, cheating, or exact off-page activity. |
| What happened during tutoring? | `formative_conversation_turns.csv`: `actor_type`, `message_text`, sequence, input timing, edit/paste counts; `formative_conversation_profile_transitions.csv`: cited evidence and append-only profiles | Persisted dialogue/products are available if tutoring was reached. Human/LLM coding of help seeking, strategy, explanation quality, or feedback uptake is a separate analysis, not an observed field. |
| Did the system cause waiting or disruption? | Stage `request_wait_ms`, `system_wait_ms`; chat `assistant_response_status`, retry/failure fields; `formative_conversation_llm_calls.csv`: `latency_ms`, versions | Available when endpoints/receipts exist. Provider latency is not the whole student-visible delay. Do not attribute system waiting to student slowness. |
| How did performance change across attempts? | `attempt_records.csv`, `attempt_paired_changes.csv`, `attempt_class_summaries.csv` | Available for the selected export scope. Match students and identical administered item versions; incomplete/waived attempts are explicit. See `ATTEMPT_COMPARISONS.md`. |

## Verify Actual Population

Every new analysis-ready ZIP includes `data_coverage.csv` and
`data_coverage_notes.txt`. The report is calculated from the **actual CSV
contents**, not from the schema. It includes the empty tables too.

- `row_count`: data rows in the dataset/group.
- `populated_count`: cells not equal to the empty CSV string.
- `blank_count = row_count - populated_count`.
- `zero_count`: cells equal to `0`; `false_count`: cells equal to `false`.
- `populated_percent = round(100 * populated_count / row_count, 2)`; blank when
  the table/group has no rows.
- `coverage_status`: `no_rows`, `all_blank`, `partly_populated`, or `populated`.

Actor/stage subgroups overlap the `all_rows` group. Never add them together.
The denominator is **observed rows**, not theoretically eligible students.
Empty tutor input telemetry, blank text-input latency for chip selection, and
an absent transfer table can all be legitimate. Empty `timing_limitations` means
no listed flags. Nonempty categories/JSON do not prove substantive evidence.

For every unexpectedly blank variable, check phase eligibility, actor, deployed
collector version, whether the action occurred, export scope, and lost events.
Do not fill missing values with zero. Research cohorts should exclude synthetic
test accounts using the study's participant list; the export does not infer
consent, eligibility, or withdrawal decisions.

## Response-Stage Calculations

`response_stage_data_dictionary.csv` defines every exported field's source,
calculation, unit, applicability, missing-value rule and calculation version.
Unknown new columns fail the dictionary contract test instead of receiving a
placeholder definition. Current derivation: `response-stage-derivation-v2`;
raw collector: `response-stage-observation-v1`.

Let `m(e)` be the monotonic clock of an observed event in the **same browser
document**, R = ready, I = first input, S1 = first submission, SA = last
submission in that visit linked to an accepted server result, C = close.
Differences are rounded to integer milliseconds. Missing endpoints, reversed
clock order or conflicting visit context yield blank values.

| Variable | Formula |
| --- | --- |
| `time_to_first_action_ms` | `m(first I or submitted event) - m(R)` |
| `input_start_latency_ms` | `m(I) - m(R)` |
| `input_elapsed_ms` | `m(S1) - m(I)` |
| `response_elapsed_ms` | `m(S1) - m(R)`, including a rejected first submission |
| `time_to_accepted_submission_ms` | `m(SA) - m(R)`, including any preceding retries/waits |
| `input_to_accepted_ms` | `m(SA) - m(I)` |
| `stage_elapsed_ms` | `m(C) - m(R)` |
| `request_wait_ms` | Sum of each submitted-to-request-finished interval, linked by `submission_id` |
| `system_wait_ms` | Sum of each submitted-to-controls-ready interval, linked by `submission_id` |
| `hidden_duration_ms` | Sum of matched hidden-to-visible intervals within this visit |
| `offline_duration_ms` | Sum of matched offline-to-online intervals within this visit |

Cumulative waiting/interruption totals are blank when observation sequence gaps
could conceal additional intervals. Interruption durations also require ready,
close and complete nonambiguous pairs. Complete visits with no observed
interruptions yield zero. Individual endpoint differences may still be available
under a partial-quality flag; inspect the flag before analysis.

Example: ready at 1000 ms, first input at 3000, first submit at 7000, request
finished at 7600, controls ready and close at 8000. The corresponding values
are 2000 ms input-start latency, 4000 input elapsed, 6000 response elapsed,
600 request wait, 1000 system wait and 7000 stage elapsed. Do not add these:
request wait is contained in system wait, and stage elapsed already contains
both response and waiting. Hidden/offline intervals can overlap all of them.

`accepted_at` is a **server** time for the first accepted linked result;
`last_accepted_submitted_at` is a **client** time for the last accepted submission.
Do not subtract them. The raw event export preserves source timestamps.
`browser_tab_id` identifies a document, not a permanent tab/device; reloads start
new clocks. No duration is imputed between visits/documents.

Item summaries select the first observed initial/transfer visit of each stage
by client `ready_at`. A resumed visit is not necessarily first exposure; client
clock changes can compromise cross-visit ordering. Use all visits and document
identities for sequence analysis. Review/revision visits are excluded from
initial/transfer timing totals but included in `observed_stage_visit_count`.

## Formative Conversation Calculations

Use `actor_type` before interpreting any conversation timing:

- On current browser **student** rows, `response_time_ms` and
  `typing_duration_ms` are the same `max(0, submitted client time - first
  nonempty input client time)`. They include pauses and are not two independent
  measures. They do not include reading time before the first input.
- On generated **tutor** rows, `response_time_ms` is the linked provider latency.
  It is not student response time. Platform-only messages may leave it blank.
- Current browser input timing uses the client wall clock; clock changes are a
  limitation. Check `typing_duration_method`; do not relabel historical
  `active_intervals` records as elapsed timing.
- `edit_count` increments on input changes when the previous draft was nonempty.
  `backspace_count` counts observed Backspace/Delete keys, not every deletion
  possible through touch/IME. Neither is a semantic revision count.
- Message length and paste-character count use JavaScript UTF-16 code units;
  they are not words, graphemes or provider tokens.
- `observed_interval_duration_ms` is supported by the lifecycle schema but the
  current browser does **not** supply it. Treat it as unavailable unless a
  recorded producer explicitly provided a measured interval.
- Conversation wall-clock duration is endpoint minus start: completed time,
  otherwise ended time, otherwise last recorded activity. It includes waiting
  and pauses, and is not active learning time.

Lifecycle event delivery in the current formative UI is best effort. Do not
derive exact absence durations across reloads/devices from server receipt times.
The stage collector's durable queue does not imply the same delivery guarantee
for every legacy or formative event path.

## Suggested Analyses

1. **Response construction:** compare within-item answer, justification and
   confidence timing alongside correctness, reasoning content and confidence.
   Use medians/distributions; optionally `log1p(milliseconds / 1000)`. Compare
   like stages and item versions, retain missingness, and model repeated
   student/item observations rather than treating rows as independent.
2. **Confidence and accuracy:** cross-tabulate Low/Medium/High against scored
   correctness. Report denominators and missing confidence. These are ordinal
   categories, not stated probabilities; do not compute probability-based
   calibration scores by silently mapping them to arbitrary probabilities.
3. **Revision behavior:** count distinct accepted edit operations by
   `(session_public_id, source_turn_sequence_index)`, and field changes separately.
   Classify option transitions using administered keys only with authorization.
   Keep before-feedback, after-feedback, and new-attempt changes distinct.
4. **Action sequences:** order within-document stage events by
   `observation_sequence`, and persisted dialogue by `turn_sequence_index`.
   Use visits as units or documented higher-level episodes. The application
   mandates much of the answer/reason/confidence order; this is not evidence
   that students chose a learning strategy. Keep uncertain cross-clock ordering.
5. **Feedback uptake:** code student explanations/questions following tutor
   replies against a predefined rubric. Anchor to exact turns and previous
   responses, validate coding with independent human raters, and distinguish
   student evidence from tutor-authored claims. Existing LLM profiles are
   interpretations, not ground-truth labels for validating the same LLM.
6. **Change over attempts:** report all-participant distributions and matched
   student changes separately. Paired change = later - earlier for the same
   eligible student/item version. Latest is latest observed, not guaranteed
   final. Retest choice and feedback exposure confound causal learning claims.
7. **Experience and reliability:** examine wait/failure/retry patterns before
   pause or exit. These support usability hypotheses, not a direct measure of
   frustration, satisfaction or cognitive load. Those require voluntary,
   purpose-designed self-report or observation data not presently collected.

For predictive work, define the prediction time and only use earlier features.
Split by student, not random event rows; keep test-set information out of coding
and preprocessing. Use a held-out cohort/time period when feasible. Small
classroom samples favor descriptive/exploratory analysis over complex models or
individual risk labels. Repeated identical items measure retest performance,
not independent transfer; optional transfer data exist only for paths actually
administered.

## Joining Without Double Counting

Join attempts by `session_public_id` and students by stable
`research_student_id`; scope both to the export manifest/pseudonym version.
Join product snapshots via the corresponding item-response snapshot keys,
not titles or question positions. Corrected items are not automatically equal.
Stage events to visits and fields to revisions are one-to-many: aggregate to
the intended analysis unit before joining item-level tables. Derived summaries
are views of existing events/products, not additional independent observations.
Tutor messages, failures and provider retries must not inflate student turns.

Retain export snapshot time, application commit, calculation/instrument versions,
quality flags, inclusion criteria, denominator definitions, and a copy of the
original export manifest with each analysis.

## Verification

The response-stage changes were checked with deterministic timing fixtures and
a local browser using synthetic students, a dedicated test database, and no
live provider calls. The browser test verifies collection through persistence,
teacher access and the downloaded research ZIP, including every initial item
stage, immediate reasoning edits, validation rejection/retry, reload, pause,
delivery deduplication, access isolation and desktop/mobile rendering.

Re-run `prisma/response-stage-observation-smoke-test.ts`,
`prisma/research-process-coverage-smoke-test.ts` and
`scripts/response-stage-browser-smoke.mjs` when changing collectors/exports.
The coverage test enforces explicit definitions for all 121 current stage-export
dataset/column entries. The formative lifecycle runtime smoke test separately
checks retained conversation evidence and export parity using mock replies.
These checks establish the tested paths, not completeness of every production
student's record. Inspect each real study export's coverage and quality flags.

## Background Reading

- OECD, [PISA 2018 Technical Report, Annex K: Uses and Reporting of Process Data](https://www.oecd.org/content/dam/oecd/en/about/programmes/edu/pisa/publications/technical-report/pisa-2018-technical-report-files/PISA%202018%20Technical%20report%20-%20Annex%20K.pdf).
- OECD, [Beyond Proficiency: What log files are and why they are useful](https://www.oecd.org/en/publications/beyond-proficiency_0b1414ed-en/full-report/component-5.html).

These sources motivate combining response products with temporally ordered
actions. They do not validate this application's instruments or establish that
particular behaviors diagnose learning, attention or misconduct.
