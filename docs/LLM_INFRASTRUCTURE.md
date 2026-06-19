# LLM Infrastructure

Phase 6A adds provider wiring, structured-output contracts, prompt registry metadata, and agent-call audit logging. It does not connect any LLM agent to student or teacher workflows.

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

Not implemented in Phase 6A:

- No live classroom OpenAI calls.
- No agent is invoked by student assessment, teacher content management, session review, export, or summative outcome workflows.
- No Student Profiling Agent output is created from real response packages.
- No `student_profiles`, `formative_decisions`, or `followup_rounds` rows are created.
- No student session is advanced out of `profiling_pending`.
- No response collection UI text is replaced by an LLM.
- No student text, transcript, process data, item reasoning, summative outcome, or classroom record is sent to OpenAI.

## Providers

`LLM_PROVIDER=mock` is the default. The mock provider is used by all Phase 6A smoke tests and does not make network calls.

`LLM_PROVIDER=openai` is allowed only when `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY` is present, and the relevant model name is configured. This deliberate gate prevents accidental live provider use during local development.

The OpenAI provider uses the Responses API with structured Zod output parsing where supported by the SDK. Requests are server-side only, use `store: false`, and do not expose the API key to the browser.

## Environment Variables

Required for normal auth/database operation:

- `DATABASE_URL`
- `SESSION_SECRET`

Phase 6A LLM variables are optional unless intentionally enabling live connectivity:

- `LLM_PROVIDER`
- `LLM_LIVE_CALLS_ENABLED`
- `OPENAI_API_KEY`
- `OPENAI_MODEL_ITEM_PREP`
- `OPENAI_MODEL_RESPONSE_COLLECTION`
- `OPENAI_MODEL_PROFILING`
- `OPENAI_MODEL_PLANNING`
- `OPENAI_MODEL_FOLLOWUP`
- `OPENAI_MODEL_CONNECTIVITY_TEST`
- `OPENAI_REASONING_EFFORT_*`
- `OPENAI_MAX_OUTPUT_TOKENS_*`
- `OPENAI_REQUEST_TIMEOUT_MS`
- `OPENAI_MAX_RETRIES`

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

Phase 6A mock smoke tests create only synthetic audit rows and clean them up afterward.

## Teacher Status Surface

Teacher-only API:

```text
GET /api/teacher/system/llm-status
```

Teacher-only page:

```text
/teacher/system/llm
```

The page shows provider mode, whether live calls are enabled, whether an API key is configured, per-agent model readiness, prompt versions, schema versions, prompt statuses, and safety boundaries. It never displays secrets.

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
```

These tests validate schemas, prompt hashes, mock provider execution, retries, refusal/incomplete/invalid-output handling, audit logging, redaction, and the absence of workflow side effects. They do not call OpenAI.
