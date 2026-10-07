# Data Logging Specification

## Ordinary conversational application exchanges (2026-10-07)

Host `formative-conversation-host-v7.14` refines teaching instructions only.
Application questions and flexible replies remain exact tutor/student messages in
the existing conversation, with existing timestamps, source-call joins and provenance.
No dedicated question/key snapshot, response record, follow-up option/reason/confidence/
correctness/completion fields, assistance flags, special events, export columns or
datasets are introduced. Existing operational logging and evidence observations
remain; a practice reply does not force a profile update or a new observation.

Later transcript coding can locate questions, preceding hints or explanations,
responses and discussion. This release does not automatically identify these
exchanges as independent transfer, retention or chatbot-caused learning. Initial
confidence is carried forward under its existing provenance rule, not remeasured.
Historical messages, initial responses, profiles and export schemas are unchanged.

## Historical context versus new learning evidence

`formative-conversation-evidence-id-validator-v3` separates six context-only
observation types from the evidence of a new profile transition:
`student_question_pending`, `student_question_addressed`,
`assessment_content_ambiguity`, `learning_summary_understanding`,
`learning_summary_progress`, and `learning_summary_remaining`.
They retain the original student reference, including initial reasoning or an
earlier conversation turn. Their IDs need not occur in the current transition's
`canonical_evidence_ids`. Scope, identity, student role, eligibility, and
conversation checks still apply. Progress requires earlier and later reasoning;
a tutor explanation or request alone does not establish learning.

Updated profile fields and resolved misconception claims still require eligible
student evidence after the prior profile cutoff. Retained field values must
match the prior value exactly; paraphrasing is not silently accepted. Historical
context references never become transition source-turn references merely by
appearing in a summary. The same provenance validation runs when persisted
snapshots are reviewed. Existing source events and profiles are not rewritten.

Tutor prompt `formative-conversation-host-v7.13` documents these distinct uses
and exact retained-field copying, and makes reply depth responsive to the
student's request while retaining necessary conceptual assumptions. Initial
confidence alignment remains carried forward, not reassessed from chat.

## Pause and session observation projection (2026-10-02)

`process-data-summary-v4` and `session-timing-v4` include later conversation
activity in the observation endpoint of open attempts. Completed attempts retain
their terminal cutoff. `pause_episodes.csv` records matched explicit pauses and
resumes with available phase, display and student-message context. No preference,
motivation or learning judgment is inferred from pauses. See
[Process participation observations](PROCESS_PARTICIPATION_OBSERVATIONS.md) for
field definitions, formulas, join keys, missing-data rules and verification.

## Conversation visibility projection (2026-09-28)

`conversation-visibility-v1` is a read-only projection, not new behavioral data.
`conversation_turns.csv` retains all original turns and adds `student_visibility`
and `conversation_visibility_version`. Values are `internal_only` for explicit
hidden/draft records or legacy tasks suppressed by the formative-conversation
route, `student_visible` for explicit transcript eligibility, and
`legacy_unspecified` when no visibility declaration exists. Conflicting declarations
favor exclusion. These values do not prove display, reading or understanding; use
the separately documented feedback-exposure observations for partial exposure.

Readable transcript and its download omit internal-only rows without renumbering
the retained source turn indexes. Internal messages remain in the Assessment log
and raw research CSV. Unknown historical visibility stays qualified; no source
text, timestamp, score, profile, evidence reference or exposure event is rewritten.

Internal/empty messages no longer receive prompt-response latency in the research
CSV. For eligible rows, this field remains the next non-internal student turn's
server timestamp minus the prompt's server timestamp in source sequence order,
within the same session. It is not necessarily a response to that particular
question, does not measure client display or active work, and overlapping intervals
must not be summed. The readable view's existing event/turn timing likewise excludes
hidden prompts. New exports correct the derivation; older downloaded datasets do not
change automatically. Host v7.10 source-call provenance identifies newly generated
personalized messages and retains the prior confidence-alignment carry-forward rule.

## Initial Feedback Technical Termination (2026-09-27)

The current failure screen recommends retry or teacher help and preserves an open
attempt; it does not offer termination. Displaying this guidance does not emit a
termination or teacher-contact event. The following event contract is retained
for explicit ordinary end requests and historical records, not failure alone.

`initial_feedback_terminated` records a confirmed student end after the current
topic's persisted preparation job failed. The session becomes `student_exited`,
not `completed`, with no completion timestamp or next-topic creation. The server
derives the technical reason from its failed job, not a client reason string.
The event carries `policy_version=initial-feedback-failure-termination-v1`,
`job_public_id`, `failure_reason`, `actor_type=student`, `destination=end_attempt`,
`learning_support_completed=false`, `from_phase` and `to_phase=student_exited`.
Standard attempt-end and session-exit events share the reason
`initial_feedback_unavailable`. Replays do not duplicate termination events.

No original products, failed jobs/calls, sealed packages or historical profiles
are overwritten. Teacher review reasons are preserved and extended. Research
`sessions.csv` uses `attempt_lifecycle_status=ended_by_student`,
`formative_activity_completion_status=incomplete_technical_failure`,
`assessment_completion_reason=ended_after_initial_feedback_failure`,
`selected_navigation_destination=end_attempt`, and includes
`initial_feedback_unavailable` in `session_limitations`. Termination alone does
not populate `activity_skip_reason`. These are operational statuses, not student
deficits or learning outcomes. Teacher Process data labels the event as ending
after AI feedback failed. Existing historical skip events retain their meaning.

The global initial-feedback allowance uses the approved runtime policy
`initial_feedback_max_output_tokens=30000`, replacing individual grants.
`agent_calls.max_output_tokens` stores the effective ceiling sent to the provider.
`input_payload.runtime_budget` uses `policy_version=initial-feedback-budget-v2`,
`approval_scope=all_students`, `grant_id=null`, `approved_runtime_hash`, and
`base_max_output_tokens` / `effective_max_output_tokens`. Actual token use is
separate. This metadata stays in the audit, not the model's assessment input.
No historical limits or calls are backfilled. It affects initial-feedback
generation, not all agent roles, input context, chat-turn counts or spending caps.

## Historical Initial Feedback Technical Continuation (2026-09-27)

This endpoint is retired. The following describes retained historical records,
not an action offered to new attempts.

`initial_feedback_skipped` is an authoritative backend event for an explicit
student choice after failed AI preparation. It is not a missing student response,
misconception resolution, or successful intervention. Its payload contains
`policy_version=initial-feedback-continuation-v1`, `job_public_id`, the sealed
`response_package_hash`, `failure_reason`, `actor_type=student`, `destination`
(`next_concept` or `assessment_complete`), `learning_support_completed=false`,
`from_phase`, and `to_phase`. The event time is the server-observed choice time.
There is no derived score or duration. Repeated requests append only one event.

The original failed job, AgentCalls, responses, package and profiles are retained.
`concept_unit_sessions.followup_status=incomplete` and a session teacher-review
flag distinguish unavailable support. No follow-up completion time or learning
profile transition is synthesized. The standard research ZIP includes the event
in `process_events.csv`; its detailed payload remains in the existing audit.
Existing `sessions.csv` columns encode the limitation without duplicating data:
`formative_activity_completion_status=incomplete_technical_failure` and
`activity_skip_reason=initial_feedback_unavailable` when any topic has this event;
`session_limitations` includes `initial_feedback_unavailable`;
`selected_navigation_destination` records the latest technical continuation's
destination. `assessment_completion_reason=initial_feedback_unavailable` only
when that choice directly finished the last topic. For multiple topics, use the
topic-linked source events rather than treating a session summary as every topic.

