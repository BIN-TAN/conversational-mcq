# Evaluation Reproducibility

Each Phase 7E2A live canary run stores a reproducibility manifest in eval tables.

## Run Identity

Phase 7E2A separates run-instance identity from run-configuration identity:

- `run_public_id` identifies one concrete run instance.
- `run_config_hash` identifies the frozen canary configuration used by that run.

`npm run eval:live-canary -- --confirm-paid-api --new-run` always creates a new
run instance with a new `run_public_id` and new run items. It must never return
an already completed run. Two fresh runs may have the same `run_config_hash` if
they intentionally use the same frozen configuration.

`npm run eval:live-canary -- --confirm-paid-api --resume <run_public_id>`
resumes only the specified nonterminal run. Resume is blocked for completed runs,
budget-unverifiable runs, Structured Outputs schema infrastructure failures, and
runs whose frozen configuration differs from the current canary configuration.

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
- environment configuration hash
- full run configuration fingerprint
- max output token settings
- retry settings
- request timeout
- concurrency
- pricing registry version
- budget limit
- creation time

Prompt, schema, case, model, and budget changes require a new eval run. Failed quality cases should not be selectively rerun under the same canary run after prompt tuning.

The run configuration fingerprint includes:

- exact model snapshot
- reasoning effort
- case manifest hash and manifest version
- exact ordered case IDs and input payload hashes
- repetition count
- agent names and agent versions
- prompt versions and prompt hashes
- schema versions
- per-agent max-output-token values
- semantic-validator version
- safety-validator version
- pricing-registry version
- retry settings
- timeout setting
- concurrency setting
- budget setting
- environment configuration hash
- application Git commit

The baseline run `evr_20260623_1sjeh1q` predates the quality patch and remains
preserved unchanged. The current quality-patch canary configuration must produce
a different `run_config_hash` from that baseline because prompt and evaluator
metadata changed.

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

The Phase 7E2A quality patch preserves baseline run `evr_20260623_1sjeh1q`
unchanged. Fresh canaries after the patch must record the new prompt versions,
prompt hashes, semantic evaluator version `eval-semantic-v2`, safety evaluator
version `eval-safety-v2`, and the `known-failure regression gate` result.

Read-only comparison command:

```bash
npm run eval:live-canary:compare-config -- --run evr_20260623_1sjeh1q
```

The comparison command reports current-versus-stored differences without making
a provider request and without modifying the compared run or annotations.
