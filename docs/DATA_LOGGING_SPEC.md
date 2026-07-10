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
followup_response_submitted
targeted_feedback_shown
revision_submitted
next_choice_selected
transfer_item_presented
transfer_item_completed
session_completed
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

After the first three-item package, construct a response package from:

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
- `response_packages` for the package-level evidence object after the initial three-item package.
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

### Simple CSV Data Explorer

The teacher data area also includes `/teacher/data/explorer` for quick
teacher/research CSV downloads over existing tables. These files are intended
for lightweight spreadsheet review, not as a replacement for the full research
ZIP.

- Assessment CSV: `assessment_<assessment_public_id>_students.csv`, one row per
  student-assessment session attempt for the selected assessment.
- Student CSV: `student_<student_id>_sessions.csv`, one row per assessment
  session attempt for the selected student.
- Matrix CSV: `student_assessment_matrix.csv`, one row per current student and
  assessment pair.

Simple CSV rows include public assessment/session/student identifiers,
assessment/session status, attempt number, timestamps, response/package/event
counts, derived latency/process-feature row counts, activity/post-activity
aggregate counts, latest student-safe status when available, latest diagnostic
purpose when available, unsupported-correct aggregate count, maximum estimated
guessing-risk aggregate, data completeness status, and limitations.

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

### Research ZIP Export

The teacher data area provides **Download all research data**. Per-session
teacher review also provides **Download readable transcript** and **Download
session research data**.

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