For new failed preparation attempts, the worker checks same-topic failed calls
created at or after its lease began. A persisted `incomplete_reason=max_output_tokens`
sets job `last_error_category=output_token_limit` and ends automatic retries.
Older failures are not backfilled or used to relabel a newer transient error.
Human-readable process data label continuation as student continuation after AI
feedback was unavailable. Restoring a technical attempt chance continues to use
the existing teacher waiver ledger; no student evidence is deleted or renumbered.

## Initial Preparation Retry Audits (2026-09-26)

Failed or invalid initial-profile calls retain their original AgentCall, invocation
key, provider metadata, validation diagnostics, and token usage. A retry is a new
AgentCall whose `agent_invocation_key` is `<original-key>:retry:00000001`, then
`00000002`, and so on. The unsuffixed call is attempt zero. This index counts
application-level profile-call attempts, not student test chances or provider
transport retries; `retry_count` retains its existing provider meaning. No
response package, item response, attempt allowance, or prior failed audit is
rewritten. Standard research exports retain separate operational rows by
`agent_call_public_id`, including status, timing and token usage; the invocation
key itself remains in the operational/raw AgentCall audit, not a new standard
dataset column.

Reservation is serialized briefly on the topic-session row. An already-started
call is not duplicated, a validated successful retry is reusable, and
`needs_review` is not automatically retried. Unexpected provider execution
exceptions mark a still-started call as `failed` with the fixed diagnostic
`provider_execution_interrupted`, without copying exception text. A process killed
before that audit update can still leave a started call requiring operational
investigation; this policy does not infer that such a call is safe to repeat.
Existing bounded workflow retries and usage guards remain in force. The initial
failure's cause must be investigated separately from a retry-key collision.

## Collection and Summary Evidence (2026-09-26)

Item-admin tutor v2 preserves submitted student wording, including limited and
uncertain reasons. Accepted limited responses have `weak_but_usable_reasoning`
classification and `weak_but_usable` tutor quality. The legacy response-quality
projection maps this to `adequate` with `reasoning_signal=weak_but_usable`;
"adequate" here means collectable, not correct, mastered, or independently reasoned.
Explicit unknown-reason responses retain their existing low-information category.
Original model output is retained under `agent_calls.raw_output.original_parsed_output`;
`output_payload` is the effective neutralized collection output. The same audit
includes `collection_policy_version` and `prior_neutral_clarification_count`.
That count uses prior same-item, same-stage rejected incomplete/continuation
or affective messages, excluding provider/configuration failures. It bounds
clarification; it is not a learning or engagement measure. Original rejected
turns and accepted products remain separate. No historical data is rewritten.

Host v7.9 uses existing formative `evidence_observations` for optional learning
summaries: `learning_summary_understanding`, `learning_summary_progress`, and
`learning_summary_remaining`. Each entry links canonical student reasoning IDs.
Progress entries require distinct earlier reasoning and later formative reasoning;
baseline or answer-only evidence cannot establish gain. These are qualitative AI
interpretations with provenance, not computed learning-effect measures. They do
not independently change claim dispositions, update a profile, or end a session.
Original observations remain in agent/turn audit and existing research exports;
there is no duplicate summary/mastery table. The policy does not infer correctness
from IDs alone: substantive accuracy still requires content review and evaluation.

## Stance-aware interpretation provenance

New initial profiles use `semantic-item-review-v3` and retain item-local
interpretation IDs, exact student quotes, source fields, proposition accuracy,
endorsement/rejection/uncertainty/quotation, evidence basis, scope, sealed option
references, rationale and rule version. Candidate misconceptions link to eligible
endorsed interpretations; historical records are not rewritten. These nested
diagnostic records complement raw product/process data, not replace them.
`docs/STANCE_AWARE_REASONING.md` documents the fields, normalization, validation,
persistence path, evidence limitations and test protocol. They are model
interpretations, not direct observations or automatically established beliefs.

## Goal

The three-chance policy adds an `assessment_attempt_chances` ledger. It records
the session, student, assessment family, original attempt number, policy version
and creation time; technical restorations add teacher, timestamp and reason.
This small allowance record survives session deletion and is removed on student
account deletion. Existing records are backfilled as `legacy_unlimited`; none of
their responses or historical attempt numbers are overwritten.

Attempt comparisons derive from each topic's earliest sealed initial response
package, never from later mutable responses. Research exports add attempt,
submission-item, paired-change and class-summary tables plus a dictionary and
snapshot/calculation metadata. Standard exports omit correctness-derived fields;
restricted exports include them under the existing confirmation/access rules.
See `ATTEMPT_COMPARISONS.md` for denominators, exclusions and interpretation.

Teacher JSON/workbook import inspection creates no classroom or research records.
Preparation stores draft assessments, primary topics and import-review batches
only. Workbook batches retain the source SHA-256, parser version, sheet/row
locations, full non-item reference-sheet text and warnings. Candidate provenance
retains original item rows and unambiguously linked guide rows. Guide learning
objectives and optional follow-up evidence remain teacher source notes, not
observed student evidence or active conversation rules. Existing student-safe
serialization remains authoritative. Normal reviewed item materialization copies
source mappings into item import provenance without changing historical data.

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

Item completion after an in-flow edit records the same `item_completed` and
`item_submitted` events as normal administration. The submission timestamp and both
events commit together, once per item, including recovery of an older incomplete
transition. Recovery timestamps describe when completion was persisted; the original
answer/edit turns keep their original timestamps. An initial item completion does
not emit `assessment_completion_summary_shown`. Misconception coverage uses existing
claim dispositions and append-only profile transitions; no historical evidence is
overwritten or inferred from tutor explanations.

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
- Corrected post-administration content is copy-on-write: assessment, concept-unit, item, and item-media records retain predecessor public IDs; the assessment revision retains its family ID, revision number, teacher correction reason, and source-content hash. Existing response and correctness snapshots are not rewritten, and only future attempts use a published correction.
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

Provider recovery v1 adds `raw_output.provider_failure` to failed OpenAI calls
and failed v18/v18r2 formative executions. Its allowlisted fields are
`recovery_version`, `http_status`, `provider_error_code`, `provider_error_type`,
`typed_failure_reason`, `retry_after_ms`, and `retryable`. Codes/types are restricted
to short machine identifiers; this object contains no provider message text,
credentials, or student content. It is a restricted operational audit object,
not a new public research column or a measure of student engagement. Missing
fields in historical calls remain missing; no earlier failures are relabeled.

`provider-failure-taxonomy-v4` distinguishes account/credit exhaustion from
temporary HTTP 429 responses, including responses with a completed error body.
`bounded-provider-transport-retry-v3` traces the actual backoff delay and the
reason `server_delay_exceeds_inline_retry_budget` when a delay is deferred.
`retry_after_ms` is derived from provider milliseconds, provider seconds times
1,000, or an HTTP-date minus receipt time, rounded up to milliseconds. It is not
student response time. For initial preparation, `run_after` is the later of the
worker's ordinary retry time and the failed call's completion time plus this
delay (creation time is used if completion time is absent).

Initial-preparation account failures use workflow category
`provider_account_unavailable`. Failed jobs/calls remain recorded across explicit
retries, while submitted response packages and item responses are unchanged.
Teacher LLM status reports the latest persisted OpenAI success/failure from the
recent-call window; it is historical evidence, not a continuous connectivity probe.
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

The baseline analysis contract is `timing-contract-v3`, exported in
`research-dataset-v2`. Items with browser response-stage observations use
`timing-contract-v4` instead; see Browser Response-Stage Observations below.
Earlier v2 timing values remain historical artifacts; re-exporting applies
the explicitly versioned corrected derivations supported by retained events.

