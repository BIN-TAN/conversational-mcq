# Evaluation Reproducibility

Each Phase 7E2A live canary run stores a reproducibility manifest in eval tables.

## Frozen Fields

Once a run is created, it freezes:

- run public ID
- run mode
- exact model snapshot
- reasoning effort
- agent order
- case IDs
- case manifest hash
- case payload hash per item
- prompt versions
- schema versions
- prompt hashes
- agent versions
- OpenAI SDK version
- application Git commit
- evaluation configuration hash
- max output token settings
- retry settings
- request timeout
- concurrency
- pricing registry version
- budget limit
- creation time

Prompt, schema, case, model, and budget changes require a new eval run. Failed quality cases should not be selectively rerun under the same canary run after prompt tuning.

## Manifest

The stable canary manifest is:

```text
tests/fixtures/evals/live-canary-manifest.json
```

It contains exactly 25 synthetic case IDs: five per active agent. The runner validates this manifest before dry run or paid execution.

## Export

Eval CSV export includes:

- model snapshot
- reasoning effort
- max output tokens
- provider response/request IDs
- retry count
- token fields
- estimated cost
- automated and human critical failure flags
- annotation source and annotation status
- canary gate status
- case manifest hash
- run config hash
- Git commit

Secrets and internal database UUIDs are not exported.

Annotation adjudication preserves provenance. AI-assisted preliminary imports
remain marked as `ai_assisted_preliminary`; confirmation changes status from
`draft` to `confirmed` and records the confirming teacher and timestamp. The
readiness report preserves automated screening flags, confirmed human critical
flags, human failed case IDs, and auto-human disagreement counts as distinct
fields.
