# Formative Value And Planning Agent

Phase 6C integrates only the Formative Value and Planning Agent after a valid saved Student Profiling Agent output exists.

## Scope

The service converts one saved `student_profiles` record plus the matching `initial_concept_unit_response_package` into one validated `formative_decisions` row.

It does not create follow-up rounds, deliver follow-up activities, update the profile, modify item responses, change correctness, send feedback to students, alter the master CSV export, or call OpenAI during normal verification.

## Approved Formative Values

The agent must select exactly one fixed enum value:

- `diagnostic_clarification`
- `reasoning_refinement`
- `confidence_calibration`
- `independent_understanding_verification`
- `consolidation_or_transfer`

Free-form formative labels are rejected.

## Default Mapping

Phase 6C uses a central integrated-profile-to-formative-value mapping as a strong guide:

- `insufficient_evidence_for_formative_decision` -> `diagnostic_clarification`
- `low_engagement_limits_interpretability` -> `diagnostic_clarification`
- `conflicting_evidence_needs_clarification` -> `diagnostic_clarification`
- `developing_understanding_with_productive_engagement` -> `reasoning_refinement`
- `misconception_with_sufficient_engagement` -> `diagnostic_clarification`
- `correct_but_fragile_understanding` -> `reasoning_refinement`
- `correct_but_independence_uncertain` -> `independent_understanding_verification`
- `underconfident_but_reasoning_supported` -> `confidence_calibration`
- `robust_understanding_ready_for_transfer` -> `consolidation_or_transfer`

If the agent follows the mapping, `mapping_followed` must be `true` and `mapping_deviation_reason` must be empty. If it selects a different formative value, `mapping_followed` must be `false` and `mapping_deviation_reason` must provide a substantive explanation.

## Input Evidence

`FormativePlanningInput` is built from allowlisted backend records:

- latest saved student profile
- latest initial concept-unit response package
- public assessment, session, concept-unit, and item metadata
- safe administered item metadata
- previous safe formative-decision summaries for the same concept-unit session
- approved formative values
- default mapping and planning constraints

The builder does not pass raw Prisma objects to the provider.

Excluded fields include password hashes, access-code hashes, cookies, authorization headers, API keys, database URLs, session secrets, internal auth tokens, unrelated summative outcomes, and unnecessary internal UUIDs.

## Execution

The central service is:

```ts
runInitialFormativePlanning({
  concept_unit_session_db_id,
  requested_by_user_db_id?,
  invocation_reason
})
```

It verifies a latest profile exists, verifies an initial response package exists, builds safe input, transitions the session to `planning_pending` when needed, calls `executeAgent`, validates `FormativePlanningOutput`, runs semantic validation, writes `formative_decisions`, updates `concept_unit_sessions.latest_formative_decision_db_id`, and transitions the session to `planning_completed`.

If execution is refused, incomplete, invalid, failed, semantically invalid, or blocked by the usage guard, no formative decision or follow-up round is created.

## Teacher Trigger

Teacher-only API:

```text
POST /api/teacher/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/run-planning
```

The route uses public IDs, requires `teacher_researcher`, rejects students with 403, and returns only public-safe decision summaries. It does not expose hidden prompts, provider secrets, internal UUIDs, raw provider configuration, or raw environment values.

## Student UI

Students do not see formative values, action plans, target evidence, success criteria, profile labels, correctness, or rationales.

After planning completes, the student UI may show only:

```text
A support plan has been prepared. Interactive follow-up is not available yet in this prototype.
```

## Idempotency

Planning uses an invocation key derived from the concept-unit session, saved profile, response package, prompt version, schema version, and prompt hash. Repeating the same successful planning trigger returns the existing decision instead of creating a duplicate.

## Audit Logging

`agent_calls` records provider, model, prompt/schema versions, prompt hash, redacted input, raw and parsed output, validation status, retry count, usage guard snapshot, live-call allowance, token usage when available, and timing.

Process events are logged for planning start, success, failure, and schema validation outcomes.

## Mock And Live Behavior

Default local behavior:

```text
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
```

The mock provider returns schema-valid planning output for infrastructure and UI testing only. Mock output is not validated educational guidance.

Live OpenAI planning can occur only when server-side configuration explicitly enables:

```text
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPENAI_API_KEY
OPENAI_MODEL_PLANNING
```

The usage guard must also allow the call. Browser code never receives provider credentials or model configuration.

## Verification

Run:

```bash
npm run agent:planning-smoke
```

The smoke test verifies safe input building, prohibited field exclusion, default mapping derivation, execution through `executeAgent`, agent-call audit, schema and semantic validation, decision persistence, latest decision pointer update, phase transition to `planning_completed`, teacher serializer behavior, student payload safety, idempotency, mapping-deviation handling, invalid-output handling, usage-blocked handling, teacher API authorization, and absence of follow-up rounds and OpenAI network calls.