Idle time is the union of observed idle intervals intersected with active
lifecycle windows, not the sum of cumulative threshold durations. Visible time
subtracts only hidden intervals intersecting active windows. Missing, incomplete,
or multi-document visibility evidence yields an unavailable visible estimate.
Browser process delivery uses bounded acknowledged retries with stable event
IDs; see `RESEARCH_DATA_FIXES_2026-09-11.md` for storage and loss limitations.

V3 item timing is derived from explicit event endpoints (V4 uses the browser
stage endpoints and first-versus-accepted distinctions documented below):

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

In-app student login emails are retired. The historical `student_login_invitations`
ledger remains intact for audit/rollback and is excluded from research datasets.
Roster imports retain normalized identity fields, validation results and account
audit events; they never persist the uploaded credential CSV or its extra password
columns. Shared-password reissues record mode, actor, student, batch and timestamp,
not plaintext credentials. Existing sessions, attempts and research events remain
unchanged. See `STUDENT_LOGIN_INVITATIONS.md`.

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
| `agent_activity_records.csv` | One row per agent call, workflow decision, authoritative legacy formative activity attempt, or diagnostic update record | Uses `record_type` and `authority_status` to distinguish incompatible row types. Historical `FollowupRound` rows are emitted as `legacy_followup_round` with `legacy_non_authoritative`; they are not active activity attempts. Non-applicable fields remain null. |
| `assessment_content.csv` | One row per administered item snapshot | Reflects content actually administered. Restricted item-key and diagnostic-note fields are excluded by default. |
| `assessment_summary.csv` | One row per student-assessment attempt summary | Includes safe session counts, status, timing, latest student-safe diagnostic signals, and explicit limitations. |
| `research_data_dictionary.csv` | One row per ordinary or restricted research dataset variable | Documents qualified variable name, dataset/table, measurement level, source nature, source-code reference, source service/function, source-verification status, missing/zero/false semantics, privacy, export policy, timing formulas, applicable record types, and interpretation cautions. |
| `process_event_codebook.csv` | One row per allow-listed process-event type | Documents event trigger, actor/source, scope, timestamp meaning, allow-listed payload fields, derived variables, source-code reference, source-verification status, and interpretation cautions. |
| `formative_conversation_sessions.csv` | One row per persistent formative conversation | Separates conversation lifecycle and starting/current profile references from assessment item administration. |
| `formative_conversation_turns.csv` | One row per visible formative student or tutor turn | Includes a conversation-local turn index and observable turn/input telemetry: timestamps, response time, message length, token counts, typing-duration method, edit count, backspace count, paste event count, and paste character count. Pasted text is not stored. Tutor rows carry an opaque public AgentCall join key. Student rows carry the public response-receipt join, assistant-response lifecycle, retry count, and latest safe failure category/timestamp. |
| `formative_conversation_events.csv` | One row per observable formative lifecycle/navigation/operational event | Includes a conversation-local event index and distinguishes enter/re-enter, leave, visibility changes, refresh, pause/resume, reconnect, conversation end, persisted message/call milestones, and terminal assistant-generation failures. Failure rows contain only the safe category, agent name, retry count, timestamp, and optional public AgentCall join. |
| `formative_conversation_llm_calls.csv` | One row per formative conversation agent call | Includes the same opaque public AgentCall join key, the public response-receipt join when the call responds to a student message, and model, prompt/context/schema versions, validation, retries, latency, and token counts without provider request IDs, raw prompts, or outputs. Failed attempts remain in this file and do not create or count as tutor turns. |
| `formative_conversation_profile_transitions.csv` | One row per validated profile transition | Preserves the agent-authored outcome and interpretation, prior/updated profile versions, supporting student/tutor turns, evidence-reference public IDs, initial assessment-profile provenance, timestamp, and source public AgentCall join key without hidden prompts, provider request IDs, or chain-of-thought. |
| `formative_conversation_interventions.csv` | One row per persisted intervention record | Documents strategy history and targeted evidence gap without claiming an inferred student trait. |
| `formative_conversation_data_dictionary.csv` | One row per formative-conversation export variable | Identifies raw observable fields versus derived/validated profile fields and states interpretation cautions. |

Formative profile evolution is append-only. A validated terminal recommendation
from `formative_conversation_agent` supplies a complete canonical updated
profile and field-level evidence dispositions. Changed fields must cite
conversation evidence; unchanged fields may be retained only when the
recommendation states that their earlier evidence remains valid. Persistence
creates a new `StudentProfile` version and a
`FormativeConversationProfileTransition`; it does not rewrite the assessment
profile, rewrite an earlier formative profile, or copy stale fields by default.
`continue_conversation` records conversation evidence without forcing a
terminal outcome. The platform checks conversation, turn, agent-call, and
assessment-profile ownership, but does not replace the agent recommendation
with deterministic pedagogical thresholds. Transition rows include prior and
updated profile fields, the complete canonical snapshot, profile timestamps,
and aligned supporting-turn sequence, actor, and evidence-role columns so the
profile timeline can be reconstructed without exporting hidden prompts or raw
provider payloads.

The persisted profile-transition outcome is the sole authoritative
teacher-assistance decision. A compatibility recommendation in the agent output
must mirror that outcome and cannot independently create a teacher-facing or
research outcome. The platform validates this coherence without applying a
turn-count or other deterministic pedagogical threshold.

The latest persisted transition is the only authoritative formative outcome
for teacher and research projections. Conversation status, review signals,
narrative text, and current-profile pointers must not be used to infer
`sound`, `largely_improved`, or `teacher_assistance_recommended` when no
transition exists. In that case, projections report no validated profile
change yet.

Formative conversation lifecycle events have separate meanings:

- `paused` and `resumed` change the resumable conversation lifecycle;
- `left` and `reentered` record observable page departure and return without
  pausing or ending the conversation;
- `conversation_ended` records the student's explicit end-conversation action;
- assessment-attempt end remains an assessment lifecycle command and is not a
  synonym for any formative conversation event.

A validated profile outcome does not automatically end the formative
conversation. Conversation termination requires its own explicit lifecycle
action.

Assistant-response lifecycle is recorded independently from the raw transcript.
`pending`, `retrying`, and `failed` student turns remain visible and auditable
without being treated as completed exchanges. `completed` requires one
persisted tutor turn. Retry reuses the persisted student message and response
receipt while creating a distinct AgentCall attempt; safe failure events retain
the agent name, category, retry count, and time without raw provider errors,
prompts, payloads, credentials, or secrets.

Runtime research-consent collection and external form integration are outside
the current implementation. A future research-data eligibility layer may link
consent/withdrawal status to public session or pseudonymous research-student
identifiers before export. That extension must not rewrite raw assessment or
formative records, and no Google Form or other external consent source is
queried by the current runtime.

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
- `agent_call_public_id` joins visible formative tutor turns to safe LLM-call
  metadata, and `source_agent_call_public_id` joins profile transitions to the
  same call record. Both are application-generated opaque identifiers; provider
  request IDs, invocation keys, raw prompts, raw payloads, and internal database
  IDs are not exported.
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
- `active_interaction_time_ms`: null until validated active-interaction
  intervals are instrumented. Elapsed time minus idle observations is not a
  measurement of active interaction.
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

