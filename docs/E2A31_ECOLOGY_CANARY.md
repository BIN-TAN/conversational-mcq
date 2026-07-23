# E2A.31 Ecology Canary

## Status

The one authorized E2A.31 ecology session was dispatched exactly once on
2026-07-23 as `e2a31_20260723031323_56517518`. It stopped fail-closed with
`e2a31_canary_failed_anchor_resolution` and must not be rerun under the
consumed authorization.

The run used frozen E2A.31a protocol hash
`12817989d2051ef671764dfa7594f1a2af227caf4f32ae995ff38db35466866b`,
frozen composite runtime identity
`f15784a61afa5a68128f1b8b4d6a941d740df9936c44f651f8a5e881bb5bd485`,
and dispatch-time composite runtime identity
`82019cc756c889f6f51ba265737f2cec14816ae6ff76c104c87b5cacae56cdc0`.
The dispatch commit was `b738703332d6ece6bd35525db625472dc9f4e480`.

## Pre-dispatch gates

The clean preflight verified:

- a clean tracked worktree and matching application build provenance;
- the exact frozen protocol, evaluator V5 request, ecology target-evidence
  contract, alias contract, overlap analysis, artifact contract, and budget;
- candidate configuration hash
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`;
- candidate file SHA-256
  `d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2`;
- approved provider host, credential fingerprint parity, database readiness,
  provider concurrency one, and no prior E2A.31 live run;
- the provider-call guard, exact authorization arguments, and bounded retry
  policy.

The deterministic runner, authorization guard, injected HTTP 520 retry test,
E2A.31a protocol smoke, E2A.30a canonical-anchor regression, privacy suites,
and full MVP smoke passed before dispatch without provider calls.

## Executed result

- Planned sessions: 1
- Completed sessions: 0
- Simulator calls: 4
- Evidence-evaluator calls: 2
- Initial tutor calls: 2
- Tutor regenerations: 0
- Logical generation calls: 8
- Adapter attempts: 8
- Transport retries: 0
- Input tokens: 25,064
- Output tokens: 4,839
- Reasoning tokens: 1,244
- Total tokens: 29,903
- Observed provider concurrency: 1
- Estimated cost: unavailable because pricing metadata was absent

All observed counts remained within the authorized ceilings. The token and
call ceilings were enforced; the USD ceiling cannot be independently verified
from the run because the provider pricing registry returned no pricing
metadata.

## Fail-closed finding

The final failure reason is
`e2a31_student_simulator_validation_failed:E2A31-ECOLOGY:3:required_anchor_stance_missing`.
The turn-3 simulator was allowed one initial generation and one bounded
semantic regeneration. Both outputs were schema-valid and explicitly referred
to `option D`. Both used the natural stance phrase `keep option D`, as requested
by the preceding tutor sentence frame.

A read-only replay through the frozen active-anchor resolver V2 classified both
messages as:

- anchor reference: `explicit`;
- matched alias: `option D`;
- match type: `exact_identifier`;
- anchor stance: `ambiguous`.

The frozen turn required `endorses_distractor`. Resolver V2 recognizes several
endorsement verbs, but `keep` is not one of its decisive endorsement forms.
The simulator therefore supplied observable endorsement language that the
frozen stance resolver did not classify as endorsement. The harness correctly
stopped before turn-3 persistence, evaluator dispatch, tutor dispatch, or
student display. This finding does not alter the frozen protocol, resolver,
evaluator, canonical anchor contract, or candidate.

## Artifact and human review status

The immutable run directory is:

`.data/e2a31-ecology-held-out-autonomous-canary/e2a31_20260723031323_56517518/`

All 83 required artifacts are present, read-only, and hash-valid. Key hashes
include:

- `canary-summary.json`:
  `15428e60dcc9c5cc9fe0f68bfa8b3dc3de53a93d930847dbb2020edd1d99d847`;
- `human-review-packet.json`:
  `f7133b9f52bd0b1d27f7ea4e9a07d0108dbf5db84358ec3dbf1921ae5ccddfe5`;
- `simulator-provider-outputs.jsonl`:
  `67d55d7d32304b3bd0b9dbb4a827a104136e2d75f9da199d7755c969f360233d`;
- `evaluator-provider-outputs.jsonl`:
  `270714160ec496a888720299c598acfd52b9438cd78cf2055dcc918813f111b3`;
- `autonomous-tutor-provider-outputs.jsonl`:
  `f0380c2089cc6a1f2903f5140a735f38d413e6b844b8b27e01d7421ce60097c3`.

The post-run artifact audit passed with no audit failures. Protected historical
evidence remained unchanged at
`286d3802aa48932913843fd23df7950a036647d02280faebc1978c9bc626481b`,
fixture cleanup passed, exactly-once accounting passed, and no deterministic
fallback was used.

The packet contains 23 review items. Human ratings remain deliberately null
and `human_review_complete` remains false. Inspection found the first two tutor
responses coherent, relevant, and free of answer-key or internal-state
disclosure. The two rejected turn-3 simulator outputs were preserved for
review but were not persisted or displayed in the simulated student workflow.

## Decision boundary

E2A.31 did not pass and is not approval evidence. The autonomous tutor
candidate remains unapproved and inactive. This execution did not run E2A.25,
E2A.27, E2A.28, E2A.29, E2A.30, a broader canary or matrix, E2B, approval,
activation, or deployment. Any follow-up must be separately scoped and cannot
reuse the consumed E2A.31 authorization.
