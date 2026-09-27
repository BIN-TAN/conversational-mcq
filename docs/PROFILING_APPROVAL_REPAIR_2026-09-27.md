# Profiling approval repair and scoped feedback allowance

## Problem and repair

The live approval retained `student-profiling-v5`, while the application used
`student-profiling-v6`. The newer prompt adds stance-aware evidence interpretation:
endorsing an option explanation, rejecting it, and merely quoting it are different
observations. Correct recognition does not alone establish independent transfer.
Changing a token environment variable could not repair this prompt mismatch.

The new amendment preserves the verified parent manifest and evidence, then creates
a separately hashed approval for the exact v5-to-v6 prompt change, evidence
consistency validator v2, and one student-and-assessment-scoped budget grant.
Other models, reasoning effort, role-wide budgets, timeouts, and validators remain
unchanged. The grant is held in the private operational artifact, not application
source, and is selected using persisted session identity, never client input.
It allows up to 30,000 **output tokens per initial feedback call**, including the
provider's reasoning allocation. It is not a minimum response length, an input
context limit, or a change to daily/session spending controls. Other tests,
students, and later conversation calls retain their existing limits.

The first synthetic live run found a distinct validator defect: a grounded local
misconception or pattern flag was treated as proof that package-level contradictory
answers had been resolved. Validator v2 no longer treats those observations as a
resolution when the profile explicitly requests clarification. Grounded conflict
signals and reference validation remain required. Historical results are not
recalculated or relabeled.

## Approval and activation

`prisma/profiling-repair-live-canary.ts` runs offline stance, evidence-consistency,
and approval-integrity regressions, then three paid synthetic calls using the
approved models and effort: 3-item and 12-item initial packages at 30,000, and a
canonical v6 profile at its unchanged 4,000 ceiling. Every call must complete and
pass schema and evidence checks. Failed results remain recorded separately.

`prisma/profiling-repair-amend.ts` requires an exact parent runtime hash, validation
artifact, operator authorization reference, explicit confirmation, a new output
directory, and the two private database identifiers. It stages a new bundle and
prints the four Render approval settings without switching the running service.
Apply the staged settings with the new application release and verify both web
and worker configuration. The old bundle remains available for rollback with
its matching prior application version.

This is a narrowly scoped operator-authorized amendment backed by automated
checks, not a newly performed independent human semantic review. The evidence
records `semantic_review_confirmed=false` and the limitations explicitly. It does
not assert classroom or psychometric validity. Further prompt revisions require
new review, not silently refreshed hashes.

## Research provenance and failure behavior

`agent_calls.max_output_tokens` records the actual effective limit sent to the
provider. `agent_calls.input_payload.runtime_budget` records `policy_version`,
`approved_runtime_hash`, `grant_id` (null outside the grant),
`base_max_output_tokens`, and `effective_max_output_tokens`. This metadata is
audit-only and is not sent in the provider's assessment input. Actual input,
output, reasoning, and total token usage remain separately recorded. A ceiling
is never presented as actual consumption. Restricted raw session exports retain
these fields; no new student-facing research interpretation is added.

New consistency results carry `student-profile-evidence-consistency-v2`; existing
v1 records remain historical evidence. No response, response package, transcript,
attempt number, or attempt allowance is changed by this release. Token exhaustion
still produces a recorded failure, not partial feedback or fabricated learning
evidence. The existing explicit retry/continue-without-feedback path remains.

A larger allowance can increase latency and cost and cannot guarantee provider
availability. The scope has no automatic expiry; removal requires a reviewed
replacement approval. Deployment and exact test outcomes are recorded in the
release ledger and its Word report.
