# E2A.33a Anchor Stance Correction and E2A.33b Protocol

E2A.33a is a deterministic, no-provider correction for the anchor-stance
boundary exposed by E2A.33. It does not rerun E2A.33, execute E2A.33b, approve
or activate the candidate, or authorize a larger evaluation stage.

## Historical boundary

The immutable E2A.33 run is:

`e2a33_20260724014237_58099b2a`

It remains failed closed as:

`e2a33_canary_failed_anchor_resolution`

Both turn-1 simulator outputs explicitly agreed with option D. Reference
resolver V1 found the option-D reference, but stance resolver V1 returned
`ambiguous`. The correction does not change those historical artifacts or
claim that E2A.33 passed.

## Resolution separation

E2A.33b separates:

1. anchor reference resolution; and
2. anchor stance evidence resolution.

`active-anchor-alias-resolution-v1` remains the reference authority.
`anchor-stance-evidence-contract-v2` and
`anchor-stance-evidence-resolution-v2` classify the evidence for endorsement,
rejection, or ambiguity only after an anchor reference is explicit.
`active-anchor-alias-resolution-v4` composes those independent results into
canonical anchor evidence.

The stance evidence resolver is domain-neutral. It handles:

- direct agreement and disagreement;
- positive and negative option judgments;
- negated agreement and disagreement;
- negated selection;
- contrastive conclusions and self-corrections;
- uncertainty;
- contextual pronouns; and
- continuity with prior student reasoning.

It does not contain causal-inference, educational-app, confounder, or option-D
content rules.

## Calibration and replay

The deterministic calibration contains 192 cases across six generic domains.
It includes explicit agreement, explicit disagreement, negated agreement,
contrastive rejection, uncertainty, pronouns, paraphrases, and prior-reasoning
continuity.

Required boundaries include:

| Student wording | Resolved stance |
|---|---|
| `I agree with D` | `endorses_distractor` |
| `D is correct` | `endorses_distractor` |
| `D is right` | `endorses_distractor` |
| `I choose D` | `endorses_distractor` |
| `D makes sense` | `endorses_distractor` |
| `D is wrong` | `rejects_distractor` |
| `D is tempting but incorrect` | `rejects_distractor` |
| `I disagree with D` | `rejects_distractor` |
| `I am unsure about D` | `ambiguous` |
| `D might be possible` | `ambiguous` |

The immutable replay covers both E2A.33 turn-1 simulator attempts. Resolver V3
reproduces the historical `explicit + ambiguous` result. Resolver V4 produces
`explicit + endorses_distractor`, with direct agreement recorded as the stance
evidence. No provider request is made.

## Frozen E2A.33b boundary

The prepared protocol version is:

`e2a33b-causal-inference-anchor-stance-canary-v1`

The protocol hash is:

`acc8b7453d57f3b2827e45bea860e8d7b24a4e349c6a17fb36f947185cc5b18d`

The protocol binds:

- the unchanged E2A.33 target, alias, canonical-anchor, and trajectory
  contracts;
- reference resolver V1;
- stance evidence contract and resolver V2;
- composed resolver V4;
- unchanged evaluator V5 and tutor candidate;
- the candidate configuration hash;
- the immutable E2A.33 evidence tree;
- the future artifact contract; and
- the bounded budget.

The inert budget remains one isolated session, 29 logical calls, 87 adapter
attempts, two transport retries per logical call, 900,000 input tokens, 70,000
output tokens, 970,000 total tokens, USD 25 when pricing is available, and
provider concurrency one.

The future artifact contract requires separate reference-resolution and
stance-evidence-resolution artifacts. E2A.33b has no live command or provider
dispatch in this phase and requires separate authorization.

## Commands

```bash
npm run eval:formative:e2a33b:run
npm run eval:formative:e2a33b:report
npm run eval:formative:e2a33b:smoke
npm run eval:formative:e2a33b:calibration-smoke
npm run eval:formative:e2a33b:replay-smoke
npm run eval:formative:e2a33b:artifact-smoke
npm run eval:formative:e2a33b:historical-integrity-smoke
npm run eval:formative:e2a33b:provider-call-guard-smoke
```

Artifacts are written under:

`.data/e2a33b-anchor-stance-resolution-protocol/<run_id>/`

E2A.33b live execution, another E2A.33 dispatch, a larger matrix, E2B,
candidate approval or activation, and deployment remain unauthorized.
