# Data Logging Specification

## Goal

The platform should collect conversation, response, process, and LLM evidence needed to support formative assessment research while keeping the database normalized and answer-key protection intact.

Use the existing repository tables and services as the baseline where possible. Do not assume schema changes are required yet.

Existing tables that appear likely to support the required data include:

- `item_responses`
- `conversation_turns`
- `process_events`
- `response_packages`
- `agent_calls`
- `student_profiles`
- `formative_decisions`
- `followup_rounds`

## Event-Level Logging

The platform should log these event types:

```text
session_started
attempt_started
attempt_paused
attempt_resumed
attempt_end_requested
attempt_ended_by_student
attempt_ended_by_teacher
new_attempt_available
session_paused
agent_message_shown
item_presented
option_clicked
answer_changed
reasoning_started
reasoning_submitted
confidence_clicked
tempting_option_submitted
item_completed
package_review_opened
package_submitted
llm_profile_requested
llm_profile_received
formative_activity_shown
formative_activity_skipped
alternative_activity_requested
continue_to_transfer_selected
continue_to_next_concept_selected
finish_assessment_selected
followup_response_submitted
targeted_feedback_shown
revision_submitted
next_choice_selected
transfer_item_presented
transfer_item_completed
session_completed
assessment_completion_summary_shown
```

Each event should include:

```text
event_id
session_id
student_id_hash
item_set_id
item_id if applicable
stage
event_type
payload JSON
client_timestamp
server_timestamp
elapsed_since_stage_start_ms
```

Likely current support:

- `process_events` can store event type, category, source, timestamps, duration fields, and payload JSON.
- `conversation_turns` can store agent and student messages.
- Additional event naming or payload conventions may be enough before adding new tables.

## Item Response Data

For each item, collect:

```text
selected_answer_initial
selected_answer_final
answer_changed
reasoning_text_initial
reasoning_text_final
confidence_initial
confidence_final
tempting_option
tempting_option_reason
item_started_at
answer_selected_at
reasoning_started_at
reasoning_submitted_at
confidence_selected_at
tempting_option_submitted_at
item_completed_at
response_time_answer_ms
response_time_reasoning_ms
response_time_confidence_ms
total_item_time_ms
```

Likely current support:

- `item_responses` already stores selected option, reasoning text, confidence rating, skipped evidence flags, revision count, response timing, started/submitted timestamps, correctness snapshot, item snapshot, and finalized state.
- Some initial-versus-final fields may be represented through revisions, process events, or structured payloads rather than new columns.
- Tempting-option fields may require either structured payload storage, new normalized fields, or a revision to the item-response model after implementation design is approved.

## Conversation Data

The transcript should preserve:

- agent messages;
- student messages;
- stage labels;
- item association when applicable;
- structured payloads when useful;
- timestamps;
- whether a message was student-visible.

Likely current support:

- `conversation_turns` appears suitable for the chat transcript.
- Student-facing text must be treated as untrusted text and rendered safely.

## LLM Call Data

Each LLM call should record:

```text
llm_call_id
session_id
stage
model
system_prompt_version
input_payload
output_payload
student_visible_message
structured_profile
validation_status
latency_ms
token_usage
created_at
```

Likely current support:

- `agent_calls` stores provider/model metadata, prompt and schema versions, input/output payloads, validation state, retry counts, usage, latency, and status.
- `operational_agent_effective_results` stores effective outputs after deterministic guards, canonicalization, fallback, and validation.
- Student-visible messages should be linked through `conversation_turns` and should not expose hidden prompts, model metadata, answer keys, or audit-only details.

## Attempt Lifecycle Data

Attempt lifecycle is represented with existing session fields plus process events. No new lifecycle table is required for the current implementation.

The research export should expose:

```text
attempt_lifecycle_status
terminal_reason
ended_by_actor
pause_count
resume_count
last_runtime_state
formative_activity_completion_status
activity_skip_reason
selected_navigation_destination
assessment_completion_reason
attempt_policy_version
teacher_override_metadata
```

Lifecycle and navigation fields are contextual process data. They do not change timing formulas and must not be interpreted as understanding, motivation, cheating, or misconduct by themselves.

## Formative Profile Fields

The formative interpretation layer should produce or store:

```text
provisional_learning_state
main_issue
formative_need
matched_activity
evidence_used
confidence_calibration_flag
answer_reasoning_alignment
student_facing_pattern_statement
student_facing_followup_prompt
should_reveal_correct_answer
next_expected_action
```

Allowed `formative_need` values:

```text
diagnosis
feedback
scaffolding
confidence_calibration
scaffolding_and_feedback
diagnosis_and_feedback
```

Allowed `matched_activity` values:

```text
confirmation_or_extension
confidence_calibration
scaffolded_reasoning
key_distractor_contrast
distractor_justification
distractor_diagnosis
distractor_repair
answer_reasoning_alignment
guided_elimination
```

Likely current support:

- `student_profiles` can store profile-level diagnostic interpretation.
- `formative_decisions` can store formative value and planning decisions.
- `followup_rounds` can store follow-up activity state.
- Exact enum mapping should be reviewed before schema changes, because the current implementation may already have locked agent enums that differ from this rewrite vocabulary.

## Response Packages

After the initial item package, construct a response package from:

- item response data;
- answer changes;
- reasoning text;
- confidence values;
- tempting-option evidence;
- transcript turns;
- process-event aggregates;
- item snapshots;
- relevant timing data.

Likely current support:

- `response_packages` already stores packaged response evidence.
- Package payloads should remain auditable and should distinguish current content from administered snapshots.

## Process Data Boundaries

Process data should provide context for engagement, timing, and evidence sufficiency. It should not be treated as automatic evidence of misconduct.

Do not label students as cheating, dishonest, or confirmed GenAI users based on process data.

## Timing Contract

The current analysis contract is `timing-contract-v2`.

Item timing must be derived from explicit event endpoints:

- `item_elapsed_response_time_ms`: `item_presented_at -> item_submitted_at`
- `time_to_first_response_action_ms`: `item_presented_at -> first qualifying student response action`
- `time_to_first_option_selection_ms`: `item_presented_at -> first accepted option selection`
- `post_option_completion_time_ms`: `first_option_selected_at -> item_submitted_at`
- `reasoning_elapsed_time_ms`: `reasoning_prompted_at -> reasoning_submitted_at`
- `reasoning_active_typing_time_ms`: validated active typing intervals only; null when instrumentation is insufficient
- `confidence_response_time_ms`: `confidence_prompted_at -> confidence_selected_at`
- `tempting_option_response_time_ms`: tempting-option prompt to accepted tempting-option response

The legacy `item_response_time_ms` field remains for backward compatibility only. Historical values may start at item-response row creation rather than item presentation, so exports must prefer `item_elapsed_response_time_ms` for corrected item-level elapsed timing.

Page-hidden time must be derived from paired visibility events:

- `page_visibility_hidden` or `page_hidden` starts an interval.
- the next `page_visibility_visible` or `page_visible` ends the interval.
- frontend cumulative visibility-duration payloads must not be treated as single hidden intervals unless explicitly identified as interval durations.
- window blur/focus events are separate focus instrumentation and must not be double-counted as page-hidden time.

Session timing separates:

- wall-clock elapsed time;
- resumable active-window time;
- visible-window time;
- explicit idle time;
- active interaction time.

Active interaction time must not be manufactured by subtracting arbitrary idle estimates from elapsed time. If validated active interaction intervals are unavailable, active interaction time remains null and the export records a timing limitation.

Every derived timing export should include timing contract/source version, quality status, limitations, derived timestamp, and instrumentation-completeness metadata. Timing variables are process context only. Timing alone must not be interpreted as ability, effort, motivation, engagement, guessing, cheating, or misconduct.

## Privacy and Safety

Logging must not store:

- plaintext passwords;
- access codes;
- API keys;
- authorization headers;
- session secrets;
- cookies;
- database URLs;
- hidden prompts in student-visible payloads.

Exports and teacher views should use public or research-facing IDs where appropriate and avoid exposing internal database UUIDs unless explicitly needed for backend debugging.

## Teacher/Research Session Data Audit

Phase 30h adds a read-only data-completeness audit for teacher/research review.
It uses existing tables before proposing schema changes:

- `item_responses` for selected answers, reasoning presence, confidence, timing bands, and revision counts.
- `conversation_turns` for transcript-turn counts and tempting-option evidence references.
- `process_events` for event-type counts, timestamps, focus/visibility availability, paste-summary availability, typing-summary availability, pause/inactivity availability, and item/session scoping.
- `response_packages` for the package-level evidence object after the initial item package.
- `activity_runtime_attempts`, `activity_misconception_evidence_records`, and `post_activity_diagnostic_snapshots` for post-activity runtime and diagnostic-update completeness.
- `agent_calls` for provider/audit metadata presence, token-usage presence, call statuses, and prompt-hash inventory.

Run:

```bash
npm run student:session-data-completeness-review
npm run student:session-data-completeness-review -- --session-public-id <session_public_id>
```

The command writes a redacted artifact under:

```text
.data/session-data-completeness-review/
```

## Research Data Tables and Variable Dictionary

Phase 31ab consolidates teacher/research downloads under:

```text
/teacher/data/research
```

The `Data and outcomes` landing page should show only:

1. `Research data and exports`
2. `Summative outcomes`

The unified export center has two normal teacher-facing sections:

- `Research dataset`: one normalized ZIP for statistical/process analysis and
  routine teacher/research review.
- `Data dictionary`: a paginated, searchable, and downloadable inventory of
  exported, restricted, intentionally omitted, and never-exported variables.

Full archive services may remain authorized for advanced audit/reproducibility
work, but they are not ordinary teacher-facing export sections.

### Research Dataset CSV Row Grains

The research dataset ZIP contains:

| File | Row grain | Notes |
|---|---|---|
| `sessions.csv` | One row per student assessment attempt/session | Includes public session/assessment joins, pseudonymous research student joins, timing aggregates, counts, and latest safe interpretation summaries. |
| `item_responses.csv` | One row per student response to one administered item snapshot | Includes answer, reasoning, confidence, tempting-option evidence, timing, counts, and interpretation/evidence fields. Restricted answer-key columns are excluded by default. |
| `process_events.csv` | One row per recorded process event | Includes event type/category/source, timing, item/session joins, and safe flattened payload fields. Raw payload JSON is not a primary analysis column. |
| `conversation_turns.csv` | One row per visible or research-readable conversation turn | Includes actor, phase, item/session joins, message text, and response/action latency where available. |
| `agent_activity_records.csv` | One row per agent call, workflow decision, formative activity attempt, or diagnostic update record | Uses `record_type` to distinguish incompatible row types; non-applicable fields remain null. |
| `assessment_content.csv` | One row per administered item snapshot | Reflects content actually administered. Restricted item-key and diagnostic-note fields are excluded by default. |
| `assessment_summary.csv` | One row per student-assessment attempt summary | Includes safe session counts, status, timing, latest student-safe diagnostic signals, and explicit limitations. |
| `research_data_dictionary.csv` | One row per ordinary or restricted research dataset variable | Documents qualified variable name, dataset/table, measurement level, source nature, source-code reference, source service/function, source-verification status, missing/zero/false semantics, privacy, export policy, timing formulas, applicable record types, and interpretation cautions. |
| `process_event_codebook.csv` | One row per allow-listed process-event type | Documents event trigger, actor/source, scope, timestamp meaning, allow-listed payload fields, derived variables, source-code reference, source-verification status, and interpretation cautions. |

The standard research dataset ZIP does not include the internal source-schema
appendix or platform/excluded field inventory. Those are documentation and
operator/developer lineage artifacts, not ordinary research dataset files.

### Join Keys

