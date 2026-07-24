# E2A.33 Causal-Inference Canary

## Status

The single authorized E2A.33 causal-inference session was dispatched exactly
once on 2026-07-24 as `e2a33_20260724014237_58099b2a`. It stopped fail-closed
with `e2a33_canary_failed_anchor_resolution` and must not be rerun under the
consumed authorization.

The run used frozen E2A.33 protocol hash
`c6536a9861c91692e9d5d26a6868f43d79c87d23dd2f9e7cf4dc744ef4ffa45b`,
frozen composite runtime identity
`a0df20358f1850c68e48404826d38d3480322ca6dc422b9be0a7bec75a97c443`,
and dispatch-time composite runtime identity
`01a23ba629fae16b34ed96755e99a46d00ae1638d9e6912065129a5d80e35395`.
The dispatch commit was `21dac38830676b7c87e5f271ec535dfa8cbb6559`.

## Pre-dispatch gates

The clean preflight verified:

- the exact frozen protocol, evaluator V5 request, target-evidence contract,
  canonical anchor contract, alias contract, trajectory envelope, overlap
  analysis, artifact contract, and budget;
- candidate configuration hash
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`;
- candidate file SHA-256
  `d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2`;
- evaluator V5 source SHA-256
  `6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd`;
- tutor-candidate source SHA-256
  `b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09`;
- anchor reference resolver V3, anchor stance resolver V1, and
  `trajectory-envelope-v1`;
- a clean tracked worktree, matching application build provenance, approved
  provider host, credential fingerprint parity, database readiness, provider
  concurrency one, and no prior E2A.33 run;
- the provider-call guard, exact authorization arguments, and bounded retry
  policy.

The E2A.33 deterministic protocol, live-harness fixture, injected HTTP 520
retry, authorization guard, E2A.32 trajectory, E2A.31b stance, E2A.31c sound
gate, E2A.30a canonical-anchor, target-evidence mapper, privacy, MVP, type,
lint, and production-build checks passed before dispatch without provider
requests.

## Executed result

- Planned sessions: 1
- Completed sessions: 0
- Simulator calls: 2
- Evidence-evaluator calls: 0
- Initial tutor calls: 0
- Tutor regenerations: 0
- Logical generation calls: 2
- Adapter attempts: 2
- Transport retries: 0
- Input tokens: 1,620
- Output tokens: 191
- Reasoning tokens: 0
- Total tokens: 1,811
- Observed provider concurrency: 1
- Estimated cost: unavailable because pricing metadata was absent

All observed counts remained within the authorized ceilings. The call and
token ceilings were enforced. The USD ceiling cannot be independently
reconciled from the run because the pricing registry returned no pricing
metadata.

## Fail-closed finding

The final failure reason is
`e2a33_student_simulator_validation_failed:E2A33-CAUSAL_INFERENCE:1:required_anchor_stance_missing`.
The turn-1 simulator was allowed one initial generation and one bounded
semantic regeneration. Both outputs were schema-valid and explicitly
referenced option D:

- attempt 1 began with `I agree with D`;
- attempt 2 began with `Yes, I agree with D`.

Both responses then restated the intended causal misconception. A read-only
replay through the frozen resolver stack classified both messages as:

- anchor reference: `explicit`;
- matched alias: `D`;
- match type: `exact_identifier`;
- anchor stance: `ambiguous`;
- stance basis: `insufficient_evidence`;
- stance cue: `no_decisive_stance`.

The frozen turn required `endorses_distractor`. The provider outputs expressed
ordinary-language endorsement, but anchor-stance resolver V1 did not treat
`agree with D` as a decisive endorsement cue. The harness correctly stopped
before persistence, student display, evaluator dispatch, tutor dispatch, or
progression. This task does not alter the frozen protocol, resolver, evaluator
V5, tutor candidate, or candidate configuration.

## Artifacts and review

The immutable run directory is:

`.data/e2a33-causal-inference-held-out-canary/e2a33_20260724014237_58099b2a/`

All 88 required artifacts are present, read-only, and hash-valid. Key hashes:

- `canary-summary.json`:
  `6731067f54669ce5cf344c9a90983e0349354861caa3876a27ffb2db5a7faf6f`;
- `human-review-packet.json`:
  `70e7838c0d4862cfbcf05f1b1236db32932eaa641632362bd127fe9592408edd`;
- `simulator-provider-outputs.jsonl`:
  `30e787c09ac81489340dde6b1e6647647ddeaf8916321d147e4153ff20be1b24`;
- `provider-attempt-results.jsonl`:
  `d9ca0764b7064111ac93931b5c76967185dbff6a6174bc441d1d5e88a4010ea8`.

The post-run audit passed with no artifact or accounting failures. Protected
evidence remained unchanged at
`286d3802aa48932913843fd23df7950a036647d02280faebc1978c9bc626481b`,
fixture cleanup passed, exactly-once accounting passed, and no deterministic
fallback was used.

The human-review packet contains five review items. Ratings and recommendation
remain null, `human_review_complete` remains false, and human review remains
pending. The two generated simulator outputs are preserved in the packet but
were neither persisted nor displayed in the simulated student workflow.

## Decision boundary

E2A.33 did not pass and is not candidate-approval evidence. The candidate
remains unapproved and inactive. This execution did not run another E2A.33
session, a larger matrix, E2B, approval, activation, or deployment. Any
follow-up requires a separately scoped no-live adjudication or protocol and
cannot reuse the consumed E2A.33 authorization.
