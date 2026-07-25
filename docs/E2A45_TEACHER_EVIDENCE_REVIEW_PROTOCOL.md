# E2A.45 Teacher-Facing Evidence Review Protocol Freeze

## Status

E2A.45 is a deterministic, no-live protocol freeze. It defines how an
authorized instructor may review CBA-generated evidence without changing the
runtime evidence pipeline, learning or engagement profiles, intervention
memory, stopping policy, instructor handoff policy, auditability contracts, or
the E2A.44 classroom data architecture.

This phase does not implement a production teacher UI, access production
student records, authorize a live evaluation, approve a candidate, or activate
a candidate.

## Frozen Identity

- Protocol version:
  `e2a45-teacher-facing-evidence-review-freeze-v1`
- Protocol hash:
  `b18dead79621673384c9ecf68e0405fdcd14bb6c55c5c8aca2d7638782c39615`
- Composite runtime identity:
  `72497a0101ec8cf196e3f19b1f87464916a61144c0c73c3b3f552cb64d26b3d3`
- E2A.44 predecessor protocol:
  `6818e181e5ecbd500afe2bb22d50e33edf56b39f788e0dfd31f406db34c25ea0`
- E2A.44 predecessor composite identity:
  `8eac47d0060a905fe6c94725af97ed62797481fae0cb3e4164405da3fa687c5f`

The authoritative artifact packet is generated under:

```text
.data/e2a45-teacher-evidence-review-protocol-freeze/e2a45_20260725T181314839Z_b2835026/
```

## Authority Boundary

The teacher is an instructional partner. The teacher does not approve hidden
AI reasoning or validate internal model decisions.

Every teacher-facing interpretation separates:

1. **Evidence observed**: source-linked student response evidence.
2. **System interpretation**: a provisional candidate pattern.
3. **Teacher judgment**: the instructor's contextual instructional decision.

AI interpretations are not final truth. Teacher overrides are append-only
instructional decisions and do not rewrite student evidence, original
responses, audit records, or research provenance.

## Frozen Contracts

### `teacher-evidence-view-contract-v1`

Class-level views may include:

- common candidate misconception patterns;
- concept difficulty patterns;
- assessment-specific learning-state distributions;
- frequently selected distractors;
- aggregate intervention outcomes.

Individual views may include:

- authorized or pseudonymous student identity;
- evidence summaries and source links;
- possible learning gaps;
- revision and transfer status;
- advisory instructional follow-up.

Teacher projections exclude chain-of-thought, hidden reasoning, hidden prompts,
internal model confidence, and system-only metadata.

### `teacher-evidence-interpretation-contract-v1`

Observed evidence, provisional system interpretation, and teacher judgment are
distinct fields with distinct authority. Every observed statement retains
evidence provenance.

### `teacher-action-contract-v1`

Teachers may review evidence, identify instructional priorities, provide
support, assign follow-up, and override recommendations. They may not modify
historical evidence, delete audit records, change original responses, or alter
research provenance.

### `teacher-research-boundary-v1`

- Teacher view: course-scoped instructional information.
- Research view: approved pseudonymous analysis data.
- Student view: the student's own feedback, next steps, and plain-language
  learning summary.

Cross-role projection is prohibited.

### `teacher-feedback-loop-v1`

Teacher feedback may inform future instruction, activity design, and
misconception analysis through a separately validated future process. Feedback
is append-only and cannot rewrite historical evidence or original system
interpretations.

### `teacher-access-control-v1`

Access denies by default. Teacher access requires an authenticated teacher role
and an authorized course and record scope. Student and researcher roles cannot
open teacher evidence projections. Researchers receive only separately
authorized pseudonymous projections.

## Synthetic Scenarios

The deterministic packet contains synthetic evidence only:

- **Student group A**: repeated reliability-validity confusion produces a
  class-level candidate pattern.
- **Student group B**: repeated SEM interpretation difficulty produces a
  different instructional priority.
- **Student C**: persistent individual evidence produces a possible follow-up
  recommendation.
- **Student D**: sound evidence produces no unnecessary intervention
  recommendation.

Class summaries contain counts and patterns, not student identifiers.
Individual summaries remain scoped to exactly one authorized student.

## Metrics

The protocol computes deterministic completeness checks for:

- teacher evidence completeness;
- interpretability;
- actionability;
- privacy compliance;
- role separation;
- instructional usefulness.

These scores validate the frozen contract and synthetic fixtures only. They do
not establish instructional effectiveness, usability, diagnostic accuracy in a
real classroom, or causal impact.

## Privacy

The artifact packet contains no real student data and stores no:

- chain-of-thought;
- hidden model reasoning;
- hidden prompts;
- internal model confidence;
- system-only metadata;
- direct student identifiers in research projections;
- credentials or secrets.

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

The E2A.45 protocol-freeze budget is zero provider calls and zero network
requests.

## Verification

```bash
npm run typecheck
npm run lint
NODE_OPTIONS=--max-old-space-size=8192 npm run build
npm run eval:formative:e2a45:smoke
npm run eval:formative:e2a45:teacher-view-smoke
npm run eval:formative:e2a45:role-separation-smoke
npm run eval:formative:e2a45:privacy-smoke
npm run eval:formative:e2a45:access-control-smoke
npm run eval:formative:e2a45:audit-preservation-smoke
npm run eval:formative:e2a45:classroom-summary-smoke
npm run eval:formative:e2a45:interpretation-smoke
npm run eval:formative:e2a45:actions-smoke
npm run eval:formative:e2a45:feedback-smoke
npm run eval:formative:e2a45:metrics-smoke
npm run eval:formative:e2a45:replay-smoke
npm run eval:formative:e2a45:regression-smoke
npm run eval:formative:e2a45:historical-integrity-smoke
npm run eval:formative:e2a45:budget-smoke
npm run eval:formative:e2a45:protected-components-smoke
npm run eval:formative:e2a45:artifact-smoke
npm run eval:formative:e2a45:provider-call-guard-smoke
npm run eval:formative:e2a45:run
npm run eval:formative:e2a45:report
```

E2A.45 has no live entrypoint. It does not authorize execution, candidate
approval, candidate activation, or deployment.
