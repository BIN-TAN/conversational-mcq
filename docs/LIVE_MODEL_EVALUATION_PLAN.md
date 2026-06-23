# Live Model Evaluation Plan

Phase 7E2A implements a guarded 25-call live canary runner but does not execute it automatically. The deployment owner must configure the API key locally and run the CLI command explicitly.

## Phase 7E2A Canary Target

```text
target model snapshot: gpt-5.4-mini-2026-03-17
reasoning effort: low
cases: 5 synthetic cases per active agent
repetitions: 1
total run items: 25
budget hard limit: USD 50
```

No GPT-5.5 comparison is included. No nano comparison is included. The 100-call full pilot belongs to a later phase.

## Required Future Gates

Live evaluation should remain disabled until all of these are true:

- server-side `OPENAI_API_KEY` is configured
- live-call environment gates are enabled intentionally
- `EVAL_PROVIDER=openai`
- `EVAL_LIVE_CALLS_ENABLED=true`
- `EVAL_TARGET_MODEL=gpt-5.4-mini-2026-03-17`
- `EVAL_REASONING_EFFORT=low`
- provider-facing output schemas compile for OpenAI Structured Outputs
- budget and usage guards are active
- evaluation cases are synthetic only for Phase 7E2A
- no classroom workflow records are mutated by eval runs
- no API key is entered or displayed in the browser

## Future Procedure

1. Confirm classroom settings remain `LLM_PROVIDER=mock` and `LLM_LIVE_CALLS_ENABLED=false`.
2. Edit `.env.local` manually with eval-only live settings and `OPENAI_API_KEY`.
3. Run `npm run eval:structured-output-compat-smoke`.
4. Run `npm run eval:live-canary:preflight`.
5. Run `npm run eval:live-canary:dry-run`.
6. Run `npm run eval:live-canary -- --confirm-paid-api`.
7. Perform blind expert annotation on all 25 run items.
8. Run `npm run eval:live-canary:report -- --run <run_public_id>`.
9. Review readiness gates before considering any future full pilot.

## Phase 7E2B Full Pilot Procedure

After an approved canary is available, run the full pilot with:

```bash
npm run eval:live-pilot:preflight -- --approved-canary <run_public_id>
npm run eval:live-pilot:dry-run -- --approved-canary <run_public_id>
npm run eval:live-pilot -- --approved-canary <run_public_id> --confirm-paid-api --new-run
npm run eval:live-pilot:report -- --run <pilot_run_public_id>
```

The full pilot uses 100 outputs, a USD 50 hard limit, max provider requests 150,
concurrency 1, and max retries 1. Passing the pilot is a controlled integration
gate, not classroom validation.

## Current Limitation

Synthetic development evaluation can expose schema, safety, and prompt-following risks, but it is not classroom validation. A later classroom validation plan is still required before relying on live agent behavior for research interpretation.
