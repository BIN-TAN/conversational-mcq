# Operational Model-Upgrade Evaluation And Review

The GPT-5.6 full-v2 candidate is evaluated through an isolated synthetic
workflow. It does not approve the candidate, does not alter the approved
GPT-5.4-mini baseline, and does not route classroom traffic to candidate
models.

## No-Live Checks

```bash
npm run operational:model-upgrade:preflight -- --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json
npm run operational:model-upgrade:dry-run -- --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json
npm run operational:model-upgrade:compare -- --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json
npm run operational:model-upgrade:report -- --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json
npm run operational:model-upgrade-live-eval-runner-smoke
npm run operational:model-upgrade-human-review-smoke
npm run operational:model-upgrade-approval-evidence-smoke
```

These commands make no OpenAI calls.

## Paid Live Evaluation

The live runner is blocked unless all explicit guards are present:

```bash
RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL=1 \
npm run operational:model-upgrade:live-eval -- \
  --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json \
  --confirm-paid-api
```

The runner prints an execution plan before the first provider call. The plan
includes the candidate manifest, active candidate hash, fixed fixture count,
role-to-model mapping, token ceilings, call ceiling, concurrency, persistence
destination, and review requirement.

Budget variables:

```text
OPERATIONAL_MODEL_UPGRADE_EVAL_MAX_CALLS
OPERATIONAL_MODEL_UPGRADE_EVAL_MAX_INPUT_TOKENS
OPERATIONAL_MODEL_UPGRADE_EVAL_MAX_OUTPUT_TOKENS
OPERATIONAL_MODEL_UPGRADE_EVAL_MAX_REASONING_TOKENS
OPERATIONAL_MODEL_UPGRADE_EVAL_BUDGET_USD
OPERATIONAL_MODEL_UPGRADE_EVAL_CONCURRENCY
```

When pricing metadata is unavailable, the runner reports token usage and does
not invent a dollar cost.

## Resume

If the run is interrupted:

```bash
RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL=1 \
npm run operational:model-upgrade:live-eval -- \
  --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json \
  --confirm-paid-api \
  --resume-run <run_public_id>
```

Completed successful fixture calls are reused. Failed or missing cases remain
visible in the run evidence.

## Human Review

Export review artifacts:

```bash
npm run operational:model-upgrade:review-export -- --candidate-run <run_public_id>
```

The export includes a JSONL review record for every fixed fixture, rendered
student-facing text where applicable, teacher-tool text where applicable,
automated findings, critical flags, and reviewer fields.

Record review:

```bash
npm run operational:model-upgrade:review-confirm -- \
  --candidate-run <run_public_id> \
  --review-artifact .data/operational-model-upgrade/runs/<run_public_id>/review/review_records.jsonl \
  --confirm "I reviewed all required candidate outputs" \
  --decision approve \
  --reviewer <safe_identifier>
```

Critical automated failures cannot be approved silently.

## Approval Evidence

Approval remains separate from evaluation and review:

```bash
npm run operational:model-upgrade:approve -- \
  --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json \
  --candidate-run <run_public_id> \
  --expected-hash 6ed800423d93ea29b0857968e6caf803955a5de9f8ad8b7ed68e4ea6d18b907e \
  --confirm "approve gpt-5.6 full operational candidate v2"
```

The command writes approval evidence under the run artifact directory and prints
the exact `OPERATIONAL_APPROVED_CONFIG_HASH` value. The operator must apply
that value manually in Render after approval planning.

## Rollback

Keep the old GPT-5.4-mini approved hash:

```text
58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2
```

Rollback means restoring prior `OPENAI_MODEL_*` and
`OPENAI_REASONING_EFFORT_*` values or removing candidate overrides, restoring
the old `OPERATIONAL_APPROVED_CONFIG_HASH`, redeploying, and rerunning
`npm run operational:approval-manifest:verify`.