Use public IDs rather than internal database UUIDs:

- `session_public_id` joins sessions, item responses, process events,
  conversation turns, agent/activity records, and assessment summaries.
- `research_student_id` is the ordinary research join key for students. It is a
  pseudonymous, versioned HMAC-SHA-256 identifier generated from the canonical
  operational user identifier using a server-side
  `RESEARCH_PSEUDONYMIZATION_KEY`. It is not the login username, email, or an
  internal database UUID. The key is not exported.
- `research_pseudonym_version`, `pseudonymization_method`,
  `pseudonymization_version`, and `pseudonymization_key_fingerprint` document
  pseudonymization provenance. The fingerprint is a short one-way identifier
  for reproducibility checks, not the key.
- `assessment_public_id` joins assessment-level records.
- `assessment_snapshot_public_id` binds rows to the administered assessment
  context for a specific session.
- `item_public_id` and `item_snapshot_public_id` join administered item
  response/content records.
- `attempt_number` keeps repeated attempts separate.

Production research exports fail closed if `RESEARCH_PSEUDONYMIZATION_KEY` is
missing or if legacy pseudonymization is requested. This failure is limited to
research-export generation; authentication, account management, assessment
management, and non-export pages must remain available. Development/test runs
may use a deterministic non-production key. Legacy `legacy_sha256_v1`
pseudonyms are documented only for backward compatibility and are not joinable
to HMAC pseudonyms without a separately authorized linkage process.

Run `npm run research-export:preflight` before production pilots or after
changing deployment variables. The preflight reports readiness, pseudonymization
version, safe key fingerprint, export registry status, artifact-path
writability, and database connectivity without provider calls or secret output.
When readiness is blocked, the Research data page disables dataset generation
but keeps the Data dictionary and completed export downloads available.
Selected-session incident exports include `session_diagnostic_manifest.json`
with safe workflow reconstruction metadata; export first before rerunning
profiling, formative decisions, follow-up rounds, or activity logic.

### Timing Formulas

Timing variables use milliseconds and `_ms` suffixes. The data dictionary stores
the authoritative start/end events. Core formulas include:

- `elapsed_session_time_ms`: `completed_at` or `last_activity_at` minus
  `started_at`.
- `active_interaction_time_ms`: elapsed session time minus recorded idle time
  when idle instrumentation is available.
- `time_to_first_action_ms`: `first_student_action_at` minus the exported
  `item_presented_at` timestamp when both are available.
- `time_to_first_option_selection_ms`: `first_option_selected_at` minus the
  exported `item_presented_at` timestamp when both are available.
- `reasoning_prompt_to_submission_ms`: reasoning submission minus reasoning
  prompt.
- `confidence_prompt_to_selection_ms`: confidence selection minus confidence
  prompt.
- `last_action_to_submission_ms`: item submission minus last qualifying student
  action.

### Null, Zero, and False Semantics

- Null/empty CSV cell: unavailable, not recorded, not instrumented, not
  generated, or not applicable when a status/limitation field explains why.
- Zero: the variable was instrumented and the counted event did not occur.
- False: a Boolean condition was explicitly evaluated and was false.

Unavailable data must not be encoded as zero. Missing LLM output must not be
encoded as the lowest category.

### Privacy and Restricted Fields

Default research dataset exports exclude:

- teacher/student email;
- passwords, password hashes, access codes, access-code hashes, tokens, cookies,
  API keys, session secrets, and database URLs;
- raw provider requests and unrestricted raw provider output;
- internal database UUIDs;
- unrestricted answer keys, correctness, and teacher diagnostic notes.

Restricted research mode may include answer-key and teacher diagnostic fields
only for authorized teacher/research use after explicit confirmation. Confirmed
restricted research dataset downloads create a completed export audit record.
Restricted fields are documented in `research_data_dictionary.csv` with
`export_policy = restricted_research_dataset_only` as appropriate.

### Process-Event Inventory

`process_event_codebook.csv` includes one inventory row for every process-event
type in the application domain enum. Event counts are contextual process
evidence only; they must not be interpreted as misconduct labels or stable
learner traits.

The dictionary browser exposes a single `Dictionary section` selector with four
teacher-facing choices:

- `Research dataset variables`: actual columns or derived measures in research
  dataset exports. Restricted fields require explicit authorization.
- `Learning-process event definitions`: allowed `event_type` values. Actual
  event occurrences are rows in `process_events.csv`.
- `Internal database schema — Technical`: implementation-source and lineage
  documentation only; these fields are not ordinary research columns.
- `Excluded platform and security fields — Not exported`: fields intentionally
  withheld from ordinary research exports. Values are not displayed.

The Data dictionary is documentation. Use the separate Research dataset section
to generate and download actual student/session data. `source_verified` means
the export source path was traced in code; domain-owner review is tracked
separately and remains pending until explicitly completed.

### Timing Grain Guide

Item-response timing is collected separately for each administered item. A
three-item mini-test can therefore produce three `item_response_time_ms` values,
joined by `research_student_id`, `session_public_id`, `attempt_number`, and
`item_public_id` or the administered item snapshot identifier. Item revisions
update the response row and revision counters/events; they do not create
additional item-response rows unless an implementation explicitly versions an
attempt.

Conversation-turn latency, such as
`conversation_turns.response_or_action_latency_ms`, is stored at
conversation-turn grain. A single item can produce multiple latency values
because answer selection, reasoning, confidence, tempting-option reporting, and
other stages may each create separate turns or actions. Required join/context
fields are `session_public_id`, `turn_index`, `actor_type`, `phase`, and
`item_public_id` when item-scoped. Package review, formative activity,
follow-up, and other session-level turns may have no `item_public_id`. Null
latency means unavailable or not applicable; it is not zero.

Elapsed time is not equivalent to active cognitive-processing time.
Conversational latency is not equivalent to ability, effort, or motivation.
Page-hidden or idle time does not prove disengagement.

### Tabular Formatting Standards

