# Operational Live Canary Budget

Phase 8C caps the guarded-live synthetic operational canary at:

```text
maximum logical invocations: 60
planned logical invocations: 30
maximum provider requests: 80
maximum concurrency: 1
maximum retries: 1
hard cost limit: USD 15
request timeout: 60000 ms
```

The preflight and dry-run commands make no provider request. They validate the manifest, planned invocation graph, approved model snapshot, operational configuration hash, and budget/request caps.

Provider request count and estimated cost are now derived from
`operational_live_canary_dispatch_attempts`. A request is counted only when the
dispatch ledger shows a provider execution path that reached the provider
boundary. Usage must be verified before a run can continue through the full
canary. If usage is unavailable, the run pauses for reconciliation rather than
continuing blindly.

Before a future paid run, the operator must configure:

```text
OPERATIONAL_LIVE_CANARY_ENABLED=true
OPERATIONAL_AGENT_MODE=guarded_live
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPENAI_API_KEY=<set locally, never commit>
OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH=58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2
```

The normal classroom defaults must remain disabled unless a separate approved phase changes them.

The budget estimate is an engineering upper-bound check for the canary. It is not an invoice prediction and is not classroom cost validation.

The full 30-step run also requires a successful one-call transport probe:

```bash
npm run operational:live-canary:transport-probe:preflight
npm run operational:live-canary:transport-probe -- --confirm-paid-api
```

The paid probe is manual only and must not run during tests.
