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
npm run operational:evaluation-proposition-analysis-smoke
npm run operational:evaluation-evidence-grounding-smoke
npm run operational:evaluation-pedagogical-quality-smoke
npm run operational:evaluation-production-schema-fidelity-smoke
npm run operational:evaluation-run-provenance-smoke
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
destination, application Git commit, evaluator versions, artifact-persistence
warning, and review requirement.

Budget variables:

```text
OPERATIONAL_MODEL_UPGRADE_EVAL_MAX_CALLS
OPERATIONAL_MODEL_UPGRADE_EVAL_MAX_INPUT_TOKENS
OPERATIONAL_MODEL_UPGRADE_EVAL_MAX_OUTPUT_TOKENS
OPERATIONAL_MODEL_UPGRADE_EVAL_MAX_REASONING_TOKENS
OPERATIONAL_MODEL_UPGRADE_EVAL_BUDGET_USD
OPERATIONAL_MODEL_UPGRADE_EVAL_CONCURRENCY
OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED
```

When pricing metadata is unavailable, the runner reports token usage and does
not invent a dollar cost.

`OPERATIONAL_MODEL_UPGRADE_ARTIFACT_PERSISTENCE_VERIFIED=1` is an operator
attestation that the run artifact destination is on a durable mount suitable for
production approval evidence. If it is not set, local development runs are still
allowed, but the live runner warns before dispatch and the approval command
blocks with `artifact_persistence_not_verified`.

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
  --expected-hash 13aa85c914a60bae83afe06181596766934ca0bc5ff747322afd066a97122c5d \
  --confirm "approve gpt-5.6 full operational candidate v2"
```

The command writes approval evidence under the run artifact directory and prints
the exact `OPERATIONAL_APPROVED_CONFIG_HASH` value. The operator must apply
that value manually in Render after approval planning.

Application build provenance is resolved through the shared app build-info
resolver. A live run must record one 40-character lowercase Git commit and the
source used to resolve it. The resolver priority is: generated build artifact,
documented deployment build metadata, then local Git fallback for development.
The live runner blocks before provider dispatch if no valid commit is available,
or if available sources disagree.

## Proposition-Aware Automated Evaluation

The current full-v2 candidate uses `eval-safety-v5` with
`eval-surface-policy-v1`, `eval-claim-polarity-v1`,
`eval-answer-reveal-policy-v1`, `eval-topic-boundary-v2`, and
`evaluation-finding-provenance-v1`, plus `eval-proposition-analysis-v2`,
`eval-evidence-grounding-v1`, `eval-pedagogical-quality-v2`,
`eval-production-schema-fidelity-v1`, `eval-run-provenance-v2`, and
`eval-artifact-persistence-warning-v1`. Automated findings must identify the
evaluated surface, field, exact text span, proposition polarity, fixture policy,
reveal policy, blocking status, evaluator version, evidence support level, and
production-schema fidelity. Teacher-tool answer-key text, internal safety notes,
and utility metadata are not evaluated as rendered student content. Student
answer-key checks are reveal-policy aware, unsupported claim checks evaluate
complete propositions instead of isolated protected phrases, and off-topic
topic-dialogue checks distinguish a substantive unrelated answer from a refusal
plus redirect.

The evaluator records structured claims with a complete proposition and exact
clause, speaker/source, assertion-versus-mention classification, claim type,
subject, predicate, object, polarity, modality, epistemic strength, source field,
evidence references, and whether the claim converts behavior into a latent trait.
Reported student misconceptions, quoted distractors, and corrective statements
are retained as audit claims but are not treated as system endorsement. Unsupported affirmative
claims about stable ability, motivation, effort, misconduct, or cheating block.
Negated or prohibitive propositions such as "not evidence of low ability" do
not block merely because they mention the protected concept. Unsupported
engagement labels require a defined construct, explicit indicators, scoring
rule, and traceable evidence; otherwise observable process descriptions are
preferred.

## Rollback

Keep the old GPT-5.4-mini approved hash:

```text
58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2
```

Rollback means restoring prior `OPENAI_MODEL_*` and
`OPENAI_REASONING_EFFORT_*` values or removing candidate overrides, restoring
the old `OPERATIONAL_APPROVED_CONFIG_HASH`, redeploying, and rerunning
`npm run operational:approval-manifest:verify`.