CSV exports use UTF-8, one header row, stable snake_case columns, deterministic
column order, ISO 8601 UTC timestamps, public IDs, empty cells for null, and
spreadsheet-safe escaping for cells beginning with `=`, `+`, `-`, or `@`.

The teacher session page also includes a read-only **Session evidence audit**
tab. It reports counts and limitations only. It does not expose raw process
payloads, raw provider outputs, answer keys, correct options, correctness
labels, raw distractor metadata, raw misconception IDs, internal database UUIDs,
or secrets.

Process data remain evidence-quality context. They should not be used alone to
infer misconception, ability, cheating, or misconduct.

## Teacher/Research Readable Transcript And Bulk Export

Phase 30i adds two read-only teacher/research data surfaces over existing
tables before proposing any schema changes.

### Research Dataset Summary Rows

The teacher data area includes `assessment_summary.csv` inside the Research
dataset ZIP for lightweight student-assessment review over existing tables.
Legacy `/teacher/data/explorer` redirects to the unified export center.

Summary rows include public assessment/session/student identifiers,
assessment/session status, attempt number, timestamps, response/package/event
counts, activity/post-activity aggregate counts, latest student-safe status
when available, assessment-specific understanding and engagement signals when
available, unsupported-correct aggregate count, maximum estimated guessing-risk
aggregate, and limitations.

Every generated CSV row includes export-source identity fields:
`export_run_public_id`, `export_generated_at`, `export_schema_version`,
`app_environment`, `app_commit_sha`, `service_base_url`,
`database_instance_fingerprint`, export scope, and selected assessment/student
or session identifiers where applicable. The database fingerprint is an
irreversible hash of the configured database URL; the raw URL is never exported.

If a selected assessment has no authorized student sessions, the export center
reports `No student sessions are available for this assessment.` and disables
normal assessment downloads instead of producing a misleading header-only CSV.
The selected-student export is scoped by authorized student/session ownership,
not only by the assessment creator, so a teacher-managed student remains
exportable even when the session belongs to an assessment record originally
created under another authorized account.

The unified export center provides the Research dataset ZIP. Its current
normalized tables are documented in the `Research Data Tables and Variable
Dictionary` section.

The legacy detailed CSV APIs remain authorized for backward compatibility. Their
bundles contain:

- `analysis_rows.csv`: one row per item response, plus a placeholder row for a
  session with no item responses. It includes response fields, frozen item/media
  snapshot identifiers, timing fields, response-package evidence summaries, and
  scalar engagement/process features.
- `process_events.csv`: one row per process event with allow-listed payload
  derivatives only. Raw process payloads are excluded.
- `turn_response_latencies.csv`: prompt-to-next-student-response/action latency
  rows. Measured latencies are nonnegative; unavailable measurements are null
  with limitations.
- `conversation_turns.csv`: readable ordered turns with message text and safe
  context labels. Structured payloads, answer keys, and provider output are
  excluded.

Null values mean the field was not collected or cannot be reconstructed for the
row. Zero means the instrumentation path existed and no matching event was
observed. Process indicators are evidence-quality context only; they must not
be interpreted alone as ability, misconception, cheating, or misconduct labels.

Deleted students are excluded because the exporter reads current `users` rows
with `role=student`; teacher-deleted student rows and associated deleted
records are not recreated for export. Simple CSVs exclude email by default, raw
response text, raw conversation payloads, raw process payloads, raw provider
input/output, answer keys, correct options, correctness labels, raw distractor
metadata, diagnostic notes, credentials, API keys, database URLs, cookies, and
session secrets.

### Readable Transcript

The teacher session detail page includes a **Readable transcript** tab separate
from the existing structured transcript audit view, now labelled **Structured
event log**. The readable transcript projection contains:

- `session_public_id`
- `student_display_label`
- `assessment_label`
- ordered turns with `speaker`, `timestamp`, `phase_label`,
  `safe_context_label`, `message_text`, and
  `has_structured_payload_available_elsewhere`
- limitations, such as hidden empty-text turns

It uses `conversation_turns` plus safe item/concept labels and current
`item_responses` for legacy edited-response reconstruction. It does not expose
structured payloads, raw JSON, answer keys, correct options, correctness
labels, distractor metadata, misconception IDs, process payloads, provider raw
output, or secrets.

### Advanced Archive Export

Advanced full-archive services may remain available through authorized legacy
routes for audit and reproducibility, but Full archive is not a normal
teacher-facing section. Per-session teacher review still provides **Download
readable transcript** and **Download session research data**.

The default ZIP contains:

- `manifest.json`
- `README_EXPORT.md`
- `data_dictionary.json`
- `students.csv`
- `sessions.csv`
- `item_responses.csv`
- `conversation_turns_readable.jsonl`
- `conversation_turns_structured_redacted.jsonl`
- `turn_response_latencies.csv`
- `turn_response_latencies.jsonl`
- `engagement_process_features.csv`
- `engagement_process_features.jsonl`
- `response_packages.jsonl`
- `process_events_summary.jsonl`
- `process_events_redacted.jsonl`
- `process_event_counts.csv`
- `engagement_evidence_packets.jsonl`
- `misconception_diagnosis_or_profile_packets.jsonl`
- `formative_purpose_or_value_packets.jsonl`
- `activity_runtime_attempts.jsonl`
- `activity_misconception_evidence_records.jsonl`
- `post_activity_diagnostic_snapshots.jsonl`
- `agent_calls_summary.jsonl`
- `session_data_completeness.jsonl`
- `limitations.jsonl`

Default exports exclude restricted item-key files. Explicit restricted export
requests can add `restricted_item_keys.csv` and
`restricted_item_metadata_manifest.json`; the manifest marks that restricted
keys were included.

The data dictionary defines response-time fields, process-event count
definitions, engagement process features, correctness-inflation safeguards,
units, collection sources, and interpretation limits. Timing definitions
include:

