# Teacher Session Review

Phase 5A adds a read-only teacher_researcher platform for reviewing existing assessment-session records. It is for research audit and classroom review, not intervention editing.

## Routes

- `/teacher/dashboard`: navigation entry for content management, student sessions, data/outcomes, and JSON import.
- `/teacher/sessions`: searchable, filterable session list.
- `/teacher/sessions/[sessionPublicId]`: one-session detail review.

All routes require `teacher_researcher` authentication. Student users are redirected away from pages and receive 403 from teacher-review APIs.

## APIs

- `GET /api/teacher/sessions`
- `GET /api/teacher/sessions/[sessionPublicId]`
- `GET /api/teacher/sessions/[sessionPublicId]/item-responses`
- `GET /api/teacher/sessions/[sessionPublicId]/transcript`
- `GET /api/teacher/sessions/[sessionPublicId]/process-events`
- `GET /api/teacher/sessions/[sessionPublicId]/response-packages`
- `POST /api/teacher/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/run-profiling`
- `POST /api/teacher/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/run-planning`
- `POST /api/teacher/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/start-followup`
- `POST /api/teacher/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/run-followup-update`
- `POST /api/teacher/sessions/[sessionPublicId]/automation/pause`
- `POST /api/teacher/sessions/[sessionPublicId]/automation/resume`
- `POST /api/teacher/sessions/[sessionPublicId]/automation/retry`
- `POST /api/teacher/sessions/[sessionPublicId]/automation/stop-followup`

Normal API responses use public IDs such as `session_public_id`, `assessment_public_id`, `concept_unit_public_id`, `item_public_id`, and `users.user_id`. Internal UUIDs, password hashes, access-code hashes, cookies, auth tokens, and environment values are not returned.

## Session List

The session list supports:

- search by student `user_id`
- assessment filter
- session status filter
- current phase filter
- needs-review filter
- sorting by started time, last activity, or completion time
- server-side pagination

Rows show student `user_id`, assessment title, attempt number, status, current phase, concept-unit progress, item-response count, activity timestamps, needs-review state, and a View session action. The list does not rank students or label ability.

Phase 6D2A rows also show workflow mode snapshot, automation state, pending workflow-job count, and failed workflow-job count.

## Session Detail

The detail view has tabs for:

- Overview
- Item responses
- Conversation transcript
- Process events
- Response packages
- Future agent data

The overview shows public session ID, student `user_id`, assessment title, attempt number, status, phase, timestamps, current concept unit, concept-unit progress, item-response count, content lock state, response-package count, and needs-review state.

Phase 6D2A overview also shows automatic workflow state, workflow-job summaries, append-only override history, and teacher exception controls. Manual-review sessions keep the existing manual profiling/planning/follow-up buttons. Automatic sessions normally hide those manual buttons and instead offer pause, resume, retry current step, or stop follow-up when the session state allows it.

Phase 6D2B detail also shows follow-up update-cycle history. A cycle row shows public cycle ID, trigger type, status, final-update flags, evidence cutoff time, whether profile/planning/opening outputs are staged, whether active pointers changed, and failure stage/category/message when present. Staged outputs are audit data and must not be treated as current profile or planning records unless the cycle status is `completed`.

## Item Responses

Item responses are grouped by concept unit and ordered by concept-unit `order_index` and item `item_order`.

Teacher_researcher users may view correctness, selected option, correct option snapshot, student reasoning, confidence, skip flags, revision count, missing-evidence repair state, timing, submitted timestamps, administered item snapshots, and current content version.

The UI distinguishes:

- unanswered
- explicitly skipped
- answered correctly
- answered incorrectly
- response not finalized

Skipped or missing evidence is not collapsed into incorrect evidence.

## Transcript

The transcript displays chronological conversation turns with actor type, phase, timestamp, concept-unit association, item association, optional future follow-up round, message text, and safe structured payload JSON.

Transcript content is treated as untrusted text. The UI does not render transcript messages as HTML.

## Process Events

The process-event tab shows a chronological timeline with event type, category, source, timestamp, item/concept-unit association, duration fields, and collapsed raw technical payloads.

Neutral aggregate cards include:

- page switch count
- long pause count
- inactivity count
- navigation event count
- invalid help request count
- prompt injection attempt count
- procedural clarification count
- emotional response count
- reasoning revision count
- option revision count
- validation failure count
- agent retry count
- follow-up turn count

Process events are contextual evidence for engagement and evidence sufficiency. They are not misconduct labels. Phase 5A does not infer independence or make diagnostic judgments from process traces.

## Response Packages

The response-package tab shows package type, creation time, concept-unit public ID, sequence, a readable summary, and collapsed full stored JSON.

For `initial_concept_unit_response_package`, the summary includes concept-unit metadata, item count, completed response count, skipped response count, correctness distribution, confidence distribution, revision count, process-event counts, transcript-turn count, and initial completion time.

Response packages are read-only. They are not sent to an LLM in Phase 5A.

## Snapshot Auditability

Where available, Phase 5A shows administered snapshots from `item_responses.item_snapshot` and compares them with current content version fields. Reviewers should not assume current content is identical to the content administered to a student.

## Future Agent Data

Phase 6B activates Student Profiling Agent review data. Phase 6C activates Formative Value and Planning Agent review data after a saved profile exists. Phase 6D1 activates first-round Follow-up Agent conversation review after a saved formative decision exists.

