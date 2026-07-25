# E2A.37 Instructor Handoff Protocol Freeze

## Status

E2A.37 is frozen as a deterministic, no-provider held-out protocol for a
separate authorization decision. It was not executed live.

- Protocol version:
  `e2a37-instructor-handoff-human-in-loop-boundary-canary-v1`
- Protocol hash:
  `d13256eb27213ee9799e2cd401df6cf5b2e8a8a38abe98fe1340ecd8bcc1e68e`
- Composite runtime identity:
  `df4ace071e88af16c4941507c6adaab3f91d3efd9ca0919d767bd7018f815f2a`
- Candidate configuration hash:
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`
- Provider calls: `0`
- Network requests: `0`
- Candidate approved: `false`
- Candidate activated: `false`

The freeze harness has no provider dispatch path. Its `run` command writes
only deterministic preparation artifacts.

## Held-Out Boundary

The domain is educational measurement and assessment literacy. The scenario
asks a student to evaluate the claim that stable scores prove an assessment
supports its intended interpretation. The active distractor incorrectly
equates reliability evidence with validity evidence.

E2A.37 tests six held-out trajectories:

| Case | Trajectory | Required boundary |
|---|---|---|
| A | Misconception to partial to sound | Continue targeted support, then authorize revision immediately when sound |
| B | Persistent misconception with high engagement | Continue or change strategy while learning gain remains plausible; use supportive handoff only after bounded support loses value |
| C | Persistent misconception with low responsiveness | Avoid an infinite explanation loop and use a bounded, supportive instructor handoff |
| D | Sound evidence reached early | Stop the formative dialogue immediately without an unnecessary tutor turn |
| E | Sound followed by renewed distractor endorsement | Reopen the profile and resume targeted support |
| F | `I think I understand now.` without evidence | Preserve the prior profile and request an observable explanation |

Exact turn-by-turn evaluator labels are not prescribed. Observable evidence,
the sound gate, profile consistency, and the application-owned progression
decision remain authoritative.

## Contract Set

The protocol binds:

1. `TargetEvidenceContractV5`
2. `e2a37-measurement-canonical-anchor-v1`
3. the unchanged anchor reference, stance, and scope resolvers
4. `e2a37-self-correction-integration-v1`
5. `learning_profile_evolution_v1`
6. `engagement_profile_evolution_v1`
7. `longitudinal-intervention-memory-v1`
8. `adaptive-stopping-policy-v1`
9. `instructor-escalation-policy-v1`
10. `e2a37-instructor-handoff-boundary-v1`
11. `e2a37-student-facing-handoff-communication-v1`
12. `trajectory-envelope-v1`
13. `e2a37-artifact-contract-v1`
14. `e2a37-bounded-live-budget-v1`
15. `e2a37-composite-runtime-identity-v1`

The self-correction integration keeps visible interaction behavior, simulator
metadata, and conceptual evidence separate. Intent-only correction cannot
update the profile. Observable independent correction evidence can update it,
while a contradictory correction keeps the conceptual barrier open.

## Stopping And Handoff

Stopping and escalation are internal application orchestration decisions.
Provider output does not authorize either decision.

Continue support when new evidence, narrowing gaps, useful strategy uptake, or
engagement makes further learning plausible. Change strategy when the previous
strategy-gap pair did not produce useful evidence.

Immediate revision is required when the profile is sound, the active
distractor is rejected with the required mechanism, no essential missing link
remains, and revision or transfer readiness is present.

Instructor handoff is eligible only after meaningful support and an
educationally relevant boundary such as a persistent unresolved barrier,
decreasing intervention value, an exhausted bounded budget, limited expected
benefit, or a need for human contextual knowledge. Correctness or a fixed turn
count alone cannot justify handoff. Premature handoff hard fails.

The valid handoff style is:

> We have explored this idea from several angles. Reliable scores show
> consistency, but validity still needs evidence for the intended
> interpretation. A useful next step is to discuss with your instructor what
> validity evidence would fit this assessment.

## Student-Facing Boundary

Visible communication must be supportive, actionable, learning-oriented, and
free of internal orchestration language. The deterministic validator rejects:

- internal profiles;
- misconception labels;
- engagement scores or states;
- stopping rules or decisions;
- session, turn, or token budgets;
- AI or system limitations; and
- escalation rules or criteria.

Regression fixtures confirm that internal escalation leakage hard fails. The
student sees the conceptual distinction and a useful next action, not why an
internal policy selected that action.

## Personalization

The same reliability-validity misconception receives different support based
on reasoning quality, engagement evidence, prior intervention strategies, and
the remaining conceptual gap:

- productive partial reasoning receives a focused mechanism prompt;
- persistent high-engagement reasoning receives a different counterexample
  strategy; and
- persistent low responsiveness after bounded support receives a concise,
  supportive instructor next step.

The protocol does not use generic identical explanations for these cases.

## Deterministic Verification

Twenty-nine deterministic cases pass across:

- learning-profile evolution;
- adaptive stopping;
- instructor escalation;
- student-facing communication;
- intervention memory;
- trajectory-envelope behavior;
- self-correction integration; and
- personalization.

The checks include all nine required regressions:

1. early sound authorizes revision immediately;
2. persistent misconception with high engagement continues or adapts;
3. bounded low responsiveness produces student-facing instructor support;
4. regression after sound reopens the profile;
5. unsupported understanding requests evidence;
6. effective self-correction updates the profile;
7. ineffective intervention changes strategy;
8. internal escalation leakage hard fails; and
9. premature escalation hard fails.

The metrics packet covers dialogue efficiency, unnecessary-turn detection,
missed-progression detection, intervention adaptation, stopping
appropriateness, escalation appropriateness, student-facing communication
quality, and instructor-handoff quality. These are synthetic protocol metrics,
not stable learner traits or classroom-validity claims.

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

`.data/e2a37-instructor-handoff-protocol-freeze/e2a37_20260725T085743Z_2a7cc062/`

It contains 37 read-only artifacts. Artifact validation confirms the exact
artifact set, frozen protocol hash, composite identity, protected-source
integrity, deterministic results, and zero provider or network activity.

## Commands

```bash
npm run eval:formative:e2a37:run
npm run eval:formative:e2a37:report
npm run eval:formative:e2a37:smoke
npm run eval:formative:e2a37:profile-evolution-smoke
npm run eval:formative:e2a37:stopping-policy-smoke
npm run eval:formative:e2a37:instructor-escalation-smoke
npm run eval:formative:e2a37:student-facing-communication-smoke
npm run eval:formative:e2a37:intervention-memory-smoke
npm run eval:formative:e2a37:trajectory-envelope-smoke
npm run eval:formative:e2a37:self-correction-smoke
npm run eval:formative:e2a37:personalization-smoke
npm run eval:formative:e2a37:evaluator-v5-request-smoke
npm run eval:formative:e2a37:target-contract-smoke
npm run eval:formative:e2a37:metrics-smoke
npm run eval:formative:e2a37:artifact-smoke
npm run eval:formative:e2a37:provider-call-guard-smoke
```

No command in this phase executes E2A.37 live, approves the candidate, or
activates the candidate.
