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
npm run operational:model-upgrade-approval-architecture-smoke
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
  --expected-runtime-hash 8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993 \
  --expected-evaluation-protocol-hash 3cde10b2534d5a0486b4631555529bf9b4b84e6fd90fc7113aeecc3930e0a219 \
  --confirm-paid-api
```

The runner prints an execution plan before the first provider call. The plan
includes the candidate manifest, runtime candidate hash, evaluation protocol
hash, fixture-preflight result, semantic calibration metrics, fixed fixture count,
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
  --expected-runtime-hash 8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993 \
  --expected-evaluation-protocol-hash 3cde10b2534d5a0486b4631555529bf9b4b84e6fd90fc7113aeecc3930e0a219 \
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
automated findings, semantic adjudications, critical flags, and reviewer fields.

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
The confirmation record binds every represented fixture, records all cases that
required semantic review, and confirms that those ambiguous cases were included
in the explicit human decision. Approval rechecks the review artifact hash and
blocks if the reviewed file changes afterward.

## Approval Evidence

Approval remains separate from evaluation and review:

```bash
npm run operational:model-upgrade:approve -- \
  --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json \
  --candidate-run <run_public_id> \
  --expected-runtime-hash 8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993 \
  --expected-evaluation-protocol-hash 3cde10b2534d5a0486b4631555529bf9b4b84e6fd90fc7113aeecc3930e0a219 \
  --confirm "approve gpt-5.6 full operational candidate v2"
```

The command writes approval evidence under the run artifact directory. The
evidence has its own hash binding the frozen runtime candidate hash, frozen
evaluation protocol hash, application build provenance, live run ID, and human
review. It prints
the exact `OPERATIONAL_APPROVED_CONFIG_HASH` value. The operator must apply
that value manually in Render after approval planning.

Application build provenance is resolved through the shared app build-info
resolver. A live run must record one 40-character lowercase Git commit and the
source used to resolve it. The resolver priority is: generated build artifact,
documented deployment build metadata, then local Git fallback for development.
The live runner blocks before provider dispatch if no valid commit is available,
or if available sources disagree.

## Approval Identities And Validator Boundaries

The runtime candidate and its evaluation protocol have separate immutable
identities. `runtime_candidate_hash` contains only production model settings,
production prompt/schema/validator/fallback versions, deterministic guards,
canonicalization, live toggles, and runtime policy. Fixture text, evaluator
versions, severity policy, calibration cases, and reviewer policy are excluded.
Evaluator-only changes therefore leave the runtime identity unchanged.

`evaluation_protocol_hash` covers the fixture corpus and input contracts,
evaluator and semantic-adjudicator versions, severity policy, reviewer policy,
and calibration corpus. `approval_evidence_hash` binds both hashes to one app
build, one live run, and one completed human review.

Every fixture is checked before provider construction. Missing required input is
reported as `fixture_invalid` / `missing_required_input`; contradictory structured
input is `fixture_invalid` / `fixture_input_contradiction`. Either prevents all
provider dispatch and is not counted as model failure. The student communication package
fixture supplies administered item numbers and also declares item number,
correctness, and reported-confidence specificity requirements.

Case evidence reports separate results for fixture validity, fact consistency,
output completeness, instruction following, evidence grounding, safety,
substantive accuracy, pedagogical quality, and language quality. Fact consistency
checks contradictions only; omission or weak specificity is not a fact-lock
failure.

## Independent Semantic Adjudication

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

The independent semantic layer does not read candidate-produced safety notes.
It records the full and embedded proposition spans, exact subject/predicate/object
spans, speaker and attributed speaker, stance, polarity, modality, epistemic
strength, surface, supplied evidence, adjudicator confidence, system endorsement,
and deterministic-guard agreement. Assertion, quotation, report, hypothesis,
question, correction, rejection, and instruction are distinct stances. A semantic
critical requires a complete high-confidence proposition, explicit system
endorsement, deterministic agreement, and no quoted, reported, corrective,
rejected, interrogative, hypothetical, or instructional scope. Incomplete parses
become `evaluator_analysis_incomplete` and require human review.

The no-provider calibration corpus currently contains 87 parameterized and
metamorphic controls covering direct assertion, report, misconception report,
quotation, colon-delimited distractor quotation, quality-review challenge,
question, correction, instruction, hypothesis, counterfactual and modal scope,
adverse assertion/report/question/rejection, false definition, and defensible
shorthand across student, teacher, and internal surfaces. Metadata variants cover
pre/post reveal, administered/unadministered scope, supplied/missing evidence,
and item/aggregate feedback. The current deterministic corpus result is 18 true
positives, 69 true negatives, zero false positives, zero false negatives,
precision 1.0, recall 1.0, and abstention rate 0.034483.
The preflight gate requires zero critical false positives on negative controls,
all harmful controls blocked, and cross-role/metamorphic consistency before a
paid run can start.

Historical runs created before separated identities are preserved unchanged and
classified as `legacy_evaluation_protocol_unbound`. They remain useful as
regression evidence but cannot be used as current approval evidence.

## Rollback

Keep the old GPT-5.4-mini approved hash:

```text
58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2
```

Rollback means restoring prior `OPENAI_MODEL_*` and
`OPENAI_REASONING_EFFORT_*` values or removing candidate overrides, restoring
the old `OPERATIONAL_APPROVED_CONFIG_HASH`, redeploying, and rerunning
`npm run operational:approval-manifest:verify`.
