# E2A.36 Measurement Reasoning Longitudinal Protocol Freeze

## Status

E2A.36 is frozen as a deterministic, no-provider protocol for a separate
authorization decision. It was not executed live in this phase.

- Protocol version:
  `e2a36-measurement-reasoning-longitudinal-canary-v1`
- Protocol hash:
  `5be98a340d561fc0b4ad0fb6e80e29089189d2c91015e53f856032c7bafddc62`
- Composite runtime identity:
  `cb2b765c9a358c7cdf4db71b8b5357de7cb86bc7b2b419ca3fab1c02a32347af`
- Candidate configuration hash:
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`
- Provider calls: `0`
- Network requests: `0`
- Candidate approved: `false`
- Candidate activated: `false`

The freeze harness contains no provider dispatch path. Its `run` command
writes only deterministic preparation artifacts and does not authorize live
execution.

## Held-Out Domain

The held-out domain is Educational Measurement / Measurement Theory. The
primary scenario tests the unsupported inference that consistent scores prove
validity. The active distractor states that a test is valid because consistency
proves it measures the intended construct accurately.

The longitudinal domain packet also covers:

1. reliability versus validity;
2. Classical Test Theory observed-score error;
3. sample-dependent item statistics;
4. distinctions among reliability types;
5. standard error of measurement;
6. score comparability; and
7. CTT versus IRT interpretation.

The protocol can therefore track more than one misconception or knowledge gap
without turning the result into a stable learner-trait claim.

## Frozen Contracts

The freeze binds:

- `TargetEvidenceContractV5`;
- `e2a36-measurement-canonical-anchor-v1`;
- the unchanged anchor reference, stance, and scope resolvers;
- `self-correction-evidence-contract-v1` through the E2A.35a integration;
- `trajectory-envelope-v1`;
- `longitudinal-intervention-memory-v1`;
- `learning_profile_evolution_v1`;
- `engagement_profile_evolution_v1`;
- `adaptive-stopping-policy-v1`;
- `instructor-escalation-policy-v1`;
- `student-facing-communication-v1`;
- the E2A.36 artifact contract;
- the bounded budget contract; and
- the composite runtime identity.

Evaluator V5, the tutor candidate, canonical anchor evidence system, all three
anchor resolvers, evidence-preservation mapper, sound gate, and trajectory
envelope remain byte-verified against their protected source hashes.

## Evolving Profiles

`learning_profile_evolution_v1` records conceptual understanding,
misconception status, knowledge gap, reasoning quality, anchor interpretation,
contradictions, missing links, transfer readiness, confidence alignment, and
self-correction evidence disposition.

Latest valid conceptual evidence updates the current snapshot. Intent-only
self-corrections preserve the existing profile. Earlier snapshots remain in
history, and a later return to a misconception reopens a previously sound
profile rather than preserving stale readiness.

`engagement_profile_evolution_v1` records participation, response-quality
trend, observed effort, persistence, help seeking, frustration,
disengagement, intervention responsiveness, and strategy uptake. Engagement
can affect the choice to continue or offer support, but never determines
correctness.

## Intervention Memory

The intervention-memory contract records the prior strategy, targeted gap,
evidence sought, safe response summary, and observed understanding change.
When a strategy-gap pair has not helped, the next intervention must use a
different valid strategy. The personalization regressions verify distinct
strategies for reliability-definition, alpha-validity, and score-error
misconceptions.

## Adaptive Stopping

Stopping is internal orchestration. It is evidence-driven, not a fixed
"after N strategies" rule.

| Internal decision | Evidence boundary | Student-facing translation |
|---|---|---|
| `continue_dialogue` | New evidence, strategy uptake, narrowing gap, or useful engagement supports another step | `You have added useful evidence. Let’s work on one more connection so you can apply the idea clearly.` |
| `stop_formative_dialogue` | Sound evidence, resolved anchor, no essential missing links, and revision or transfer readiness | `Your explanation now captures the key idea. You are ready to apply this understanding to a new situation.` |
| `bounded_stop_instructor_support` | A persistent unresolved barrier and low expected benefit after bounded meaningful support | `We have explored this idea from several perspectives. I will summarize the key point and suggest what to discuss next with your instructor.` |
| `engagement_support_needed` | Sustained off-task or disengagement evidence calls for a smaller supportive next step | `Let’s pause and make the next step smaller. Tell me which part feels unclear, or continue when you are ready.` |

Internal labels, profile fields, engagement scores, budgets, intervention
counts, AI confidence, escalation rules, and system-limit descriptions are
blocked from student-facing output. A message containing an internal stopping
state fails validation.

## Trajectory and Self-Correction

The trajectory envelope allows misconception, partial understanding,
contradiction, self-correction, sound understanding, and regression without
requiring exact turn labels. Sound evidence overrides simulator intent and
authorizes revision immediately.

E2A.35a separation remains authoritative:

- correction intent alone does not update conceptual evidence;
- correction plus observable evidence can update the profile;
- copied correction language is insufficient; and
- renewed distractor endorsement cannot produce a sound update.

## Metrics

The metrics contract prepares:

- dialogue efficiency;
- unnecessary-turn detection;
- missed-progression detection;
- intervention count;
- strategy adaptation;
- learning gain per turn;
- stopping appropriateness;
- instructor-escalation appropriateness; and
- student-facing communication quality.

These are bounded synthetic protocol metrics, not stable learner traits or
classroom-validity claims.

## Deterministic Verification

Thirty-four deterministic cases pass across learning-profile evolution,
engagement-profile evolution, intervention memory, adaptive stopping,
instructor escalation, student communication, self-correction, trajectory,
and personalization.

The required boundaries include:

- early sound evidence triggers immediate revision;
- persistent misconception with high engagement changes strategy;
- a persistent barrier after the bounded budget produces supportive
  instructor-next-step language;
- sound followed by misconception reopens support;
- self-correction without evidence preserves the profile;
- self-correction with evidence updates the profile;
- ineffective tutor strategy repetition is rejected;
- internal stopping-state leakage hard fails; and
- student-facing escalation language passes.

The compiled Evaluator V5 request, target evidence contract, metrics,
protected-source integrity, artifact contract, and provider-call guard also
pass.

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

This budget is descriptive only and does not authorize provider dispatch.

## Artifacts

The authoritative no-live run is:

`.data/e2a36-measurement-reasoning-longitudinal-protocol-freeze/e2a36_20260725T021228230Z_4eef5bb5/`

It contains 35 read-only artifacts. Artifact validation confirms the frozen
protocol hash, composite identity, exact artifact set, 34 passing deterministic
cases, protected-component integrity, and zero provider or network activity.

## Commands

```bash
npm run eval:formative:e2a36:run
npm run eval:formative:e2a36:report
npm run eval:formative:e2a36:smoke
npm run eval:formative:e2a36:learning-profile-smoke
npm run eval:formative:e2a36:engagement-profile-smoke
npm run eval:formative:e2a36:stopping-policy-smoke
npm run eval:formative:e2a36:instructor-escalation-smoke
npm run eval:formative:e2a36:student-facing-communication-smoke
npm run eval:formative:e2a36:intervention-memory-smoke
npm run eval:formative:e2a36:trajectory-envelope-smoke
npm run eval:formative:e2a36:self-correction-smoke
npm run eval:formative:e2a36:personalization-smoke
npm run eval:formative:e2a36:evaluator-v5-request-smoke
npm run eval:formative:e2a36:target-contract-smoke
npm run eval:formative:e2a36:metrics-smoke
npm run eval:formative:e2a36:artifact-smoke
npm run eval:formative:e2a36:provider-call-guard-smoke
```

No command in this phase executes E2A.36 live, approves the candidate, or
activates the candidate.
