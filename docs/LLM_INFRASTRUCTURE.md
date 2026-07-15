# LLM Infrastructure

Phase 6A adds provider wiring, structured-output contracts, prompt registry metadata, and agent-call audit logging. Phase 6A.5 adds classroom access controls, usage-limit checks, live-call readiness checks, and teacher-visible usage monitoring. Phase 6B connects only the Student Profiling Agent after initial concept-unit administration. Phase 6C connects only the Formative Value and Planning Agent after a saved student profile. Phase 6D1 connects only the Follow-up Agent for the first open-ended follow-up conversation round. Phase 6D2B adds staged iterative follow-up evidence updates within the current concept unit. Phase 6D3 adds deterministic student-led concept progression and final assessment completion. Phase 7C connects the Response Collection Agent only for submitted free-text messages during initial administration. Phase 7D replaces the former Item Preparation concept with advisory Item Verification for teacher-authored item sets. Phase 8A adds default-off guarded operational integration with explicit modes, an approved configuration manifest, and immutable operational effective-result records.

## Phase Boundary

Implemented in Phase 6A:

- OpenAI JavaScript/TypeScript SDK dependency.
- Responses API provider wrapper for future live structured-output calls.
- Mock provider for local development and smoke tests.
- Environment validation for provider, live-call gate, per-agent model names, request timeout, retries, reasoning effort, and max output tokens.
- Draft prompt registry with prompt versions, schema versions, prompt hashes, agent versions, and prompt status.
- Strict Zod input/output contracts for all five agents.
- Central `executeAgent` service that validates input, blocks prohibited secret/auth fields, calls the selected provider, validates structured output, retries retryable failures, and writes `agent_calls` audit rows.
- Teacher-only LLM status API and page.
- LLM smoke tests for contracts, mock execution, and redaction.

Implemented in Phase 6A.5:

- Server-side usage-limit configuration.
- Usage accounting from `agent_calls`.
- Live-call readiness checks for provider, live-call gate, API key presence, model configuration, and usage limits.
- Audit fields for blocked reasons, usage snapshots, live-call allowance, and usage windows.
- Teacher-visible usage dashboard on `/teacher/system/llm`.
- Student-safe unavailable-message placeholder.
- Smoke tests for usage guards and teacher status access.

Implemented in Phase 6B:

- Backend `StudentProfilingInput` builder from an `initial_concept_unit_response_package` and allowlisted evidence.
- Student Profiling Agent execution through `executeAgent`.
- Validated `StudentProfileOutput` persistence to `student_profiles`.
- Agent-call/process-event audit trail for profiling start, success, failure, and validation outcomes.
- Idempotent profiling invocation keys.
- Teacher-only manual profiling trigger and saved-profile display.
- Neutral student post-analysis state after `profiling_completed`.
- Profiling smoke test that runs in mock mode and does not call OpenAI.

Implemented in Phase 6C:

- Backend `FormativePlanningInput` builder from the latest saved profile and allowlisted response-package evidence.
- Central default integrated-profile-to-formative-value mapping.
- Semantic validation for mapping metadata, nonempty planning fields, and prohibited claims.
- Formative Value and Planning Agent execution through `executeAgent`.
- Validated `FormativePlanningOutput` persistence to `formative_decisions`.
- Latest formative-decision pointer update.
- Teacher-only manual planning trigger and saved-decision display.
- Neutral student post-planning state.
- Planning smoke test that runs in mock mode and does not call OpenAI.

Implemented in Phase 6D1:

- Backend `FollowupInput` builder from the latest saved profile, latest saved formative decision, current round, student message, bounded transcript, item evidence, and process context.
- Follow-up semantic validation for action type, target formative value alignment, trusted event types, prohibited disclosures, and no misconduct language.
- Follow-up Agent execution through `executeAgent`.
- First-round `followup_rounds` creation through a teacher-only manual trigger.
- Follow-up conversation turns persisted to `conversation_turns`.
- `agent_calls.followup_round_db_id` audit linkage.
- Neutral process-event logging for follow-up start, turns, prompt-injection-like messages, validation outcomes, and stop.
- Student-safe follow-up messaging and stop APIs.
- Teacher review display of saved follow-up rounds.
- Follow-up smoke tests that run in mock mode and do not call OpenAI.

