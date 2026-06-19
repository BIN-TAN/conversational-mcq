# Teacher Session Review

Phase 5A adds a read-only teacher_researcher platform for reviewing existing assessment-session records. It is for research audit and classroom review, not intervention editing.

## Routes

- `/teacher/dashboard`: navigation entry for content management, student sessions, and JSON import.
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

## Session Detail

The detail view has tabs for:

- Overview
- Item responses
- Conversation transcript
- Process events
- Response packages
- Future agent data

The overview shows public session ID, student `user_id`, assessment title, attempt number, status, phase, timestamps, current concept unit, concept-unit progress, item-response count, content lock state, response-package count, and needs-review state.

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

Phase 5A does not create or simulate:

- student profiles
- formative decisions
- follow-up rounds
- LLM agent calls

The Future agent data section shows empty states when these records do not exist. It must not show enum defaults as actual profile or planning outputs.

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

## Future Work

Phase 5B may add the merged master CSV export. A later phase may add summative outcome upload and linkage. Later agent phases may populate `agent_calls`, `student_profiles`, `formative_decisions`, and `followup_rounds` through backend-only OpenAI integration using environment-configured model names.
