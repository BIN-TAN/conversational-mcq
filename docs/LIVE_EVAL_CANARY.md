# Live Evaluation Canary

Phase 7E2A adds a controlled live-evaluation canary path for the five active agents. It is evaluation-only and does not enable classroom live calls.

## Scope

The canary design is fixed:

- model snapshot: `gpt-5.4-mini-2026-03-17`
- reasoning effort: `low`
- agents: `item_verification_agent`, `response_collection_agent`, `student_profiling_agent`, `formative_value_and_planning_agent`, `followup_agent`
- cases: 5 synthetic cases per agent
- repetitions: 1
- total run items: 25
- hard budget: USD 50
- concurrency: 1
- max retries: 1

The canary rejects the `gpt-5.4-mini` alias, GPT-5.5, nano models, nonsynthetic cases, more than 25 run items, and more than one repetition.

## Configuration

Evaluation live calls are separate from classroom live calls:

```text
EVAL_PROVIDER=openai
EVAL_LIVE_CALLS_ENABLED=true
EVAL_TARGET_MODEL=gpt-5.4-mini-2026-03-17
EVAL_REASONING_EFFORT=low
EVAL_COST_HARD_LIMIT_USD=50
OPENAI_API_KEY=<set locally, never commit>
```

Classroom settings should remain:

```text
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
```

Do not enter an API key in the browser or chat. Store it only in `.env.local`, which is ignored by Git.

## Manual Procedure

After editing `.env.local` locally:

```bash
npm run eval:live-canary:preflight
npm run eval:live-canary:dry-run
npm run eval:live-canary -- --confirm-paid-api
```

After completion:

```bash
npm run eval:live-canary:report -- --run <run_public_id>
```

Without `--confirm-paid-api`, the paid command refuses to run.

To inspect an existing live canary run without making any provider request:

```bash
npm run eval:live-canary:inspect -- --run <run_public_id>
```

The inspect command is read-only. It displays the run status, item statuses,
provider response/request IDs where present, whether raw output and usage are
persisted, where usage was found, sanitized error categories/messages, whether
the run is safe to resume, and whether a fresh run is recommended. It never
prints API keys, authorization headers, database URLs, session secrets, cookies,
or raw environment values.

## Execution Rules

Live-provider canary execution:

- uses the server-only OpenAI provider and Responses API
- uses Structured Outputs with the exact agent output schema
- sends no tools, web search, file search, code interpreter, remote MCP, or function calls
- sets `store: false`
- sends each synthetic case as one stateless provider request
- persists only eval records
- never creates operational `agent_calls`, profiles, decisions, follow-up rounds, item verification runs, process events, workflow jobs, sessions, responses, or content changes

The teacher UI can display live-run metadata and results, but it does not contain a paid-run start button, API-key field, or budget-bypass control.

## Resume

Live canary runs are resumable by run ID. Completed run items are skipped. Pending or retryable items may continue according to the retry policy. Permanent failures remain preserved and are not silently replaced.

Runs with status `budget_unverifiable` are not automatically resumable. If a
provider request was counted but usage was not persisted, the budget guard cannot
verify cost for that request. Use the inspect command and start a fresh canary
run unless a teacher/researcher intentionally performs a documented manual
recovery action outside the automated runner.

## Usage Parsing

The live canary parser accepts the current Responses API usage shape:

```text
usage.input_tokens
usage.output_tokens
usage.total_tokens
usage.input_tokens_details.cached_tokens
usage.output_tokens_details.reasoning_tokens
```

It also accepts the normalized internal provider shape and optional missing
cached/reasoning-token details. If usage is missing or token fields are
malformed, the run pauses as `budget_unverifiable`; the runner does not
fabricate token counts or continue through remaining cases.
