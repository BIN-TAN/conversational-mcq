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

Before budget reservation, the runner verifies that the provider-facing output
schema compiles for OpenAI Structured Outputs. A local schema compatibility
failure is marked `structured_output_schema_incompatible`; it is not a dispatched
provider request and does not increment `provider_request_count`.

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
- marks malformed usage as `budget_unverifiable`
- pauses rather than continuing when cost cannot be verified

Retries count toward the provider request limit. Mock token metadata used in smoke tests is not real billing data.

The Phase 7E2A parser supports the Responses API usage shape:

```text
usage.input_tokens
usage.output_tokens
usage.total_tokens
usage.input_tokens_details.cached_tokens
usage.output_tokens_details.reasoning_tokens
```

Cached-input and reasoning-token details may be absent and remain blank/null in
the database. Required input/output token counts must be finite non-negative
integers. The runner never estimates actual cost from malformed provider usage.

## Smoke Test

```bash
npm run eval:budget-smoke
```

This test uses no OpenAI calls.

## Phase 7E2B Pilot Budget Guard

The pilot uses the same conservative reservation model but with pilot-specific
environment variables: USD 50 hard limit, max provider requests 150, concurrency
1, and max retries 1. Missing provider usage pauses the run as
`budget_unverifiable`; the runner does not fabricate token counts.
