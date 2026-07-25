# E2A.36 Measurement-Reasoning Longitudinal Canary

## Status

The single authorized E2A.36 measurement-reasoning longitudinal session was
dispatched exactly once at `2026-07-25T03:37:01Z` as
`e2a36_20260725033701_3afd3874`. It stopped fail-closed with
`e2a36_canary_failed_stability` and must not be rerun under the consumed
authorization.

The run used:

- frozen E2A.36 protocol hash
  `5be98a340d561fc0b4ad0fb6e80e29089189d2c91015e53f856032c7bafddc62`;
- frozen composite runtime identity
  `cb2b765c9a358c7cdf4db71b8b5357de7cb86bc7b2b419ca3fab1c02a32347af`;
- dispatch-time composite runtime identity
  `bff55c97e16ab307aae2ff64262439d83335ff36b1a5f5ae34c28542e892d8d4`;
- dispatch commit
  `cb7295c673dc4459e70265ba06f6eb663e97eaa4`;
- candidate configuration hash
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`.

## Pre-dispatch gates

The no-live gates verified:

- a clean tracked worktree and application build provenance matching the
  dispatch commit;
- the frozen protocol, candidate, Evaluator V5 request, canonical anchor,
  stance resolver, self-correction contracts, learning and engagement profile
  contracts, intervention memory, adaptive stopping policy, student-facing
  communication policy, artifact contract, and budget;
- canonical credential fingerprint parity, the approved provider host,
  database readiness, provider concurrency one, and no prior E2A.36 live run;
- the exactly-once authorization guard, provider-call guard, bounded transport
  retry policy, and dispatch checkpoint.

The 34-case deterministic E2A.36 suite, injected live-runner smoke,
transport-retry smoke, authorization-guard smoke, artifact validation,
typecheck, lint, and production build passed without network requests before
dispatch. The production build required an 8 GB Node heap after the default
Node heap exhausted memory.

## Executed result

- Planned sessions: 1
- Completed sessions: 0
- Completed dialogue turns: 3
- Simulator calls: 5
- Evidence-evaluator calls: 3
- Initial tutor calls: 3
- Tutor regenerations: 0
- Logical generation calls: 11
- Adapter attempts: 11
- Transport retries: 0
- Input tokens: 39,469
- Output tokens: 7,916
- Reasoning tokens: 2,536
- Cached input tokens: 8,532
- Total tokens: 47,385
- Observed provider concurrency: 1
- Total recorded provider latency: 118,530 ms
- Estimated cost: unavailable because pricing metadata was absent

All call and token counts remained below the authorized ceilings. The USD
ceiling cannot be independently reconciled because provider pricing metadata
was unavailable. No deterministic fallback was used, and every recorded
provider call completed with provider request or response metadata.

## Completed dialogue evidence

Turn 1 preserved the student's explicit endorsement of the reliability-implies-
validity distractor. Evaluator V5 classified the response as a misconception,
kept revision readiness false, and retained the missing reliability-validity
boundary. The tutor used a wrong-construct counterexample and asked the student
to distinguish what consistent scores establish from what they do not.

Turn 2 showed partial improvement: the student distinguished consistency from
the intended interpretation and recognized that a test could consistently
measure reading speed instead. Evaluator V5 classified the response as partial
with an ambiguous anchor stance. The tutor then asked for an explicit accept or
reject decision and a concise reliability-validity distinction.

Turn 3 retained option D while also stating that consistency did not prove the
intended interpretation. Evaluator V5 preserved the resulting structured
`anchor_conclusion_conceptual_explanation_conflict`, kept the response
non-sound, and blocked revision. The tutor directly addressed that conflict
with a consistent-but-inaccurate scale analogy and requested a coherent final
stance.

For all three completed turns:

- profile consistency and pre-tutor finalization passed;
- the adaptive stopping decision was `continue_dialogue`;
- tutor dispatch was allowed and completed;
- three different intervention strategies were selected in sequence;
- pedagogical and privacy validators passed;
- instructor escalation remained internal and was not yet recommended;
- student-facing messages contained no internal stopping decision.

The longitudinal learning observations moved from misconception to partial and
then to a contradictory partial response. The authoritative learning profile
did not accept these observations as latest-valid conceptual updates before
the run stopped. That behavior requires later review; this incomplete canary
does not establish that longitudinal profile evolution works end to end.

## Fail-closed finding

The final failure reason is:

`e2a36_student_simulator_validation_failed:E2A36-MEASUREMENT_REASONING_LONGITUDINAL:4:self_correction_intent_mismatch`

Turn 4 was intended to produce a correction claim without conceptual evidence.
The first simulator output said:

`I think I need to change what I said. I was too quick to call it accurate enough.`

The second, permitted semantic regeneration said:

`I think I need to change what I said before. I was too quick about it.`

Both structured outputs labeled their rendered intent as
`unsupported_understanding_claim`, even though their student-visible messages
expressed self-correction intent. The frozen trajectory required the
self-correction intent classification. Both outputs were schema-valid provider
responses, but both failed the semantic stability contract. The runner stopped
before a Turn 4 evaluator or tutor call.

This is a simulator output-contract adherence failure. It is not a provider
transport failure, an Evaluator V5 failure, a tutor failure, or a stopping-
policy leak. No frozen component was changed during or after execution.

## Review and limitations

The immutable human-review packet contains 32 bound review items. Automated
artifact audit passed with no hash, accounting, tracing, cleanup, privacy, or
exactly-once failures. Human ratings and recommendation remain unset, and
`human_review_complete` remains false.

An AI-assisted review of the completed turns found the tutor responses
conceptually aligned, appropriately continued for non-sound evidence, and
progressively more focused. It also confirmed that internal stopping and
escalation decisions were absent from student-facing language. This is not a
substitute for the required human review.

The run did not reach:

- validated self-correction evidence;
- regression and profile reopening;
- sound evidence or immediate revision authorization;
- persistent-barrier instructor-support language;
- terminal stopping behavior.

Those behaviors therefore remain unvalidated by E2A.36. No claim of canary
success, classroom validity, candidate approval, or candidate activation is
supported.

## Artifacts

The immutable run directory is:

`.data/e2a36-measurement-reasoning-longitudinal-canary/e2a36_20260725033701_3afd3874/`

All 113 required artifacts are present and hash-valid. Key SHA-256 values:

- `canary-summary.json`:
  `5e352f980bc36ebda698eba7ff09bec10834ccf1903745eca529ded6632333ff`;
- `human-review-packet.json`:
  `52338317ca6186b744cbe5f962227938cde9c47b00d17214d4848fb01dc24375`;
- `simulator-provider-outputs.jsonl`:
  `d74dd76a4b055124c5503f99ac3dc7d5febb3daf6ee5c49051880b5f74d49ff2`;
- `evaluator-provider-outputs.jsonl`:
  `3b4fe70292af7957cecea1af16afc99f811af1b3049a0f97643102136031717d`;
- `autonomous-tutor-provider-outputs.jsonl`:
  `4cf004f9fd3020fade9d71552dc8b02235f4557b41fda98560309664f493a12d`;
- `provider-attempt-results.jsonl`:
  `f5feafb09989413b811ac25376be23b8367bc7e764c90f789cbb7acfbeec3692`;
- `learning-profile-evolution-results.jsonl`:
  `a78a13fc259a38d0f33ed71e6f86669550ec361160a4de527644871501fcc34c`;
- `adaptive-stopping-decisions.jsonl`:
  `156ce49718ba85712becf0497912731891b958a725f65d0d2bfc1b3d97d9a33f`;
- `student-facing-communication-results.jsonl`:
  `4a2b1f675a63a1c31a609c2151b2cd13c8a29a5dd5c92d01286f451540d6ca9f`.

Protected historical evidence was unchanged before and after execution at
`03c6ac57bac0242cf80b97999d6de388390ebbfecac5826946cb932601ae698b`.

## Decision boundary

E2A.36 did not pass and is not candidate-approval evidence. The candidate
remains unapproved and inactive. This execution did not run another live
session or larger matrix, run E2B, approve or activate a candidate, or deploy
anything.

Any correction requires separately scoped no-live adjudication of the
simulator self-correction-intent boundary. The consumed E2A.36 authorization
cannot be used for another provider dispatch.
