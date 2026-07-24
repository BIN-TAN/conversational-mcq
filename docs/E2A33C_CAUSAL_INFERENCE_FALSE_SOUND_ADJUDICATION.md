# E2A.33c Causal-Inference False-Sound Adjudication

## Scope

E2A.33c is a no-live adjudication of immutable E2A.33b run
`e2a33b_20260724101300_f5ae71c0`. It does not rerun E2A.33b, execute E2A.34,
modify Evaluator V5, modify the tutor candidate, or make a provider call.

The source run remains a historical failure:

- status: `e2a33b_canary_failed_evidence_accuracy`
- failure: `target_evidence_profile_inconsistent_v5:false_sound`
- protocol:
  `acc8b7453d57f3b2827e45bea860e8d7b24a4e349c6a17fb36f947185cc5b18d`
- composite identity:
  `99c957224b4d71aa29a4cef4e0a1a02aaa7a938b5ca949dca3b09958a4161d79`
- source evidence: 90 files with aggregate SHA-256
  `ec134ae3d7333fad30c65c188f1a57de320e7dac7ba9cfabd606a077fe10b348`

## Turn 3 reconstruction

The exact student response was:

> 1. More motivated students might use the app more and also study harder
> outside the app. 2. Therefore, option D is not justified because the higher
> scores could be from motivation, not just the app. 3. The researcher could
> compare students who use the app with students who do not.

Evaluator V5 did not classify this as complete causal reasoning. It recorded:

- `boundary_understanding_improved`
- medium evidence quality
- partial independent reconstruction
- partial reasoning-link repair
- explicit rejection of option D
- a correct motivation/confounding mechanism
- two essential missing links:
  - explain why comparing existing users with nonusers may preserve
    motivation and other preexisting differences;
  - specify random assignment or another justified design that addresses
    alternative explanations before drawing a causal conclusion.

Canonical anchor evidence was `explicit + rejects_distractor`. Anchor parity
passed, the conceptual conclusion aligned with the anchor stance, and no
structured contradiction was required.

## Root cause

The selected root cause is **B: mapper dropped evidence**.

The failure has two connected parts:

1. The legacy V3 adjudication projected one coarse
   `required_mechanism=true` value onto every required-mechanism criterion,
   including the stronger-evidence/design criterion.
2. The V6 mapper ran the unchanged sound gate with only criterion-derived
   missing links, received `sound`, and merged Evaluator V5's two structured
   missing links afterward.

The resulting observation was internally inconsistent:

- `reasoning_quality = sound`
- two `essential_missing_links`

The V5/V6 consistency guard correctly detected `false_sound` and failed closed
before profile persistence, sound-gate artifact persistence, pre-tutor
finalization, or tutor dispatch.

The evidence does not support the other candidate causes:

- **A, Evaluator V5 defect:** rejected. The evaluator retained the missing
  causal-design evidence and characterized the reasoning as partial.
- **C, sound-gate missing criteria:** rejected. The unchanged gate already
  rejects any non-empty essential-missing-link list.
- **D, trajectory-envelope override:** rejected. Turn 3 allowed partial or
  sound, and the trajectory did not change the evidence decision.
- **E, other:** no additional cause is needed.

## Sound-gate replay

The original incomplete mapper input had no missing links and passed the
unchanged gate. Replaying the same gate after including Evaluator V5's
structured missing links failed with:

`essential_missing_links_present`

No sound criterion was weakened. Sound still requires:

- mechanism understanding;
- sufficient causal reasoning;
- rejection of the distractor;
- no essential missing links;
- a coherent conclusion.

## Deterministic regressions

All four required no-live cases pass:

| Case | Expected | Result |
|---|---|---|
| Reject distractor but omit a causal design | Non-sound | Non-sound |
| Reject distractor with a complete causal explanation | Sound | Sound |
| Copy causal language without applying it | Non-sound | Non-sound |
| Mention a confounder but retain the causal conclusion | Non-sound | Non-sound |

The regressions call the existing production sound gate. They do not call a
provider and do not introduce a separate weaker oracle.

## Artifacts

The adjudication run is:

`e2a33c_20260724142532_cd0ca553`

Artifact directory:

`.data/e2a33c-causal-inference-false-sound-adjudication/e2a33c_20260724142532_cd0ca553`

The 11 validated artifacts include:

- immutable source-run integrity;
- exact Turn 3 reconstruction;
- Evaluator V5 and canonical-anchor evidence;
- mapper input/output and ordering trace;
- incomplete and evidence-complete sound-gate replays;
- consistency-guard replay;
- four deterministic regressions;
- AI root-cause adjudication;
- a human-review packet enhancement;
- summary and artifact validation.

Human review remains required and incomplete. E2A.33b is not reclassified as
passed. The candidate remains unapproved and inactive. This adjudication does
not establish classroom validity and does not authorize E2A.34 or any live
execution.
