# Guarded Operational Agent Integration

Phase 8A wires the evaluated five-agent configuration into the local operational workflow behind a fail-closed, default-disabled gate. It does not authorize classroom live use, public deployment, or use of real student data with OpenAI.

## Modes

`OPERATIONAL_AGENT_MODE` is the server-only source of truth:

- `disabled`: no provider request. Existing deterministic behavior or deterministic fallback is used.
- `mock`: development and smoke-test mode. Mock output is allowed only through controlled backend paths; fabricated mock text must not reach ordinary classroom students without an explicit development-only flag.
- `guarded_live`: provider execution is permitted only when every readiness check passes.

`OPERATIONAL_AGENT_INTEGRATION_ENABLED` remains as a deprecated compatibility alias. If the alias conflicts with `OPERATIONAL_AGENT_MODE`, the system fails closed and emits only sanitized warnings.

## Guarded Live Readiness

Guarded live execution requires all of the following:

- `OPERATIONAL_AGENT_MODE=guarded_live`
- `LLM_PROVIDER=openai`
- `LLM_LIVE_CALLS_ENABLED=true`
- server-side `OPENAI_API_KEY` configured
- exact approved model snapshot `gpt-5.4-mini-2026-03-17`
- reasoning effort `low`
- approved manifest verifies against the active prompt/schema registry
- `OPERATIONAL_APPROVED_CONFIG_HASH` matches the approved active configuration hash
- effective result and validator versions match the manifest
- usage guard allows the call
- database readiness succeeds

Any missing requirement blocks the provider call, records a sanitized blocked reason, and returns the relevant deterministic fallback or blocked result. Blocked readiness never fabricates provider metadata.

## Executor Boundary

Operational domain services call `executeOperationalAgent(...)`. The executor validates mode, approved manifest, active configuration, readiness, usage guard, and redaction before allowing the existing audited agent execution path. Domain services consume only the effective result or deterministic fallback, not raw provider output directly.

Evaluation services are not imported into operational runtime. Evaluation and operational code may share pure validators, guards, canonicalizers, and fallback functions, but operational execution persists only operational audit records.

## Integration Points

Phase 8A connects the shared executor to:

- Response Collection free-text handling
- initial and updated Student Profiling
- initial and updated Formative Planning
- Follow-up opening generation
- Follow-up student-message handling
- Follow-up update cycles
- Item Verification

Automatic workflow jobs remain asynchronous and non-interventionist. Students can save, exit, and resume; progression remains student-led; teachers cannot approve or deny the next concept during an active session.

## No Classroom Activation

The default remains `OPERATIONAL_AGENT_MODE=disabled`, `LLM_PROVIDER=mock`, and `LLM_LIVE_CALLS_ENABLED=false`. Phase 8A smoke tests use disabled or injected-mock paths and make no OpenAI calls.

## Phase 8B Synthetic End-To-End Validation

Phase 8B keeps guarded-live disabled and validates the guarded operational
integration through a production-like synthetic harness. It uses a `_e2e`
database, the built Next.js server, the real worker process, and synthetic
Playwright journeys. The result is synthetic engineering readiness only, not
classroom validity.

## Phase 8C Guarded-Live Synthetic Canary Infrastructure

Phase 8C adds CLI-only infrastructure for a future guarded-live synthetic
operational canary. It does not enable classroom live calls and does not execute
paid provider requests during normal development, tests, builds, migrations, or
smoke tests.

The canary uses an isolated database whose name must end in
`_live_canary_e2e`. The database guard rejects the normal development database
and the Phase 8B `_e2e` database. The canary fixture is synthetic-only and is
defined by `tests/fixtures/operational-live-canary/manifest.json`.

The future paid command is guarded by all of the following:

- `OPERATIONAL_LIVE_CANARY_ENABLED=true`
- `OPERATIONAL_AGENT_MODE=guarded_live`
- `LLM_PROVIDER=openai`
- `LLM_LIVE_CALLS_ENABLED=true`
- server-side `OPENAI_API_KEY` configured
- approved operational configuration hash match
- exact model snapshot `gpt-5.4-mini-2026-03-17`
- reasoning effort `low`
- isolated canary database suffix guard
- request, retry, concurrency, network, and budget guards
- explicit `--confirm-paid-api`

The teacher UI does not start the canary and does not accept API keys. The
review workflow exports blind review packets after a run and stores AI-assisted
review provenance separately from human review.
