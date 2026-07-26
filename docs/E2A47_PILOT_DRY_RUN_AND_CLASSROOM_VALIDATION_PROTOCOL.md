# E2A.47 Pilot Dry-Run and End-to-End Classroom Validation Protocol

## Status

E2A.47 is a deterministic protocol freeze only. It does not execute live
classroom testing, use real students, access production research data, call a
provider, approve or activate a candidate, authorize deployment, establish
classroom effectiveness, demonstrate learning gains, establish real-student
usability, or assume institutional ethics approval.

The protocol is bound to the committed E2A.46 operational-readiness freeze and
the E2A.44 classroom data architecture:

```text
E2A.46 protocol:
68c0f468fa41c01dd5ae9574580453b762ea1d7212c10549274033a980bc38ca

E2A.46 composite runtime identity:
1bbc21e220e77a8dc40e17fc04eb254a8019fbd3a2e84ea586402af6766f5f10

E2A.44 protocol:
6818e181e5ecbd500afe2bb22d50e33edf56b39f788e0dfd31f406db34c25ea0

E2A.44 composite runtime identity:
8eac47d0060a905fe6c94725af97ed62797481fae0cb3e4164405da3fa687c5f
```

The E2A.47 frozen identity is:

```text
protocol_version:
e2a47-pilot-dry-run-end-to-end-classroom-validation-freeze-v1

protocol_hash:
abe57e5f7727ad41b19817b706a326f2767dfc8754deb0e7d02b9690718d588a

composite_runtime_identity:
f7959108f2950e663c68de17b11d1f9adc01270161f35684d8974a888c3bfa7d
```

The authoritative 40-artifact packet is:

```text
.data/e2a47-pilot-dry-run-protocol-freeze/e2a47_20260726T003016278Z_f14028da/
```

## Frozen Contracts

- `pilot-dry-run-workflow-contract-v1`
- `end-to-end-data-trace-contract-v1`
- `runtime-schema-alignment-contract-v1`
- `research-export-readiness-contract-v1`
- `pilot-failure-recovery-contract-v1`
- `teacher-review-validation-contract-v1`
- `e2a47-artifact-contract-v1`
- `e2a47-budget-contract-v1`
- `e2a47-composite-runtime-identity-v1`

The contracts are new evaluation-only modules. Evaluator V5, the tutor
candidate, evidence pipeline, learning and engagement profiles, intervention
memory, stopping policy, instructor handoff policy, auditability contracts,
classroom data architecture, teacher evidence-review contracts, database
schema, and deployment configuration remain unchanged.

## Synthetic Pilot Workflow

The dry run validates all three workflow periods.

Before class:

1. The instructor selects the assessment activity.
2. Learning objectives are defined.
3. target misconceptions are reviewed.
4. Activity settings are configured.

During class:

1. The student accesses the activity.
2. The student answers the item.
3. The student provides reasoning.
4. The student provides confidence.
5. The student receives formative dialogue.
6. The student revises when appropriate.
7. The student completes transfer or closure when appropriate.

After class:

1. The teacher reviews a bounded evidence summary.
2. The teacher identifies instructional needs.
3. The researcher receives only an approved pseudonymous export.

The five synthetic students cover:

| Student | Trajectory | Required outcome |
|---|---|---|
| A | Misconception to sound | Short dialogue and closure |
| B | Misconception to partial improvement | Adaptive support |
| C | Persistent misconception | Multiple strategies and supportive bounded stop |
| D | Copied terminology without evidence | No false-sound result |
| E | Misconception to evidence-based self-correction | Profile update and closure |

## End-to-End Provenance

Every synthetic student has the same 12-stage trace:

1. Assessment item
2. Student response
3. Evidence extraction
4. Learning-profile update
5. Engagement-profile update
6. Intervention selection
7. Post-intervention response
8. Revision evidence
9. Transfer evidence
10. Closure decision
11. Teacher evidence summary
12. Research export

Every stage has a synthetic student/session scope, monotonic sequence, contract
version, timestamp, source-record link, and content hash. Hidden prompts and
hidden model reasoning are not provenance sources.

## Architecture Alignment

The dry-run objects are contractually aligned with the five E2A.44 layers:

- assessment objects;
- student evidence;
- learning-state evolution;
- intervention;
- classroom/research.

This alignment is validation against synthetic runtime-shaped objects. It does
not perform a migration or claim that a production classroom run occurred.

## Teacher and Research Boundaries

The teacher projection permits class-level candidate misconception patterns and
assessment-specific concept difficulty, plus authorized individual evidence
summaries, learning gaps, revision status, follow-up suggestions, and explicit
partial-evidence status.

It excludes chain-of-thought, hidden reasoning, hidden prompts, model internals,
raw provider payloads, credentials, unnecessary private information, and
cross-course data.

The synthetic research export requires a pseudonymous student ID, item ID,
response, evidence summary, confidence, profile transitions, intervention
history, revision, transfer, and outcome. Direct identifiers, hidden reasoning,
hidden prompts, provider payloads, credentials, and unnecessary metadata are
excluded.

## Failure Recovery

The deterministic suite covers:

- student-session interruption;
- duplicate submission;
- provider unavailability without dispatch;
- teacher review before completion;
- interrupted export;
- profile-update failure.

Every path preserves accepted evidence and prior audit records, records a safe
failure result, avoids duplicate effects, and does not corrupt data. A failed
profile update preserves the prior profile pointer. A partial teacher review is
marked partial. Export retry uses immutable source records.

## Metrics and Interpretation

The protocol computes synthetic validation rates for:

- workflow completion;
- data-trace completeness;
- profile consistency;
- teacher-evidence completeness;
- export completeness;
- failure-recovery success;
- privacy-boundary compliance.

These are protocol-connectivity metrics over deterministic fixtures. They are
not real classroom performance, usability, learning-gain, or effectiveness
measures.

## Budget and Execution Boundary

The protocol-freeze budget is zero provider calls and zero network requests.
The following future ceiling is frozen but not authorized:

- 29 logical calls;
- 87 adapter attempts;
- concurrency one;
- two transport retries per logical call;
- 900,000 input tokens;
- 70,000 output tokens;
- 970,000 total tokens;
- USD 25 when pricing metadata is available.

There is no live entry point in E2A.47.

## Commands

```bash
npm run eval:formative:e2a47:smoke
npm run eval:formative:e2a47:workflow-smoke
npm run eval:formative:e2a47:end-to-end-smoke
npm run eval:formative:e2a47:schema-alignment-smoke
npm run eval:formative:e2a47:export-smoke
npm run eval:formative:e2a47:teacher-review-smoke
npm run eval:formative:e2a47:failure-recovery-smoke
npm run eval:formative:e2a47:privacy-smoke
npm run eval:formative:e2a47:audit-preservation-smoke
npm run eval:formative:e2a47:profile-evolution-smoke
npm run eval:formative:e2a47:engagement-evolution-smoke
npm run eval:formative:e2a47:intervention-history-smoke
npm run eval:formative:e2a47:multi-student-isolation-smoke
npm run eval:formative:e2a47:metrics-smoke
npm run eval:formative:e2a47:replay-smoke
npm run eval:formative:e2a47:regression-smoke
npm run eval:formative:e2a47:historical-integrity-smoke
npm run eval:formative:e2a47:budget-smoke
npm run eval:formative:e2a47:protected-components-smoke
npm run eval:formative:e2a47:artifact-smoke
npm run eval:formative:e2a47:provider-call-guard-smoke
npm run eval:formative:e2a47:run
npm run eval:formative:e2a47:report
```
