# E2A.35 Self-Correction Protocol Freeze

## Status

E2A.35 is frozen for a separate authorization decision. It was not executed
live in this phase.

- Protocol version:
  `e2a35-sampling-bias-self-correction-canary-v1`
- Protocol hash:
  `97812ff31dc3af594b992c01706bed8ddda2229ac1e5cbdd96f916c2e569e9b9`
- Composite runtime identity:
  `cc6f9a6f1f4000106f599c8221b01fbf9c72ff01360ac6b32b2aff4bc9b88303`
- Provider calls: `0`
- Network requests: `0`
- Candidate approved: `false`
- Candidate activated: `false`

The freeze has no live harness and no live command. The `run` command below
only creates deterministic no-live preparation artifacts.

## Held-Out Boundary

The domain is Research Methods / Sampling Bias. The scenario asks whether a
volunteer sample supports a conclusion about all university students.

The active distractor claims that volunteers represent the whole university
population because anyone could participate. The required mechanism is that
volunteers can differ systematically from non-volunteers, self-selection can
produce that difference, and the resulting bias limits population
generalization.

The protocol binds:

- a `TargetEvidenceContractV5`;
- a sampling-bias canonical anchor contract;
- an anchor-stance contract using the unchanged scoped stance resolver;
- `self-correction-intent-v1`;
- `trajectory-envelope-v1`;
- the bounded artifact and budget contracts; and
- a composite runtime identity over the unchanged candidate and Evaluator V5.

## Conversation-State Rules

`self-correction-intent-v1` separates correction intent from conceptual
evidence. A valid correction such as "I think my previous answer was wrong
because..." remains an ordinary conceptual response when it supplies
assessable evidence. It must not be routed as off-topic, unrelated, or a new
question.

Correction language alone is not evidence. Empty or copied correction stems
request revised reasoning, while a correction that changes topic preserves
the prior conceptual profile and redirects the topic.

The latest valid conceptual evidence has precedence. Earlier misconception
evidence remains in the historical profile. If a student returns to the
misconception after a valid correction, the profile reopens. A later
independent sound explanation closes the reopened profile and authorizes
revision immediately.

## Trajectory Envelope

The simulator trajectory is non-authoritative. The protocol defines broad
allowed reasoning-quality sets rather than exact turn-by-turn labels.
Evidence accuracy and the production sound gate control progression.

- Early sound evidence triggers immediate revision.
- Prolonged partial evidence remains in dialogue.
- Regression after improvement reopens targeted support.
- Copied wording without evidence requests independent evidence.
- Historical misconception evidence does not block a later valid sound state.

## Deterministic Evidence

The no-live verification includes:

- 160 domain-neutral self-correction calibration cases;
- all eight required self-correction cases;
- production profile-update regressions;
- regression-reopening regressions;
- trajectory-envelope regressions;
- compiled Evaluator V5 request validation;
- candidate and protected-source integrity;
- held-out overlap checks against representative prior E2A.24-E2A.34
  scenario artifacts; and
- artifact and provider-call guards.

Evaluator V5, the tutor candidate, the scoped stance resolver, the production
profile-update contract, and `trajectory-envelope-v1` remain unchanged.

## Budget

The inert bounded budget is:

- one isolated session;
- 29 logical generation calls maximum;
- 87 adapter attempts maximum;
- two transport retries per logical call maximum;
- 900,000 input tokens maximum;
- 70,000 output tokens maximum;
- 970,000 total tokens maximum;
- USD 25 maximum when pricing metadata is available; and
- provider concurrency one.

This budget is descriptive only. It does not authorize a provider dispatch.

## Commands

```bash
npm run eval:formative:e2a35:run
npm run eval:formative:e2a35:report
npm run eval:formative:e2a35:smoke
npm run eval:formative:e2a35:calibration-smoke
npm run eval:formative:e2a35:self-correction-smoke
npm run eval:formative:e2a35:profile-update-smoke
npm run eval:formative:e2a35:regression-reopening-smoke
npm run eval:formative:e2a35:trajectory-envelope-smoke
npm run eval:formative:e2a35:target-contract-smoke
npm run eval:formative:e2a35:evaluator-v5-request-smoke
npm run eval:formative:e2a35:artifact-smoke
npm run eval:formative:e2a35:provider-call-guard-smoke
```

Persistent no-live artifacts are written under:

`.data/e2a35-sampling-bias-self-correction-protocol-freeze/<run_id>/`

The final artifact set is redaction-scanned and made read-only. Live execution,
candidate approval, and candidate activation remain outside this phase.
