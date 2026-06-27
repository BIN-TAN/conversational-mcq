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