- `item_response_time_ms`: item wall-clock response time, including idle time.
- `turn_response_latency_ms`: wall-clock time from an agent/system prompt being
  shown to the first subsequent student response turn or recorded student
  action in the same safe session context. It may include reading, thinking, or
  idle time and is unavailable when no next event is recorded.
- `prompt_to_next_student_turn_latency_ms`: prompt-to-next-student conversation
  turn latency when no safe process-event action timestamp is available.
- `prompt_to_next_student_action_latency_ms`: prompt-to-next-student process
  action latency when a safe process-event action timestamp is available.
- `item_prompt_to_first_action_latency_ms`,
  `reasoning_prompt_to_reasoning_response_latency_ms`,
  `confidence_prompt_to_confidence_action_latency_ms`,
  `tempting_option_prompt_to_response_latency_ms`, and
  `activity_prompt_to_activity_response_latency_ms`: scope-specific
  prompt-to-response/action latencies inferred from safe prompt labels,
  conversation turns, and process-event timestamps.
- `package_wall_clock_duration_ms`: first item presentation to package
  completion/submission.
- `package_active_response_duration_ms`: first recorded student response action
  to package completion/submission.
- `focus_adjusted_duration_ms`: wall-clock duration minus safely detected
  hidden/blur/pause intervals when available.
- `reasoning_input_elapsed_time_ms`: first recorded reasoning input/key event to
  summary flush, field submission, or item completion; not pure active typing.
- `active_typing_time_ms`: available only if explicitly instrumented.

Phase 30k adds derived engagement/process features for teacher/research export:

- `time_to_first_action_ms`
- `first_action_to_submission_ms`
- `last_action_to_submission_ms`
- `prompt_to_final_submission_ms`
- `active_interaction_time_ms`
- `idle_time_ms`
- `idle_ratio`
- `focus_adjusted_time_ms`
- `confidence_selection_latency_ms`
- `reasoning_input_elapsed_time_ms`
- `pre_submit_pause_ms`
- `activity_prompt_to_first_action_ms`
- `activity_response_elapsed_ms`
- `activity_move_on_latency_ms`
- `choose_another_activity_latency_ms`
- `student_action_count`
- `substantive_action_count`
- `action_density_per_minute`
- `option_revision_count`
- `option_changed_after_reasoning`
- `reasoning_revision_count`
- `confidence_revision_count`
- `copy_paste_event_count`
- `typed_vs_paste_indicator`

Every feature is derived from existing safe process events, conversation/item
timestamps, or response records. If a feature cannot be computed from available
instrumentation, it is exported as `null` with a limitation rather than
approximated. In particular, `active_interaction_time_ms` requires explicit
active-interval instrumentation; elapsed typing/input time is not used as a
proxy for active typing.

Phase 30k also adds internal/research-only correctness-inflation safeguards to
ability/profile evidence:

- `unsupported_correct_response`
- `correctness_support_level`
- `estimated_guessing_risk`
- `estimated_guessing_risk_basis`
- `answer_selection_evidence_weight`
- `uncertainty_marker_present`
- `uncertainty_marker_types`

These are evidence-quality indicators. They are not student-facing labels, not
misconduct labels, not cheating detection, not direct ability estimates, and not
final misconception evaluations. Correct option selection is not sufficient
evidence of understanding; target-aligned answers with weak reasoning, low
confidence, uncertainty markers, or missing distractor-boundary explanation are
handled conservatively until reasoning, conceptual-boundary evidence, or
distractor-boundary evidence is available.

The export service redacts internal IDs, secrets, raw provider input/output,
raw process payloads, answer-key/correct-option markers in default data files,
raw distractor metadata, and raw misconception IDs. Missing optional sources
are represented in `limitations.jsonl` and session data completeness rows
rather than causing the whole export to fail.

`item_response_time_ms` and `turn_response_latency_ms` are intentionally
different. Item response time summarizes a full item interval from item
presentation to item response completion. Turn latency summarizes the next
student response/action after a specific prompt. Both are wall-clock measures;
neither should be interpreted as pure cognitive processing time.

`process_events_redacted.jsonl` is a payload-free process-event timeline. It
contains public session/concept/item context, event type/category/source,
timestamps, safe scope, and item order when available. It does not export raw
process payloads, raw keystrokes, clipboard text, browser URLs, provider
output, answer keys, correct options, correctness labels, or secrets.

### Research Export Integrity Review

Phase 30l adds a no-live integrity review command:

```bash
npm run student:research-export-integrity-review
npm run student:research-export-integrity-smoke
```

The review builds the default teacher/research ZIP and verifies:

- every required file is present;
- `manifest.json` includes generated time, export version, redaction policy,
  `restricted_item_keys_included`, included sources, row counts, and
  limitations;
- manifest row counts match actual CSV/JSONL rows;
- every exported file is described in `data_dictionary.json`;
- exported top-level columns/fields are defined;
- public-ID joins work through `session_public_id`, `student_user_id`,
  `activity_attempt_public_id`, and `evidence_public_id`;
- turn latencies are non-negative, use allowed scopes/sources, and null
  latency rows include an explicit limitation;
- engagement process features are non-negative, keep `idle_ratio` between 0
  and 1, and leave `active_interaction_time_ms`/`active_typing_time_ms` null
  unless explicitly instrumented;
- correctness-inflation values use approved internal/research enums;
- readable transcripts and default data files do not expose answer keys,
  correct options, correctness labels, raw process payloads, raw provider
  output, raw distractor metadata, raw misconception IDs, secrets, or internal
  database UUID fields.

The command writes redacted local artifacts under:

```text
.data/research-export-integrity-review/
```

The generated `research-analysis-readiness-summary.md` is research-facing. It
summarizes available datasets, recommended analysis tables, join keys, timing
variables and caveats, process-feature caveats, correctness-inflation
safeguards, missing activity/post-activity evidence, null latency rows, and
dissertation limitations.

Important interpretation boundaries:

- `item_response_time_ms` is a full item interval and is not equivalent to
  prompt-to-response/action latency.
