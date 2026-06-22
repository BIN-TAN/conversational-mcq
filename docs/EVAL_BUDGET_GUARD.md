# Evaluation Budget Guard

Phase 7E2A uses an evaluation-specific budget guard. It does not consume or modify classroom LLM usage limits.

## Pricing Registry

The versioned pricing registry entry for the canary is:

```text
pricing_registry_version=openai-pricing-2026-06-22-v1
model_snapshot=gpt-5.4-mini-2026-03-17
input_price_per_million_tokens=0.75
cached_input_price_per_million_tokens=0.075
output_price_per_million_tokens=4.50
source_checked_at=2026-06-22
```

Pricing is based on official OpenAI pricing checked at implementation time. Prices may change; estimated cost is not an exact invoice.

## Guard Behavior

Before each provider request, the runner:

- estimates input tokens conservatively from the frozen prompt and payload
- reserves the maximum configured output-token cost
- includes retry allowance
- verifies the projected cost is within `EVAL_COST_HARD_LIMIT_USD`
- verifies projected requests are within `EVAL_MAX_PROVIDER_REQUESTS`

After the provider returns usage, the runner:

- records input, cached input, output, reasoning, and total tokens when available
- calculates estimated cost from actual usage
- updates run totals
- marks missing usage as `budget_unverifiable`

Retries count toward the provider request limit. Mock token metadata used in smoke tests is not real billing data.

## Smoke Test

```bash
npm run eval:budget-smoke
```

This test uses no OpenAI calls.
