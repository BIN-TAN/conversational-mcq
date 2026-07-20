# E2A.23a Production Evidence Reconciliation

E2A.23a is a no-live reconciliation of the six student turns preserved by the
exactly-once E2A.23 micro-canary. It does not rewrite E2A.23, call a provider,
approve the tutor candidate, activate the candidate, or authorize E2A.24.

## Result

The E2A.23 run remains `completed_valid_bounded_stop`. Its stored evaluator,
profiles, routes, provider outputs, and audit evidence are immutable. E2A.23a
records a separate corrected analytic result:

| Turn | Corrected evidence | Anchor | Revision ready | Correct route |
|---|---|---|---|---|
| 1 | misconception | explicit | no | clarify concept with a new strategy |
| 2 | partial | explicit | no | refine partial reasoning |
| 3 | sound | explicit | yes | request revision |
| 4 | sound | explicit | yes | request revision |
| 5 | sound | explicit | yes | request revision |
| 6 | sound | explicit | yes | request revision |

Turn 3 is the earliest sound, revision-ready response. The first operation
divergence is Turn 1. Historical Turns 2 through 6 are consequently
path-dependent and are retained only for chronological and analytic replay;
E2A.23a does not fabricate counterfactual student or tutor turns.

The user-supplied primary human-review attestation and the supplied
AI-assisted adjudication are stored as separate provenance layers. No
item-level human ratings were retained, so E2A.23a claims neither item-level
agreement nor inter-rater reliability.

## Root Cause

The E2A.23 live harness used the Item-16-specific
`e2a22-theta-information-replay-adjudicator-v1` to create profiles and routes.
That deterministic replay helper is explicitly anchor-specific, and its
phrase recognizers missed sound paraphrases. It also produced an internally
contradictory Turn-3 record: direct Item-16 option-A application appeared in
observable evidence while the same application remained an essential missing
link and the anchor was mapped as implicit.

The browser activity runtime did not import that replay adjudicator. It used
the structured `formative_activity_response_evaluator_agent` packet, but its
legacy packet-to-profile mapping did not formalize criterion-level consistency
or direct anchor application. E2A.23a replaces that production mapping with:

- `target-evidence-contract-v1`
- `production-turn-evidence-evaluator-v2`
- `turn-evidence-profile-mapper-v2`
- `turn-evidence-profile-consistency-v2`

The contract carries item-specific criteria. The mapper is domain-agnostic and
does not contain theta or Item-16 logic. A criterion cannot be both satisfied
and missing; accepted direct item/distractor evidence maps to an explicit
anchor; optional deepening cannot block revision; contradictory profile
construction fails closed.

The deterministic Item-16 patterns remain no-live replay fixtures only. They
must not serve production evaluation or route student runtime.

## Simulator Reconciliation

Historical simulator classifier V3 remains unchanged. Separate classifier V4
preserves V3 outcomes except for confirmed paraphrase false negatives in
Turns 4 and 5, which become substantive. Turn 3 and Turn 6 remain substantive.
Above-ceiling exact-span checks and tentative/copied-language protections are
preserved. The simulator classifier does not control production routing.

## Calibration And Artifacts

The deterministic calibration corpus contains 64 cases across correlation and
causation, reliability and validity, photosynthesis, and sampling bias. All 64
are non-IRT and cover insufficient, misconception, partial, sound,
anchor-missing, mechanism-missing, optional-deepening, latest-evidence, and
reopened-contradiction boundaries.

Generate and inspect the ignored audit packet with:

```bash
npm run eval:formative:e2a23a:run
npm run eval:formative:e2a23a:report -- --run <run_id>
npm run eval:formative:e2a23a:smoke
```

Artifacts are written under
`.data/e2a23a-turn-profile-reconciliation/<run_id>/`. The packet contains 26
files, including separate human and AI references, the exact six-turn causal
timeline, three analytic adjudications per turn, the root-cause and production
path audits, the calibration corpus/results, protected-evidence hashes, and
the unexecuted E2A.24 draft.

## E2A.24 Boundary

E2A.24 is drafted around a held-out research-methods correlation/causation
item. It tests misconception, partial, and paraphrased sound evidence followed
immediately by `request_revision`. Its frozen maximum is one session, six
simulator calls, six initial tutor calls, two tutor regenerations, fourteen
logical calls, forty-two adapter attempts, 400,000 input tokens, 31,000 output
tokens, USD 10 when pricing is complete, and provider concurrency one.

E2A.24 is not authorized or executed. Its remaining blocker is separate,
explicit authorization for the frozen live micro-canary.