Implemented in Phase 6D2B:

- Follow-up Agent output fields for substantive-turn and evidence-trigger classification.
- `followup_evidence_update_package` creation from allowlisted current-concept follow-up evidence.
- `followup_update_cycles` audit/staging records.
- Async workflow jobs for updated profiling, updated planning, and final activation.
- Updated Student Profiling Agent execution through `executeAgent` with `profile_type=updated`.
- Updated Formative Value and Planning Agent execution through `executeAgent`.
- Atomic activation of updated profile, updated decision, and next follow-up round only after all required stages succeed.
- Final profile/planning update on student stop when unprocessed substantive evidence exists.
- Teacher review display of update-cycle state, trigger type, staged-output presence, and failure details.
- Student-safe neutral updating state with no profile/planning labels.
- Smoke tests that run in mock mode and do not call OpenAI.

Phase 7C implements:

- Response Collection Agent contract version `response-collection-output-v2`.
- Student-safe response collection input building with no answer keys or teacher diagnostic metadata.
- Semantic validation for exact reasoning segments, no feedback, no phase control, and no option/confidence mutation.
- Deterministic fallback when mode is deterministic, provider readiness fails, usage is blocked, mock workflow is not explicitly allowed, execution fails, or output validation fails.
- Agent-call audit rows only for actual Response Collection Agent executions.
- Initial chat UI for free-text messages with option and confidence controls remaining authoritative.

Phase 7D implements:

- Active agent identity `item_verification_agent`.
- Strict Item Verification input/output contracts and prompt metadata.
- Advisory semantic verification of teacher-authored concept-unit item sets.
- Deterministic structural validation before any verification agent call.
- Content fingerprinting so verification applies only to the exact item-set version.
- Warning acknowledgement for current verification fingerprints.
- Publication policy allowing teacher-confirmed publication without current AI verification after deterministic validation passes.
- Teacher-only verification APIs and UI.
- Mock verification fixtures and smoke tests that do not call OpenAI.

Phase 8A implements:

- Default-off `OPERATIONAL_AGENT_MODE=disabled`.
- Deprecated `OPERATIONAL_AGENT_INTEGRATION_ENABLED` alias with fail-closed conflict handling.
- Approved manifest verification from `config/approved-operational-agent-config.json`.
- Exact active configuration hash verification before guarded live can run.
- Shared `executeOperationalAgent(...)` boundary for all five operational agents.
- Raw validation, semantic/safety validation, deterministic guards, backend canonicalization, deterministic fallback, effective validation, and immutable effective-result persistence.
- Automatic workflow and worker backstops that use deterministic fallback instead of permanent deadlock when readiness is blocked.
- Teacher-visible sanitized operational audit fields on session review and system LLM surfaces.
- Status, preflight, manifest, and smoke commands that make no OpenAI call.

Not implemented through Phase 7D:

- No automatic next-concept-unit movement.
- No item generation or rewriting behavior.
- No concept generation, concept recommendation, replacement distractors, or suggested item revisions.
- No student-facing profile, planning, correctness, or diagnostic display.
- No adaptive routing.
- No correctness feedback, answer explanation, tutoring, or content help during initial administration.
- No mock Response Collection Agent output in ordinary student workflow unless `ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW=true`.
- Normal development and verification use mock mode and send no student text, transcript, process data, item reasoning, summative outcome, or classroom record to OpenAI.
- No student provides an OpenAI API key or needs an OpenAI account.

Implemented in Phase 6D3:

- Deterministic next-concept progression by teacher-defined `concept_units.order_index`.
- Explicit student move-on and completion choices.
- Final profile/planning update before progression when unprocessed substantive evidence exists.
- Unresolved-evidence confirmation before progressing or completing.
- Prior-concept read-only behavior after progression.
- Standard classroom non-intervention rules for teacher controls.
- Student progression UI and teacher read-only progression display.
- Progression and completion smoke tests that run in mock mode and do not call OpenAI.

## Providers

`LLM_PROVIDER=mock` is the default. The mock provider is used by Phase 6 smoke tests and does not make network calls.

`LLM_PROVIDER=openai` is allowed only when `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY` is present, and the relevant model name is configured. This deliberate gate prevents accidental live provider use during local development.