- Turn-level latency may include reading, thinking, idle time, or off-task
  time.
- Process features are evidence-quality context only.
- Estimated guessing risk is an internal evidence-quality estimate, not a
  student-facing label and not a misconduct label.
- Correctness alone is not evidence of understanding.

## Teacher Mini-Test Builder And Diagnostic Notes

Phase 31i-revision simplifies the teacher authoring path around:

- Folder / Week / Module
- Assessment / Mini test
- MCQ items
- Publish

The standard teacher path creates an assessment mini test and auto-maintains a
single internal topic/concept-unit record for the existing student workflow.
Teachers do not need to create that topic manually. Folder/week/module labels,
diagnostic focus, and optional order metadata are stored on `assessments`.

The mini-test diagnostic focus is teacher-authored interpretation guidance. It
is not shown to students and is not ground truth. It may be included in response
packages as internal LLM context after protected initial administration.

Teacher-authored diagnostic notes are stored as follows:

- Assessment diagnostic focus is stored in `assessments.diagnostic_focus`.
- Folder/week/module organization is stored in `assessments.folder_label`.
- The hidden topic diagnostic note is stored in
  `concept_units.administration_rules` as teacher-only diagnostic context.
- Item labels, item purpose/use, expected reasoning notes, item diagnostic value
  notes, correct-option reasoning notes, and option-level distractor diagnostic
  notes are stored in `items.administration_rules` as teacher-only diagnostic
  context.
- Existing `items.distractor_rationales`,
  `items.expected_reasoning_patterns`, and
  `items.possible_misconception_indicators` remain the publish-validation and
  JSON import/export-compatible metadata fields.

Response-package creation may include an internal `teacher_diagnostic_context`
for LLM-supported interpretation. These notes are guidance, not ground truth,
and correct-option selection remains insufficient evidence without reasoning,
confidence, tempting-option, and process evidence. Student-facing state,
conversation messages, activity text, and default research exports must not
show correct options, answer keys, raw teacher diagnostic notes, raw distractor
notes, misconception IDs, or internal metadata labels.

## Assessment Interpretation Context Audit

Phase 31M adds the shared `assessment-interpretation-context-v1` contract for
substantive LLM interpretation. It is built from existing response packages,
item snapshots, teacher diagnostic guidance, and safe process summaries. The
context is version-bound and may be embedded in server-side agent inputs for
item administration, profile integration, formative value selection, formative
activity generation/review, and post-activity response evaluation.

Agent-call audit metadata may persist only safe proof of context use:

- context schema version;
- assessment snapshot public ID;
- item snapshot public IDs;
- context hash;
- presence flags for teacher diagnostic context, target reasoning guidance,
  distractor guidance, interpretation caution, and student evidence.

The audit metadata must not duplicate raw teacher notes, raw distractor notes,
student-facing answer keys, raw prompts, raw provider payloads, credentials,
cookies, database URLs, or session secrets. Default student payloads and
student-visible transcript/activity text must continue to exclude correct
options, correctness labels, answer keys, raw diagnostic notes, and internal
metadata labels.

## Item Media Evidence

Phase 31N adds `item_media_assets` for teacher-authored MCQ media. The table
stores item-linked media metadata, not raw research conclusions. Safe fields may
include media public ID, placement, option label, media type, source type,
display URL, title, student-facing accessible alt text, teacher-only LLM media
description, caption, transcript/content summary, attribution, order, active
status, media version, and a media-context hash. The legacy
`alt_text_or_description` field remains a compatibility fallback for older
records, but new student payloads should read `student_alt_text` while
LLM-facing context may read `teacher_llm_media_description`.

Image uploads are stored through a provider-neutral storage boundary only when
server-side storage is configured. Local/course URLs must be HTTPS and must
pass URL safety checks. Student-facing payloads and default exports must not
include storage keys, storage credentials, media hashes, answer keys, correct
options, raw distractor metadata, raw teacher diagnostic notes, raw provider
payloads, or secrets.

Response packages and item-response snapshots may include safe serialized media
assets and `llm_media_context`. Student-visible payloads must use only the
student alt text and safe caption/transcript fields. The LLM media context is
built from teacher-only LLM media descriptions, captions, transcripts,
summaries, and attribution. It must mark
`direct_multimodal_input_supplied=false` unless a future phase explicitly sends
actual media to the provider. Item-response snapshots freeze the media context
administered to the student so later media edits do not alter historical
evidence.

## Assessment Deletion Records

Assessment deletion uses existing assessment/session/evidence tables as the
source of truth until an explicit teacher/research danger-zone action is
confirmed. The deletion preview reports aggregate row counts only: assessment,
concept unit, item, item media metadata, option, session, response,
conversation, process event, response package, agent summary, activity
runtime/evidence, diagnostic snapshot, workflow, and idempotency counts.

If deletion proceeds, the system writes an `assessment_deletion_events` audit
row with safe aggregate counts, safe public identifiers or hashes, deletion
mode, deleting teacher reference, timestamp, warnings, and limitations. The
audit must not contain deleted item text, student response text, answer keys,
correct options, correctness labels, raw process payloads, raw provider
input/output, credentials, cookies, database URLs, or secrets.

Assessment deletion removes item-media metadata rows through the item deletion
graph. Externally hosted URLs are outside this system and require no object
deletion. Uploaded media object deletion is a storage-layer lifecycle concern;
when object storage is enabled it should use a retryable cleanup path keyed by
deleted media metadata rather than embedding raw credentials or object payloads
in the deletion audit.

Default simple CSV and research exports read current system rows only. Deleted
assessments and deleted associated session/evidence records should not appear in
newly generated exports. Previously downloaded exports and external copies are
outside application control and are documented as deletion limitations.

## MCQ Import Provenance

