# V18 LLM/Platform Contract Convergence

## Status

V18 is an inactive executable-freeze candidate. Its live package is prepared
only after the complete no-provider gate succeeds; it is not authorized,
executed, approved, or activated. V17 candidate and run artifacts remain
immutable.

## Failure Classification

- The three V17 profiling canaries failed before HTTP dispatch because the
  production Responses schema compiler rejected
  `misconception_indicators[].atomic_claims`: the V17 Zod schema used
  `.optional()` without `.nullable()`. The V17 offline tests parsed fixtures
  with Zod but did not compile the exact production Responses request.
- V17 Case 5 was truncated at the configured 3,500 output-token ceiling. The
  provider returned `status=incomplete`, `reason=max_output_tokens`, and a
  truncated JSON candidate. It was not a parsed semantic-contract failure.
- V17 Case 6 exposed the legacy `misconception_claim_closure` field in its
  active output schema. Compatibility parsing admitted it before semantic
  validation rejected it. The regeneration then cited tutor turn 891 while
  the canonical top-level evidence set contained only student turns 890 and
  892, producing an evidence-closure rejection.

## Converged Boundary

The LLM interprets educational evidence, teaches adaptively, judges learning
change, and recommends profile outcomes. The platform assigns opaque claim and
evidence identities before generation, restricts references to an eligible
same-scope catalog, validates complete transition provenance, persists accepted
records, and reconstructs teacher/research views.

V18 uses one production request builder and one production Responses schema
compiler for production profiling, no-provider preflight, and the V18 runtime.
The active profiling schema requires nonempty atomic claims while remaining
compatible with the provider's strict JSON-schema boundary.

Canonical evidence identity v2 uses opaque hashes of immutable source
coordinates. Its scope binds the assessment-session namespace, assessment, and
concept unit. Baseline answer, reasoning, confidence, and distractor evidence
use item identity plus evidence kind; process observations use the persisted
process-event ID; formative evidence uses conversation identity plus immutable
turn sequence. Human-readable content is carried for interpretation but is not
part of the evidence-ID material. Rebuilding a context, retrying, regenerating,
persisting, projecting, exporting, or replaying therefore preserves the same
ID for the same source object.

Every evidence entry records `evidence_stage` as either
`baseline_assessment` or `formative_conversation`. Stage is provenance only;
it does not encode a pedagogical interpretation. Tutor turns and
teacher-private records are ineligible. Sequence indexes remain derived audit
fields, not free-text identities.

Initial profiling may cite only canonical student-understanding evidence from
the baseline catalog. The profiling model interprets that evidence and emits
atomic claims with evidence IDs; the platform verifies scope and eligibility,
then assigns canonical claim IDs and persists baseline provenance.

Resolved claims and changed profile fields require eligible student-authored
formative evidence after the prior profile's evidence cutoff. Baseline-only,
tutor, teacher-private, foreign-conversation, foreign-scope, unknown, and
fabricated references fail closed. Retained claims keep stable claim IDs and
historical baseline provenance automatically; no new evidence is required, and
optional reconfirming evidence must itself be post-cutoff student evidence.
Untested content remains a limitation or uncertainty.

## Recovery And Accounting

V18 distinguishes transport failure, provider incomplete/truncated output,
syntactic structured-output failure, and parsed semantic-contract failure.
Only the last class permits one bounded semantic regeneration. The regeneration
receives the same claim catalog, evidence catalog, invalid candidate and hash,
issue paths, rejection category, and contract version.

No structured-output recovery call was added. Case 5 was specifically caused
by the output ceiling, so V18 raises the formative role allowance to 7,000 and
reduces identity verbosity by using canonical ID references. Incomplete output
continues to fail closed.

Accounting separately records planned base calls, entered logical calls,
pre-dispatch request rejections, HTTP requests, completed provider responses,
transport retries, incomplete-output recovery calls, semantic regenerations,
parsed candidates, and accepted candidates.

## Persistence And Verification

The dissertation pipeline canary exercises fixed assessment evidence through
the production profiling service, semantic validation, platform claim
assignment, repeated V18 context compilation, a new partial-resolution student
response, transition validation/persistence, and teacher/research
reconstruction. It resolves one claim from post-cutoff student evidence,
retains another with the original claim ID and baseline provenance, rejects a
baseline-only resolution attempt, and verifies byte-identical catalogs,
idempotency, and duplicate-transition prevention in an isolated temporary
local PostgreSQL database.

Teacher projection exposes only safe identity metadata and the persisted claim
provenance. Research export carries the original append-only V18 snapshot. The
database canary verifies that both views preserve the exact canonical IDs; no
new table or migration is required.

All three frozen V17 profiling inputs are compiled offline through the same
production request builder and Responses structured-output compiler used by
the application. V18 configures 7,000 formative output tokens. An incomplete
max-token provider result is accounted as dispatched and received but not
parsed or accepted, and it cannot trigger semantic regeneration.

The current generation boundary accepts only V18 claim IDs and canonical
evidence IDs. V16 closure payloads, V17 sequence-reference payloads, and
free-text identity aliases remain available only to immutable historical
readers and are rejected from current generation.

No Prisma migration is required. Existing append-only JSON snapshots carry the
claim catalog, evidence catalog, dispositions, readable content, and lineage.

The V18-owned executable package freezes exactly 12 cases: three production
profiling contract cases, eight longitudinal formative-comparability cases,
and one dissertation end-to-end provenance case. It includes the canonical
`node --import tsx` launcher, process-local runner, compiled plan, environment
parity contract, exactly-once dispatch checkpoint, provenance closure,
preventive security release boundary, and an inactive approval placeholder.

The compiled plan contains four profiling base calls and 24 formative base
calls. It permits at most 28 bounded semantic-regeneration calls, 56 logical
calls, 168 provider attempts, 1,800,000 input tokens, 368,000 output tokens,
2,168,000 total tokens, 7,200,000 milliseconds, concurrency one, and a USD 60
operator ceiling. Plan mode creates no dispatch checkpoint and performs no
provider or model-auth request.

Live execution still requires a committed-source deployment verification and
the exact separately supplied authorization text bound to the final runtime
and protocol hashes. Freezing this package does not authorize a provider call,
create approval evidence, or permit activation.
