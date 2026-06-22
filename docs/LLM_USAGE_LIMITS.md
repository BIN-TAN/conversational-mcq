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

Blocked calls do not call OpenAI and do not fabricate agent output. In Phase 7C initial-administration free-text handling, a blocked Response Collection Agent call falls back to deterministic safe wording and records fallback as process context rather than as a successful model call. In Phase 7D item verification, a blocked verification call leaves deterministic validation available and must not be represented as a completed LLM verification.

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

## Smoke Tests

```bash
npm run llm:usage-smoke
npm run llm:status-smoke
npm run workflow:automation-smoke
npm run agent:item-verification-smoke
```

These tests run without OpenAI network calls. The workflow smoke verifies automatic jobs use the same usage-guarded agent services in mock mode.
