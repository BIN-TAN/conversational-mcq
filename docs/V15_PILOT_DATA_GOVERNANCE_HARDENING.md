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
