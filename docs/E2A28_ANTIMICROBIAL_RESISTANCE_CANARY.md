# E2A.28 Antimicrobial-Resistance Canary

E2A.28 is one explicitly authorized, isolated live evaluation session for the
unapproved autonomous topic-dialogue candidate. It uses the held-out
health-sciences protocol frozen by E2A.27a. The authorization does not permit a
rerun, another live session, a broader matrix, E2B, approval, activation, or
deployment.

## Frozen Boundary

- Authoritative E2A.27a run:
  `e2a27a_20260722074221_ec5cc0b0`
- Frozen protocol hash:
  `d9025800788987ed982a30db101bc73f6eb935d8436d58ec26598826fb939185`
- Candidate configuration hash:
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`
- Candidate file SHA-256:
  `d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2`
- Approved V2 hash retained:
  `8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`
- Dispatch commit:
  `4bba9f8d08f784c8e282a612152b182a277c023c`
- Composite runtime identity:
  `8944abbef04648007b7b72712e87d2c1af57f7b085cea103d80880b7e1f39f72`

The protocol tests whether the evidence evaluator and profile mapper can keep
need-driven individual adaptation distinct from population-level selection.
The deliberate later conflict combines a substantially correct differential-
survival explanation with endorsement of distractor C. The V4 evaluator,
mapper, consistency policy, contradiction propagation, and pre-tutor
finalization must keep that state non-sound.

## Resource Ceiling

The run was fail-closed at one session, 29 logical generation calls, 87 adapter
attempts, 900,000 input tokens, 70,000 output tokens, 970,000 total tokens, and
USD 25 when pricing metadata is available. Provider concurrency was one.

## Executed Result

The one authorized dispatch was consumed on 2026-07-22 as immutable run
`e2a28_20260722083935_6ecb39bb`. It stopped with
`e2a28_canary_failed_evidence_accuracy` at turn 3. The exact failure was:

```text
e2a28_profile_semantically_outside_allowed_envelope:turn_3:misconception:partial
```

The synthetic student correctly described pre-existing less-susceptible
bacteria surviving and reproducing, but still said option C was accurate
because exposure makes bacteria resistant. The evaluator identified the
causal conflict, and the V4 profile mapper conservatively retained
`reasoning_quality = misconception`. The frozen turn-3 oracle permitted only
`partial`, so the harness stopped instead of accepting the label mismatch.
This did not produce a false sound or revision-ready state.

The run therefore did not reach the deliberate turn-4 structured-conflict
gate or the planned turn-6 sound-resolution gate. The generated turn-3 tutor
output was retained for audit but was not persisted or displayed as an
effective response.

Observed usage was 3 student-simulator calls, 3 evidence-evaluator calls, 3
initial tutor calls, no tutor regenerations, 9 logical generation calls, 9
adapter attempts, no transport retries, 27,385 input tokens, 5,925 output
tokens, 1,909 reasoning tokens, 33,310 total tokens, and 119,402 ms aggregate
provider latency. Pricing metadata was unavailable, so no cost was fabricated.
All call and token limits remained within budget.

## Evidence and Human Review

The immutable evidence directory is:

```text
.data/e2a28-antimicrobial-resistance-contradiction-canary/e2a28_20260722083935_6ecb39bb
```

It contains 59 hash-validated artifacts. The 17-item
`human-review-packet.json` binds the visible conversation, parsed structured
outputs, request provenance, generated-but-suppressed evidence, metrics, and
review fields. Ratings and recommendation remain null; human review is still
required and no human judgment is fabricated by the harness.

The post-run audit passed artifact integrity, candidate and approved-baseline
integrity, protected-evidence parity, request/context binding, privacy,
failure-path completeness, and synthetic-fixture cleanup. No database fixture
was created, no historical record was modified, and no raw secret was exposed.
The failed-session burden artifact is explicitly `partial`: it records two
completed student turns, three generated tutor responses, two effective tutor
responses, and the generated-but-suppressed turn-3 evidence.

Use only the read-only report commands for this consumed run:

```bash
npm run eval:formative:e2a28:report -- --run e2a28_20260722083935_6ecb39bb
npm run eval:formative:e2a28:audit -- --run e2a28_20260722083935_6ecb39bb
```

E2A.28 did not pass. The candidate remains unapproved and inactive, approved
V2 remains unchanged, and no broader live stage ran. Any protocol or oracle
correction must preserve this run and would require a separately frozen,
separately authorized future evaluation.
