# Formative Value And Planning Agent

Phase 6C integrates the Formative Value and Planning Agent after a valid saved Student Profiling Agent output exists. Phase 6D1 may consume the saved decision as input to the Follow-up Agent. Phase 6D2B may run an updated planning candidate from staged follow-up profile output, but that candidate is staged first and is not an active formative decision until the entire update cycle succeeds.

## Scope

The initial service converts one saved `student_profiles` record plus the matching `initial_concept_unit_response_package` into one validated `formative_decisions` row.

It does not create follow-up rounds, deliver follow-up activities, update the profile, modify item responses, change correctness, send feedback to students, alter the master CSV export, or call OpenAI during normal verification. Phase 6D1 creates follow-up rounds downstream from a saved decision without changing this planning record.

Phase 6D2B updated planning consumes the staged updated profile output and follow-up evidence package. The updated planning output is staged on `followup_update_cycles`; it does not update `latest_formative_decision_db_id` unless finalization succeeds.

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

## Automatic Workflow

Phase 6D2A may run the same planning service from a backend workflow job after automatic profiling succeeds. The job requires a saved latest student profile and an initial response package. It uses the same schema validation, semantic validation, usage guard, idempotency, persistence, and audit logging as the manual trigger.

Automatic planning success enqueues first follow-up startup. Phase 6D2A does not replan after follow-up messages.

Phase 6D2B follow-up update jobs use an execution-only planning candidate function. A failure leaves the previous active profile and previous active formative decision authoritative, preserves audit records, and marks the update cycle failed without activating a partial decision.

## Student UI

Students do not see formative values, action plans, target evidence, success criteria, profile labels, correctness, or rationales.

After planning completes and before follow-up starts, the student UI may show only:

```text
A support plan has been prepared. Interactive follow-up is not available yet in this prototype.
```

After Phase 6D1 starts follow-up, students see only conversation text and still do not see formative labels or action-plan metadata.

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

The smoke test verifies safe input building, prohibited field exclusion, default mapping derivation, execution through `executeAgent`, agent-call audit, schema and semantic validation, decision persistence, latest decision pointer update, phase transition to `planning_completed`, teacher serializer behavior, student payload safety, idempotency, mapping-deviation handling, invalid-output handling, usage-blocked handling, teacher API authorization, and absence of follow-up side effects during planning itself.

Phase 6D1 follow-up verification is covered by:

```bash
npm run agent:followup-smoke
```

## Phase 7E2C Backend-Canonical Mapping

Prompt version `formative-planning-v2` treats the default formative-value
mapping as backend-owned guidance rather than an absolute pedagogical rule.
The backend calculates `default_formative_value` before provider execution and
includes it in the planning input.

After the provider returns one of the approved five formative values, the
backend derives canonical mapping state:

- selected value equals default: `mapping_followed=true` and `mapping_deviation_reason=null`
- selected value differs from default: `mapping_followed=false` and a nonempty evidence-linked deviation reason is required

The raw provider output remains preserved for audit. The semantic evaluator must
not raise `incorrect_top_level_formative_value` merely because a defensible
non-default value was selected.

## Phase 8A Operational Effective Result

Operational planning calls route through `executeOperationalAgent`. The backend
derives default formative value and mapping state before execution and consumes
only the effective result after validation, canonicalization, and fallback. If
initial planning cannot use a valid effective result, a deterministic
course-agnostic fallback plan keeps the workflow resumable. Updated planning
failure preserves the previous active decision pointer.
