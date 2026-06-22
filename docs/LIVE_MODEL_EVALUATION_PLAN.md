# Live Model Evaluation Plan

Phase 7E1 does not run live model evaluation. This document records the future Phase 7E2 plan so current code can store safe metadata without enabling provider calls.

## Planned Target

```text
target model: gpt-5.4-mini
cases: 10 per active agent
repetitions: 2
budget hard limit: USD 50
```

No GPT-5.5 comparison is included in the current plan. No nano comparison is included in the current plan.

## Required Future Gates

Live evaluation should remain disabled until all of these are true:

- server-side `OPENAI_API_KEY` is configured
- live-call environment gates are enabled intentionally
- `EVAL_LIVE_CALLS_ENABLED=true`
- budget and usage guards are active
- evaluation cases are synthetic, teacher-authored, or intentionally deidentified
- no classroom workflow records are mutated by eval runs
- no API key is entered or displayed in the browser

## Future Procedure

1. Seed or review evaluation cases.
2. Confirm active agent contracts and prompt versions.
3. Run mock evaluation first.
4. Enable live evaluation on the server only.
5. Run the target model on the same cases.
6. Perform blind expert annotation.
7. Review critical failures before any classroom activation.

## Current Limitation

Synthetic development evaluation can expose schema, safety, and prompt-following risks, but it is not classroom validation. A later classroom validation plan is still required before relying on live agent behavior for research interpretation.
