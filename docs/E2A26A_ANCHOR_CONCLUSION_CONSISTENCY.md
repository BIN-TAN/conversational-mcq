# E2A.26a Anchor-Conclusion Consistency

E2A.26a is a no-live correction to production evidence interpretation and
progression authorization. It does not change the autonomous tutor prompt,
schema, validator, model, retry policy, history policy, or pedagogical strategy
logic. It does not approve or activate the autonomous dialogue candidate.

## Root Cause

The V2 mapper treated anchor application as a single boolean. This allowed a
response to satisfy the conceptual criteria and the anchor criterion even when
its explicit option conclusion contradicted its own conceptual explanation.
Session B Turn 4 exposed the defect: the evaluator recorded the direct conflict
in `evidence_limitations`, but the mapped profile had no contradiction and was
marked sound and revision-ready.

V3 separates four concerns:

- `anchor_application`: absent, implicit, or explicit;
- `anchor_stance`: not expressed, ambiguous, endorses the distractor, or
  rejects the distractor;
- `anchor_consistency`: whether that stance agrees with the conceptual
  explanation;
- `anchor_resolution_status`: unresolved, resolved against the distractor,
  regressed, or contradictory.

Directly naming the active item or option is explicit application even when
the conclusion is wrong. The mapper never assumes an inconsistent option label
is a typo. It records a structured contradiction and keeps the student in
formative dialogue until the conclusion is clarified.

## Sound Gate

`sound-gate-anchor-consistency-v1` permits sound only when every essential
conceptual relationship and mechanism is present, anchor application is
explicit, the observable stance rejects the distractor, the stance is
consistent with the conceptual reasoning, the anchor is resolved against the
distractor, the conclusion is coherent, and no contradiction or essential
missing link remains.

A limitation describing a direct anchor-conclusion conflict must be promoted
to a structured contradiction. A blocking conflict cannot remain only in
`evidence_limitations` while the profile is sound.

## Historical Evidence

E2A.25 and E2A.26 artifacts remain immutable. E2A.26a replays their sanitized
records without provider calls. The user-supplied dual-human attestation,
AI-assisted review reference, deterministic adjudication, and runtime evidence
are separate provenance layers. No item-level human ratings or inter-rater
statistic are inferred.

The autonomous dialogue candidate remains byte-identical with configuration
hash `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`
and file SHA-256
`d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2`.

## E2A.27 Freeze

The earlier chemistry draft is superseded because the composite evaluator,
mapper, consistency, and sound-gate identity changed. E2A.26a freezes a new
held-out geometrical-optics trajectory. It contains copied wording,
misconception evidence, a deliberately correct mechanism paired with a
contradictory final option conclusion, clarification, and later independent
sound reasoning that resolves both mechanism and anchor stance.

The freeze is not execution authorization. E2A.27, E2B, candidate approval,
and activation all require separate explicit authorization.

```bash
npm run eval:formative:e2a26a:smoke
npm run eval:formative:e2a26a:run
npm run eval:formative:e2a26a:report -- --run <run_id>
```
