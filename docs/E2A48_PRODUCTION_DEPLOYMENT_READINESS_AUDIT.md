# E2A.48 Production Deployment Readiness Audit

E2A.48 is a no-live repository audit. It checks whether the checked-in
deployment configuration has the controls needed for a production-like Render
deployment. It does not deploy the application, inspect Render, query a
production database, authorize a classroom pilot, approve a model candidate,
or activate a model candidate.

Run the deterministic audit:

```bash
npm run eval:formative:e2a48:smoke
npm run eval:formative:e2a48:run
npm run eval:formative:e2a48:report
```

Artifacts are written under:

```text
.data/e2a48-production-deployment-readiness-audit/<run-id>/
```

The artifact set contains:

- deployment environment, database, build, runtime, security, observability,
  and Render contracts;
- source-file and migration-set fingerprints;
- E2A.44 student-data and E2A.45 teacher/research boundary bindings;
- protected evaluator, tutor, candidate, and predecessor hashes;
- twelve deterministic failure-detection regressions;
- an explicit list of deployment blockers and external evidence still needed;
- zero-provider and zero-network budget and guard evidence.

## Interpretation

`protocol_verification_passed=true` means the audit protocol, regressions,
protected-source checks, and artifacts passed. It does not mean a production
deployment is authorized.

`deployment_readiness_status` is the deployment decision:

- `blocked`: a repository-level issue must be remediated before production;
- `operator_evidence_required`: repository checks passed but external evidence
  is still required;
- `repository_audit_ready`: repository checks passed and no known external
  evidence item remains in the audit input.

E2A.48 intentionally does not read or serialize environment values. It reports
variable names and safe source references only.

## External Evidence

The no-network audit cannot establish:

- whether Render contains the correct secret values;
- whether the production database is reachable or fully migrated;
- whether database backup and restore have been tested;
- whether the selected Render instance has sufficient memory and capacity;
- whether generated exports are moved to approved durable storage;
- whether post-deploy health and browser checks pass from an external client.

These remain explicit operator checks after repository blockers are resolved.

## Security Limitation

The audit treats `console.error(error)` and equivalent raw unknown-error
logging in production request paths as unsafe. The detector records source
references only, never error text. A green E2A.48 artifact protocol may
therefore carry a blocked deployment verdict until those runtime log sites are
replaced with sanitized error codes and types in a separate runtime-hardening
change.

E2A.48a performs that separate hardening without changing the historical
E2A.48 artifact. Current production catches use
`production-safe-log-v1`, whose output is restricted to:

- timestamp;
- safe error category;
- caller-owned safe error code;
- validated request or session identifiers when supplied.

The logger does not serialize error messages, stacks, causes, student response
data, prompts, credentials, or provider payloads. Run the no-network regression
with:

```bash
npm run eval:formative:e2a48a:smoke
```

The same regression verifies that the checked-in Render runbook contains
application rollback, database backup/restore recovery, compatibility checks,
and the observed Node build-capacity requirements.

## Database Limitation

Historical migrations containing destructive SQL are not assumed safe merely
because they are checked in. E2A.48 records file-and-line references and
requires backup-aware review. It does not run migrations, seed data, reset a
database, or contact production.

## Existing Readiness Checks

E2A.48 complements rather than replaces:

```bash
npm run student:render-staging-readiness-smoke
npm run student:production-deployment-readiness-smoke
npm run student:production-schema-readiness-smoke
```

The schema readiness smoke contacts the configured database. Run it only
against an explicitly selected environment and never as part of the E2A.48
no-network protocol.