The teacher session page includes a read-only **Process data** tab with a
versioned `behavior_summary`: core activity measures, per-item timing,
conversation input observations, a filterable chronological timeline, capture
limitations, a downloadable JSON summary, and a full-timeline CSV with UTC
timestamps and millisecond durations. CSV quoting and formula escaping preserve
safe spreadsheet review; missing durations remain blank. Timing uses the same v3 interval
derivation as research exports. Missing browser evidence is unavailable, not
zero; incomplete visibility pairs and multiple documents do not produce a
fabricated total time away. Idle thresholds overlap and are not added.

The **Assessment log** contains event records, collapsible structured
conversation records, and the original technical evidence audit. Its technical
counter section hides zero-valued counters rather than deleting stored data.
**Item responses** contains the historical submission snapshots previously in
Response packages. These snapshots remain separate immutable research records,
not duplicate editable answers. Existing export files and join keys remain;
`session_data_completeness.jsonl` adds the documented `behavior_summary` field.
Review sections load on demand and reuse their data until Refresh is selected.
A failed optional section can be retried without blocking the rest of the page.
Historical and current answer-revision event aliases share one counting rule,
so the readable summary and technical counts do not double count the same item.

Generic browser observations span initial administration and the learning
conversation. Conversation input/lifecycle telemetry is summarized separately
and is not added to overlapping page-wide counts. Revisions distinguish
accepted response updates, changed fields, and input edit/backspace counts.
Typing duration is not treated as active thinking time. No keystroke text or
full unsent draft history is collected.

Browser navigation records now distinguish `assessment_view_entered`,
`assessment_view_left`, `beforeunload`, `pagehide`, and `pageshow_return` reasons.
View entry/exit denotes instrumentation mount/unmount, not verified abandonment.
Item navigation does not generate new view entries or reloads. Document identity
and reload deduplication survive component remount within the same document.
Close/return delivery remains bounded and best effort; an abrupt shutdown or
offline gap cannot establish an exact absence interval. No record is backfilled
for historical attempts.

The technical evidence audit does not expose raw process
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

Teacher student-account management supports single-account and bounded batch
deletion. Batch deletion is limited to 100 explicitly selected student
accounts, previews aggregate associated-record counts, binds confirmation to a
SHA-256 fingerprint of the canonical selected account IDs, and requires an
exact count-specific confirmation phrase. The deletion executes in one
transaction and retains one safe `student_account_deletion_events` audit row
per removed account with a shared batch operation reference and aggregate
counts. The audit does not retain response text, conversation text, prompts,
provider payloads, credentials, answer keys, or process payloads. Previously
downloaded exports and external copies remain outside system control.

Teacher session management supports bounded batch deletion for terminal
`completed` and `student_exited` attempts only. The preview is bound to the
selected session identities and current states, and deletion requires an exact
count-specific confirmation phrase. Student accounts and assessment authoring
content are retained. A safe lifecycle audit row remains for each deleted
session with aggregate counts and a shared batch reference; response,
reasoning, conversation, provider, and process payload text is not retained in
that audit. Active, paused, not-started, and review-pending attempts are not
eligible for this operation.

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
- `turn_response_latency_ms` (export column `response_latency_ms`): elapsed
  wall-clock time from an agent/system conversation turn's **server record**
  timestamp, not verified browser display time, to the earliest eligible student
  conversation turn or process action in the same session and item/topic context.
  Formula: `min(next_turn.created_at, next_action.occurred_at ?? next_action.created_at)
  - prompt.created_at`, using only available, nonnegative candidates. Missing
  endpoints remain null. Source/type/index metadata describe the selected endpoint;
  `mixed` means both endpoints share that timestamp. The legacy `prompt_shown_at`
  column contains `prompt.created_at`, not a client display acknowledgement.
  It may include reading, thinking, network delay, or time away. Overlapping
  prompt intervals must not be summed as active work. Rows explicitly flag
  overlapping prompts and recorded visibility/pause events during the interval.
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

The assessment library also supports bounded batch deletion of archived mini
tests. The action uses a selection fingerprint, an exact count-specific
confirmation phrase, one transaction, and one safe `assessment_deletion_events`
row per removed assessment with a shared batch reference. If any selected mini
test has student or operational records, the preview switches the entire batch
to `assessment_and_all_data`, requires a second acknowledgement, and includes
all associated sessions, responses, conversations, profiles, and evidence in
the transaction. Student accounts and historical deletion events are never
removed by the batch action.

## MCQ Import Provenance

Teachers may batch-delete explicitly selected items only from an owned draft
mini test with no student attempts or item-linked evidence. Preview and deletion
bind the current selection and content with a fingerprint and an exact
count-specific confirmation. Deletion is atomic; current publication pointers
are invalidated, while historical import batches and verification runs remain
unchanged. Deleted candidates remain marked as previously imported and cannot
be reimported from that batch. Surviving item IDs, content, and order values are
preserved. A `teacher_delete_unused_items` lifecycle audit records the teacher,
assessment and deleted item identifiers, counts, timestamp, and fingerprint,
without copying item text, keys, or student evidence. Media metadata cascades;
external files and previously downloaded copies are not removed.


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

Evidence-centered item design is stored as a versioned
`item_design_blueprint` inside the primary topic's administration rules. The
blueprint records section/topic, teacher-authored objectives, observable
evidence requirements, misconception hypotheses, student-language examples,
optional exemplar items, and generation settings. Provider-backed draft
generation uses `mcq_diagnostic_authoring_assistant_agent` with the distinct
`evidence-centered-mcq-generation-v2` prompt and stores one redacted
`agent_calls` record for each bounded generation chunk or recovery attempt.
Failed and invalid attempts remain auditable; successful chunks are resumable
and their public references are linked to the final review batch. Generated
drafts are materialized as an
`McqItemImportBatch(source_type=generated_evidence_blueprint)` so the existing
candidate review, key confirmation, duplicate checking, provenance, and draft
import controls remain authoritative. Generated answer keys are suggestions
until the teacher explicitly confirms them.

The same primary-topic rules store the versioned teacher-authoring conversation
and the assistant's latest advisory design state. Each exchange preserves the
teacher message, validated teacher-facing assistant wording, public AgentCall
reference, client message identity, and timestamp. The corresponding
`agent_calls` row records the dedicated authoring prompt/schema identities,
model and token metadata, redacted context, validation result, and provider
attempt status. Client message identities make completed exchanges idempotent.
The provider context contains the assessment title, current blueprint, bounded
recent authoring transcript, and latest teacher message; it does not include the
teacher account identifier, authentication data, or student records. The
authoring thread is teacher/audit data and is not projected into student
assessment or profiling payloads.

Versioned `item_design_source_materials` records support teacher uploads in the
authoring conversation. Accepted types are bounded PDF, DOCX, PNG, JPEG, and
WebP files. The record preserves a stable material ID, client message ID, safe
file name, media type, byte count, SHA-256 content checksum, source kind,
parser version where applicable, bounded extracted DOCX text, validated
educational-content summary, limitations, parser warnings, public AgentCall
reference, and timestamp. PDF and image binaries are transient provider inputs;
original binary data and base64 payloads are not stored in the database or
AgentCall audit payload. The attachment IDs are linked to the corresponding
teacher transcript turn. All source-material records, summaries, filenames,
checksums, and extracted text are teacher/audit only and are removed by the
student-agent provider projection.

Teacher-pasted exemplar item text and generation-only context notes remain in
the authoring record but are excluded from the student-profiling provider
projection. Profiling retains the section, objectives, evidence requirements,
and misconception hypotheses needed to interpret administered student evidence
without exposing unadministered exemplar content.

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
tables. Historical `timing-contract-v2` artifacts remain unchanged; corrected
derivations are explicitly labeled v3 in new exports.

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

## Feedback Display Observations (2026-09-27)