When a concept-unit session is eligible and the assessment session is in `profiling_pending`, teacher_researcher users may run profiling from the Future agent data tab. The trigger:

- requires teacher_researcher authentication
- rejects student and unauthenticated users
- uses route public IDs
- runs the backend Student Profiling Agent service
- returns a public-safe profile summary
- does not expose provider secrets, hidden prompts, or internal UUIDs

After profiling succeeds, the teacher review page displays the saved profile fields:

- ability profile and pattern flags
- engagement profile and pattern flags
- integrated diagnostic profile, confidence, and rationale
- evidence sufficiency
- confidence alignment
- independence interpretability
- misconception indicators
- item-level evidence
- reasoning and engagement summaries
- process interpretation cautions
- profile confidence, rationale, and recommended next evidence
- based-on agent-call metadata without secrets

Process flags and timing context remain evidence-context fields. The UI must not label cheating, dishonesty, confirmed GenAI use, or misconduct.

When a concept-unit session has a saved profile and the assessment session is in `profiling_completed` or `planning_pending`, teacher_researcher users may run formative planning from the Future agent data tab. The trigger:

- requires teacher_researcher authentication
- rejects student and unauthenticated users
- uses route public IDs
- runs the backend Formative Value and Planning Agent service
- returns a public-safe formative decision summary
- does not expose provider secrets, hidden prompts, internal UUIDs, raw response-package payloads, or environment values
- does not create follow-up rounds or deliver student activities

After planning succeeds, the teacher review page displays the saved decision fields:

- formative value
- formative action plan
- target evidence
- success criteria
- follow-up prompt constraints for a future Follow-up Agent
- profile update triggers for a future iterative profiling phase
- rationale and mapping-deviation metadata
- based-on agent-call metadata without secrets

The UI must not show planning data as direct student feedback and must not label cheating, dishonesty, confirmed GenAI use, or misconduct.

When a concept-unit session has a saved profile, saved formative decision, no active follow-up round, and the assessment session is in `planning_completed`, teacher_researcher users may start the first follow-up round from the Future agent data tab. The trigger:

- requires teacher_researcher authentication
- rejects student and unauthenticated users
- uses route public IDs
- runs the backend Follow-up Agent service
- creates an auditable `followup_rounds` attempt and activates it only after a valid opening message is generated
- does not expose provider secrets, hidden prompts, internal UUIDs, raw provider configuration, or raw environment values
- does not update profiles, rerun planning, create evidence packages, or move to the next concept unit

After follow-up starts, the teacher review page displays saved follow-up round data:

- round index and status
- started and completed timestamps
- formative decision reference
- chronological follow-up transcript
- trusted structured action metadata
- follow-up agent-call audit metadata
- mock-output notice when the provider was mock

The UI must not show follow-up process flags as misconduct and must not infer independence from process context.

In Phase 6D2B, meaningful follow-up evidence can start an update cycle:

- automatic sessions enqueue backend jobs without the teacher dashboard staying open
- manual-review sessions are flagged as evidence ready and expose `Run follow-up update`
- updated profiling and planning outputs are staged first
- a new active follow-up round opens only after profiling, planning, and opening generation all succeed
- final stop updates do not create a next round
- failed cycles preserve audit records, keep previous active profile/decision pointers, and show teacher exception details

The Future agent data section shows empty states when planning or follow-up records do not exist. It must not show enum defaults as actual planning or follow-up outputs.

## Demo Fixture

Create the development-only teacher-review fixture:

```bash
npm run demo:teacher-review
```

It creates or recreates fixture-owned records for:

- `teacher_demo`
- `student_demo`
- one demo assessment
- one published concept unit
- exactly 3 included items
- one assessment session in `profiling_pending`
- mixed item responses
- conversation turns
- process events
- one initial response package

It does not call OpenAI and does not create profiles, formative decisions, follow-up rounds, or agent calls.

Cleanup only fixture-owned records:

```bash
npm run demo:teacher-review:cleanup
```

Demo users are preserved.

## Smoke Test

Run:

```bash
npm run teacher:review-smoke
```

The smoke test verifies listing, search, status and phase filters, pagination, public-ID serialization, absence of internal UUID keys, item-response ordering, correctness visibility, skipped evidence distinction, chronological transcript and process events, aggregate counts, response-package summary, non-mutating package reads, absence of fabricated profiles/decisions, no OpenAI calls, and cleanup behavior.

## Related Data Management

Phase 5B adds `/teacher/data`, `/teacher/data/summative-outcomes`, and `/teacher/data/export` for supervised outcome import and the merged master CSV export. The session-review pages remain read-only and do not edit student answers, process events, response packages, profiles, or formative decisions.

Phase 6B may populate `agent_calls` and `student_profiles` for Student Profiling Agent execution. Phase 6C may populate `agent_calls` and `formative_decisions` for Formative Value and Planning Agent execution. Phase 6D1 may populate `followup_rounds`, follow-up conversation turns, process events, and `agent_calls.followup_round_db_id` through backend-only integration using environment-configured model names.

Phase 6D3 may populate `concept_progression_records`. Teacher session review displays progression history read-only. It does not expose approve, deny, advance, complete, reopen, edit, or force-move controls for active student sessions. Active-session intervention controls are hidden and rejected unless `DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED=true`.
