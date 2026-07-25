# E2A.38 Integrated Autonomous Formative Session Canary

## Status

The single authorized E2A.38 integrated autonomous formative session was
dispatched exactly once at `2026-07-25T10:43:22Z` as
`e2a38_20260725104322_25d11b2c`. It stopped fail-closed with
`e2a38_canary_failed_evidence_accuracy` and must not be rerun under the
consumed authorization.

The run used:

- frozen E2A.38 protocol hash
  `84300970cf23afa5f114ec3d367ca9a2096ea074fe9fb78a37e630fc30750911`;
- frozen composite runtime identity
  `4aeae9f504135a99b4d26fd596d0f1796fb59dcf2d85fbc6fc62dc82e850b96a`;
- dispatch-time composite runtime identity
  `63e2f0b0e8815200f8360a369f068717c3d2d36069fa37fbf6893c228a2c07c2`;
- dispatch commit
  `321e1a2b1df0b31ee129f431cb89f2af847f099b`;
- candidate configuration hash
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`.

## Pre-dispatch gates

The no-live gates verified:

- a clean tracked worktree and application build provenance matching the
  dispatch commit;
- the frozen protocol, candidate, Evaluator V5 request, target evidence,
  canonical anchor, stance resolution, self-correction, trajectory envelope,
  learning and engagement profile evolution, intervention memory, adaptive
  stopping, instructor handoff, student communication, artifact, and budget
  contracts;
- protected E2A.37 and E2A.38 source identities;
- canonical credential resolution, the approved provider host, database
  readiness, provider concurrency one, and no prior E2A.38 live run;
- the provider-call guard, exactly-once authorization guard, bounded transport
  retry policy, and immutable dispatch checkpoint.

The deterministic E2A.38 suite, injected live-runner smoke, transport-retry
smoke, authorization-guard smoke, artifact validation, typecheck, lint, and
production build passed without network requests before dispatch. The
production build required an 8 GB Node heap after the default and 6 GB heaps
exhausted available memory.

## Executed result

- Planned sessions: 1
- Completed sessions: 0
- Completed evidence-evaluated turns: 5
- Completed student-visible tutor turns: 4
- Simulator calls: 5
- Evidence-evaluator calls: 5
- Initial tutor calls: 4
- Tutor regenerations: 0
- Logical generation calls: 14
- Adapter attempts: 14
- Transport retries: 0
- Input tokens: 60,849
- Output tokens: 12,356
- Reasoning tokens: 4,045
- Cached input tokens: 17,064
- Total tokens: 73,205
- Observed provider concurrency: 1
- Total recorded provider latency: 164,776 ms
- Estimated cost: unavailable because pricing metadata was absent

All call and token counts remained below the authorized ceilings. The USD
ceiling cannot be independently reconciled because provider pricing metadata
was unavailable. No deterministic fallback was used, no transport retry was
needed, and every logical call had exactly one adapter attempt.

## Completed dialogue evidence

Turn 1 preserved the student's explicit endorsement of the
reliability-implies-validity distractor. Evaluator V5 classified the response
as a misconception, and the tutor introduced a wrong-construct
counterexample.

Turn 2 showed partial improvement. The student recognized that score
consistency and the intended interpretation are different, but left the
active distractor stance ambiguous. The tutor shifted to a
necessary-versus-sufficient distinction.

Turn 3 stated the conceptual boundary while still endorsing the distractor.
The evaluator preserved a structured
`anchor_conclusion_conceptual_explanation_conflict`, kept the response
non-sound, and the tutor used a focused contradiction audit.

Turn 4 acknowledged that the student's prior conclusion did not match the
reasoning but did not supply new conceptual evidence. The profile remained
non-sound, and the tutor requested a revised verdict linked to the
reliability-validity distinction. Correction language alone was not promoted
to understanding.

Turn 5 supplied a coherent reliability-validity distinction, rejected the
active distractor, and used a reading-heavy algebra assessment as an example
of stable scores representing the wrong construct. Evaluator V5 reported:

- reasoning quality `sound`;
- explicit anchor application;
- anchor stance `rejects_distractor`;
- no blocking contradiction;
- no essential missing links.

The trajectory envelope preserved that evidence, the sound gate passed, and
the platform correctly selected immediate revision without another tutor
call.

## Fail-closed finding

The final failure reason is:

`e2a38_longitudinal_stopping_runtime_mismatch:continue_dialogue:request_revision:platform_request_revision:tutor_not_called`

The ordinary conceptual response at Turn 5 was correctly mapped with
`update_from_latest_evidence`. The learning-profile evolution artifact also
recorded the sound observation in trajectory history. However, the integrated
runner supplied the self-correction-specific
`conceptual_evidence_update=false` value to longitudinal profile evolution for
this ordinary conceptual response. The longitudinal authoritative
`current_profile` therefore remained at the earlier partial state.

Adaptive stopping read that stale partial current profile and selected
`continue_dialogue`, while the evaluator, sound gate, trajectory envelope, and
platform progression correctly selected immediate revision. The runtime
consistency guard detected the disagreement and stopped before persisting a
Turn 5 stopping decision, student-facing transition, or tutor response.

This is an integration-boundary evidence-propagation failure between accepted
ordinary conceptual evidence and longitudinal stopping state. It is not a
provider transport failure, an Evaluator V5 error, a tutor output failure, or
evidence that the candidate passed. No frozen protocol, evaluator, tutor,
stopping policy, or protected source was changed during or after execution.

## Safety and review

Student-facing communication through Turn 4 passed safety validation. No
internal stopping state was student-visible. Candidate approval and activation
remain false.

The immutable human-review packet contains 42 bound review items. Ratings and
recommendation remain unset, `ratings_prepopulated=false`, and
`human_review_complete=false`. Human review is still required; artifact
generation is not human adjudication.

Post-run artifact audit passed with no hash, budget, tracing, cleanup,
privacy, or exactly-once failures. The canary verdict remains failed even
though the evidence-preservation audit itself is complete and valid.

## Artifacts

The immutable read-only run directory is:

`.data/e2a38-integrated-autonomous-session-canary/e2a38_20260725104322_25d11b2c/`

All 122 required artifacts are present and hash-valid. Key SHA-256 values:

- `canary-summary.json`:
  `ad8216c29171aecc0d036a0f53d2a98452dfac5eec8dbcb71af215474c2a5f33`;
- `human-review-packet.json`:
  `15690e974c2946d7a70efcd1cbb66b1100866e4e6bb1d85c95198fa48482be7c`;
- `simulator-provider-outputs.jsonl`:
  `9ec431259e2d33ec2faa879dda6743f8631ff4fb014338a868cf7d75b5d8983c`;
- `evaluator-provider-outputs.jsonl`:
  `2264b384a779238d30feae561fb649e19c84bd0c38a3bdf2a4ea15e784301ff5`;
- `autonomous-tutor-provider-outputs.jsonl`:
  `7a7314c1300b7d3f296c562a07bb3d0f5643292cc99f41fbb493ccf5d51ea38f`;
- `provider-attempt-results.jsonl`:
  `885302c8dc65dea1ffa0cb9891757ca46dc3ad3c4cac1c7ca8453d7b097b554b`;
- `learning-profile-evolution-results.jsonl`:
  `7fbce4ac70e765f5bcda59e2d477e88d75b41514302a45aba7b6ab3ac375bca5`;
- `adaptive-stopping-decisions.jsonl`:
  `664c044e52e592cd03c5cce10be359b960314582bda4356c165aaa33ca117e58`;
- `student-facing-communication-results.jsonl`:
  `2dbffeedab2f852a1a297951198d60475921da23ecc84e1a0ff2060355351692`;
- `integration-metrics-results.json`:
  `29e36c2b4518285337a0ee663a86abefd33e64615d8eb1c2fe309201396ea2c1`.

Protected historical evidence was unchanged before and after execution at
`03cd005a0468761feda2d63dc22d9b7bc68a5bfb89d15bb686e299de42e1e5f5`.

## Decision boundary

E2A.38 did not pass and is not candidate-approval evidence. The candidate
remains unapproved and inactive. This execution did not rerun E2A.38, run
another live session or larger matrix, run E2B, approve or activate a
candidate, or deploy anything.

Any correction requires separately scoped no-live adjudication of the
ordinary-conceptual-evidence-to-longitudinal-profile boundary. The consumed
E2A.38 authorization cannot be used for another provider dispatch.
