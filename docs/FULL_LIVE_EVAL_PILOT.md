# Phase 7E2B Full Live Evaluation Pilot

Phase 7E2B adds a guarded full-pilot runner for evaluation records only. It does
not enable live OpenAI calls in classroom workflows and does not run automatically.

## Approved Prerequisite

The pilot requires an approved 25-item canary run supplied by CLI flag or
server-side environment:

```bash
--approved-canary <run_public_id>
EVAL_PILOT_APPROVED_CANARY_RUN_ID=<run_public_id>
```

The approved canary must be completed, use `gpt-5.4-mini-2026-03-17`, use
`reasoning_effort=low`, have 25 confirmed human Pass annotations, have zero
confirmed human critical failures, pass the known-failure regression gate, and
carry recommendation `ready_for_full_pilot`.

## Pilot Design

The full pilot uses:

- five active agents
- ten synthetic base cases per agent
- two repetitions per base case
- 100 total eval run items
- exact model snapshot `gpt-5.4-mini-2026-03-17`
- `reasoning_effort=low`
- USD 50 hard cost limit
- max provider requests 150
- concurrency 1
- max retries 1

The manifest is `tests/fixtures/evals/live-pilot-manifest.json`. It has two
strata:

- `internal_holdout`: the five Phase 7E1 synthetic cases per agent not used in the canary
- `replication`: the exact five canary cases per agent

The runner rejects nonsynthetic cases. It does not read operational student
records, summative outcomes, profiles, decisions, follow-up rounds, content
records, sessions, item responses, or process events as eval input.

## Manual Commands

Do not paste an API key into chat or the browser. Configure `.env.local`
manually, keeping classroom live calls disabled:

```text
EVAL_PILOT_PROVIDER=openai
EVAL_PILOT_LIVE_CALLS_ENABLED=true
EVAL_PILOT_APPROVED_CANARY_RUN_ID=<approved_canary_run_public_id>
EVAL_PILOT_TARGET_MODEL=gpt-5.4-mini-2026-03-17
EVAL_PILOT_REASONING_EFFORT=low
EVAL_PILOT_COST_HARD_LIMIT_USD=50
OPENAI_API_KEY=<set locally, never commit>

LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
```

Then run:

```bash
npm run eval:live-pilot:preflight -- --approved-canary <run_public_id>
npm run eval:live-pilot:dry-run -- --approved-canary <run_public_id>
npm run eval:live-pilot -- --approved-canary <run_public_id> --confirm-paid-api --new-run
```

Resume only a nonterminal pilot run:

```bash
npm run eval:live-pilot -- --confirm-paid-api --resume <pilot_run_public_id>
```

Inspect and report:

```bash
npm run eval:live-pilot:inspect -- --run <pilot_run_public_id>
npm run eval:live-pilot:report -- --run <pilot_run_public_id>
```

## Readiness

The deterministic report recommendation is one of:

- `ready_for_controlled_operational_integration`
- `not_ready_for_controlled_operational_integration`
- `incomplete_review`

The report is labelled `full pilot readiness` and `classroom_validity=false`.
It is not classroom validation.

## Smoke Tests

All smoke tests use mock/fake providers and make no OpenAI calls:

```bash
npm run eval:pilot-manifest-smoke
npm run eval:live-pilot-runner-smoke
npm run eval:pilot-stability-smoke
npm run eval:pilot-blind-export-smoke
npm run eval:pilot-annotation-smoke
npm run eval:pilot-report-smoke
```
