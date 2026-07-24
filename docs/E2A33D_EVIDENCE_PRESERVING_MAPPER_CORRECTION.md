# E2A.33d Evidence-Preserving Mapper Correction

## Scope

E2A.33d is a no-live correction to the evidence-mapping boundary identified
by E2A.33c. It does not rerun E2A.33 or E2A.33b, execute E2A.34, call a
provider, change Evaluator V5, change the sound gate, change the tutor
candidate, or change the semantic envelope.

The immutable source remains E2A.33b run
`e2a33b_20260724101300_f5ae71c0`, whose status remains
`e2a33b_canary_failed_evidence_accuracy`.

## Correction

`target-evidence-mapper-preservation-v1` establishes a monotonic evidence
contract for `turn-evidence-profile-mapper-v7`. A mapper may aggregate or add
normalized evidence, but it may not remove:

- evaluator essential missing links;
- blocking contradictions;
- unresolved limitations;
- source evidence spans.

The mapper constructs the unchanged sound-gate input only after evaluator
missing links have been included. It fails closed if any evaluator missing
link is absent from that input. A mapped observation cannot be `sound` while
`essential_missing_links` is non-empty.

`pre-tutor-profile-finalization-v4` attests that evidence preservation passed
before applicability classification, profile update, route selection, or
tutor authorization. Historical V1-V3 finalization attestations remain
accepted and unchanged.

The current V5 runtime paths in
`autonomous-formative-dialogue.ts` and `activity-runtime-ui.ts` use the V7
mapper and V4 finalizer. Historical E2A harnesses retain their frozen mapper
versions.

## Offline Replay

The canonical correction run is:

`e2a33d_20260724145806_004e9fee`

Artifacts are under:

`.data/e2a33d-evidence-preserving-mapper-correction/e2a33d_20260724145806_004e9fee/`

The offline replay reconstructs E2A.33b turns 1-3 from the immutable simulator
and Evaluator V5 outputs. On Turn 3:

- Evaluator V5 supplied two essential missing links.
- Both links reached the V7 observation.
- Both links reached the sound-gate input before classification.
- The corrected quality is `partial`.
- Revision readiness is `false`.
- The route remains `remain_in_dialogue`.
- Tutor dispatch is permitted only for another bounded instructional turn.

This result does not reclassify E2A.33b as passed.

## Regression Boundary

Four deterministic mapper regressions pass:

1. Confounder identified and distractor rejected without a causal design:
   non-sound.
2. Confounder identified, valid causal design supplied, and distractor
   rejected: sound.
3. Copied causal language without independent application: non-sound.
4. Evaluator essential missing links survive mapper transformation and reach
   the sound gate.

The source E2A.33b evidence tree remains byte-stable at 90 files with aggregate
SHA-256:

`ec134ae3d7333fad30c65c188f1a57de320e7dac7ba9cfabd606a077fe10b348`

## E2A.34 Boundary

E2A.34 has only a preparation record:

- status: `prepared_not_frozen_not_executable`;
- held-out domain: not frozen;
- protocol hash: none;
- composite runtime identity: none;
- provider dispatch: not authorized;
- live execution: not authorized.

A separate phase must freeze a complete held-out domain, scenario, artifact
contract, budget, and runtime identity before E2A.34 can become executable.

## Commands

```bash
npm run eval:formative:e2a33d:smoke
npm run eval:formative:e2a33d:regression-smoke
npm run eval:formative:e2a33d:source-integrity-smoke
npm run eval:formative:e2a33d:provider-call-guard-smoke
npm run eval:formative:e2a33d:report -- \
  --run e2a33d_20260724145806_004e9fee
```

All commands are no-live. No command in this phase authorizes a provider call
or E2A.34 execution.
