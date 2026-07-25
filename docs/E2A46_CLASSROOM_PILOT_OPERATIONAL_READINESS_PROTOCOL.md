# E2A.46 Classroom Pilot Operational Readiness Protocol Freeze

## Status

E2A.46 is a deterministic, no-live operational-readiness protocol freeze. It
defines the evidence required to decide whether CBA is prepared for a
controlled university course pilot.

This phase does not execute a pilot, establish classroom effectiveness,
authorize deployment, assume REB or ethics approval, access production data,
approve a candidate, or activate a candidate.

## Frozen Identity

- Protocol version:
  `e2a46-classroom-pilot-operational-readiness-freeze-v1`
- Protocol hash:
  `68c0f468fa41c01dd5ae9574580453b762ea1d7212c10549274033a980bc38ca`
- Composite runtime identity:
  `1bbc21e220e77a8dc40e17fc04eb254a8019fbd3a2e84ea586402af6766f5f10`
- E2A.45 predecessor protocol:
  `b18dead79621673384c9ecf68e0405fdcd14bb6c55c5c8aca2d7638782c39615`
- E2A.45 predecessor composite identity:
  `72497a0101ec8cf196e3f19b1f87464916a61144c0c73c3b3f552cb64d26b3d3`

The authoritative 36-artifact packet is:

```text
.data/e2a46-pilot-operational-readiness-protocol-freeze/e2a46_20260725T183518657Z_caca6f2c/
```

## Readiness Decision

The frozen evaluator distinguishes:

- `not_ready`: a required check failed or claims verification without evidence;
- `not_determined`: required checks remain unverified;
- `ready_for_authorized_controlled_pilot_review`: every required check has
  explicit evidence, subject to separate operator and institutional approval.

The current E2A.46 decision is `not_determined`. E2A.46 contains no real
deployment, monitoring, backup, recovery, consent, ethics, training,
orientation, or support evidence. A synthetic all-verified checklist confirms
only that the decision logic can reach the review state; it does not authorize
deployment.

## Frozen Contracts

### `instructor-onboarding-contract-v1`

Instructors must understand CBA's formative purpose, the separation between
evidence and grades, bounded interpretation, override boundaries, and privacy
responsibilities. Treating AI output as final judgment fails onboarding and
requires remediation.

### `student-onboarding-contract-v1`

Students receive plain-language information about reasoning, confidence,
feedback, learning rather than grading, privacy, participation, and withdrawal.
Student-facing explanations exclude internal profiles, routing, model
confidence, prompts, agent calls, and hidden decisions.

### `pilot-workflow-readiness-contract-v1`

The contract freezes before-class, during-class, and after-class requirements
for students, instructors, researchers, and the application-controlled
workflow. Resume uses persisted state, and providers never own transitions.

### `pilot-failure-handling-contract-v1`

The protocol covers:

- provider unavailable;
- student disconnect;
- duplicate submission;
- incomplete response;
- teacher override;
- export failure.

Every case preserves evidence and prior audit records, prevents corruption, and
uses typed recovery behavior. Duplicate submissions are idempotent. Provider
failure is never counted as success.

### `pilot-privacy-readiness-contract-v1`

Privacy readiness requires verified consent, withdrawal, anonymization, access
control, and research/instruction separation. Missing consent excludes research
use without blocking the course. Withdrawal excludes future research use
without affecting course standing. No deployment or ethics approval is
assumed.

### `pilot-monitoring-contract-v1`

Monitoring is limited to availability, incomplete-session counts, typed
interaction failures, data-quality issues, and support requests. It excludes
raw credentials, unnecessary direct identity, raw reasoning, hidden prompts,
and chain-of-thought, and it cannot be used to infer misconduct.

### `pilot-readiness-criteria-v1`

Operational success means the workflow completes, evidence is collected and
profiles update from valid evidence, teachers can interpret bounded summaries,
privacy holds, and failures recover safely. It does not mean that AI answers
correctly, classroom effectiveness is established, learning gains are proven,
or deployment is authorized.

### `pilot-readiness-checklist-v1`

Required operator evidence is grouped into:

- Technical: deployment environment, monitoring, backup, and recovery.
- Research: consent, withdrawal, data handling, ethics approval, and
  documentation.
- Teaching: instructor training, student orientation, and support process.

## Deterministic Coverage

The freeze includes all twelve required regressions:

1. instructor misunderstanding of AI output;
2. student misunderstanding of feedback purpose;
3. provider outage;
4. student session interruption;
5. duplicate submission;
6. withdrawal request;
7. unauthorized teacher access;
8. export failure;
9. evidence preservation after failure;
10. audit preservation;
11. student-facing communication leakage;
12. research/instruction data mixing.

Protocol metrics cover instructor, student, workflow, privacy, data collection,
failure handling, and support/monitoring readiness. These are synthetic
contract-completeness checks, not empirical effectiveness measures.

## Budget

The future live ceiling is frozen but not authorized:

- 29 logical calls;
- 87 adapter attempts;
- concurrency one;
- at most two transport retries per logical call;
- 900,000 input tokens;
- 70,000 output tokens;
- 970,000 total tokens;
- USD 25 when pricing metadata is available.

The E2A.46 freeze budget is zero provider calls and zero network requests.

## Verification

```bash
npm run typecheck
npm run lint
NODE_OPTIONS=--max-old-space-size=8192 npm run build
npm run eval:formative:e2a46:smoke
npm run eval:formative:e2a46:onboarding-smoke
npm run eval:formative:e2a46:workflow-readiness-smoke
npm run eval:formative:e2a46:failure-recovery-smoke
npm run eval:formative:e2a46:privacy-smoke
npm run eval:formative:e2a46:monitoring-smoke
npm run eval:formative:e2a46:audit-preservation-smoke
npm run eval:formative:e2a46:teacher-student-boundary-smoke
npm run eval:formative:e2a46:data-collection-smoke
npm run eval:formative:e2a46:readiness-decision-smoke
npm run eval:formative:e2a46:metrics-smoke
npm run eval:formative:e2a46:replay-smoke
npm run eval:formative:e2a46:regression-smoke
npm run eval:formative:e2a46:historical-integrity-smoke
npm run eval:formative:e2a46:budget-smoke
npm run eval:formative:e2a46:protected-components-smoke
npm run eval:formative:e2a46:artifact-smoke
npm run eval:formative:e2a46:provider-call-guard-smoke
npm run eval:formative:e2a46:run
npm run eval:formative:e2a46:report
```

E2A.46 has no live entrypoint and does not authorize a pilot, approval,
activation, or deployment.
