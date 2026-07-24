# E2A.35 Sampling-Bias Self-Correction Canary

## Status

The single authorized E2A.35 sampling-bias self-correction session was
dispatched exactly once at `2026-07-24T22:41:31Z` as
`e2a35_20260724224131_d10b5897`. It stopped fail-closed with
`e2a35_canary_failed_stability` and must not be rerun under the consumed
authorization.

The run used:

- frozen E2A.35 protocol hash
  `97812ff31dc3af594b992c01706bed8ddda2229ac1e5cbdd96f916c2e569e9b9`;
- frozen composite runtime identity
  `cc6f9a6f1f4000106f599c8221b01fbf9c72ff01360ac6b32b2aff4bc9b88303`;
- dispatch-time composite runtime identity
  `2e798cb2825da65fc75d9e119efd2af2e219e6ed6148d83c6e9e4e975ef4261e`;
- dispatch commit
  `0099ee4c27a1504aefe9a98da8b5972890e5a8c3`;
- candidate configuration hash
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`.

## Pre-dispatch gates

The no-live preflight verified:

- a clean tracked worktree and application build provenance matching the
  dispatch commit;
- the exact frozen protocol, target-evidence contract, canonical anchor
  contract, alias and stance contracts, self-correction intent contract,
  trajectory envelope, artifact contract, budget, and compiled Evaluator V5
  request;
- candidate integrity, Evaluator V5 identity, canonical anchor evidence,
  scope-aware stance resolution, latest-valid-evidence precedence, profile
  reopening, V7 mapper evidence preservation, V4 pre-tutor finalization, and
  the unchanged sound gate;
- the approved provider host, canonical credential fingerprint parity,
  database readiness, provider concurrency one, and absence of a prior
  E2A.35 live run;
- the provider-call guard, authorization arguments, bounded transport-retry
  policy, and dispatch checkpoint.

The injected live-harness smoke, transport-retry smoke,
authorization-guard smoke, deterministic E2A.35 suite, formative privacy
smoke, artifact validation, typecheck, lint, and production build passed
without provider requests before dispatch.

## Executed result

- Planned sessions: 1
- Completed sessions: 0
- Simulator calls: 3
- Evidence-evaluator calls: 1
- Initial tutor calls: 1
- Tutor regenerations: 0
- Logical generation calls: 5
- Adapter attempts: 5
- Transport retries: 0
- Input tokens: 12,986
- Output tokens: 2,844
- Reasoning tokens: 910
- Cached input tokens: 0
- Total tokens: 15,830
- Observed provider concurrency: 1
- Total recorded provider latency: 43,138 ms
- Estimated cost: unavailable because pricing metadata was absent

All call and token counts remained below the authorized ceilings. The USD
ceiling cannot be independently reconciled because provider pricing metadata
was unavailable. No deterministic fallback was used.

## Fail-closed finding

The final failure reason is:

`e2a35_student_simulator_validation_failed:E2A35-SAMPLING_BIAS_SELF_CORRECTION:2:self_correction_evidence_status_mismatch|self_correction_disposition_mismatch`

Turn 1 completed through the simulator, Evaluator V5, and initial tutor. The
student simulator explicitly endorsed option D and the tutor asked for the
connection between who volunteers and whether the sample represents all
students.

Turn 2 was intended to express self-correction without conceptual evidence.
The frozen contract expected:

- intent: `self_correction_intent`;
- evidence status: `copied_correction_language`;
- downstream disposition: `request_revision_evidence`;
- latest-valid-evidence eligibility: `false`.

The first simulator output said:

`Actually, I think my previous answer was wrong. I would change it.`

The resolver correctly detected self-correction intent and no revised
conceptual evidence. It classified the evidence as `correction_claim_only`
rather than the frozen `copied_correction_language` subtype, while preserving
the safe `request_revision_evidence` disposition and
latest-valid-evidence eligibility `false`. The exact subtype mismatch
triggered the permitted semantic regeneration.

The second simulator output said:

`Actually, I think my previous answer was wrong. I would change what I said about D.`

The resolver again detected self-correction intent. Because the message
mentioned the active anchor and contained enough non-stop-word tokens, the
current heuristic classified it as `revised_evidence_present`, selected
`evaluate_revised_evidence`, and made it eligible as latest valid evidence.
The message still contained no sampling-bias mechanism, evidence, or reason.
The canary therefore stopped before a Turn 2 evaluator or tutor dispatch.

This is a self-correction evidence-resolution boundary: correction language
plus an anchor reference must not by itself count as revised conceptual
evidence. It is not an Evaluator V5 error, a tutor error, a provider transport
failure, or evidence that the candidate passed. No frozen component was
changed during or after the run.

## Artifacts and review

The immutable run directory is:

`.data/e2a35-sampling-bias-self-correction-canary/e2a35_20260724224131_d10b5897/`

All 96 required artifacts are present and hash-valid. Key SHA-256 values:

- `canary-summary.json`:
  `76e58a0723df81e77d65e4d118d0567ee7b1d99f881e40ccb17acb4cb4a49e83`;
- `human-review-packet.json`:
  `d08cda96756d69335d097c33f4d6a31d19a360085062308481fc1a5a1162821a`;
- `simulator-provider-outputs.jsonl`:
  `961f80c72ac8c5297311573b66245761148fdc340e2c62be54a2ed781e71ca8a`;
- `evaluator-provider-outputs.jsonl`:
  `46f64d15cec9e067366c638602aa5bfb5c303f046891a27cad73d0a6b9702c54`;
- `autonomous-tutor-provider-outputs.jsonl`:
  `d99cdb1fae82e198dd0cf909a877736e17081cdd21e1417c7148cd419490b378`;
- `provider-attempt-results.jsonl`:
  `edcf8d7ea2367ead93938d9cf71bf9329d39146ae3a58885d19bdd0a43a39589`.

The post-run audit passed with no artifact, accounting, tracing, privacy,
cleanup, or exactly-once failures. The human-review packet contains 14 review
items. Ratings and recommendation remain unset, and
`human_review_complete` remains false.

Protected historical evidence was unchanged before and after execution at
`29e087dd4d432fb4116b45f60107cfcbadad731de440520c1266bc0ffeebf109`.

## Decision boundary

E2A.35 did not pass and is not candidate-approval evidence. The candidate
remains unapproved and inactive. This execution did not rerun E2A.35, run
another live session or larger matrix, run E2B, approve or activate a
candidate, or deploy anything.

Any correction requires separately scoped no-live adjudication of the
self-correction evidence-status boundary. The consumed E2A.35 authorization
cannot be used for another provider dispatch.
