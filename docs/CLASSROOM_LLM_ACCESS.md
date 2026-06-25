# Classroom LLM Access

Phase 6A.5 defines access-control rules for classroom LLM use. Later phases activate specific backend-only agents behind the same server-side readiness and usage guards.

## Server-Side Key Model

- Students never enter an OpenAI API key.
- Students never need OpenAI accounts.
- Students never provide their own provider credentials.
- The deployment owner configures one server-side `OPENAI_API_KEY` in backend environment variables.
- The frontend must never receive API keys, provider secrets, Authorization headers, project IDs, organization IDs, database URLs, or session secrets.
- Every future LLM call must go through backend authentication, authorization, usage guard checks, and `agent_calls` audit logging.

No browser form exists for entering an OpenAI key.

## Live-Call Readiness

The safe default remains:

```text
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
```

A future live OpenAI call is allowed only when all of these are true:

- `LLM_PROVIDER=openai`
- `LLM_LIVE_CALLS_ENABLED=true`
- `OPENAI_API_KEY` is configured server-side
- the relevant agent model environment variable is configured
- the usage guard allows the call

If any check fails, the system returns a typed blocked result or uses an approved deterministic fallback for the specific workflow, and does not call OpenAI.

## Student-Facing Fallback

Future student workflows should use `buildLlmUnavailableStudentMessage(reason)` when an AI-supported step is unavailable. The message is intentionally neutral:

```text
The system is not able to generate the next AI-supported step right now. Your progress has been saved.
```

It must not mention budget, cost, API keys, rate limits, or provider internals.

## Current Boundary

Phase 6D2A can connect existing profiling, planning, and first follow-up startup services to an asynchronous backend workflow when an assessment session snapshot is `automatic`. Phase 6D2B extends that workflow with staged follow-up evidence updates inside the current concept unit. These services still use the Phase 6A.5 live-call gate and usage guard. In normal local development and smoke tests, `LLM_PROVIDER=mock` and `LLM_LIVE_CALLS_ENABLED=false`, so no OpenAI call occurs.

Phase 7C permits Response Collection Agent execution only for submitted student free-text messages during initial administration when the assessment session snapshot is `llm_assisted` and provider readiness/usage checks allow it. Routine item presentation remains deterministic. If `LLM_PROVIDER=mock` and `ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW=false`, ordinary student workflow uses deterministic fallback instead of mock-generated student-facing text.

Phase 7D replaces Item Preparation with advisory Item Verification for teacher-authored content. It still does not implement item generation, item rewriting, concept generation, adaptive concept routing, student-entered provider credentials, correctness feedback, hints, explanations, or content tutoring during initial administration.

Phase 7E1 adds an internal evaluation harness for synthetic cases only. It uses mock evaluation by default, does not call OpenAI, does not require an API key, and does not change classroom workflows.

Phase 7E2A adds a CLI-only live evaluation canary with separate eval settings: `EVAL_PROVIDER`, `EVAL_LIVE_CALLS_ENABLED`, `EVAL_TARGET_MODEL`, and `EVAL_REASONING_EFFORT`. Enabling eval live calls must not enable classroom live calls. The canary uses only synthetic eval cases and writes only eval tables.

Phase 7E2B adds a separate CLI-only full pilot with `EVAL_PILOT_*` settings.
It remains synthetic-only and eval-table-only. It must not activate live
profiling, planning, follow-up, response collection, or item verification for
students or teacher content workflows.

Phase 8A adds separate guarded operational integration modes for local workflow
wiring:

```text
OPERATIONAL_AGENT_MODE=disabled
OPERATIONAL_APPROVED_CONFIG_HASH=
OPERATIONAL_EFFECTIVE_RESULT_VERSION=effective-system-eval-v2
OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION=effective-validator-v1
```

This integration is default-off. `mock` mode is for controlled local
development/testing. `guarded_live` remains unavailable unless the approved
manifest, exact active configuration hash, usage guard, database readiness,
server-side OpenAI readiness, exact model snapshot, and effective-result
versions all match. The approved evidence is provisional engineering readiness
from targeted run `evr_20260624_bltzgtq`, not classroom validity, and human
review remains pending.

See `docs/LLM_USAGE_LIMITS.md` for operational safeguards.
