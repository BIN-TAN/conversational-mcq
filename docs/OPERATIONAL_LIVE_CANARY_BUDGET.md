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
