# E2A.49 Render Staging Deployment Protocol

## Scope

E2A.49 freezes a production-like Render staging validation protocol. It does
not deploy the application, contact Render, query a staging database, call an
LLM provider, approve a candidate, activate a candidate, or establish
classroom effectiveness or student usability.

The protocol distinguishes:

- `repository_verified`: source, configuration, deterministic smoke, privacy,
  failure-recovery, and artifact checks that can be completed locally.
- `operator_evidence_required`: deployed startup, database connectivity,
  migration completion, health, API, log, backup, restore, and synthetic
  browser evidence that cannot be claimed without a separately authorized
  staging operation.

## Frozen Contracts

The protocol binds these versioned contracts:

- `render-staging-deployment-contract-v1`
- `build-validation-contract-v1` using `staging-build-validation-v1`
- `database-validation-contract-v1` using
  `staging-database-validation-v1`
- `health-validation-contract-v1` using `staging-health-validation-v1`
- `cba-staging-smoke-contract-v1` using
  `staging-cba-smoke-contract-v1`
- `rollback-validation-contract-v1` using
  `staging-rollback-validation-v1`
- `operator-checklist-contract-v1` using
  `render-staging-operator-checklist-v1`
- `e2a49-artifact-contract-v1`
- `e2a49-budget-contract-v1`
- `e2a49-composite-runtime-identity-v1`

The protocol also binds the approved candidate configuration hash, protected
runtime source hashes, the E2A.48/E2A.48a deployment-readiness sources, the
staging source inventory, and the E2A.49 implementation source set.

## Staging Boundary

The Blueprint must use:

- a staging-named web service;
- a staging-named managed PostgreSQL database;
- `APP_ENV=staging`;
- Render-managed secret inputs or database attachment;
- synthetic accounts only;
- no production database attachment;
- no production secret reuse;
- no real student records.

The local freeze inspects variable names and secret-source declarations only.
It does not read secret values or `.env` files. An operator must verify the
deployed resources remain separate without printing or copying values into
protocol artifacts.

## Build and Startup

The frozen configuration expects:

- Node.js major 22;
- npm lockfile version 3;
- `npm ci --include=dev && npm run prisma:generate && npm run build`;
- `npm run start`;
- a 12 GB Node build heap for the bounded local verification;
- one Next.js build worker for the bounded local verification;
- `.next/BUILD_ID`;
- `build/application-build-info.json`.

The local build proves source buildability in the verification environment.
The operator must still confirm Render build capacity, npm major, runtime
memory, port binding, process stability, and health after deployment.

## Database Validation

Repository checks validate the PostgreSQL Prisma datasource, versioned
migrations, staging database attachment, `prisma migrate deploy` pre-deploy
command, and schema-readiness health implementation.

The protocol does not connect to PostgreSQL or execute a migration. The
operator must verify:

1. the deployed service uses the staging database attachment;
2. migration deployment completed;
3. `/api/health` reports the database reachable and schema ready;
4. a recent backup exists;
5. an isolated restore drill and schema-compatibility review are recorded.

Never use `prisma migrate dev`, `prisma migrate reset`, or `prisma db push`
against staging or production.

## Deterministic CBA Smoke

The no-live smoke uses two in-memory synthetic identities and covers:

1. assessment activity creation;
2. student activity start;
3. response submission;
4. evidence extraction;
5. profile update;
6. formative interaction;
7. revision;
8. transfer or closure;
9. teacher evidence view;
10. audit-record verification.

It verifies synthetic student/session isolation, profile persistence,
intervention history, audit history, and export generation without storing
student response content, reasoning, hidden prompts, or provider payloads.
This is a contract regression, not a deployed browser or database smoke.

## Failure Recovery

The deterministic suite covers:

- missing environment variable;
- database unavailable;
- provider unavailable;
- application restart;
- interrupted session;
- duplicate request;
- failed export;
- logging failure.

Every case must fail closed or recover without corrupting synthetic state.

## Operator Checklist

### Before Deployment

- Confirm staging resources and configuration.
- Confirm staging-only secrets.
- Confirm the staging database and backup/restore evidence.
- Confirm build and runtime capacity.
- Select synthetic accounts and synthetic content.

### During Deployment

- Monitor build and migration output.
- Monitor startup.
- Check `/api/health`.
- Stop if logs contain secrets or private student content.

### After Deployment

- Run the synthetic CBA staging smoke.
- Review production-safe logs.
- Verify the teacher evidence view and audit record.
- Verify a readable export.
- Record operator evidence without secret values or student private content.

Follow
[`RENDER_STAGING_DEPLOYMENT_RUNBOOK.md`](./RENDER_STAGING_DEPLOYMENT_RUNBOOK.md)
for the deployment and rollback procedure. E2A.49 does not authorize any of
those operations.

## Budget

The frozen ceiling for a separately authorized future staging validation is:

- 29 logical calls maximum;
- 87 adapter attempts maximum;
- provider concurrency 1;
- two transport retries per logical call maximum;
- 900,000 input tokens maximum;
- 70,000 output tokens maximum;
- 970,000 total tokens maximum;
- USD 25 maximum when pricing metadata exists.

This protocol-freeze execution has a zero provider-call, network-request,
database-query, Render-API-call, and deployment budget.

## Local Verification

```bash
npm run typecheck
npm run lint
npm run prisma:generate
npx prisma validate
NODE_OPTIONS=--max-old-space-size=12288 \
NEXT_PRIVATE_BUILD_WORKER=1 \
npm run build
npm run eval:formative:e2a49:smoke
npm run eval:formative:e2a49:run
npm run eval:formative:e2a49:report
```

Focused suites are available under
`eval:formative:e2a49:<area>-smoke`, including configuration, build,
database, health, CBA, data integrity, security, failure recovery, rollback,
operator checklist, historical integrity, protected components, budget,
artifact, and provider-call guard.

Generated artifacts are written under:

```text
.data/e2a49-render-staging-deployment-protocol/<run-id>/
```

The files and run directory are made read-only after validation. They contain
no secret values, real student data, hidden prompts, chain-of-thought, or raw
provider payloads.
