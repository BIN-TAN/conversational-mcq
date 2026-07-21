# E2A.26 Semantic Evaluation-Oracle Calibration

E2A.26 is a no-live diagnostic and replay phase over the immutable E2A.25 run
`e2a25_20260721000435_bf179fb6`. It does not relabel E2A.25 as passed, rerun a
provider output, modify the autonomous candidate, authorize E2A.27, or approve
or activate any candidate.

## Derived diagnosis

The historical code `e2a25_genuine_false_sound` is not factually precise for
Session C turn 2. The production profile classified the copied response as
`misconception`, kept revision readiness false, and remained in formative
dialogue. The frozen exact-label oracle expected `insufficient_copied_wording`
and treated that defensible non-sound label difference as a candidate failure.

E2A.26 records the derived diagnosis
`e2a25_historical_failure_caused_by_frozen_oracle_overconstraint`. Historical
E2A.25 files and status remain unchanged.

The authoritative no-live E2A.26 run is
`e2a26_20260721222943_37b534d9` under
`.data/e2a26-semantic-oracle-calibration/`. Its status is
`e2a26_session_c_evidence_incomplete`, reflecting the unrecoverable historical
evaluator packet rather than a candidate-quality failure. The run produced all
22 required artifacts, made zero provider calls and zero network requests, and
verified byte-identical protected evidence before and after generation.

The independent adjudication prefers `insufficient` because the response
echoes the prior trace without independently explaining the ordering
mechanism. `Misconception` remains inside the accepted classroom formative
envelope because the active incorrect relationship is unresolved. Neither
classification permits revision, transfer, or completion.

## Evaluation-only contracts

- `e2a26-semantic-profile-envelope-v1` accepts pedagogically defensible label
  variation while preserving progression invariants.
- `e2a26-autonomous-canary-oracle-v1` reserves `genuine_false_sound` for a
  production profile that is actually sound or revision-ready without
  supporting observable evidence.
- `e2a26-failure-path-artifact-policy-v1` requires every attempted call and
  generated output to remain represented after a fail-closed decision.

Exact-label differences inside an accepted envelope create review flags, not
candidate failures. Genuine false sound, genuine sound false negatives,
premature progression, stale context, missing evaluators, tutor calls after
sound, and failure-path omissions remain hard failures.

## Historical evidence limitation

The E2A.25 failure occurred after the Session C turn-2 simulator, evaluator,
and tutor calls completed. The downstream tutor request preserves the
authoritative production profile, and the tutor provider output is preserved.
However, the historical harness did not append the exact Session C turn-2
simulator provider envelope, evaluator request, evaluator provider output,
criterion results, route row, validator row, privacy row, transcript row, or
human-review tutor item before abort.

E2A.26 does not fabricate those records. Derived artifacts identify each
stage as completed, generated but not displayed, not reached, or missing. The
complete derived review packet adds the preserved tutor message with
`provider_generated=true`, `persisted=false`,
`displayed_to_student=false`, and
`suppression_reason=harness_oracle_abort`. All human decisions remain null.

## Calibration

The deterministic corpus contains 72 cases across chemistry, linguistics,
economics, computer science, biology, and measurement theory. Sixty cases are
non-IRT. It includes copied wording, explicit misconceptions, partial
boundaries, sound noncanonical reasoning, low-confidence sound reasoning,
polished misconceptions, genuine false-sound controls, and genuine
sound-false-negative controls.

## E2A.27 draft

E2A.27 is a fresh, one-session chemistry equilibrium and kinetics protocol.
It tests informal language, copied wording, a retained contradiction, later
independent application, and immediate revision after sound evidence. It does
not reuse the binary-search concept or wording.

The future maximum is one session, eight simulator calls, eight evaluator
calls, eight initial tutor calls, two tutor regenerations, 26 logical calls,
78 adapter attempts, 800,000 input tokens, 60,000 output tokens, 860,000 total
tokens, USD 20, and concurrency one. These are future ceilings, not live
authorization.

## Commands

```bash
npm run eval:formative:e2a26:run
npm run eval:formative:e2a26:report -- --run <run_id>
npm run eval:formative:e2a26:smoke
npm run eval:formative:e2a26:semantic-envelope-smoke
npm run eval:formative:e2a26:failure-path-smoke
npm run eval:formative:e2a26:human-review-packet-smoke
npm run eval:formative:e2a26:calibration-smoke
npm run eval:formative:e2a26:e2a27-protocol-smoke
npm run eval:formative:e2a26:provider-call-guard-smoke
```

Every E2A.26 command is no-live. E2A.27 requires separate explicit
authorization and must use a new frozen source and candidate identity.
