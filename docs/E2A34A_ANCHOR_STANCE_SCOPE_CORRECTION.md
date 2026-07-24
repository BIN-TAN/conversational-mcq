# E2A.34a Anchor Stance Scope Correction

E2A.34a is a deterministic, no-provider correction for the anchor-stance
scope boundary exposed by E2A.34. It does not rerun E2A.34, execute E2A.35,
change Evaluator V5, change the tutor candidate, approve or activate a
candidate, or authorize a larger evaluation stage.

## Historical boundary

The immutable E2A.34 run remains:

`e2a34_20260724162010_49f33990`

Its status remains:

`e2a34_canary_failed_anchor_resolution`

Turn 1 explicitly endorsed option D:

> I agree with option D. If p = .03, that means there is only a 3% chance the
> result is wrong, so the research hypothesis has a 97% chance of being true.

Evaluator V5 and composed resolver V4 both recorded
`explicit + endorses_distractor`. The legacy V2 parity resolver scanned the
whole message for polarity words and incorrectly attached `wrong` from
`the result is wrong` to option D. The resulting false rejection caused
canonical parity to stop before mapping or tutor dispatch.

The 90 historical files remain read-only and byte-stable at aggregate SHA-256:

`ba8be92757911bc75ad43a6fb6d1239da4fd1ea26a62cd5f7b83137b390ae78a`

E2A.34 remains a historical failed run. This correction does not reinterpret
it as passed.

## Scoped resolution

`anchor-stance-scope-resolution-v1` separates three operations:

1. **Polarity detection** identifies positive, negative, uncertain, and
   negated language without assigning that language to an entity.
2. **Anchor-target attachment** determines whether each cue targets the
   active anchor, another entity, or an unresolved target.
3. **Stance classification** uses only anchor-targeted cues, bounded discourse
   context, contrast, negation, uncertainty, and prior student reasoning.

The resolver is domain-neutral. It contains no p-value, causal-inference,
ecology, circuits, thermal-physics, antimicrobial-resistance, optics, IRT, or
option-D mechanism rule.

Required boundaries are:

| Student wording | Scoped result |
|---|---|
| `Option D is wrong` | `rejects_distractor` |
| `The result is wrong` | no anchor stance change |
| `I choose D, although the result may be wrong` | `endorses_distractor` |
| `I am unsure whether D is right` | `ambiguous` |

`target-evidence-scoped-adjudication-v1` retains the established V5
adjudication wire shape for downstream mapper, sound-gate, consistency, and
finalization contracts. It replaces only the legacy whole-message lexical
stance comparison with the scoped decision. The full scope-resolution record
is persisted separately on the student conversation turn and its resolver
version and basis are included in the profile-update process event.

The legacy resolver and historical V5 adjudication builder remain unchanged so
historical evidence can still be reproduced.

## Calibration and replay

The no-live calibration contains 288 cases across eight generic domains. It
covers:

- anchor-targeted positive and negative polarity;
- non-anchor positive and negative adjectives;
- negation;
- contrast and self-correction;
- pronouns;
- multiple entities in one response;
- causal and statistical language;
- option references and paraphrases;
- uncertainty; and
- bounded prior-reasoning continuity.

Offline replay of E2A.34 Turn 1 first reproduces the legacy
`anchor_stance_not_detected` parity failure. It then verifies that:

- `I agree with option D` resolves to `endorses_distractor`;
- `wrong` remains attached to the non-anchor result;
- the evaluator's canonical stance remains `endorses_distractor`; and
- canonical parity passes under the scoped compatibility projection.

The replay reads immutable stored provider output. It makes no provider or
network request.

## Prepared E2A.35 protocol

The inert protocol version is:

`e2a35-statistical-inference-anchor-stance-scope-canary-v1`

Its protocol hash is:

`b1f86306b03e60a7dc54f4c34291926667d8bcccb065f5b8f82c67ff29140cbf`

Its preparation composite runtime identity is:

`68be79e53f9718b9baeb07733613589f7eaaaa1915eea25634273d253b83359b`

The protocol binds the unchanged candidate, Evaluator V5, tutor candidate,
E2A.34 target/canonical-anchor/trajectory contracts, the new scope resolver,
the scoped adjudication integration, the calibration, the immutable replay,
the future artifact contract, and the bounded budget.

The inert budget is one isolated session, 29 logical calls, 87 adapter
attempts, at most two transport retries per logical call, 900,000 input
tokens, 70,000 output tokens, 970,000 total tokens, USD 25 when pricing
metadata is available, and provider concurrency one.

E2A.35 has no live harness or live command in this phase. Its prepared
protocol is not executable and requires separate implementation, preflight,
and explicit authorization before any provider dispatch.

## Commands

```bash
npm run eval:formative:e2a35:run
npm run eval:formative:e2a35:report
npm run eval:formative:e2a35:smoke
npm run eval:formative:e2a35:calibration-smoke
npm run eval:formative:e2a35:replay-smoke
npm run eval:formative:e2a35:historical-integrity-smoke
npm run eval:formative:e2a35:runtime-smoke
npm run eval:formative:e2a35:artifact-smoke
npm run eval:formative:e2a35:provider-call-guard-smoke
```

Persistent no-live artifacts are written under:

`.data/e2a35-anchor-stance-scope-protocol/<run_id>/`

No command in this set creates a provider client or authorizes live
execution.
