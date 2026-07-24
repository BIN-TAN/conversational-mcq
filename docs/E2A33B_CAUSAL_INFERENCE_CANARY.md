# E2A.33b Causal-Inference Canary

## Status

The single authorized E2A.33b causal-inference session was dispatched exactly
once on 2026-07-24 as `e2a33b_20260724101300_f5ae71c0`. It stopped fail-closed
with `e2a33b_canary_failed_evidence_accuracy` and must not be rerun under the
consumed authorization.

The run used:

- frozen E2A.33b protocol hash
  `acc8b7453d57f3b2827e45bea860e8d7b24a4e349c6a17fb36f947185cc5b18d`;
- frozen composite runtime identity
  `99c957224b4d71aa29a4cef4e0a1a02aaa7a938b5ca949dca3b09958a4161d79`;
- dispatch-time composite runtime identity
  `10b1224709a5301a14480186375498db4ad1516ce081e4d514c78802c934121c`;
- dispatch commit `f70740027642d072e8d47361b8d437eca1a4e0c6`;
- candidate configuration hash
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`.

## Pre-dispatch gates

The clean preflight made zero network requests and verified:

- the exact frozen protocol, target-evidence contract, canonical anchor
  contract, alias contract, stance-evidence contract, trajectory envelope,
  compiled evaluator V5 request, artifact contract, and budget;
- evaluator V5, anchor reference resolver V1, anchor stance evidence resolver
  V2, composed resolver V4, canonical anchor evidence, parity reconciliation,
  contradiction propagation, profile consistency, and pre-tutor finalization;
- candidate file SHA-256
  `d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2`;
- a clean tracked worktree, application build provenance matching the dispatch
  commit, database readiness, approved provider host, credential fingerprint
  parity, provider concurrency one, and no prior E2A.33b run;
- the provider-call guard, exact authorization arguments, bounded transport
  retry policy, and dispatch checkpoint.

The deterministic E2A.33b protocol suite contains 192 stance-calibration cases.
The injected 90-artifact live-harness smoke, HTTP 520 retry smoke,
authorization-guard smoke, E2A.32 trajectory-envelope regression, typecheck,
lint, and production build all passed without provider requests.

## Executed result

- Planned sessions: 1
- Completed sessions: 0
- Simulator calls: 3
- Evidence-evaluator calls: 3
- Initial tutor calls: 2
- Tutor regenerations: 0
- Logical generation calls: 8
- Adapter attempts: 8
- Transport retries: 0
- Input tokens: 33,028
- Output tokens: 7,918
- Reasoning tokens: 3,149
- Cached input tokens: 8,532
- Total tokens: 40,946
- Observed provider concurrency: 1
- Total recorded provider latency: 140,718 ms
- Estimated cost: unavailable because pricing metadata was absent

All call and token counts remained below the authorized ceilings. The USD
ceiling cannot be independently reconciled because pricing metadata was not
available. No deterministic fallback was used.

## Fail-closed finding

The final failure reason is
`target_evidence_profile_inconsistent_v5:false_sound`.

The stance correction worked at the original boundary:

- turn 1 explicitly referenced option D;
- `I agree with D` resolved to `endorses_distractor`;
- the turn remained non-sound and the tutor continued.

Turn 2 identified motivation as an alternative explanation but remained
partial. The tutor then asked the student to trace both confounding pathways,
evaluate option D, and propose stronger causal evidence.

At turn 3, the simulator:

- explained that motivation could increase app use and studying;
- explicitly rejected option D;
- proposed comparing existing app users with nonusers.

Evaluator V5 correctly retained two essential missing links:

1. comparing existing users and nonusers does not by itself remove motivation
   or other pre-existing differences;
2. the response did not specify random assignment or another justified design
   that addresses alternative explanations.

The same evaluator output described the response as partial and
`boundary_understanding_improved`. The downstream target-evidence mapper
nevertheless produced a `sound` observation while those missing links
remained. The V5 consistency guard detected the internal conflict as
`false_sound` and stopped before profile finalization or turn-3 tutor dispatch.

This is not an anchor-reference or anchor-stance failure. The canonical anchor
for turn 3 was `explicit + rejects_distractor`, with parity reconciliation
passing. No structured contradiction was required because the conceptual
reasoning and conclusion agreed. The failure is the promotion of incomplete
evidence to `sound`.

## Artifacts and review

The immutable run directory is:

`.data/e2a33b-causal-inference-held-out-canary/e2a33b_20260724101300_f5ae71c0/`

All 90 required artifacts are present, read-only, and hash-valid. Key hashes:

- `canary-summary.json`:
  `20a16736f1e8c0229b7a0279e8228d474542dd6fcd23f6473c8c732b832f96b5`;
- `human-review-packet.json`:
  `d658a4039700d667e195f54c3b1182dd0a48edbd38cca169dd8f70bb618b7af8`;
- `simulator-provider-outputs.jsonl`:
  `60d3cddfc167ab083009cf3fb8020be2e315026d21ccd35f5f249439ef8dc6eb`;
- `evaluator-provider-outputs.jsonl`:
  `17f4d561bb57ce06c5d028b7632753830ecc0366efecfe6ac31e995ef1c831a6`;
- `provider-attempt-results.jsonl`:
  `9f756b3506804ef9f18653689359ea95f0c4469392354cb727bc9d8f6e8f511d`.

The post-run audit passed with no artifact, accounting, persistence, privacy,
or cleanup failures. The human-review packet contains 24 review items, but its
ratings and recommendation remain null. `human_review_complete` remains false.

Protected evidence was unchanged before and after execution at
`9b79eb5054c3527aa29e3ccb168542c33af63acc7ab1d347f0c1a16d1a393327`.
Historical E2A.33 run `e2a33_20260724014237_58099b2a` remains unchanged with
evidence-tree hash
`75d0c929642f40769b951b6d04cf47fa044ab89e78b7adbfab475058e7303f66`.

## Decision boundary

E2A.33b did not pass and is not candidate-approval evidence. The candidate
remains unapproved and inactive. This execution did not rerun E2A.33 or
E2A.33b, run another live session or larger matrix, run E2B, approve or
activate a candidate, or deploy anything.

Any correction requires a separately scoped no-live adjudication of the
`false_sound` mapper boundary. The consumed E2A.33b authorization cannot be
used for another provider dispatch.
