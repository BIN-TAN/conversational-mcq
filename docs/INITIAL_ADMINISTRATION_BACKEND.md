# Initial Administration Backend

Phase 4A implements the backend foundation for student initial administration only. It does not implement the ChatGPT-style student UI, OpenAI integration, LLM agents, profiling, formative planning, follow-up, teacher session review, or CSV export.

## Availability

Authenticated students can list available assessments with:

```text
GET /api/student/assessments/available
```

An assessment is student-available when it is `published`, not archived, and has at least one published concept unit that passes the Phase 3C structural checks. The student response includes public assessment metadata, whether a session already exists, and whether the student can start or resume. It does not expose answer keys, correctness, distractor rationales, reasoning expectations, misconception indicators, teacher-only administration metadata, or internal UUIDs.

## One Attempt In V1

Phase 4A uses `assessment_sessions.attempt_number = 1` as the default v1 attempt. The database uniqueness rule is:

```text
user_db_id + assessment_db_id + attempt_number
```

This prevents duplicate default attempts while preserving future support for teacher-authorized retakes with attempt 2 or later. Phase 4A does not implement retake authorization.

## Atomic Start And Resume

Students start or resume through:

```text
POST /api/student/assessments/[assessmentPublicId]/sessions/start
```

The service runs in a serializable transaction. It verifies publication/governance state, finds an existing non-completed attempt-1 session if one exists, rejects completed attempts, creates a session otherwise, selects the first published concept unit by teacher-defined `order_index`, creates or reuses the concept-unit session, logs `session_started` or `session_resumed`, and returns only public, student-safe state.

Repeated Start requests resume the same existing session. A unique-conflict or serialization conflict is handled conservatively by retrying or returning a structured conflict.

## Resume Behavior

Take-home assessments can be exited and resumed. If a student exits, the service stores `resume_phase` and `resume_context` before moving the session to `student_exited`. On resume, the backend derives the current interaction state from trusted database state:

- assessment session
- current concept unit
- item responses
- selected option
- reasoning text
- confidence rating
- missing-evidence repair state
- submitted/skipped items
- concept-unit completion state

The client cannot choose the assessment phase, current item, or next step.

## Deterministic Next Step

The initial administration state service returns one of:

```text
concept_unit_intro
present_item
request_reasoning
request_confidence
missing_evidence_repair
item_complete
initial_concept_unit_complete
awaiting_profiling
```

This is an orchestration boundary. A future Response Collection Agent may generate natural language inside the allowed step, but it must not change phases, answer keys, evidence requirements, no-feedback rules, or session ownership checks.

## Student-Safe Serialization

Student-facing serializers allow only public and administration-safe fields. A student item payload may include:

- `item_public_id`
- `item_order`
- `item_stem`
- `options`
- `item_version`
- existing selected option, reasoning, and confidence
- submission state

Student payloads must not include internal UUIDs, answer keys, correctness, distractor rationales, expected reasoning patterns, possible misconception indicators, teacher-only administration rules, profile labels, or formative decision labels. Serializer assertions and smoke tests check this at the backend boundary.

## Item Response Actions

Phase 4A exposes explicit backend routes for later conversational UI actions:

```text
POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/option
POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/reasoning
POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/confidence
POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/submit
```

Each route requires student authentication, session ownership, the current concept unit, a published included item, and a valid current phase. The backend calculates correctness and never accepts correctness from the client. Correctness is stored for research use but not returned during initial administration.

## Revision Policy

Initial responses may be revised until the concept unit's initial administration is completed. The current `item_responses` row stores the latest selected option, reasoning, and confidence. Process events and conversation turns preserve history. `revision_count` increments when a meaningful option, reasoning, confidence, or submitted response changes.

After `concept_unit_sessions.initial_completed_at` is set, all initial response mutations are rejected with:

```text
initial_response_locked_after_concept_completion
```

Later follow-up evidence must be stored separately and must not overwrite initial item responses.

## Missing Evidence And Skips

Submitting an incomplete item first returns:

```json
{
  "submission_status": "missing_evidence_repair_required",
  "missing_fields": ["answer", "reasoning", "confidence"]
}
```

The backend records that repair was offered. If the student later provides the missing evidence, the item can submit normally. If the student deliberately confirms skipping, the backend records explicit skipped flags and finalizes the item without inventing evidence.

Supported skip semantics:

- `skip_item`
- `skip_reasoning`
- `skip_confidence`

A skipped whole item stores `correctness = unanswered`, not `incorrect`.

