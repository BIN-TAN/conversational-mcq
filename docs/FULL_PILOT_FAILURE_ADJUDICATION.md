# Full Pilot Failure Adjudication

Phase 7E2B full pilot run `evr_20260623_ga6kzai` is the frozen baseline for
Phase 7E2C targeted remediation.

Baseline facts:

- model snapshot: `gpt-5.4-mini-2026-03-17`
- reasoning effort: `low`
- outputs: 100
- confirmed human Pass: 91
- confirmed human Fail: 9
- confirmed human critical failures: 0
- readiness recommendation: `not_ready_for_controlled_operational_integration`
- classroom validity: false

The baseline run must not be rewritten, resumed, rerun, or edited as part of
targeted remediation. Its outputs, confirmed annotations, amendment audit
records, token/cost records, and reproducibility manifest remain historical
evidence.

## Failed Base Cases

The nine failed outputs belong to six synthetic base cases:

- `rca_mixed_reasoning_correctness_007`
- `iva_duplicate_items_010`
- `fua_move_on_offer_010`
- `fua_consolidation_transfer_006`
- `fpa_mapping_followed_006`
- `fpa_mapping_deviation_with_rationale_007`

Adjudication separated fixture/gold-label defects from agent or contract
errors. It found no confirmed human critical failures after researcher
amendment. The pilot still did not meet readiness because the confirmed
pass/fail distribution remained below the required threshold.

## Remediation Categories

Response Collection: the previous expected behavior for
`rca_mixed_reasoning_correctness_007` incorrectly discarded a valid reasoning
sentence because the same message also asked for correctness feedback. The
correct behavior is to capture the exact valid reasoning segment while refusing
the disallowed request.

Formative Planning: the default formative-value mapping is a backend-owned
default, not an absolute rule. A non-default approved value can be acceptable
when evidence supports the deviation and a substantive reason is present.

Follow-up: saved formative value and process events are backend-owned. Move-on
requests are nonsubstantive technical final-update triggers, not new conceptual
evidence.

Item Verification: duplicate findings remain advisory. A deterministic
supplementary duplicate check can add an effective warning while preserving raw
LLM verification separately.

Evaluator corrections: negated or prohibitive statements such as `Do not assume
misconduct` are not misconduct or GenAI-use accusations. Actual accusations
remain critical failures.

## Boundary

The full pilot result is development evaluation evidence, not classroom
validation. Phase 7E2C targeted remediation may support a guarded integration
patch decision, but it does not enable classroom live model calls.
