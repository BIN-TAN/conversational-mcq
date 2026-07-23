# E2A.31c Turn 5 Sound Adjudication

E2A.31c is a no-live adjudication of the immutable E2A.31b run
`e2a31b_20260723111043_c82c52ae`. It does not rerun E2A.31b, make a provider
request, modify evaluator V5, modify the tutor candidate, approve or activate a
candidate, or claim that the historical canary passed.

## Decision

Turn 5 is **not a genuine false sound**. The supported diagnosis is:

`frozen_trajectory_oracle_overconstraint`

The evaluator correctly identified sound evidence earlier than the scripted
trajectory expected. The student simulator was instructed to reconstruct the
mechanism without giving a final stance, but its generated response did give a
decisive claim-level rejection:

> When the top fish disappear, the second species may increase and eat more of
> the focal prey, so the focal prey could decrease. Reduced direct predation
> does not guarantee the focal prey will increase.

That response contains the required indirect pathway, explains how it can
reverse the direct effect, and rejects the guaranteed prey-increase claim. The
accepted evaluator V5 evidence marks the anchor as explicit, the stance as
`rejects_distractor`, the conceptual relationship as aligned, and the
contradiction set as empty.

## Turn reconstruction

| Turn | Observable student evidence | Frozen envelope | Replayed result | Anchor stance | Contradiction status |
|---|---|---|---|---|---|
| 1 | Selects D and predicts an increase from reduced direct predation alone | misconception | misconception | endorses | active distractor retained; required links missing |
| 2 | Traces a second-consumer pathway but leaves its implication unresolved | misconception or partial | partial | ambiguous | none |
| 3 | Acknowledges an opposing pathway but still says D is right | misconception or partial | partial | endorses | structured and blocking |
| 4 | Accepts that focal prey could decrease but asks whether the indirect effect can dominate | insufficient or partial | non-sound | not expressed | none; anchor unresolved |
| 5 | Traces the indirect pathway and rejects the guaranteed increase | partial | sound | rejects | none |

The Turn 3 replay is an important control. The corrected stance resolver still
detects the explicit endorsement, the mechanism/conclusion contradiction
remains blocking, and the production sound gate rejects progression. The
Turn 5 result is therefore not evidence of a generally permissive evaluator.

## Existing sound gate

E2A.31c replays `sound-gate-anchor-consistency-v1`, not the simulator's declared
evidence level or turn number. Turn 5 passes because:

- every essential conceptual relationship is satisfied;
- the required indirect mechanism is demonstrated;
- the active anchor is applied explicitly;
- the stance rejects the distractor;
- the anchor conclusion is consistent with the conceptual explanation;
- the anchor is resolved against the distractor;
- the conclusion is coherent;
- no essential link is missing;
- no contradiction or unstructured blocking conflict remains.

The mapped result is `sound`, revision readiness is true, and the tutor was
correctly not called.

The authoritative no-live adjudication packet is:

`.data/e2a31c-turn5-sound-adjudication/e2a31c_20260723160824_932f698a/`

Its status is
`e2a31c_frozen_trajectory_oracle_overconstraint_confirmed`. All 10 artifacts
validate. The source E2A.31b tree remains 84 files with aggregate SHA-256
`6b8439e9ff9cec3098aa3fb39d162d36608c93d5851238cc1fa1958a1b23bf3b`.
The original human-review packet remains bound at SHA-256
`23c44df7edb30d2fdfa0855c5e557d89b0451a4fd0fcf47633f72c54d56e31d4`.

## Oracle diagnosis

The historical runner finalized and persisted the Turn 5 evidence before
comparing `sound` with the frozen `partial` envelope. It then emitted
`e2a31b_genuine_false_sound`. E2A.31c preserves that historical code and all
source artifacts, but records that the factual responsibility lies with the
trajectory oracle:

- evaluator accuracy: passed;
- production sound gate: passed;
- simulator trajectory adherence: failed;
- frozen oracle classification: overconstrained;
- evaluator V5 implicated: no;
- tutor candidate implicated: no.

A future protocol must report an early-advancing simulator response as a
trajectory-adherence issue without converting supported observable evidence
into an evaluator-accuracy failure.

## Review status

The E2A.31c AI adjudication source is
`ai_agent_no_live_evidence_review`. It is not human review. The original
42-item E2A.31b human-review packet remains unchanged and incomplete. The
enhancement binds the original packet hash, reconstructs turns 1 through 5,
adds the Turn 5 gate matrix, and leaves the human reviewer, rating, and notes
null.

E2A.32 **preparation is allowed**, subject to a new versioned protocol and
complete no-live verification. E2A.32 live execution is not authorized.
Candidate approval, activation, a larger matrix, E2B, and deployment remain
prohibited.

## Commands

All commands below are no-live and install a fetch guard:

```bash
npm run eval:formative:e2a31c:run
npm run eval:formative:e2a31c:report -- --run <run_id>
npm run eval:formative:e2a31c:smoke
npm run eval:formative:e2a31c:source-integrity-smoke
npm run eval:formative:e2a31c:sound-gate-smoke
npm run eval:formative:e2a31c:human-review-smoke
npm run eval:formative:e2a31c:provider-call-guard-smoke
```

Generated artifacts are stored under
`.data/e2a31c-turn5-sound-adjudication/<run_id>/`. They include immutable
source-run integrity, five-turn reconstruction, production sound-gate replay,
AI adjudication, semantic-oracle diagnosis, human-review packet enhancement,
and the E2A.32 preparation decision.
