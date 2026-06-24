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
npm run eval:targeted-remediation:diagnose -- --run <run_public_id>
```

The diagnostic command is read-only. It separates raw provider output, parsed
provider output, semantic and safety validation, deterministic safeguards,
backend-canonical/effective results, blind-review annotations, and report-gate
inputs. It is intended for audit before any remediation patch; it does not make
provider calls and does not mutate eval or operational classroom records.

Blind review uses the existing review exporter:

```bash
npm run eval:blind-review-export -- --run <targeted_run_public_id>
```

The blind packet hides case IDs, affected/control classification, repetition
index, model/provider metadata, automated results, gold labels, cost, token
usage, and existing annotations.

## Raw Versus Effective Review

Phase 7E2C keeps two review targets:

- `raw_model_output`: the raw parsed provider output. Existing AI-confirmed
  annotations for `evr_20260624_bltzgtq` remain in this layer and are not
  rewritten.
- `effective_system_output`: the behavior the backend would expose after
  deterministic safeguards, backend canonicalization, and safe fallback logic.

Raw model failures remain visible. A raw failure can be operationally acceptable
only when the effective artifact shows that the backend prevents unsafe
student-facing behavior or incorrect workflow mutation.

Generate an effective-system blind packet with:

```bash
npm run eval:blind-review-export -- \
  --run <targeted_run_public_id> \
  --review-target effective_system_output
```

This writes `effective-system-eval-v2` artifacts under
`.data/eval-review/<run_public_id>/effective-system-v2/`. The blind packet
shows synthetic input, effective student-facing behavior, effective structured
result, effective workflow actions, rubric, and safety expectations. It hides
case ID, affected/control status, repetition index, raw failure status, fallback
status, previous review result, model/provider metadata, automated flags, and
gold labels. The separate reference file keeps raw/effective comparison data for
adjudication.

The original `effective-system-eval-v1` artifacts for
`evr_20260624_bltzgtq` remain preserved. Their AI-confirmed effective-system
review is 20 Pass / 2 Fail, and both Fail judgments are the two
`fua_move_on_offer_010` repetitions. The v1 failure was not a paid-model rerun
issue; it was a deterministic fallback issue where an explicit student move-on
request received another transfer task and `should_offer_move_on=false`.

`effective-system-eval-v2` corrects only that fallback. A clear student
move-on request is nonsubstantive conceptual evidence, sets
`should_offer_move_on=true`, may request the technical final-follow-up update,
prepares concept progression through backend-owned workflow actions, preserves
unresolved-evidence confirmation, and does not directly mark the concept
complete or choose the next concept. The v2 AI blind review is stored as 22
Pass / 0 Fail with zero critical-failure flags; v1 judgments must not be copied
onto v2 hashes. Human review remains pending and classroom validity remains
false.

## Readiness Gates

The deterministic report uses these recommendation values:

- `ready_for_guarded_integration_patch`
- `not_ready_for_guarded_integration_patch`
- `incomplete_review`

Required effective-system gates:

- planned outputs = 22
- terminal outputs = 22
- schema pass rate = 100%
- effective-system review annotations = 22
- effective-system artifact version = `effective-system-eval-v2`
- effective-system review critical failures = 0
- estimated cost <= USD 10
- all 22 effective results are safe and usable
- effective student-facing failures = 0
- effective workflow failures = 0
- effective critical failures = 0
- all four effective engineering gates pass

Engineering gates check exact reasoning substring capture, correctness refusal,
backend-owned option/confidence controls, backend-canonical planning mapping,
safe planning fallback, safe follow-up fallback, backend-owned process event
metadata, and deterministic duplicate advisory behavior.

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
  --reference .data/eval-review/<targeted_run_public_id>/effective-system-v2/review_reference.jsonl \
  --reviewer-model gpt-5.5-pro \
  --review-target effective_system_output \
  --review-artifact-version effective-system-eval-v2 \
  --confirm-ai-review
```

The command validates row/reference/run mapping, preserves rubric scores and
notes, stores hashes and reviewer provenance, writes annotation revision audit
records, leaves human confirmer fields empty, and makes no provider call.

## Smoke Tests

These smoke tests use synthetic eval data and mock providers only:

```bash
npm run eval:targeted-remediation-manifest-smoke
npm run eval:targeted-remediation-runner-smoke
npm run eval:targeted-remediation-report-smoke
npm run eval:targeted-remediation-blind-export-smoke
npm run eval:ai-review-confirmation-smoke
npm run eval:targeted-remediation-diagnostic-smoke
npm run eval:effective-system-artifact-smoke
npm run eval:effective-move-on-fallback-smoke
npm run eval:effective-system-report-smoke
npm run eval:effective-system-blind-export-smoke
npm run eval:effective-system-annotation-smoke
```

They verify the 22-output manifest, deterministic ordering, two repetitions per
case, affected/control coverage, budget and request guards, remediation
engineering gates, blind-review packet shape, no operational mutation, and no
OpenAI network call.
