# E2A.31b Anchor Stance Resolution Protocol

## Status

E2A.31b is a frozen protocol with a dedicated exactly-once live runner. The
user separately authorized one isolated live session on 2026-07-23. That
single-use authorization was consumed by run
`e2a31b_20260723111043_c82c52ae`, which stopped fail-closed as
`e2a31b_canary_failed_evidence_accuracy`. E2A.31b did not pass and must not be
rerun under the consumed authorization.

Historical E2A.31 run `e2a31_20260723031323_56517518` remains failed closed as
`e2a31_canary_failed_anchor_resolution`. Its 83 files and critical evidence
hashes were identical before and after the deterministic correction replay.
E2A.31 was not rerun.

## Correction boundary

`anchor-stance-resolution-v1` separates stance classification from anchor
reference detection:

- `active-anchor-alias-resolution-v1` continues to determine whether the
  current student message explicitly references the active anchor;
- `anchor-stance-resolution-v1` classifies that reference as endorsement,
  rejection, ambiguity, or no expressed stance;
- `active-anchor-alias-resolution-v3` composes those independent results and
  creates canonical evidence for a future E2A.31b execution.

The stance resolver uses generic endorsement and rejection cues, negation,
contrast conclusions, uncertainty, discourse continuity, and prior student
reasoning. It contains no ecology-specific terms or rules. Uncertainty remains
ambiguous and is not overridden by prior reasoning.

Frozen resolver V2 remains unchanged for historical reproducibility. Evaluator
V5 and the autonomous tutor candidate are byte-identical to their E2A.31
versions.

## Calibration

The deterministic corpus contains 144 cases across eight generic contexts:

- 64 expected endorsements;
- 48 expected rejections;
- 32 expected ambiguous stances.

All cases pass. Required boundary examples include:

| Student wording | Resolved stance |
|---|---|
| `I keep option D` | `endorses_distractor` |
| `I would keep D` | `endorses_distractor` |
| `D is still correct` | `endorses_distractor` |
| `Keep D as a distractor` | `rejects_distractor` |
| `D sounds right but is wrong` | `rejects_distractor` |
| `I am unsure about D` | `ambiguous` |
| `Maybe D` | `ambiguous` |

The corpus also verifies both endorsement and rejection continuity from prior
student reasoning, plus an uncertainty case where prior stance must not be
used.

## Immutable replay

The first failing E2A.31 boundary, turn 3 attempt 1, was replayed directly from
the preserved simulator-output artifact without a provider request.

- Frozen V2 reproduces `reference=explicit` and `stance=ambiguous`.
- V3 preserves `reference=explicit` and resolves
  `stance=endorses_distractor`.
- The V3 resolution basis is `direct_endorsement`.
- Historical E2A.31 status remains failed and no pass is claimed.

## Frozen protocol

The deterministic packet is:

`.data/e2a31b-anchor-stance-resolution-protocol/e2a31b_20260723T103812272_e8ac5705/`

Key identities:

- protocol version:
  `e2a31b-ecology-anchor-stance-resolution-canary-v1`;
- protocol hash:
  `66bf3960794ca54f9cbafd7c20e5edebbd097e06454166df3eb6f0491df991ee`;
- composite runtime identity:
  `fd0a9a647bc0dbd271c947ab8ca6f6ebe6ce15bc2c2ce341e34156d5196b6694`;
