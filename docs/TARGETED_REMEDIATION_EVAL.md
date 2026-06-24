# Targeted Remediation Evaluation

Phase 7E2C adds a guarded, CLI-only targeted regression path for the six failed
base cases from full pilot run `evr_20260623_ga6kzai`.

It does not run automatically, does not call OpenAI during normal tests, does
not use operational student data, does not mutate classroom records, and does
not modify the completed full pilot.

## Manifest

The manifest is `tests/fixtures/evals/targeted-remediation-manifest.json`.

Affected cases, two repetitions each:

- `rca_mixed_reasoning_correctness_007`
- `iva_duplicate_items_010`
- `fua_move_on_offer_010`
- `fua_consolidation_transfer_006`
- `fpa_mapping_followed_006`
- `fpa_mapping_deviation_with_rationale_007`

Control cases, two repetitions each:

- `iva_clean_item_set_001`
- `rca_hint_request_004`
- `spa_robust_understanding_001`
- `fpa_diagnostic_clarification_001`
- `fua_off_topic_redirect_007`

Total planned outputs: 22.

## Configuration

Targeted paid runs use:

- model snapshot: `gpt-5.4-mini-2026-03-17`
- reasoning effort: `low`
- max concurrency: 1
- max retries: 1
- max provider requests: 35
- cost hard limit: USD 10

Classroom configuration remains independent and disabled by default:

```text
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
```

## Commands

Preflight and dry run make no provider request:

```bash
npm run eval:targeted-remediation:preflight
npm run eval:targeted-remediation:dry-run
```

Paid execution requires explicit local approval:

```bash
npm run eval:targeted-remediation -- --confirm-paid-api --new-run
npm run eval:targeted-remediation -- --confirm-paid-api --resume <run_public_id>
```

Read-only inspection and report:

```bash
npm run eval:targeted-remediation:inspect -- --run <run_public_id>
npm run eval:targeted-remediation:report -- --run <run_public_id>
```

Blind review uses the existing review exporter:

```bash
npm run eval:blind-review-export -- --run <targeted_run_public_id>
```

The blind packet hides case IDs, affected/control classification, repetition
index, model/provider metadata, automated results, gold labels, cost, token
usage, and existing annotations.

## Readiness Gates

The deterministic report uses these recommendation values:

- `ready_for_guarded_integration_patch`
- `not_ready_for_guarded_integration_patch`
- `incomplete_review`

Required gates:

- planned outputs = 22
- terminal outputs = 22
- schema pass rate = 100%
- review annotations = 22
- review critical failures = 0
- estimated cost <= USD 10
- all 12 affected outputs receive reviewed Pass
- at least 9 of 10 control outputs receive reviewed Pass
- no agent has both control repetitions fail

Engineering gates also check exact reasoning substring capture, correctness
refusal, backend-canonical planning mapping, follow-up saved-target and move-on
semantics, backend-owned process event metadata, and deterministic duplicate
advisory behavior.

The report always includes `classroom_validity=false`.

When review annotations are AI-confirmed, the report is labelled `provisional
engineering readiness` with `review_source=ai_agent_review`. It reports
AI-confirmed and human-confirmed counts separately and states that human review
remains pending. AI-confirmed review can drive the guarded engineering gate, but
it is not classroom validity and must not be described as human confirmation.

Confirm an AI-agent blind review with:

```bash
npm run eval:annotations:confirm-ai-review -- \
  --run <targeted_run_public_id> \
  --annotations <completed_annotation_csv_path> \
  --reference .data/eval-review/<targeted_run_public_id>/review_reference.jsonl \
  --reviewer-model gpt-5.5-pro \
  --confirm-ai-review
```

The command validates the 22-row targeted review file, preserves rubric scores
and notes, stores hashes and reviewer provenance, writes annotation revision
audit records, leaves human confirmer fields empty, and makes no provider call.

## Smoke Tests

These smoke tests use synthetic eval data and mock providers only:

```bash
npm run eval:targeted-remediation-manifest-smoke
npm run eval:targeted-remediation-runner-smoke
npm run eval:targeted-remediation-report-smoke
npm run eval:targeted-remediation-blind-export-smoke
npm run eval:ai-review-confirmation-smoke
```

They verify the 22-output manifest, deterministic ordering, two repetitions per
case, affected/control coverage, budget and request guards, remediation
engineering gates, blind-review packet shape, no operational mutation, and no
OpenAI network call.