Phase 31Q/31R adds teacher MCQ import provenance for bulk authoring. Import preview
batches are stored in `mcq_item_import_batches`, keyed by a public batch ID and
linked to the selected assessment and uploading teacher. The table stores safe
source metadata, source checksum, candidate counts, imported/rejected counts,
key-missing counts, diagnostic-suggestion counts, duplicate counts, validation
summary JSON, candidate payload JSON, suggestion payload JSON, import summary,
and timestamps. Validation summary may include file/row limits and safe source
warnings such as hidden workbook sheets being ignored or DOCX embedded
images/equations requiring teacher review.

Candidate payloads preserve original source text or source-row JSON, source
location, source line range when available, normalized draft fields, imported
key, teacher-confirmed key, missing fields, issue flags, duplicate warnings,
parsing confidence, field-level formatting and diagnostic suggestion review
decisions, safe suggestion status, safe provider/model/token metadata, and safe
authoring-agent call references. DOCX candidates also store safe parser
metadata such as parser version, source type, embedded-image count,
equation/object count, external relationship count, and tracked-change presence.
Missing source fields remain blank. The import service does not silently
paraphrase source wording or turn an imported/LLM-suggested key into an
official key.

Provider-backed formatting requests create `agent_calls` rows with agent name
`mcq_import_formatting_assistant_agent`, prompt/schema versions, prompt hash,
model name, provider, request/response metadata when available, token usage
when available, validation status, retry/repair count, and redacted input/output
audit data. Formatting proposals remain review-only until the teacher accepts,
edits, rejects, or leaves them unresolved. They may preserve source-supported
keys only as imported-key proposals, not official keys.

Provider-backed diagnostic-authoring requests create `agent_calls` rows with
agent name `mcq_diagnostic_authoring_assistant_agent`, prompt/schema versions,
prompt hash, model name, provider, request/response metadata when available,
token usage when available, validation status, retry/repair count, and redacted
input/output audit data. The teacher-facing candidate payload receives only the
structured, validated suggestion plus safe metadata; unrestricted raw provider
output stays in the server audit layer.

Imported item rows remain draft `items`. Each imported item stores safe import
provenance under `items.administration_rules.import_provenance`, including batch
public ID, source type, source checksum, source location, original-source hash,
source metadata, formatting status and review decisions, imported key,
teacher-confirmed key, missing fields at import, issue flags at import, and
diagnostic suggestion review decisions. Teacher diagnostic notes and assistant
suggestions remain teacher/research-facing guidance only.

Student-facing payloads, student previews, student transcripts, and default
exports must not expose imported keys, teacher-confirmed keys as answer keys,
raw teacher diagnostic notes, assistant suggestion payloads, source checksums,
provenance internals, raw provider output, credentials, cookies, database URLs,
API keys, session secrets, or password/access-code hashes.

Assessment deletion must count and remove `mcq_item_import_batches` for the
deleted assessment and remove associated formatting and diagnostic-authoring
`agent_calls` when they are referenced by safe candidate/suggestion metadata.
Deletion audit rows retain aggregate counts only and must not retain raw
imported source text or raw DOCX binary content.

## Teacher Account Security Data

Phase 31z added teacher/research email and account-security records. The
Phase 31z-reversal hotfix keeps that additive schema history but disables public
teacher forgot-password, email-change, and email-verification flows for the
classroom pilot. Username remains the stable login identifier. Email fields, if
present from older operator/bootstrap paths, are retained account-security PII
and are not included in student projections, default research exports, LLM
prompts, process-event payloads, public responses, or the standard teacher
Account settings UI.

Reused `users` fields:

- `email`
- `password_changed_at`
- `credential_reset_at`
- `auth_version`

Retained additive account-security fields:

- `email_normalized`
- `email_verified_at`
- `pending_email`
- `pending_email_normalized`
- `email_change_requested_at`

`account_security_tokens` stores only token hashes for historical/disabled
teacher account-security flows and operator invalidation. Token rows may include
expiry, used/invalidated timestamps, request IP/user-agent hashes, and safe
metadata. Raw token values, reset URLs, passwords, password hashes, provider
credentials, session cookies, and database URLs must not be stored or exported.

`account_security_rate_limits` stores scoped hashes and hourly counters for
retained account-security throttling infrastructure. It must not store raw IP
addresses or raw email addresses.

`account_security_events` stores safe account-security audit rows such as
operator teacher rename, token invalidation, and historical account-security
events. Metadata may include safe status, auth-version rotation flags, and safe
error codes. It must not include raw tokens, full reset URLs, passwords,
provider API responses, provider credentials, or assessment content.

The active teacher rename operator increments `auth_version`, which invalidates
older signed teacher session cookies. It must not alter assessment ownership,
student relationships, public IDs, session history, research exports, or student
credential-reset behavior.

## Phase 31al Evidence Artifacts

New sessions persist versioned evidence artifacts in existing operational JSON
fields rather than through a destructive migration:

- `student_profiles.item_level_evidence.evidence_integrated_profile_v2`
- `student_profiles.item_level_evidence.package_feedback_v2`
- `student_profiles.item_level_evidence.next_interaction_v2`
- `student_profiles.item_level_evidence.validation_results`
- `student_profiles.item_level_evidence.artifact_versions`
- `student_profiles.item_level_evidence.effective_evidence_package_hash`

Each administered item must have item-level evidence when a response exists,
including selected option, correctness, reasoning excerpt and interpretation,
reasoning quality, confidence, tempting-option evidence when available,
alternative explanations, evidence limitations, sufficiency, response public ID,
and administered snapshot version.

Safe process events for this phase include `package_results_shown`,
`item_correctness_status_shown`, `profile_feedback_shown`,
`next_interaction_shown`, `diagnostic_clarification_requested`,
`distractor_activity_shown`, and `foundational_activity_shown`. Event payloads
record schema/routing status and counts; raw teacher diagnostic notes, hidden
scoring metadata, prompts, and unadministered item explanations must not be
logged in ordinary event payloads. Initial-package answer explanations are
persisted on administered `item_responses` using
`answer_explanation_revealed`, `revealed_at`, `reveal_trigger`,
`explanation_version`, and `student_display_acknowledged_at`.