`display-ack-v2` separately captures `package_results_shown` (summary only),
`item_correctness_status_shown` (one item's explanation), and
`formative_feedback_shown` (one saved tutor message). An observation requires
some of the content to intersect the viewport of a visible browser document
continuously for at least 500 ms. The threshold resets while hidden/offscreen;
collapsed explanations do not qualify. This is partial exposure, not proof of
reading, full-message exposure, comprehension, or reading duration.

Events use the bounded session-storage delivery queue with stable event IDs.
Content identity is session + topic + summary/item/turn identity. The server
validates ownership, administered context, released item feedback and tutor
turn references, then deduplicates by session/event type/content identity.
Reloads and delivery retries do not count as additional readings. Storage
failure, queue expiry (24 hours), queue overflow (200 events), abrupt shutdown
and offline closure remain best-effort limitations; absent data are not zero.

`feedback_exposure_events.csv` adds `display_event_contract_version`,
`content_kind`, `observation_method`, `minimum_visible_ms`, `client_event_id`,
`server_received_at`, and `source_turn_sequence_index`. The latter joins a
tutor exposure to `conversation_turns.csv` within `session_public_id`; it is
blank for summaries/items. The browser's occurrence timestamp and server's
receipt timestamp are distinct clocks. The dictionary documents each field.

Only a v2 item explanation observation sets that item's
`student_display_acknowledged_at`, using first server receipt time. A summary
or tutor message cannot mark all answers as seen. Legacy v1 package-level
acknowledgements retain their original broader semantics. Historical missing
exposure records are not inferred from generated/persisted feedback or backfilled.
Read-only historical review does not generate new in-attempt exposure evidence.

Explicit **Finish assessment** creates one backend `session_completed` event
with `reason=student_confirmed_finish_after_learning_conversation` and
`completion_contract_version=conversation-finish-v1`. It changes lifecycle
metadata only; `learning_outcome_generated=false` documents that no final
profile or improvement evidence is fabricated by this action.

## Browser Response-Stage Observations (V4)

See [Process and Product Analytics Guide](PROCESS_PRODUCT_ANALYTICS_GUIDE.md)
for formulas, analysis units, join rules, current coverage limits and suggested
analyses. Every new analysis-ready ZIP includes `data_coverage.csv` calculated
from its actual tables, with row/populated/blank/zero counts and actor/stage
subgroups. It describes population, not eligible-record completeness or validity.
`response_stage_data_dictionary.csv` provides explicit source, formula, units,
applicability and missing-value rules for every stage-export column. Derived
visits/item summaries carry `calculation_version=response-stage-derivation-v2`;
cumulative waiting/hidden/offline durations are unavailable when sequence gaps
could hide intervals. Raw records and their collector version are unchanged.

New initial/transfer administration records `response_stage_observation` for
answer, reasoning, confidence, tempting-option, and tempting-reason stages.
Review and in-flow edits have separate `review`/`revision` contexts. A stage
visit begins when its interface is visible in the viewport and usable; this is
not a claim that the student read it. First input includes typing, paste, and
input-method edits. Pointer movement or focus alone is not a response action.

`stage_visit_id` identifies one visit; `submission_id` links each submitted
action to a separate backend `response_stage_outcome`. The backend alone
determines acceptance or validation rejection. Delivery retries retain event
IDs and do not create duplicate observations. Client timing does not control
assessment state, scoring, answer-key access, or completion.

Initial-response and edit transport retries reuse both `client_action_id` and
the original `response_observation` link. Clicking Retry is not a new product
response or accepted submission; the backend replays the original result.
The original browser request may therefore show `request_failed` while its
linked server outcome is accepted. This indicates a delivery failure, not loss
of the saved answer. A new response after validation rejection gets a new ID.

When an answer edit adopts the former tempting option, a new tempting-evidence
turn records `tempting_evidence_reset_reason=answer_changed_to_tempting_option`
with null option/reason and `no_tempting_option=false`. This means the student
must reconsider the alternative, not that the student selected No. Earlier
turns remain unchanged. Current-state and package projections honor this reset;
unrelated edits do not cause older valid tempting evidence to disappear.
Repeated Start questions requests preserve `initial_started_at` and do not
create additional `item_presented` events.

Elapsed times use `performance.now()` within a single browser document.
`browser_tab_id` identifies the document capture, not a persistent device.
Client UTC timestamps, server receipt, and server outcome timestamps remain
separate. Reloaded documents cannot be joined by subtracting monotonic clocks.
Missing endpoints, sequence gaps, conflicting context, and unpaired visibility
or connection observations are flagged. Unknown durations remain null.

The research ZIP adds these additive tables:

- `response_submission_timing.csv`: separately paired student elapsed response,
  request wait, post-request controls wait and total system wait per submission.
  Derivation v3 exposes endpoint clocks, submission joins and quality flags.
- `response_stage_events.csv`: allow-listed observations and linked outcomes.
- `response_stage_visits.csv`: first-action/input/submission timing, accepted
  submission timing, request/UI waiting, visibility, connectivity, and counts.
- `item_behavior_summary.csv`: compact first-observed stage summaries per item.
- `response_revision_history.csv`: accepted edits with before/after values and
  phase, derived from the existing transcript rather than copied browser text.
- `feedback_exposure_events.csv`: existing display acknowledgements, not proof
  of reading, comprehension, or time spent reading.
- `response_stage_data_dictionary.csv` and `response_stage_notes.txt` explain
  the added variables and their limits.

`response_elapsed_ms` ends at the first submitted action, including a rejected
submission. `time_to_accepted_submission_ms` ends at the last submitted action
linked to an accepted outcome in that visit. `input_start_latency_ms` separates
pre-input time from input-to-submission time; neither is a direct measure of
thinking or active typing. `request_wait_ms` ends when the request finishes;
`system_wait_ms` ends when usable controls are visible again, including UI
refresh and rendering. These waiting intervals, hidden time, and stage elapsed
time overlap and must not be added together or treated as pure student work.

Explicit assessment pause/end actions remain in the authoritative lifecycle
log and also close the active visit. Returns create new visits. Gaps between
visits are not imputed as absence or thinking time. Browser close, device
shutdown, and offline delivery remain best effort. Detailed timing is not
backfilled for historical attempts; their existing V3 evidence is retained.

### Student/system timing separation (2026-10-05)

`response-stage-derivation-v3` adds submission-level separation without changing
raw observations or earlier visit/item formulas. First submission student time
starts at ready; later submissions start at the preceding controls-ready event.
Request wait runs from submit to request-finished; post-request controls wait
runs to controls-ready; their enclosing total is not an additional duration.
Pauses/hidden intervals overlap elapsed intervals and are not additive. Missing
endpoints, sequence gaps, mixed documents, unordered/overlapping submissions or
ambiguous identity yield null affected durations. Backend outcomes remain the
authority for acceptance. Dictionary formulas and raw monotonic endpoints are
included in every export. No duration is derived across browser documents.

New formative chat input uses `elapsed_monotonic_first_input_to_submit`, an
additive database enum value. The browser records the same-document monotonic
interval from first nonempty input to first Send and freezes it for transport
retries of that client message. Student UTC labels remain separate; a backwards
UTC adjustment leaves the compatibility turn-start label blank, retaining the
raw typing labels and monotonic duration. No existing rows are rewritten.
`student_input_elapsed_ms` and `model_call_latency_ms` in conversation exports
separate actors explicitly. The latter uses the linked provider call, including
provider transport overhead, not pure inference or total user-visible waiting.
Historic wall-clock student timing is flagged `legacy_wall_clock_retry_unverified`.
Unknown, restored-draft origin and unsupported method intervals stay blank;
current input may cover only the newly observed portion of a restored draft.
Full display-to-reply timing is not reconstructed. Compatibility fields stay
available and must not be summed with their new preferred aliases.

See `PROCESS_PRODUCT_ANALYTICS_GUIDE.md` for endpoint definitions, retry/pause
semantics and formulas. These changes collect timing, not engagement judgments.

Teacher Process data shows compact item timing, an expandable stage table,
and a readable timeline. Raw keystroke text, unsent draft content, other-site
URLs, screen captures, and unrelated browsing history are not collected.
Process observations are context, not diagnoses of attention, learning, or
misconduct.

The two high-frequency `response_stage_*` event types remain in ProcessEvent
and research exports, but are not recopied into pedagogical response packages
or raw profiling/follow-up provider input. Existing accepted-response,
revision, visibility, and lifecycle evidence still supplies the pedagogical
context. This separates research instrumentation from added model workload.

## Accepted Response Evidence (2026-09-22)

New response packages and research manifests identify the projection as
`response_evidence_version=accepted-response-evidence-v2`.

- `reasoning_text_initial` is the first accepted reasoning submission, not the
  first free-text utterance. Content questions, procedural questions and rejected
  text remain in the transcript but are not initial justifications. Accepted
  reasoning edits use `reasoning_text`, not their formatted chat summary.
- `answer_changed` is true when retained answer values contain a transition
  (including A -> B -> A), or the first and final accepted answers differ.
  Repeating the same answer in a confidence/reasoning edit does not count.
- Package alternative-choice evidence includes accepted package-review edits.
  A complete replacement or explicit reset supersedes the earlier alternative
  and its explanation. It never borrows a reason from another alternative.
- `item_responses.csv` represents current accepted products. Its alternative
  fields use the latest accepted student transcript record by `sequence_index`,
  even when an attempt stopped before a package was submitted. Package evidence
  is a fallback only if accepted transcript evidence is unavailable.
- `no_tempting_option` is true for an explicit No, false for a named alternative
  or a reset awaiting reconsideration, and blank when no evidence exists. False
  with blank option/reason must not be interpreted as an explicit No. Accepted
  edits now retain this flag in `previous_response` and field-level revision
  exports. Legacy missing previous values remain flagged, not reconstructed.

Previously sealed packages and original turns are not rewritten. Re-exporting
can recover current alternative fields from retained turns; it does not repair
old package baselines or regenerate their profile interpretations. Researchers
using older packages should inspect the original transcript and projection
version. A version in the export manifest describes the export projection, not
a retroactive upgrade of every historical package inside it.

## Profile Tracking Projection

The additive `understanding-summary-v2` teacher/research projection is documented
in `UNDERSTANDING_SUMMARIES.md`. It unifies summary labels and canonical profile
selection, retains original dimensions and provenance, and records its version,
reason, source profile, baseline/updated stage, original timestamp and separate
transfer status. No raw learning evidence is changed or backfilled.

Version 2 separates uncertain independence from the demonstrated-understanding
label, just as version 1 separates a fragile-reasoning focus. Eligible native
mostly-correct understanding remains "Mostly understood" even if independence is
uncertain; `understanding_caution=independent_understanding_uncertain` is retained
and transfer remains separately classified. Native partial/fragile reasoning,
supported misconceptions, insufficient evidence and invalid provenance keep their
existing precedence. Historical v1 exports remain unchanged; re-exports identify v2.

`profile-record-projection-v1` is an additive, read-only export and review
projection. It never changes stored answers, source calls, profile timestamps,
sealed packages, or historical AI interpretations. No database migration is
required for this projection.

- `profile_record_id` is `profile_` plus the first 24 hexadecimal SHA-256
  characters of the stored profile ID. Source-call public IDs, agent name,
  success/validation flags, prompt version and output schema remain attached.
- `profile_record_role` distinguishes baseline, updated and intermediate.
  `profile_validation_status` distinguishes validated, intermediate, fallback
  and unverified. Only non-intermediate, non-fallback profiles backed by a
  successful validated profiling/conversation call are eligible under
  `profile_valid_for_learning_analysis`. Eligibility is not scientific validity.
- Pipeline artifacts are retained in `agent_activity_records.csv`, not counted
  as repeated learning measurements. `misconception_indicator_count` uses the
  canonical indicators array or a supported legacy array.
  `misconception_claim_count` sums canonical `claims.length`. Unrecognized
  formats and fallback diagnoses stay blank, not zero. An explicitly empty
  supported array is zero.
- `profile_item_evidence.csv` retains per-item reasoning judgments and confidence
  with profile provenance. Original student products remain in
  `item_responses.csv`. Legacy V2 aggregate categories stay on their own
  intermediate artifact; they are not copied to a later canonical profile.
  Native `confidence_alignment` is not silently converted to the different
  legacy `confidence_calibration` vocabulary.
- Conversation exports link `initial_profile_record_id` and
  `current_profile_record_id`; transition exports link `prior_profile_record_id`
  and `updated_profile_record_id`. Current means the latest canonical transition,
  or the original baseline if there is none. Reusing the baseline is not a new
  measurement. `profile_reassessment_status` is `validated_reassessment` when a
  canonical transition exists, `reassessment_incomplete` after student turns or
  a non-active lifecycle without a transition, and otherwise `not_reassessed`.
  Pause, exit and elapsed time never manufacture a new learning outcome.
- `profile_data_dictionary.csv`, the general dictionary and the legacy JSON
  dictionary document these fields. Fallbacks display as `Profile unavailable`,
  not as a student deficit. Original fallback categories remain in raw exports
  with explicit provenance; analysis must respect their eligibility flag.

### Formative interpretation provenance, projection v2

Hosts v7.6 through v7.9 retain prior `confidence_alignment` rather than interpreting a correct
answer as a new self-confidence rating. `profile_confidence_alignment_scope`
distinguishes initial assessment, carry-forward without reassessment, legacy
unknown scope, and unavailable validation provenance. Transition CSVs include
the corresponding prior/updated scope, using each stored source call. Explicit
free-text confidence remains an observation and original transcript evidence.

`item_level_evidence_count` counts stored entries, not unique items.
`item_level_evidence_format` distinguishes linked item records from narrative
summaries. Only actual item-ID records set `item_level_evidence_available=true`;
narrative-only formative profiles are not falsely advertised as item-joinable.

Unchanged values accidentally marked updated may receive a deterministic
bookkeeping correction, never a new substantive interpretation. Preserve the
original candidate, both hashes, corrected field names, and every evidence ID.
Rejected original candidates and projection metadata survive successful retries.
See `FORMATIVE_INTERPRETATION_POLICY.md` for exact rules and limitations.

Host v7.7 also uses evidence observations of type `uncatalogued_misconception`
for a supported unresolved new/recurring error outside the retained claim
catalog. References must identify current post-profile student evidence, not
historical endorsement alone. If the model proposes a profile transition with
such an observation, the live validator requires teacher assistance with reason
`uncatalogued_misconception_requires_review` and disallows the strongest transfer
categories. Existing observation/source-call exports preserve the evidence;
this does not mint new canonical IDs or silently edit historical profiles.
Canonical claim counts are not an exhaustive count of these extra observations.
Review the evidence observations, transcript and teacher-review reason together.
The observation is an AI interpretation, not a direct behavioral measurement.

### Research dataset generation, session-spooled-export-v1

The HTTP Research dataset generator serializes session-sized chunks to private
temporary files within one RepeatableRead database snapshot. It compresses and
downloads by streaming; it does not load the entire archive into RAM. The
manifest records `generation_policy_version=session-spooled-export-v1`. This is
an operational generation version, not a new variable definition or data schema.
Row counts, file bytes, SHA-256, coverage counts, pseudonyms and restricted-field
rules are preserved. Rows may be grouped by session; join by documented IDs,
never by CSV row position. Snapshot timeout/failure does not produce a truncated
successful export. Source student records are unchanged. See
`RESEARCH_EXPORT_MEMORY_REVIEW_2026-09-26.md` for evidence, verification, cleanup
behavior and remaining capacity limitations.

### Teacher process summary v3

`process-data-summary-v3` is a teacher-facing summary, not the complete research
dataset. `export_scope=teacher_process_summary_not_full_research_dataset` makes
this distinction explicit. Existing research ZIP tables retain response
products, raw events, source calls and profile history; no extra raw-data table
or historical backfill is introduced.

Each item now carries `calculation_version`, `timing_contract_version`,
`timing_source_version`, `timing_quality` and `timing_limitations`. Read these
together with `stage_visits` and `stage_summary`. A partial item can still have
valid stage durations: for example, active typing duration may be unavailable.
Missing data remain null, not zero. The export's `definitions` describes:

- `elapsed_ms`: item answer-ready to final accepted submission using a single
  browser document's monotonic clock when available; otherwise the explicitly
  identified legacy timing contract. Elapsed time is not active work.
- `time_to_first_action_ms`: answer-ready to first recorded input or submission,
  not pointer movement or focus.
- `explanation_elapsed_ms`: reasoning-ready to last accepted submission,
  including pre-input time and pauses; not pure typing time.
- `system_wait_ms`: sum of observed submission-to-usable-controls intervals.
  These overlap stage/item elapsed intervals, so must not be added to them.
  Background initial preparation and free-text generation are separate events.
- Conversation input edits: input-change events for submitted messages, not
  answer revisions or changes of belief. They overlap whole-page typing counts.

The readable timeline and its CSV now include existing feedback-display,
background-job and conversation-generation events. Each timeline row carries
`event_type`, `event_source`, `recorded_at_field`, and available
`client_occurred_at`/`server_received_at`. `at` uses `occurred_at`, falling back
to `created_at`; the fallback is explicitly labeled. Display records also
retain `source_turn_sequence_index` and `display_event_contract_version`.
No raw event payload or arbitrary provider text is included in this projection.

`display-ack-v2` is partial viewport visibility for at least 500 ms, not proof of
reading the entire message or understanding it. `display-ack-v1` is a legacy
component-mount acknowledgement, not verified visibility. Missing versions or
acknowledgements mean unknown exposure. Generation, persistence and display are
different events. Client and server timestamps are different clocks; do not
infer a precise latency by subtracting clocks without a clock-quality check.

### Instructional question coverage and content uncertainty

Host v7.11 can record `student_question_pending`, `student_question_addressed`
and `assessment_content_ambiguity` in existing `evidence_observations` after
the opening turn. Each must cite canonical student reasoning or student
conversation evidence. Request-only turns marked `evidence_quality_context`
can establish a question, but remain ineligible to establish understanding or
resolve a misconception. These are model interpretations, not direct behavior
measurements, verified mastery or exhaustive coverage counts. An answered
question does not by itself resolve a misconception. The live interpretation
policy v3 prevents automatic completion while declared questions remain and
turns are available, except a teacher-assistance referral; student pause and
application-owned finish controls remain available. Content ambiguity cannot
support a global sound-understanding judgment.

Existing source-call/observation exports retain these records and references;
they are never part of the student message. Original provider output, mechanical
projection audit and rejected candidates remain preserved under policy v3 as
under v1/v2. Historical responses, scores, profiles and missing observations are
not rewritten. More complete semantic coverage still requires reviewer audit;
schema and citation validation cannot establish educational validity alone.

### English presentation and mixed-intent collection (2026-10-04 review)

Student metadata projections use an English fallback when an assessment/topic
title contains Han text; descriptions and objectives with Han text are omitted
from that projection. Stored content, student-authored text, item snapshots,
provider originals, and teacher/research exports remain unchanged. This is a
presentation policy, not translation of historical research evidence. Generated
student-facing conversation text and teaching artifacts are checked before
acceptance; a language violation uses the existing bounded validation/retry path.
Mathematical symbols remain permitted. Student input language is not a reason to
downgrade understanding.

Item-administration tutor v3 distinguishes a question-only request from a mixed
reason-plus-question response. For the latter, the model classifies the reason
and records `deferred_concern_summary`; the app retains the complete response and
moves to the next collection step without answering the question or confirming
correctness. These existing structured fields remain available in accepted-turn
and process-event payloads. Collection acceptance is not evidence of mastery.
Question-only requests still receive content-neutral deferral.

### Revision counts and prompt latency corrections (2026-10-04 review)

`process-data-summary-v5` recognizes both current and legacy package-review
revision events. New package-review edits emit `confidence_changed` and
`tempting_option_changed` only when the corresponding value changes, with the
before/after response payload. They replace, rather than duplicate, the older
`confidence_clicked` and `tempting_option_submitted` events in that route.

- Confidence revisions = `confidence_changed` + `confidence_selected` with
  `payload.revised=true` + legacy `confidence_clicked` whose
  `event_category=package_review` (that route emitted it only on a change).
- Alternative revisions = `tempting_option_changed` + legacy
  `tempting_option_submitted` whose `event_category=package_review`. The separate
  alternative-reason submission is not counted again as an alternative revision.
- Explanation revisions = `reasoning_revised` + `reasoning_edited`. The generic
  response-level `revision_count` is never added: it also includes edits to other
  fields. Whole-response revision counts and field counts have different grains.

Historical raw events are not renamed or backfilled. Updated derived exports
recognize the legacy event/category combinations; old downloaded summaries are
not silently rewritten. Confidence revision rules are shared by the teacher
summary, analysis-ready item rows, and legacy engagement feature exports.

`turn-response-latency-v2` adds `calculation_version` to latency JSONL/CSV rows.
For each visible prompt, select the earliest subsequent same-session/item/topic
student turn or explicitly allowlisted student-action event. Exclude system
deferrals, clarification responses, classifier decisions, follow-up completion,
and unknown `student_response` category events. Such system reactions can share
the prompt timestamp and previously produced a spurious zero-second latency.

`response_latency_ms = next_student_response_at - prompt_shown_at`;
`response_latency_seconds = round(response_latency_ms / 1000, 3)`. Missing next
actions remain null. `prompt_shown_at` is a legacy column name for the server
prompt-record timestamp, not measured browser exposure. These are elapsed
intervals, not pure reading, typing, or thinking time. Raw timestamps remain
unchanged; latency and session/item-stage timing use distinct contracts.

### Choice annotation provenance repair (2026-10-05)

`choice-annotation-normalization-v1` removes an interpretation only when its
`basis=answer_only`, its complete quote equals `selected_answer_final`, the quote
is absent from its claimed reasoning source, and no misconception links to its
interpretation ID. Selection remains in the sealed response package. This is not
a repair of substantive reasoning, a reassignment of correctness, or permission
to infer understanding from a choice. Full schema, quote, stance, coverage, and
supported-reasoning validation runs after normalization and can still reject it.

For accepted normalized calls, `raw_output` retains the original provider fields
and adds `application_normalization.version` and
`application_normalization.removed_choice_only_annotations` (item and
interpretation IDs). `output_payload` holds the validated effective result.
Earlier failed calls, student responses, and original exports remain unchanged.

### Missing process observations (2026-10-05 synthetic journeys)

`process-data-summary-v6` distinguishes missing conversation input telemetry from
observed zero actions. `conversations[].edits`, `backspaces`, and `paste_actions`
are null when `messages_with_input_telemetry=0`. Otherwise each is the sum of its
recorded per-message count. A recorded zero stays zero. `input_telemetry_coverage`
is `not_recorded` with no input rows, `partial` with fewer rows than student turns,
and `complete` when all student turns have rows. Partial sums cover observed
messages only, not an estimate for missing messages. Browser-unobserved attempts
also have null `assessment_view_open_count`, rather than a fabricated zero.

The readable label for `item_presented` is "Item made available": this server
event is not a browser-display receipt. Raw events, student responses and
historical downloads are unchanged. The teacher page already distinguishes
missing input telemetry; this version aligns the JSON summary with that display.

### Initial profile item identities (2026-10-05 synthetic journeys)

`chat-native-formative-profile-output-v4` specializes the generation schema for
each sealed response package: `semantic_item_reviews[].item_public_id` is an enum
of its actual response IDs, and the number of reviews equals the number of
submitted items. Source packages require 1-12 distinct, nonblank IDs. Subsequent
coverage validation still rejects duplicates, and quote/stance validation still
requires evidence belonging to the corresponding item. An invalid generated ID
is never reassigned using position, similar spelling, or inferred meaning.

This change constrains generation before acceptance; it does not fabricate
reasoning, alter scoring, change student AI limits, or rewrite past failed calls.
Original provider output and effective validated output retain their established
audit paths. The schema version on each new AgentCall identifies this contract.

### Lossless AI request projection (2026-10-05)

The four interpretation/feedback/conversation roles can send
`lossless-agent-json-v1` at the provider boundary. Expanded input payloads,
student responses, process records, and evidence identities stay unchanged.
`raw_output.input_projection` records encoding, source/wire SHA-256 hashes,
UTF-8 byte lengths, definition/reference/table counts, and round-trip validation.
Central agent execution also records `agent_input_projection_prepared`; direct
provider paths retain the raw-output audit. Source text is not added to these
audit fields. Earlier records and pre-response transport failures may lack them.

See [AI input deduplication](AI_INPUT_DEDUPLICATION.md) for exact definitions,
fallback behavior, request-body reduction formulas, token-accounting caveats,
and the narrowly approved Sol low-reasoning configuration. Compression metrics
are implementation measures, not student behavior or learning outcomes.

### Return-visit pause context (2026-10-05 review)

`participation-observation-v2` records `participation_window_started_at` and
`display_receipt_scope` in the shared teacher/research pause projection. Only a
matching tutor receipt in the current window produces `display_receipt_to_pause_ms`.
The window begins at the latest conversation start, assessment resume/view-open,
or this conversation's resume/reentry at or before the pause. An older receipt
remains stored in the projection for provenance; its interval is null rather than
counting days away as current-visit time. Both receipt and pause use server clocks.

`process-data-summary-v7` separates conversation-only pause/resume counts from
assessment pause episodes linked to that conversation, adds the public join IDs,
and exposes the recorded conversation end time. Student messages remain actual
persisted messages; closing with no reply creates neither participation nor a
learning claim. The scopes overlap and are not additive. The shared pause CSV
dictionary contains the same formulas as the teacher download. Raw events,
products, profiles, old downloads and conversation content are unchanged.

### Participation boundary corrections (2026-10-05 follow-up)

`process-data-summary-v8` derives core assessment pause/resume totals from the
shared episode projection rather than counting raw lifecycle rows. Pauses count
assessment-scope episodes; resumes count episodes with a matched same-scope return
before termination. Duplicate aliases and unmatched returns remain available as
raw events but do not inflate these totals. Conversation-only raw counters retain
their original definition. All summary endpoint activity uses server-receipt
timestamp priority, including compatibility conversation inputs.

`participation-observation-v3` resolves equal-time canonical lifecycle records
before aliases, preserving the canonical topic context independently of row order.
Tutor-display joins require a positive safe integer or digit-only string index,
a matching saved tutor turn, and a receipt at or after both conversation and turn
creation. The same receipt validation drives conversation participation and pause
context. Historical source events are preserved; regenerated projections carry
their versions. See `PROCESS_PARTICIPATION_OBSERVATIONS.md` for formulas.

### Local draft continuity and completion (2026-10-05)

Unsent composer text is a browser-tab convenience, not submitted product data.
It is not uploaded to the research dataset. Restoring text or a reading position
does not synthesize keystrokes, paste events, submissions, or conversation turns.
Response-stage timing and input counters retain their existing visit scope;
counts after refresh do not reconstruct typing from a previous visit. Feedback
exposure still requires the existing visible-content observation, not draft or
scroll restoration alone. These changes do not backfill historical events.

The final `Finish assessment` confirmation can issue two server requests:
conversation end followed by authorized assessment completion. The existing
distinct lifecycle events and timestamps remain intact. A failure between these
requests leaves completion retryable, rather than inferring completion from the
button click. Pause-and-leave retains its existing assessment pause event. Raw
event counts, attempt limits, profiling rules and research export schemas are
unchanged by this presentation update.

### Research suitability contract (2026-10-05)

This export-only revision preserves raw observations and historical packages.
There is no new student task, research-consent decision, automated diagnosis,
human rating, experimental allocation or production record migration.

- `research-csv-v2`: true/false serialize as the literal strings `true`/`false`;
  null/undefined serialize as empty. Formula-like spreadsheet cells remain escaped.
  Old supplemental CSVs conflated false and missing; re-export from retained
  sources instead of guessing how to replace historical blanks.
- `profile-record-projection-v3`: `profile_provenance_eligible` is the preferred alias
  for `profile_valid_for_learning_analysis`. Both have the identical existing
  provenance rule (source validation, success, fallback and stage exclusions).
  The old name is deprecated, not deleted. Eligibility is not diagnostic validity.
- Sealed baseline exports include the three tempting-option fields from the
  first submitted package. Missing old fields remain blank and are never filled
  from a later mutable response.
- `item_pair_id = "pair_" + SHA256(JSON.stringify([research_student_id,
  assessment_public_id, from_session_public_id, to_session_public_id, item_key]))`.
  View labels are omitted intentionally so overlapping comparison views share an
  ID. Matching rules and scores are unchanged; analysts choose the intended view
  or deduplicate item pairs before pooling. Latest means latest observed.
- Coverage adds collection status/guidance without changing observed counts.
  Uninstrumented active-time/idle fields remain blank; compatibility columns move
  to the supplementary dictionary. Population is not evidence of validity.
- `research-study-templates-v1` supplies optional external cohort-review,
  human-coding and outcome worksheets plus a dedicated dictionary. Blank research
  fields are never populated from AI claims. Worksheets are excluded from
  coverage and contain no added student response text. Human-review case IDs use
  SHA-256 of JSON `[session_public_id, item_snapshot_key]` for stable linkage.

See `PROCESS_PRODUCT_ANALYTICS_GUIDE.md` for interpretation and joining rules.
The manifest declares serialization, measurement-availability, template and
profile projection versions. Timing formulas continue to use each row's actual
method/version; top-level legacy timing versions are fallback descriptions only.

The teacher dashboard and its CSV label the existing sum of positive recorded
item durations as `recorded_item_response_ms`, replacing the misleading
`active_interaction_ms` label. Values and included attempts are unchanged.
Missing item intervals are omitted; pauses may be included and the separate
learning conversation is excluded. If no recorded item totals are available,
the existing start-to-completion wall-clock fallback remains separately labeled.
Neither metric measures active attention; no value is copied into uncollected
research active-time fields.
