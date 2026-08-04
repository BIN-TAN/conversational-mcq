# V15 Pilot Data-Governance Hardening

## Scope

V15 is a minimal privacy revision for the current classroom pilot: one teacher,
one course, and one research environment. It does not change formative
pedagogy, profile semantics, assessment truth handling, database schema, or the
V14 evaluation evidence.

## Provider Input Boundaries

- Student profiling omits operational student account identifiers while
  retaining administered-item responses, reasoning, confidence, process
  evidence, and assessment context.
- Formative conversation requests are checked immediately before every
  provider generation, including semantic regeneration, and fail closed if an
  identity-shaped field is present.
- Formative teacher guidance is limited to normalized instructional content:
  learning objectives, conceptual boundaries, misconception support, and
  interpretation cautions. Explicitly private, confidential, teacher-only, or
  pejorative student commentary is excluded from provider context.
- Stored teacher content and internal audit records are unchanged.

## Export Artifact Privacy

- Analysis-ready selected-student research bundles use the stable research
  pseudonym in both source identity and artifact filename.
- Teacher selected-student CSV and ZIP filenames use a generated export run
  identifier. Their existing CSV content and teacher-authorized scope are not
  changed by the filename protection.
- Assessment and session public identifiers remain available in their
  corresponding artifact names because they are not account login identifiers.

## Future Production Requirements

The following are intentionally deferred and must be addressed before a
multi-teacher or multi-course production deployment:

- per-teacher ownership enforcement for export job listing and download;
- explicit cross-course and tenant authorization boundaries;
- a governed research-administrator role and approval workflow;
- tenant-aware retention, deletion, and research-eligibility controls.

These controls are outside the current single-teacher, single-course pilot and
are not simulated by V15.

## Governance State

V15 is inactive. No approval evidence, dispatch checkpoint, live provider run,
or activation artifact is created by the no-provider materialization. A future
live evaluation requires committed-source freezing and separate explicit
authorization.

## Committed-Source Reproducibility

V15 materialization reads one V15-owned immutable reference containing only the
V14 base runtime, prompt, runner, protocol, fixture, approval, rollback, and
budget identities required to derive V15. Historical V14 evidence is referenced
by hash and is not copied. V15 does not read the V14 candidate directory,
launcher files, Prisma tests, or unstaged runtime changes, so a clean checkout
can reproduce the V15 package without staging V14 working-tree artifacts.

## Verification Ownership

The transition evidence-closure regression is a current acceptance-boundary
check, so V15 owns its deterministic smoke test. The package script resolves to
that committed V15 test and does not rely on an omitted V14 test file.

The following checks are historical evidence dependencies rather than V15
readiness gates:

- the V10 profile-semantics replay of the immutable V8 case-8 transcript;
- the opening-contract replay of the immutable V12 case-2 transcript;
- the V14 candidate-package provenance replay.

V15 records only their immutable SHA-256 identities. It does not require their
original `.data` paths, the V14 candidate directory, or another working-tree
artifact. Current V15 readiness uses V15-owned dependency-closure, privacy,
transition, export, provenance, and security checks.

## Executable Freeze Boundary

V15 now owns a dispatch-capable launcher, process-local security wrapper,
environment-parity contract, compiled eight-case fixture plan, and exactly-once
dispatch checkpoint contract. Plan and live modes use the same `node --import
tsx` chain, and bare `node` invocation fails before the evaluation CLI loads.

The package is structurally `live_execution_prepared=true`, but this is not an
authorization or approval. Before future execution, the prepared files must be
committed, the canonical deployment must match that commit, and a fresh
committed-source verification must reproduce every frozen identity. The exact
future authorization text and command are recorded in the V15-owned
`live-execution-authorization.json` and generated `LIVE_EXECUTION.md` files.

No provider call, model-auth request, or real V15 dispatch checkpoint is made
while preparing or verifying this package. Approval remains ineligible and
activation remains forbidden.