## Completion And Response Package

Initial concept-unit completion uses:

```text
POST /api/student/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/complete-initial
```

Completion requires every published included item to have a finalized response or explicit skip. On success, the backend sets `initial_completed_at`, transitions through `initial_concept_unit_completed` to `profiling_pending`, creates exactly one `initial_concept_unit_response_package`, and returns a student-safe awaiting state.

In Phase 6D2A, if `assessment_sessions.workflow_mode_snapshot = automatic`, completion also enqueues the asynchronous `run_initial_profiling` workflow job. Manual-review sessions do not enqueue jobs and continue to wait for teacher-triggered profiling.

The response package is backend/research data. It includes public assessment metadata, concept-unit metadata, included item metadata, item snapshots, selected options, backend correctness, reasoning, confidence, skipped flags, revision counts, timing, conversation turns, process events, and process-event aggregations. It is not returned to the student.

## Process Events

Students can submit browser-context events with:

```text
POST /api/student/sessions/[sessionPublicId]/events
```

Allowed browser event types are:

- `page_hidden`
- `page_visible`
- `long_pause`
- `inactivity_detected`
- `navigation_event`
- `refresh_recovery`

The backend forces `event_source = frontend`, uses server receipt time as canonical `occurred_at`, preserves any client timestamp in payload context, validates duration fields, limits payload size, and limits batch size.

Browser clients cannot assert trusted backend/system/agent labels such as `invalid_help_request`, `prompt_injection_attempt`, validation errors, scoring events, or agent events. Process data remain engagement and evidence-sufficiency context, not misconduct labels.

## Ownership And Idempotency

Every student assessment route requires the `student` role and verifies session ownership. Another student receives a not-owned safe error. Teacher researchers cannot use student session routes through the API role guard.

Public IDs are used in routes:

- `assessment_public_id`
- `session_public_id`
- `concept_unit_public_id`
- `item_public_id`

Internal UUIDs remain service/database details.

Repeated item actions can include `client_action_id`. The backend stores a request hash in `student_action_idempotency_keys`; a repeated identical action returns the same safe payload without duplicating events or revisions, and a repeated key with a different request returns `idempotency_conflict`.

Repeated concept-unit completion does not create duplicate initial response packages.

## API Routes

```text
GET  /api/student/assessments/available
POST /api/student/assessments/[assessmentPublicId]/sessions/start
GET  /api/student/sessions/[sessionPublicId]/state
POST /api/student/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/start
POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/option
POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/reasoning
POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/confidence
POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/submit
POST /api/student/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/complete-initial
POST /api/student/sessions/[sessionPublicId]/events
POST /api/student/sessions/[sessionPublicId]/exit
```

## Phase Boundary

Phase 4A is not the final rule-based conversational experience. The existing student assessment page can remain a placeholder. Phase 4B may build the ChatGPT-style interface on top of these route boundaries, and later phases may add Response Collection Agent language generation, profiling, planning, and follow-up. Those later components must still obey the deterministic backend phase, ownership, no-answer-leak, and no-feedback rules defined here.

## Phase 4B UI Integration

Phase 4B adds the student-facing UI on top of this backend contract. The backend still owns state, order, allowed actions, correctness calculation, locking, and missing-evidence requirements.

Additional student-safe read endpoints support the UI:

```text
GET /api/student/sessions/[sessionPublicId]/review
GET /api/student/sessions/[sessionPublicId]/transcript
```

The review endpoint returns safe item stems, options, latest selected option, latest reasoning, latest confidence, submission state, missing fields, and read-only/editable status. It does not return correctness, answer keys, rationales, expected reasoning, misconception indicators, profile labels, or internal UUIDs.

The transcript endpoint returns student-authored transcript entries only, with safe message text, public item IDs where relevant, created time, and interaction type. It does not expose raw structured payloads, process-event payloads, agent/debug metadata, or teacher-only metadata.

Phase 4B also refines explicit skip handling so skipping reasoning before confidence can save the skipped reasoning flag and continue to the confidence step rather than prematurely finalizing the full item. Whole-item skip and final missing-evidence confirmation still finalize through the submit endpoint.

## Phase 6D2A Availability And Automatic Workflow

New starts now check assessment release and closing dates in addition to publication and content validity. Existing sessions may resume after release/close changes and after the closing date. The backend does not implement countdowns, time limits, auto-submit, or session expiration.

Automatic workflow jobs run after initial completion only when the session snapshot is `automatic`. The student browser does not execute profiling, planning, or follow-up startup.