The OpenAI provider uses the Responses API with structured Zod output parsing where supported by the SDK. Requests are server-side only, use `store: false`, and do not expose the API key to the browser.

All live classroom calls must use the server-side deployment key. Browser clients must never send or receive provider credentials.

## Environment Variables

Required for normal auth/database operation:

- `DATABASE_URL`
- `SESSION_SECRET`

Phase 6A LLM variables are optional unless intentionally enabling live connectivity:

- `LLM_PROVIDER`
- `LLM_LIVE_CALLS_ENABLED`
- `OPENAI_API_KEY`
- `OPENAI_MODEL_ITEM_VERIFICATION`
- `OPENAI_MODEL_ITEM_ADMIN`
- `OPENAI_MODEL_RESPONSE_COLLECTION`
- `OPENAI_MODEL_PROFILING`
- `OPENAI_MODEL_PROFILE_INTEGRATION`
- `OPENAI_MODEL_PLANNING`
- `OPENAI_MODEL_FOLLOWUP`
- `OPENAI_MODEL_STUDENT_COMMUNICATION`
- `OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING`
- `OPENAI_MODEL_MCQ_FORMATTING`
- `OPENAI_MODEL_CONNECTIVITY_TEST`
- `OPENAI_REASONING_EFFORT_*`: per-agent, server-side only; allowed values
  are `none`, `low`, `medium`, `high`, `xhigh`, and `max`. Missing values keep
  the approved baseline behavior. Invalid explicit values fail closed for LLM
  readiness/dispatch and must not block authentication or non-LLM pages.
- `OPENAI_MAX_OUTPUT_TOKENS_*`
- `OPENAI_REQUEST_TIMEOUT_MS`
- `OPENAI_MAX_RETRIES`
- `LLM_DAILY_CLASS_CALL_LIMIT`
- `LLM_DAILY_CLASS_TOKEN_LIMIT`
- `LLM_DAILY_STUDENT_CALL_LIMIT`
- `LLM_DAILY_STUDENT_TOKEN_LIMIT`
- `LLM_SESSION_CALL_LIMIT`
- `LLM_SESSION_TOKEN_LIMIT`
- `LLM_AGENT_CALL_LIMIT_PER_SESSION`
- `LLM_COST_WARNING_LIMIT_USD`
- `LLM_COST_HARD_LIMIT_USD`
- `LLM_USAGE_TIMEZONE`
- `FOLLOWUP_CONTEXT_MAX_TURNS`
- `FOLLOWUP_MESSAGE_MAX_CHARS`
- `FOLLOWUP_CONTEXT_MAX_CHARS`
- `FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE`
- `OPERATIONAL_AGENT_MODE`
- `OPERATIONAL_APPROVED_CONFIG_HASH`
- `OPERATIONAL_EFFECTIVE_RESULT_VERSION`
- `OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION`
- `OPERATIONAL_AGENT_INTEGRATION_ENABLED` deprecated alias
- `ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW`
- `INITIAL_CHAT_MESSAGE_MAX_CHARS`
- `RESPONSE_COLLECTION_CONTEXT_MAX_TURNS`
- `RESPONSE_COLLECTION_CONTEXT_MAX_CHARS`

The approved operational baseline remains `gpt-5.4-mini-2026-03-17` with low
reasoning effort until a separate candidate evaluation and approval workflow
produces a new approved hash. The GPT-5.6 candidate stack is stored separately
in `config/candidate-operational-agent-config.gpt-5.6.json`.

`OPENAI_MODEL_STUDENT_COMMUNICATION`,
`OPENAI_REASONING_EFFORT_STUDENT_COMMUNICATION`, and
`OPENAI_MAX_OUTPUT_TOKENS_STUDENT_COMMUNICATION` are optional Phase 31an
extension variables for a future fact-locked student communication agent. They
must remain unset in production until the communication agent is evaluated,
approved, and covered by the approved operational configuration hash. The
current runtime uses deterministic, fact-locked fallback wording.

No model name is hardcoded. No documentation should describe a specific model as currently latest.

## Audit Logging

`agent_calls` records:

- agent name, agent version, prompt version, schema version, prompt hash
- provider and model name
- provider response/request IDs when available
- client request ID and optional idempotency key
- redacted input payload
- raw output, parsed output, validation status, validation error
- retry count, latency, token usage, and status
- refusal, incomplete, and sanitized error categories where applicable
- blocked reason, usage guard snapshot, live-call allowance, and usage window when applicable

Phase 6A mock smoke tests create only synthetic audit rows and clean them up afterward.

Phase 6B Student Profiling Agent calls attach to the relevant assessment session and concept-unit session. Mock provider outputs are marked as infrastructure-testing outputs and should not be interpreted as validated research inferences.

Phase 6C Formative Value and Planning Agent calls also attach to the relevant assessment session and concept-unit session. Mock planning outputs are infrastructure-testing fixtures, not validated educational guidance.

Phase 6D1 Follow-up Agent calls attach to the relevant assessment session, concept-unit session, and follow-up round. Mock follow-up outputs are infrastructure-testing fixtures, not validated formative guidance.

Phase 6D2A automatic workflow jobs call the same profiling, planning, and follow-up services asynchronously when a session snapshot is `automatic`. They do not bypass provider readiness, usage guards, schema validation, semantic validation, prompt/version audit logging, or mock-mode defaults.

Phase 6D2B follow-up update cycles create new agent-call audit rows for updated profiling, updated planning, and next-round opening generation when applicable. Candidate outputs are stored as staged JSON on `followup_update_cycles`; they are not active profiles or active decisions until final transaction success.

Phase 7C Response Collection Agent calls attach to the relevant assessment session, concept-unit session, and current item when an actual agent execution occurs. Deterministic fallback does not create fake provider metadata or successful agent-call rows.

Phase 7D Item Verification Agent calls attach to `item_verification_runs`, which link to teacher-authored concept units and preserve the content fingerprint, deterministic validation result, warning count, acknowledgement metadata, and optional agent-call audit link. They do not attach to student sessions and must not include student records.

Phase 8A does not add a new agent-call type. Raw provider attempts still use
`agent_calls`. The effective operational output consumed by workflow is stored
separately in `operational_agent_effective_results`. When readiness blocks
execution, no successful provider metadata is fabricated; deterministic fallback
or a typed blocked result is recorded as the effective operational result where
the domain service needs a resumable outcome.

Phase 7E1 evaluation runs use the mock provider directly inside the evaluation harness. They reuse the active prompt/version metadata and output schemas, but they do not call `executeAgent`, do not write `agent_calls`, and do not mutate classroom workflow tables. Evaluation outputs are stored only in eval tables.

Evaluation configuration defaults:

```text
EVAL_TARGET_MODEL=gpt-5.4-mini
EVAL_DEFAULT_REPETITIONS=2
EVAL_LIVE_CALLS_ENABLED=false
EVAL_COST_HARD_LIMIT_USD=50
```

`EVAL_TARGET_MODEL` is future target metadata in Phase 7E1. It is not a live provider call and does not hardcode operational agent execution.

## Teacher Status Surface

Teacher-only API:

```text
GET /api/teacher/system/llm-status
```

Teacher-only page:

```text
/teacher/system/llm
```

The page shows provider mode, whether live calls are enabled, whether an API key is configured, per-agent model readiness, prompt versions, schema versions, prompt statuses, current usage counts, limits, blocked-call counts, recent safe audit metadata, and safety boundaries. It never displays secrets or raw student evidence.

In Phase 8A the page also shows operational mode, approved manifest status,
active and approved configuration hashes, readiness blocking reasons, and
sanitized operational audit metadata. This is provisional engineering readiness
only and does not claim classroom validity.

## Connectivity Test

`npm run llm:connectivity` is a synthetic-only live OpenAI connectivity check. It is intentionally not part of the normal offline verification path.

It requires:

- `LLM_PROVIDER=openai`
- `LLM_LIVE_CALLS_ENABLED=true`
- `OPENAI_API_KEY`
- `OPENAI_MODEL_CONNECTIVITY_TEST`

The script sends a fixed synthetic Response Collection Agent request. It must not be modified to send real classroom data.

## Smoke Tests

