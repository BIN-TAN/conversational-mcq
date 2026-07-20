# E2A.15a Protocol Completeness Audit

E2A.15a is a read-only evidence audit of E2A.15 run
`e2a15_20260720030832_efc41543`. It makes no provider request and does not
change the E2A.14 candidate, E2A.13 provider evidence, E2A.15 provider evidence,
runtime validation, prompts, schemas, routing, retry policy, or fallbacks.

## Finding

The authorized protocol required eight distinct fresh protected-request cases.
The frozen E2A.15 protocol contains six cases. Its runner scheduled all six,
dispatched all six, completed all six, and accurately reported six provider
calls. The discrepancy is therefore not a reporting-count defect.

The missing categories are:

- informal or grammatically imperfect protected request;
- long-history refusal and distractor-continuity stress.

The protocol combined provider/model/schema/validator details in one case and
used quotation language in the hidden-prompt case. Those content overlaps do
not satisfy the requirement for eight distinct executions.

## Audit Commands

```bash
npm run eval:formative:e2a15:report -- \
  --run e2a15_20260720030832_efc41543
npm run eval:formative:e2a15:smoke
npm run eval:formative:e2a15a:audit
npm run eval:formative:e2a15a:smoke
```

Artifacts are written under `.data/e2a15a-protocol-audit/<run_id>/`. The audit
records source hashes before and after processing, validates all row counts,
and keeps the candidate unapproved and inactive.

## Supplemental Draft

When the two missing cases are confirmed, E2A.15a writes a frozen supplemental
protocol draft with fresh wording. It includes one informal protected request
and one long-history repeat-verbatim request that must preserve the active
distractor anchor. The draft is explicitly undispatched and requires separate
user authorization before a provider call.

The bounded supplemental budget is:

- two initial generation calls;
- at most two hard-rejection regenerations;
- four total generation calls;
- 12 provider-adapter attempts;
- 60,000 input tokens;
- 14,000 output tokens;
- USD 3 maximum estimated cost;
- sequential concurrency of one.

## Human Review

The original E2A.15 packet has 36 case-level records. It does not explicitly
identify all historical attempts, separate student and audit projections, or
carry privacy results and source hashes.

The E2A.15a template has 38 rows:

- six fresh live case rows;
- 30 historical V3 recomposition rows, each linked to its final source attempt;
- two explicit attempt rows for the former false-positive case.

Together, those rows account for all 31 historical provider attempts. Every
human decision, score, reviewer identity, note, confidence, and timestamp field
is null. The packet status is
`automated_provider_evidence_available_protocol_incomplete`; it is not human
review completion, approval readiness, approval, activation, or production
readiness.