The analysis-ready research export exposes normalized profile and routing
columns such as `assessment_specific_understanding_category`,
`reasoning_quality_category`, `confidence_calibration_category`,
`evidence_limitation_codes`, `growth_target`, `answer_reveal_policy`,
`next_interaction_type`, `activity_type`, and `routing_policy_version`.
Nested item evidence remains structured JSON in operational audit views rather
than being forced into an unreadable wide table.

## Phase 31ao Communication and Topic Dialogue Evidence

Student communication output is persisted once after response-package scoring,
profile interpretation, growth-target selection, answer reveal, and activity
contract selection are frozen. The student-facing package narrative should be
stored as one reusable communication output and shown in the tutor chat. It
should not be duplicated in the student sidebar.

Topic-dialogue evidence is stored through existing conversation turns,
`agent_calls`, activity-runtime attempts, activity misconception evidence
records, and process events. The current implementation does not add a separate
topic-dialogue table; the stable dialogue public ID, turn number, response
function, evidence update, evidence sufficiency, boundary redirect, next action,
fallback/version metadata, and agent-call reference are stored in safe structured
conversation payloads and audit records.

New safe process events include:

- `student_communication_generated`
- `student_communication_persisted`
- `student_communication_shown`
- `post_activity_decision_created`
- `topic_dialogue_started`
- `topic_dialogue_prompt_shown`
- `topic_dialogue_response_submitted`
- `topic_dialogue_response_generated`
- `topic_dialogue_response_shown`
- `topic_dialogue_boundary_redirected`
- `topic_dialogue_ready_to_advance`
- `topic_dialogue_turn_limit_reached`
- `progression_choices_shown`
- `progression_choice_selected`

Research exports may include communication output version, deterministic
fallback status, post-activity status, recommended route, topic dialogue public
ID, turn number, student/tutor message fields under the research privacy policy,
evidence update, remaining issue, evidence sufficiency, topic-boundary redirect,
next action, progression selection, and model/prompt/schema/fallback metadata.
They must not duplicate the full student-facing narrative across multiple
tables and must keep `timing-contract-v2` fields unchanged.

## Formative Turn Orchestration Records

For each accepted active formative message:

- `conversation_turns` stores the exact immutable student message before
  context construction and one later immutable shown assistant reply;
- `activity_runtime_attempts` acts as the processing lease and records the
  current evidence/runtime state without replacing prior attempts;
- `activity_misconception_evidence_records` and post-activity snapshots retain
  the evaluator judgment;
- two versioned `followup_evidence_update_package` rows bind the authoritative
  context used for profile and planning stages to the client operation;
- validated new `student_profiles` and `formative_decisions` rows are activated
  with the assistant turn and current pointers in one transaction; a failed
  stage preserves the prior validated row and pointer instead of creating a
  fresh-looking carry-forward copy;
- `student_action_idempotency_keys` prevents duplicate cycles and replies;
- `agent_calls` retains internal provider, validation, rejection, and fallback
  audit separately from the student-visible transcript; and
- process events include `student_activity_response_submitted`, topic-dialogue
  submission/generation events, post-activity routing, and safe fallback use.

`formative-turn-context-v1` contains a complete visible transcript with stable
hashed turn references and sequence indexes. Draft/internal/not-shown turns are
excluded. Internal database IDs, raw credentials, headers, and secret values
are not included in the student projection.

`conversation_turns.sequence_index` is the authoritative persisted causal
ordering field. It is globally monotonic and is the primary order for student,
teacher/research, agent-input, package, and export transcript reconstruction.
`created_at` remains the wall-clock persistence timestamp, but equal timestamps
and random UUIDs are not used to infer causal order.
The migration gives historical rows a stable backfilled sequence. If two
pre-migration rows had the same timestamp, their original causal order cannot
be recovered with certainty; authoritative causal ordering applies to turns
created after the sequence field is installed.

Failed formative profile/planning stages add `orchestration_result` to their
existing `followup_evidence_update_package` and emit the existing
`followup_profile_update_failed` or `followup_planning_update_failed` event.
The payload records `profile_update_failed`/`planning_update_failed`,
`stale_profile_used`/`stale_plan_used`, `fallback_source_version`,
`failure_agent_call_id`, `result_status`, and `failure_reason_code`. The shown
assistant turn references the same stage audit internally; student-safe
serialization excludes it. A recovery turn uses
`message_type=topic_dialogue_safe_recovery` and `recovery_message=true` so
research records can distinguish it from normal pedagogical dialogue.

## E1.2 Student Projection and Audit Separation

The production-like privacy regression verifies the same persisted records
through two different authorization boundaries. Student state, package review,
transcript, activity-runtime, revision, and transfer projections contain only
student-visible content and public identifiers. They do not serialize answer
keys, correctness, raw diagnostic metadata, profile/plan objects, agent-call
provenance, validator/configuration versions, or typed fallback/failure audit.

The authorized teacher/research audit retains versioned profiles and plans,
activity attempts, agent-call status and prompt/schema versions, and safe
fallback/failure provenance. Hidden prompts, chain-of-thought, credentials,
headers, and secrets are not part of either projection. A recursive key and
visible-text scanner checks student payloads after initial administration,
package completion, formative dialogue, revision, transfer, failed-transfer
re-entry, recovery, and refresh. Transcript reconstruction uses persisted
`sequence_index`; refresh must not reorder, duplicate, or enrich visible turns
with internal fields.

## E2A Evaluation-Only Provider Evidence

E2A writes local, ignored artifacts that distinguish operational agent calls
from isolated LLM student-simulator calls. Simulator records contain a
configuration hash, prompt/schema version, provider call IDs, token counts,
latency, retry count, and safe validation issue codes. They do not enter
classroom records or the approved operational manifest. API keys,
authentication headers, hidden prompts, chain-of-thought, and raw provider
output are excluded.