```bash
npm run llm:contracts-smoke
npm run llm:execution-smoke
npm run llm:redaction-smoke
npm run llm:usage-smoke
npm run llm:status-smoke
npm run agent:response-collection-smoke
npm run response-collection:fallback-smoke
npm run response-collection:service-fallback-smoke
npm run student:initial-chat-ui-smoke
npm run response-collection:mode-smoke
npm run agent:item-verification-smoke
npm run content:verification-publish-smoke
npm run item:verification-ui-smoke
npm run agent:item-verification-rename-smoke
npm run eval:harness-smoke
npm run agent:profiling-smoke
npm run agent:planning-smoke
npm run agent:followup-smoke
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
npm run student:followup-ui-smoke
npm run student:followup-update-ui-smoke
npm run concept:progression-smoke
npm run assessment:completion-smoke
npm run classroom:nonintervention-smoke
npm run student:progression-ui-smoke
npm run workflow:automation-smoke
npm run workflow:worker-smoke
npm run operational:guarded-integration-status
npm run operational:guarded-integration-status -- --check-eval
npm run operational:guarded-integration-smoke
```

These tests validate schemas, prompt hashes, mock provider execution, retries, refusal/incomplete/invalid-output handling, audit logging, redaction, usage limits, safe status serialization, Student Profiling Agent integration, Formative Planning Agent integration, Follow-up Agent integration, iterative follow-up update cycles, final stop updates, student-led concept progression, final assessment completion, non-intervention classroom controls, student-safe updating states, idempotency, usage-blocked behavior, and isolated mock evaluation harness behavior. They do not call OpenAI.

See `docs/CLASSROOM_LLM_ACCESS.md` and `docs/LLM_USAGE_LIMITS.md` for the Phase 6A.5 operational contract.

## Phase 7E2A Evaluation-Only Live Calls

Phase 7E2A adds a separate eval live-call path. It reuses the server-only OpenAI Responses provider with Structured Outputs, `store: false`, no tools, no web search, no file search, no code interpreter, no remote MCP, and no function calls.

This path does not use the operational `executeAgent` persistence path. It writes only eval runs and eval run items. Operational classroom live-call gates remain controlled by `LLM_PROVIDER` and `LLM_LIVE_CALLS_ENABLED`.

The eval live-call path compiles every provider-facing agent output schema with
the same OpenAI `zodTextFormat` helper before preflight, dry run, or paid
execution can proceed. This local compatibility check is not a provider request.
If schema construction fails, the run item records
`structured_output_schema_incompatible`, provider dispatch is skipped, and the
provider request counter is not incremented.

Offline checks:

```bash
npm run eval:structured-output-compat-smoke
npm run eval:live-canary-runner-smoke
npm run eval:budget-smoke
npm run eval:live-isolation-smoke
npm run eval:canary-report-smoke
```

These checks use mock/fake provider execution and do not call OpenAI.

## Phase 7E2B Full Pilot

The full pilot extends the evaluation-only live path to 100 synthetic outputs.
It uses separate `EVAL_PILOT_*` settings and does not use the operational
`executeAgent` persistence path. Enabling the pilot does not enable classroom
live calls, and pilot outputs stay in eval tables only.

## Phase 31ao Communication and Topic Dialogue Agents

Two student-facing extension roles are now represented in configuration:

- `student_communication_agent`
- `topic_dialogue_agent`

The communication role verbalizes frozen assessment facts. The topic-dialogue
role provides bounded support after a formative activity. Both roles remain
candidate/extension roles until separately evaluated and approved. Merely
setting model variables must not bypass the operational approved-hash gate.

Server-only optional variables:

```text
OPENAI_MODEL_STUDENT_COMMUNICATION
OPENAI_REASONING_EFFORT_STUDENT_COMMUNICATION
OPENAI_MAX_OUTPUT_TOKENS_STUDENT_COMMUNICATION
OPENAI_MODEL_TOPIC_DIALOGUE
OPENAI_REASONING_EFFORT_TOPIC_DIALOGUE
OPENAI_MAX_OUTPUT_TOKENS_TOPIC_DIALOGUE
TOPIC_DIALOGUE_MAX_STUDENT_TURNS
TOPIC_DIALOGUE_RECENT_TURN_WINDOW
```

Absent communication/topic-dialogue model variables use deterministic no-live
fallback behavior. The browser never calls OpenAI directly, and normal smoke
tests must continue to report zero OpenAI calls.
