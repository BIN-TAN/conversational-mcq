# E2A.38 Integrated Autonomous Session Protocol Freeze

## Status

E2A.38 is frozen as a deterministic, no-provider integrated workflow
protocol. It was not executed live and requires separate authorization for
any future provider-backed run.

- Protocol version:
  `e2a38-integrated-autonomous-formative-session-v1`
- Protocol hash:
  `84300970cf23afa5f114ec3d367ca9a2096ea074fe9fb78a37e630fc30750911`
- Composite runtime identity:
  `4aeae9f504135a99b4d26fd596d0f1796fb59dcf2d85fbc6fc62dc82e850b96a`
- Upstream E2A.37 protocol hash:
  `d13256eb27213ee9799e2cd401df6cf5b2e8a8a38abe98fe1340ecd8bcc1e68e`
- Candidate configuration hash:
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`
- Provider calls: `0`
- Network requests: `0`
- Candidate approved: `false`
- Candidate activated: `false`

The freeze harness has no provider client or provider dispatch path. Its
`run` command writes deterministic protocol artifacts only.

## Integration Goal

E2A.38 tests whether the complete formative workflow remains coherent across:

`activity -> evidence -> profile -> intervention -> reassessment -> revision`

The protocol integrates evidence-driven assessment, longitudinal learning and
engagement profiles, intervention memory, self-correction, sound detection,
revision, adaptive stopping, instructor boundaries, and student-facing
communication. It does not alter or retest any protected component by changing
its implementation.

## Scenario

The held-out integration scenario remains in educational measurement and
assessment literacy so integration behavior can be isolated from domain
generalization.

The student sees:

> A teacher creates an assessment that produces very consistent scores across
> multiple administrations. However, evidence suggests the assessment may not
> measure the intended construct. The teacher claims the assessment is valid
> because the scores are reliable. Do you agree? Explain.

The canonical distractor is that a test is valid because it produces
consistent scores. Sound evidence must distinguish reliability as consistency
from validity as support for score interpretation and use, explain that stable
scores can still reflect the wrong construct, reject the distractor, and leave
no essential missing link.

## Frozen Component Boundary

E2A.38 consumes the frozen E2A.37 component contract set and pins the E2A.37
protocol source and harness hashes. E2A.37 in turn verifies evaluator V5, the
tutor candidate, canonical anchor evidence, reference/stance/scope resolvers,
the evidence-preservation mapper, self-correction intent, profile evolution,
intervention memory, stopping, handoff, communication, and trajectory
contracts.

E2A.38 adds integration assertions only. It does not modify any protected
component.

## Integration Contracts

The new integration layer contains:

1. `integrated-session-contract-v1`
2. `workflow-fidelity-contract-v1`
3. `dialogue-efficiency-contract-v1`
4. `personalization-evaluation-contract-v1`
5. `stopping-quality-contract-v1`
6. `human-boundary-contract-v1`
7. `e2a38-integration-metrics-v1`
8. `e2a38-artifact-contract-v1`
9. `e2a38-bounded-live-budget-v1`
10. `e2a38-composite-runtime-identity-v1`

The full-session trajectory envelope permits initial misconception, partial
understanding, contradiction, strategy adaptation, self-correction, sound
understanding, revision readiness, regression, and an optional instructor
boundary. Trajectory intent never overrides observable evidence.

## Accepted Turn Record

Every accepted deterministic student turn records:

- evaluator evidence and stable evidence references;
- the current learning profile, including missing links and contradiction
  status;
- the current engagement evidence;
- prior strategy and outcome;
- the next strategy or progression decision; and
- an evidence-preservation audit from source evidence to the current profile.

Sound profiles require no essential missing links. Self-correction intent alone
cannot update the profile. A supported self-correction can update it, while
later regression reopens a previously sound profile.

## Deterministic Cases

All ten required cases pass:

1. early sound advances directly to revision;
2. delayed sound follows adapted support and then advances;
3. a structured contradiction is preserved and later resolved;
4. self-correction with evidence updates the profile;
5. self-correction without evidence preserves the prior profile;
6. sound followed by regression reopens targeted support;
7. a persistent barrier reaches a bounded instructor next step;
8. the same conceptual gap receives different support under different
   engagement evidence;
9. a repeated ineffective tutor strategy hard fails; and
10. student-visible internal orchestration language hard fails.

The negative cases pass only when the invalid repetition or leaked message is
rejected.

## Student-Facing Boundary

Student-facing messages may summarize the learning distinction, request
observable reasoning, recommend revision, or suggest a useful instructor
discussion. They must not expose:

- internal profile or misconception labels;
- engagement scores or states;
- session, turn, or token budgets;
- stopping rules or decisions;
- escalation criteria; or
- AI or system limitations.

Instructor-boundary messages identify the conceptual distinction and a useful
next step without explaining the internal reason for ending autonomous support.

## Integration Metrics

The synthetic metrics cover:

- workflow fidelity;
- dialogue efficiency;
- personalization;
- stopping quality;
- human-boundary appropriateness; and
- cross-stage evidence integrity.

These are protocol-level engineering checks. They are not stable learner
traits, classroom-validity claims, or evidence that an instructor handoff will
always be appropriate in authentic use.

## Budget

The inert bounded budget is:

- one isolated session;
- 29 logical generation calls maximum;
- 87 adapter attempts maximum;
- three adapter attempts per logical call maximum;
- two transport retries per logical call maximum;
- 900,000 input tokens maximum;
- 70,000 output tokens maximum;
- 970,000 total tokens maximum;
- USD 25 maximum when pricing metadata is available; and
- provider concurrency one.

This budget does not authorize provider dispatch.

## Artifacts

The authoritative no-live packet is:

`.data/e2a38-integrated-session-protocol-freeze/e2a38_20260725T093925Z_f87aceaf/`

It contains 43 read-only artifacts. Artifact validation confirms the exact
file set, protocol hash, composite identity, frozen component bindings,
deterministic case results, and zero provider or network activity.

## Commands

```bash
npm run eval:formative:e2a38:run
npm run eval:formative:e2a38:report
npm run eval:formative:e2a38:smoke
npm run eval:formative:e2a38:integrated-workflow-smoke
npm run eval:formative:e2a38:profile-integration-smoke
npm run eval:formative:e2a38:intervention-memory-smoke
npm run eval:formative:e2a38:stopping-smoke
npm run eval:formative:e2a38:instructor-boundary-smoke
npm run eval:formative:e2a38:student-facing-communication-smoke
npm run eval:formative:e2a38:trajectory-envelope-smoke
npm run eval:formative:e2a38:self-correction-smoke
npm run eval:formative:e2a38:evidence-preservation-smoke
npm run eval:formative:e2a38:personalization-smoke
npm run eval:formative:e2a38:component-bindings-smoke
npm run eval:formative:e2a38:budget-smoke
npm run eval:formative:e2a38:artifact-smoke
npm run eval:formative:e2a38:provider-call-guard-smoke
```

No command in this phase executes E2A.38 live, approves the candidate, or
activates the candidate.
