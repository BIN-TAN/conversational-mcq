# E2A.31b Anchor Stance Resolution Protocol

## Status

E2A.31b is a frozen, no-live protocol prepared for separate authorization. It
has not been executed, is not authorized for live dispatch, and does not alter
the result of E2A.31.

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
```

There is no E2A.31b live command. A future live canary requires separate,
explicit authorization and a dedicated exactly-once runner bound to the
frozen protocol.

## Decision boundary

This correction is deterministic evidence that the identified stance boundary
is resolved under the new contract. It is not evidence that E2A.31 passed, is
not a candidate approval, and does not authorize E2A.31b, E2B, activation, or
deployment.
