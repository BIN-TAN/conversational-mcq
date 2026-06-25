# LLM Usage Limits

Phase 6A.5 adds server-side operational safeguards for LLM calls. These limits are reliability and budget controls, not pedagogical labels.

## Environment Variables

```text
LLM_DAILY_CLASS_CALL_LIMIT=200
LLM_DAILY_CLASS_TOKEN_LIMIT=500000
LLM_DAILY_STUDENT_CALL_LIMIT=25
LLM_DAILY_STUDENT_TOKEN_LIMIT=75000
LLM_SESSION_CALL_LIMIT=20
LLM_SESSION_TOKEN_LIMIT=50000
LLM_AGENT_CALL_LIMIT_PER_SESSION=8
LLM_COST_WARNING_LIMIT_USD=""
LLM_COST_HARD_LIMIT_USD=""
LLM_USAGE_TIMEZONE=UTC
```

The call and token limits default to conservative server-side values. Cost limits are optional because Phase 6A.5 does not include a versioned pricing registry. If estimated cost is unavailable, cost limits must not be treated as exact billing controls.

## Usage Window

Daily windows use `LLM_USAGE_TIMEZONE`, defaulting to `UTC`. Database timestamps remain UTC `TIMESTAMPTZ`; the usage service computes the configured local day boundary and returns `window_start` and `window_end` as UTC timestamps.

## Guard Result

The usage guard returns a typed result:

```ts
type LlmUsageGuardResult =
  | { allowed: true; warnings: string[]; usage_snapshot: object }
  | {
      allowed: false;
      reason:
        | "student_daily_call_limit_exceeded"
        | "student_daily_token_limit_exceeded"
        | "session_call_limit_exceeded"
        | "session_token_limit_exceeded"
        | "agent_session_call_limit_exceeded"
        | "class_daily_call_limit_exceeded"
        | "class_daily_token_limit_exceeded"
        | "cost_hard_limit_exceeded"
        | "live_calls_disabled"
        | "provider_not_configured"
        | "model_not_configured";
      usage_snapshot: object;
      retry_after?: string;
    };
```

Blocked calls do not call OpenAI and do not fabricate agent output. In Phase 7C initial-administration free-text handling, a blocked Response Collection Agent call falls back to deterministic safe wording and records fallback as process context rather than as a successful model call. In Phase 7D item verification, a blocked verification call leaves deterministic validation available and must not be represented as a completed LLM verification. In Phase 8A, the default-off operational integration gate can block workflow access to evaluated agent services before usage accounting or provider dispatch; this is a configuration boundary, not a model failure.

## Accounting Source

Usage is aggregated from `agent_calls`:

- class daily calls and tokens
- student daily calls and tokens when a session is known
- session calls and tokens
- per-agent session calls
- per-agent daily calls and tokens
- blocked call counts
- retry and failure counts

Teacher-facing serializers exclude input payloads, raw outputs, API keys, database URLs, cookies, and Authorization headers.

## Teacher Monitoring

Teacher-only surfaces:

- `GET /api/teacher/system/llm-status`
- `/teacher/system/llm`

The status surface shows provider readiness, model readiness, current usage counts, limits, blocked reasons, retry/failure counts, and recent safe audit-row metadata. It never shows secrets or raw student evidence.

Phase 7D adds `item_verification_agent` to the same readiness and usage surfaces. It uses `OPENAI_MODEL_ITEM_VERIFICATION` only when live calls are explicitly enabled server-side. Normal local verification and smoke tests run in mock mode and do not require an OpenAI key.

Phase 7E1 evaluation uses separate evaluation metadata:

```text
EVAL_PROVIDER=mock
EVAL_LIVE_CALLS_ENABLED=false
EVAL_TARGET_MODEL=gpt-5.4-mini-2026-03-17
EVAL_REASONING_EFFORT=low
EVAL_DEFAULT_REPETITIONS=2
EVAL_CANARY_REPETITIONS=1
EVAL_CANARY_CASES_PER_AGENT=5
EVAL_COST_HARD_LIMIT_USD=50
EVAL_MAX_CONCURRENCY=1
EVAL_MAX_RETRIES=1
EVAL_MAX_PROVIDER_REQUESTS=50
```

These settings do not enable classroom live calls. Phase 7E1 mock runs do not consume OpenAI billing, do not call OpenAI, and do not create `agent_calls`. Phase 7E2A live canary execution enforces a separate eval budget guard before each provider request.

Phase 7E2B full pilot execution uses `EVAL_PILOT_COST_HARD_LIMIT_USD=50`,
`EVAL_PILOT_MAX_PROVIDER_REQUESTS=150`, `EVAL_PILOT_MAX_CONCURRENCY=1`, and
`EVAL_PILOT_MAX_RETRIES=1`. These limits are separate from classroom usage
guards.

The Phase 7E2A pricing registry is versioned as `openai-pricing-2026-06-22-v1` and estimates cost for `gpt-5.4-mini-2026-03-17`. Estimated cost is not an exact invoice.

Phase 8A adds operational workflow integration flags:

```text
OPERATIONAL_AGENT_MODE=disabled
OPERATIONAL_APPROVED_CONFIG_HASH=
OPERATIONAL_EFFECTIVE_RESULT_VERSION=effective-system-eval-v2
OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION=effective-validator-v1
```

These flags are separate from eval live-call settings and do not enable
classroom OpenAI calls. `guarded_live` must still pass the same usage guard
before dispatch and is additionally blocked by manifest, configuration hash,
database, exact model snapshot, and server-side live-call readiness.

## Smoke Tests

```bash
npm run llm:usage-smoke
npm run llm:status-smoke
npm run workflow:automation-smoke
npm run agent:item-verification-smoke
npm run eval:harness-smoke
npm run eval:budget-smoke
npm run operational:guarded-integration-smoke
```

These tests run without OpenAI network calls. The workflow smoke verifies automatic jobs use the same usage-guarded agent services in mock mode.

## Phase 8C Operational Live Canary Limits

Phase 8C introduces a separate operational live-canary budget guard for a
future synthetic-only canary. It does not consume classroom per-student or
per-session limits and does not change normal classroom usage accounting.

Default local settings are disabled:

```text
OPERATIONAL_LIVE_CANARY_ENABLED=false
OPERATIONAL_LIVE_CANARY_COST_HARD_LIMIT_USD=15
OPERATIONAL_LIVE_CANARY_MAX_PROVIDER_REQUESTS=80
OPERATIONAL_LIVE_CANARY_MAX_CONCURRENCY=1
OPERATIONAL_LIVE_CANARY_MAX_RETRIES=1
```

The manifest currently plans 30 logical agent invocations across the five
active agents and bounds execution with a maximum of 80 provider requests. The
preflight and dry-run commands calculate an upper-bound estimate, validate the
approved configuration, and make no provider request.

The paid canary command is blocked unless all readiness gates pass and the CLI
includes `--confirm-paid-api`. Any unavailable token usage or budget
verification failure must pause or block execution rather than continuing
blindly.
