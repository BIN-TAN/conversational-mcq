# E2A.34 Statistical-Inference Canary

## Status

The single authorized E2A.34 statistical-inference session was dispatched
exactly once on 2026-07-24 as
`e2a34_20260724162010_49f33990`. It stopped fail-closed with
`e2a34_canary_failed_anchor_resolution` and must not be rerun under the
consumed authorization.

The run used:

- frozen E2A.34 protocol hash
  `83ddef09e6d70631ce30f1161659fe85aa25b3bcc38891ba7b3f7bc6a9e0c405`;
- frozen composite runtime identity
  `39f61e1aa128a7586b1c6f534c6401ffaadbdc61ab59e54943556dde84f35195`;
- dispatch-time composite runtime identity
  `bcf5ecefe23caa9da890ececba0e8f969a39e41cd032f8c8c2645a5e219a64f8`;
- dispatch commit
  `a13afd6366374d3226cfad224bbd4398e5dfc6f1`;
- candidate configuration hash
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`.

## Pre-dispatch gates

The no-live preflight verified:

- a clean tracked worktree and application build provenance matching the
  dispatch commit;
- the exact frozen protocol, target-evidence contract, canonical anchor
  contract, alias and stance contracts, trajectory envelope, artifact
  contract, budget, and compiled Evaluator V5 request;
- candidate integrity, Evaluator V5 identity, canonical anchor evidence,
  reference resolver V1, stance-evidence resolver V2, composed resolver V4,
  V7 mapper evidence preservation, V4 pre-tutor finalization, and the
  unchanged sound gate;
- the approved provider host, canonical credential fingerprint parity,
  database readiness, provider concurrency one, and absence of a prior
  E2A.34 live run;
- the provider-call guard, authorization arguments, bounded transport-retry
  policy, and dispatch checkpoint.

The injected live-harness smoke, transport-retry smoke,
authorization-guard smoke, deterministic E2A.34 suite, artifact validation,
typecheck, lint, and production build passed without provider requests before
dispatch.

## Executed result

- Planned sessions: 1
- Completed sessions: 0
- Simulator calls: 1
- Evidence-evaluator calls: 1
- Initial tutor calls: 0
- Tutor regenerations: 0
- Logical generation calls: 2
- Adapter attempts: 2
- Transport retries: 0
- Input tokens: 8,327
- Output tokens: 1,885
- Reasoning tokens: 516
- Cached input tokens: 0
- Total tokens: 10,212
- Observed provider concurrency: 1
- Total recorded provider latency: 29,432 ms
- Estimated cost: unavailable because pricing metadata was absent

All call and token counts remained below the authorized ceilings. The USD
ceiling cannot be independently reconciled because provider pricing metadata
was unavailable. No deterministic fallback was used.

## Fail-closed finding

The final failure reason is:

`target_evidence_evaluator_parity_v5_failed:anchor_stance_not_detected`

The first simulator turn explicitly said:

`I agree with option D.`

It then retained the p-value misconception by treating `p = .03` as a three
percent chance that the result is wrong and `1 - p` as a 97 percent
probability that the research hypothesis is true.

Evaluator V5 correctly recorded:

- anchor reference: `explicit`;
- anchor stance: `endorses_distractor`;
- conceptual conclusion: `endorses_distractor`;
- four essential missing links covering the null-reference condition,
  data extremeness under the null, conditional-probability direction, and the
  boundary that a p-value does not directly provide hypothesis probability.

The independently recorded composed resolver V4 also resolved the turn as
`explicit + endorses_distractor`.

The parity path still invokes the older V2 alias resolver as an independent
check. Its whole-message stance refinement interpreted the unrelated word
`wrong` in the later phrase `3% chance the result is wrong` as a rejection cue
for option D. It therefore produced `rejects_distractor` as the independent
stance. Canonical parity detected the disagreement with Evaluator V5 and
stopped before adjudication, mapping, sound-gate evaluation, profile
finalization, or tutor dispatch.

This is an anchor-stance cue-scoping conflict in the parity path. It is not an
Evaluator V5 error, a tutor error, a provider transport failure, or a
false-sound promotion. No frozen component was changed during or after the
run.

## Artifacts and review

The immutable run directory is:

`.data/e2a34-statistical-inference-held-out-canary/e2a34_20260724162010_49f33990/`

All 90 required artifacts are present and hash-valid. Key SHA-256 values:

- `canary-summary.json`:
  `46bb5702593897a0758d80f10edb32e5bb424eafe2a82766f364cea793a2accd`;
- `human-review-packet.json`:
  `197065e0b2c0aec492ebdc65f6b2e3c93fadf33935a49012ad7717b2ed9cd223`;
- `simulator-provider-outputs.jsonl`:
  `1f2b80b4b82fbd402f203db1c4c21a7c7f65f7bdfab65bbc8b9166f0a9a52058`;
- `evaluator-provider-outputs.jsonl`:
  `d8292fb6600d1a31f5f73f78b3358aa7ca0d431b3b23e76218e18992d08f9357`;
- `provider-attempt-results.jsonl`:
  `bc96fc910a12f6d23dc04db20663522e04df4955ab67c5bd1fb1d33bd51f8f39`.

The post-run audit passed with no artifact, accounting, tracing, privacy,
cleanup, or exactly-once failures. The human-review packet contains six
review items. Ratings and recommendation remain unset, and
`human_review_complete` remains false.

Protected historical evidence was unchanged before and after execution at
`250179200426345131f816f7a0cb7ffcce565388ad09d18d7b3957d91777856e`.

## Decision boundary

E2A.34 did not pass and is not candidate-approval evidence. The candidate
remains unapproved and inactive. This execution did not rerun E2A.34, run
another live session or larger matrix, run E2B, approve or activate a
candidate, or deploy anything.

Any correction requires separately scoped no-live adjudication of the V2
independent stance cue-scoping boundary. The consumed E2A.34 authorization
cannot be used for another provider dispatch.