- candidate configuration hash:
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`.

The packet includes the calibration results, immutable replay, historical
before/after inventories, a compiled evaluator V5 request, protected-source
integrity, budget, future artifact contract, provider-call guard, protocol, and
artifact validation.

The frozen ceilings remain one isolated session, 29 logical calls, 87 adapter
attempts, two transport retries per logical call, 900,000 input tokens, 70,000
output tokens, 970,000 total tokens, USD 25 when pricing is available, and
provider concurrency one. These limits do not grant authorization.

## Commands

The following commands are deterministic and make no provider request:

```bash
npm run eval:formative:e2a31b:calibration-smoke
npm run eval:formative:e2a31b:replay-smoke
npm run eval:formative:e2a31b:artifact-smoke
npm run eval:formative:e2a31b:provider-call-guard-smoke
npm run eval:formative:e2a31b:smoke
npm run eval:formative:e2a31b:report
npm run eval:formative:e2a31b:live-preflight
npm run eval:formative:e2a31b:live-authorization-guard-smoke
npm run eval:formative:e2a31b:live-transport-retry-smoke
npm run eval:formative:e2a31b:live-smoke
```

The paid command is `npm run eval:formative:e2a31b:live` with the complete
single-use confirmation set emitted by the committed preflight checkpoint.
It is blocked unless the current build provenance, source identity, protected
evidence identity, protocol hash, frozen composite identity, candidate hashes,
credential readiness, provider host, database readiness, and every numeric
ceiling match. The runner cannot dispatch when a prior E2A.31b live run or lock
exists.

## Authorized live result

The exactly-once run is preserved at:

`.data/e2a31b-ecology-anchor-stance-resolution-canary/e2a31b_20260723111043_c82c52ae/`

The anchor-stance correction passed the boundary that failed in E2A.31. At
turn 3, composed resolver V3 classified the explicit option-D reference as
`endorses_distractor`; the sound gate retained the response as non-sound with
the mechanism/conclusion contradiction structured and blocking.

The E2A.31b run later stopped at turn 5 with
`e2a31b_genuine_false_sound`. The frozen turn-5 trajectory required a partial
mechanism reconstruction without an explicit final stance. The generated
student message instead explicitly rejected the guaranteed prey-increase
claim. Evaluator V5 accepted the output as sound, while the frozen turn-5
semantic envelope allowed only `partial`. This is recorded as an
evidence-accuracy failure. Human adjudication remains pending; the result is
not reclassified here.

Usage and execution evidence:

- five simulator calls, five evidence-evaluator calls, four initial tutor
  calls, and zero tutor regenerations;
- 14 logical calls and 14 adapter attempts with zero transport retries;
- 59,350 input tokens, 13,189 output tokens, 4,879 reasoning tokens, and
  72,539 total tokens;
- provider concurrency one;
- pricing metadata unavailable, so USD cost is not reported and the currency
  ceiling cannot be independently reconciled; call and token ceilings passed;
- zero completed sessions because the session stopped at the fail-closed
  evidence boundary.

All 84 required artifacts validate, including preserved provider outputs,
request/attempt tracing, the stance-resolution evidence, and the 42-item
human-review packet. The post-run audit passes, fixture cleanup passes,
protected evidence is unchanged, and historical E2A.31 evidence retains tree
hash `3f82fb7b6d86250912b3a4805752dec9a731e8773ee4aa7ea38a1e1049e367b0`.
Human review remains incomplete, and the candidate remains unapproved and
inactive.

## Decision boundary

The identified E2A.31 stance boundary was resolved in the live E2A.31b
trajectory, but the canary as a whole failed at a later evidence-accuracy gate.
Neither E2A.31 nor E2A.31b passed. The consumed authorization does not permit a
rerun, a larger matrix, E2B, approval, activation, or deployment.

## E2A.31c no-live adjudication

E2A.31c replays turns 1 through 5 through the unchanged production sound gate
and preserves this run byte-for-byte. The replay determines that Turn 5 is not
a genuine false sound. The generated student response supplied the required
indirect food-web mechanism and explicitly rejected the guaranteed
prey-increase claim, so `sound-gate-anchor-consistency-v1` correctly passed it.

The supported diagnosis is `frozen_trajectory_oracle_overconstraint`: the
simulator advanced beyond its instruction to withhold a final stance, while
the post-finalization oracle incorrectly treated that trajectory violation as
an evaluator-accuracy failure. This derived diagnosis does not change the
historical E2A.31b status or failure code, does not make the run pass, and does
not complete human review.

The E2A.31c review enhancement binds the original 42-item packet and leaves all
human fields null. E2A.32 preparation is allowed, but no E2A.32 dispatch,
candidate approval, activation, matrix, E2B stage, or deployment is
authorized. The canonical packet is
`.data/e2a31c-turn5-sound-adjudication/e2a31c_20260723160824_932f698a/`;
see `docs/E2A31C_TURN5_SOUND_ADJUDICATION.md`.
