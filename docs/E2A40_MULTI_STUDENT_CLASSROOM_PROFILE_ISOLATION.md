# E2A.40 Multi-Student Classroom Simulation and Profile Isolation

## Status

E2A.40 is a deterministic protocol freeze only.

- Live execution: not authorized and not implemented
- Provider calls: zero
- Network requests: zero
- Candidate approval: false
- Candidate activation: false
- Student data: synthetic only

This protocol tests orchestration and isolation contracts. It does not
establish classroom validity, measurement validity, or stable learner traits.

Frozen identity:

- Protocol SHA-256:
  `0ce1218bb01caf99ce85c45a973d3c5604913b9fb8eb80157860b07bdacd91ab`
- Composite runtime identity:
  `ab5a6a047b8e663753303f142ee2fdcb979e854c6f0d37330dd3e10c42da7171`
- Authoritative artifact packet:
  `.data/e2a40-multi-student-classroom-profile-isolation-freeze/e2a40_20260725T141313885Z_b121a78b/`

## Scope

E2A.40 adds an orchestration-only layer above the existing per-student
evaluator, tutor, profile, stopping, transfer, handoff, and communication
components. Those components are source-hash bound and remain unchanged.

The synthetic Measurement Theory simulation contains six distinct sessions:

| Trajectory | Current evidence pattern | Bounded response |
|---|---|---|
| Fast learner | Early independent sound explanation | Close the episode after offering a transfer application |
| Slow engaged learner | Repeated partial progress | Continue with a concept-boundary scaffold |
| Persistent high-confidence misconception | Repeated misconception with confidence exceeding evidence | Change strategy and offer a supportive instructor next step |
| Shallow copied understanding | Repeated copied or definition-only wording | Request independent application |
| Self-correction learner | Evidence-bearing correction reaches sound | Authorize revision |
| Regression learner | Sound evidence followed by misconception recurrence | Reopen the distinction and continue |

These labels identify synthetic test trajectories. They are not student-facing
labels and are not learner typologies.

## Frozen Contracts

### Multi-student sessions

`multi-student-session-contract-v1` requires every record to be owned by a
synthetic classroom run, student subject, and assessment session. Evidence
records add concept and misconception scope. Per-student event order is
monotonic, closure is session scoped, and cross-student reads fail closed.

### Profile isolation

`profile-isolation-contract-v1` requires exact owner scope for profile reads
and updates. Students with the same misconception do not share profiles, and
one student with two misconception scopes receives separate profiles.

### Intervention-memory isolation

`intervention-memory-isolation-contract-v1` scopes prior strategy history and
intervention counts to one student, session, concept, and misconception.
Another student's intervention is never available as context.

### Classroom orchestration

`classroom-orchestration-contract-v1` canonicalizes synthetic events by:

1. logical tick;
2. student subject ID;
3. student-local sequence;
4. event ID.

Reversing or rotating the concurrent input array cannot change the canonical
result. One session's isolation failure or closure cannot mutate another
session.

### Privacy boundaries

`classroom-privacy-boundary-v1` blocks internal labels from student-facing
messages, including profile, engagement, escalation, stopping, routing,
intervention-memory, audit, and peer-student language. The aggregate artifact
contains counts only and excludes student identifiers, transcripts, profiles,
and intervention memory.

### Personalization evaluation

`multi-student-personalization-evaluation-v1` evaluates whether current
episode evidence leads to appropriately different interventions, stopping
decisions, and instructor-boundary decisions. It explicitly prohibits stable
trait inference, aggregate learner typologies, and classroom-validity claims.

## Required Isolation Regressions

The deterministic packet directly tests:

- profile leakage;
- transcript leakage;
- intervention leakage;
- foreign student/session references in stored payloads;
- the same misconception for different students;
- different misconceptions for the same student;
- concurrent ordering;
- closure isolation.

It also verifies audit isolation, individualized intervention, stopping
differences, supportive instructor-boundary decisions, and student-facing
language safety.

## Artifacts

Generate the immutable no-live artifact packet:

```bash
npm run eval:formative:e2a40:run
```

Inspect the latest packet:

```bash
npm run eval:formative:e2a40:report
```

Artifacts are written under:

```text
.data/e2a40-multi-student-classroom-profile-isolation-freeze/
```

Every artifact is read-only after generation. The packet includes the frozen
protocol, all six contract records, synthetic trajectories, deterministic
suite results, a privacy-safe aggregate, source integrity, composite identity,
provider guard, and artifact validation. The final packet contains 34
artifacts and 46 deterministic checks.

## Verification

```bash
npm run eval:formative:e2a40:smoke
npm run eval:formative:e2a40:regression-smoke
npm run eval:formative:e2a40:provider-call-guard-smoke
npm run typecheck
npm run lint
npm run build
```

E2A.40 has no live entrypoint and no provider-dispatch path. It does not
authorize live execution, candidate approval, or candidate activation.
