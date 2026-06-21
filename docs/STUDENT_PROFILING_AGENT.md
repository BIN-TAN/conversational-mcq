# Student Profiling Agent

Phase 6B integrates only the Student Profiling Agent after initial concept-unit administration. Phase 6C may consume the saved profile as planning input, but it must not modify or regenerate the profile.

## Scope

The service converts one `initial_concept_unit_response_package` into one validated `student_profiles` record. It does not create follow-up rounds, student feedback, explanations, tutoring, or CSV-inferred profile values.

Phase 6C creates a separate `formative_decisions` row only after a valid saved profile exists. That planning step is downstream of profiling and preserves the saved profile audit record unchanged.

The profile has three connected layers:

- `ability_profile`
- `engagement_profile`
- `integrated_diagnostic_profile`

Correctness is evidence, not the profile itself. Process data are contextual evidence for engagement and evidence sufficiency, not misconduct evidence.

## Input Evidence

`StudentProfilingInput` is built from allowlisted backend records:

- assessment and concept-unit public metadata
- initial response package payload
- item responses, correctness values, reasoning, confidence, skip flags, revisions, and timing
- administered item snapshots
- teacher-side item metadata such as distractor rationales, expected reasoning patterns, and possible misconception indicators
- initial conversation turns
- process-event aggregates and relevant process events
- profiling constraints

The builder does not pass raw Prisma objects to the provider.

Excluded fields include password hashes, access-code hashes, cookies, authorization headers, API keys, database URLs, session secrets, internal auth tokens, unrelated summative outcomes, and unnecessary internal UUIDs.

## Execution

The central service is:

```ts
runInitialStudentProfiling({
  concept_unit_session_db_id,
  requested_by_user_db_id?,
  invocation_reason
})
```

It verifies completed initial administration, uses or recreates the latest initial response package, builds safe input, calls `executeAgent`, validates `StudentProfileOutput`, writes `student_profiles`, updates `concept_unit_sessions.latest_student_profile_db_id`, and transitions the session from `profiling_pending` to `profiling_completed`.

If execution is refused, incomplete, invalid, failed, or blocked by the usage guard, no profile is created.

## Mock And Live Behavior

Default local behavior:

```text
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
```

The mock provider returns a schema-valid profile for infrastructure and UI testing only. Mock output is not validated research inference.

Live OpenAI profiling can occur only when server-side configuration explicitly enables:

```text
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPENAI_API_KEY
OPENAI_MODEL_PROFILING
```

The usage guard must also allow the call. Browser code never receives provider credentials or model configuration.

## Teacher Trigger

Teacher-only API:

```text
POST /api/teacher/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/run-profiling
```

The route uses public IDs, requires `teacher_researcher`, rejects students with 403, and returns only public-safe profile summaries. It does not expose hidden prompts, provider secrets, internal UUIDs, or raw environment values.

## Student UI

Students do not see profile labels or correctness. After profiling completes and before planning completes, the student UI shows only neutral progress copy. After Phase 6C planning completes, students still do not see profile or planning labels. The student UI may show:

```text
A support plan has been prepared. Interactive follow-up is not available yet in this prototype.
```

## Idempotency

Profiling uses an invocation key derived from the concept-unit session, response package, profile type, prompt version, schema version, and prompt hash. Repeating the same successful profiling trigger returns the existing profile instead of creating a duplicate.

## Audit Logging

`agent_calls` records provider, model, prompt/schema versions, prompt hash, redacted input, raw and parsed output, validation status, retry count, usage guard snapshot, live-call allowance, token usage when available, and timing.

Process events are logged for agent start, success, failure, and schema validation outcomes.

## Verification

Run:

```bash
npm run agent:profiling-smoke
```

The smoke test verifies safe input building, prohibited field exclusion, mock execution through `executeAgent`, agent-call audit, validated output persistence, latest profile pointer update, phase transition to `profiling_completed`, teacher serializer behavior, student payload safety, idempotency, invalid-output handling, usage-blocked handling, teacher API authorization, and absence of formative decisions, follow-up rounds, and OpenAI network calls.
