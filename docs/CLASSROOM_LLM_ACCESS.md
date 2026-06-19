# Classroom LLM Access

Phase 6A.5 defines access-control rules for future classroom LLM use. It does not activate any LLM agent in student or teacher workflows.

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

If any check fails, the system returns a typed blocked result and does not call OpenAI.

## Student-Facing Fallback

Future student workflows should use `buildLlmUnavailableStudentMessage(reason)` when an AI-supported step is unavailable. The message is intentionally neutral:

```text
The system is not able to generate the next AI-supported step right now. Your progress has been saved.
```

It must not mention budget, cost, API keys, rate limits, or provider internals.

## Current Boundary

Phase 6A.5 does not:

- connect agents to real classroom workflows
- send classroom data to OpenAI
- run profiling on response packages
- create profiles, formative decisions, or follow-up rounds
- alter `profiling_pending` sessions
- replace deterministic Response Collection presentation
- implement live Item Preparation behavior

See `docs/LLM_USAGE_LIMITS.md` for operational safeguards.
