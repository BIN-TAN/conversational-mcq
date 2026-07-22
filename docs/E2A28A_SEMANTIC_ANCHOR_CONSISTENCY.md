# E2A.28a Semantic Anchor Consistency

E2A.28a is a no-live correction, replay, and protocol-preparation phase. It
does not rerun E2A.25, E2A.27, or E2A.28; execute E2A.29; approve or activate a
candidate; or change the approved V2 operational configuration. Historical
E2A.12 through E2A.28 evidence remains immutable.

## Root Cause

E2A.28 stopped fail-closed at Turn 3 because its frozen oracle accepted only
`partial`, while the production mapper conservatively returned
`misconception`. Both labels are defensible for the observed mixed response
and produce the same required progression state: non-sound, not
revision-ready, and still in formative dialogue. The corrected
`progression-relevant-semantic-envelope-v2` therefore accepts either label and
keeps the trajectory role `partial_improvement` separate from the production
reasoning-quality label.

The no-live source audit also found an independent runtime defect. The E2A.28
provider request used `formative-activity-response-evaluator-prompt-v6`,
`formative-activity-response-evaluator-input-v1`, and provider output schema
`student-activity-misconception-evidence-v1`. V4 identity was added only by
local normalization; V4 stable anchor and contradiction fields were not sent
to or returned by the provider.

## Corrected Runtime Boundary

The preserved V4 path remains available for historical replay. The corrected
production path adds:

- `production-turn-evidence-evaluator-v5`
- `active-anchor-alias-resolution-v1`
- `turn-evidence-profile-mapper-v5`
- `anchor-contradiction-propagation-v2`
- `turn-evidence-profile-consistency-v5`
- `turn-evidence-cross-artifact-consistency-v1`
- `pre-tutor-profile-finalization-v2`

V5 returns stable source-turn, anchor-reference, anchor-stance, conceptual,
alignment, conflict, exact-span, missing-link, confidence, engagement, and
limitation fields. A blocking anchor/concept conflict cannot exist only in
summary text, rationale, or limitations. Provider source-turn identity and
the deterministic target-contract alias resolver must agree before mapping.

The generic resolver derives option labels, identifiers, text, paraphrases,
negative forms, and bounded pronoun references from the active target
contract. Direct statements such as `I would choose C`, `I still think C`, and
`C seems accurate` map to explicit endorsement regardless of whether that
stance is correct.

## Finalization Order

Before tutor dispatch, the runtime requires persisted student evidence,
complete visible history, a dispatched and schema-valid evaluator request,
normalized structured fields, applied target aliases, finalized anchor stance,
propagated conflicts, a constructed profile, reconciled authoritative views,
profile consistency, cumulative update, sound-gate result, finalized mode, and
freshness verification. Missing, stale, or inconsistent state blocks before a
tutor request. A consistently represented contradictory learning state is not
an infrastructure failure and remains eligible for a tutor response.

## No-Live Evidence

The runner reconstructs all three E2A.28 turns from immutable provider
outputs, records unavailable normal Turn-3 records as missing, and runs 200
deterministic cases across eight non-IRT domains:

```bash
npm run eval:formative:e2a28a:run
npm run eval:formative:e2a28a:report
npm run eval:formative:e2a28a:smoke
```

Artifacts are written to
`.data/e2a28a-semantic-anchor-consistency/<run_id>/`. The run records the
user-supplied `primary_project_owner` attestation separately from AI-assisted
review evidence. It does not claim legal identity, item-level agreement, or
inter-rater reliability.

The corrected Turn-3 replay retains population-selection evidence and the
continuing intentional-adaptation misconception. It maps option C explicitly,
records `endorses_distractor`, propagates
`anchor_conclusion_conceptual_explanation_conflict`, remains non-sound, and
continues in dialogue. This derived replay does not relabel historical E2A.28
as passed.

The autonomous tutor candidate remains unchanged at configuration hash
`b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`
and file SHA-256
`d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2`.
Approved V2 remains
`8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`.
