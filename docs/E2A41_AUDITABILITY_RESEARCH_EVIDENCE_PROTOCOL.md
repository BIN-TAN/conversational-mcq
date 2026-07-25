# E2A.41 Auditability and Research Evidence Protocol

## Status

E2A.41 is a deterministic research-audit protocol freeze only.

- Live execution: not authorized and not implemented
- Provider calls: zero
- Network requests: zero
- Candidate approval: false
- Candidate activation: false
- Student data: synthetic only

The protocol validates whether autonomous formative decisions can be traced,
replayed, and reviewed from structured evidence. It does not validate
classroom effectiveness or authorize production execution.

Frozen identity:

- Protocol SHA-256:
  `01bece2a52167d5f4b1993bd6d358a98b64f6c3332c4a5f78cccb34fa57fcc83`
- Composite runtime identity:
  `9465c76cabd28c3aca8c107bed2b19c81e395150d6012e1f2926e1b3fc283ef5`
- Authoritative 34-artifact packet:
  `.data/e2a41-auditability-research-evidence-protocol-freeze/e2a41_20260725T150029475Z_27d6f2ad/`

## Audit Chain

`research-evidence-traceability-v1` requires this chain for every major
decision:

1. decision;
2. accepted evidence source;
3. profile state;
4. rule or policy identifier;
5. outcome;
6. linked student-facing communication, when communication is produced.

The trace stores accepted turn IDs, evidence-span IDs, profile snapshot IDs,
policy IDs and versions, rule codes, and outcome codes. It does not store
hidden prompts, chain-of-thought, or raw model reasoning.

## Auditable Decisions

The synthetic packet covers:

| Decision | Required structured evidence |
|---|---|
| Misconception identification | Observed evidence, knowledge gap, confidence category, profile update source |
| Tutor intervention selection | Previous strategy, remaining gap, selected strategy, intervention goal and outcome |
| Profile update | Previous profile, new evidence, updated profile, transition reason codes |
| Sound decision | Required and satisfied criteria, remaining limitations, revision readiness |
| Stopping decision | Continue, revise, close, or instructor-support outcome; evidence and policy version |
| Instructor handoff | Unresolved gap, intervention history, and reason human support is appropriate |

## Contracts

### Research evidence traceability

`research-evidence-traceability-v1` validates reference completeness and
scope consistency. Evidence and profile references must match the exact
student, session, concept, and misconception namespace from E2A.40.

### Research replay

`research-replay-contract-v1` reconstructs accepted turn order, evidence
extraction, profile transitions, intervention history, and stopping outcome
from structured records. Replay is ordered by explicit sequence and stable
record ID, not timestamps or input array order.

Reversing the source arrays produces the same replay hashes.

### Student and audit separation

`student-audit-separation-v1` permits structured metadata in research audit
records but blocks policy IDs, policy versions, profile schemas, confidence
scores, escalation criteria, rule codes, stopping outcomes, and model-decision
labels from student-facing messages.

### Human review package

`human-review-evidence-package-v1` provides:

- student-visible conversation;
- structured evidence summary;
- profile transitions;
- intervention history;
- final outcome.

It deliberately excludes hidden reasoning, model chain-of-thought, hidden
prompts, provider transport payloads, unnecessary system metadata, and direct
identifiers.

### Audit metrics

`audit-metrics-contract-v1` reports:

- decision trace completeness;
- evidence provenance completeness;
- replay consistency;
- audit/student separation;
- reviewer package completeness;
- privacy compliance.

The protocol-freeze target for every metric is `1`.

## Multi-Student Isolation

Two synthetic students receive the same Measurement Theory activity:

- one reaches sound evidence and is authorized to revise;
- one retains a persistent misconception and receives a supportive
  instructor next step.

Their turns, evidence, profiles, decisions, replay outputs, and audit records
remain separate. Cross-student audit reads and evidence references fail
closed. The protocol imports E2A.40 isolation rather than replacing it.

## Deterministic Regressions

The packet verifies:

1. sound-decision traceability;
2. false-sound prevention;
3. missing-evidence detection;
4. evidence preservation across modules;
5. incorrect profile-transition detection;
6. incorrect stopping-decision detection;
7. student-facing audit leakage detection;
8. multi-student audit separation;
9. replay consistency;
10. E2A.40 historical protocol and source integrity.

## Budget

The prepared, unexecuted budget is:

- maximum logical generation calls: 29;
- maximum adapter attempts: 87;
- provider concurrency: 1;
- maximum transport retries per logical call: 2;
- maximum input tokens: 900,000;
- maximum output tokens: 70,000;
- maximum total tokens: 970,000;
- maximum cost: USD 25 when pricing metadata exists.

These limits do not authorize execution. E2A.41 has no live entrypoint or
provider-dispatch path.

## Commands

Generate the immutable no-live packet:

```bash
npm run eval:formative:e2a41:run
```

Inspect the latest packet:

```bash
npm run eval:formative:e2a41:report
```

Run the deterministic verification:

```bash
npm run eval:formative:e2a41:smoke
npm run eval:formative:e2a41:audit-trace-smoke
npm run eval:formative:e2a41:replay-smoke
npm run eval:formative:e2a41:evidence-provenance-smoke
npm run eval:formative:e2a41:student-audit-separation-smoke
npm run eval:formative:e2a41:human-review-smoke
npm run eval:formative:e2a41:privacy-smoke
npm run eval:formative:e2a41:multi-student-audit-smoke
npm run eval:formative:e2a41:provider-call-guard-smoke
```

Artifacts are written under:

```text
.data/e2a41-auditability-research-evidence-protocol-freeze/
```

Every artifact is made read-only after validation.

The final packet contains 11 decision traces and 36 deterministic checks. All
six audit metrics equal the protocol-freeze target of `1`.
