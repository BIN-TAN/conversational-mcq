# Guarded Live Synthetic Canary

Phase 8C adds CLI-only infrastructure for a small guarded-live operational canary.

The canary is synthetic-only. It must not use real student data, deidentified student data, summative outcome data, or teacher classroom records. A successful canary is only readiness for private staging deployment; it is not classroom validity.

## Default State

Normal local defaults remain disabled:

```text
OPERATIONAL_AGENT_MODE=disabled
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
OPERATIONAL_LIVE_CANARY_ENABLED=false
```

The paid command refuses to run unless the operator explicitly enables canary settings in local server-side environment files and supplies `--confirm-paid-api` plus either `--new-run` or `--resume <run_public_id>`.

## Approved Configuration

The canary uses the Phase 8A approved operational configuration:

```text
model_snapshot=gpt-5.4-mini-2026-03-17
reasoning_effort=low
approved_manifest_hash=3040d13fbe5dae09cc8734dd3c638b223c5d40234b3e79132367bd173853548f
active_approved_config_hash=58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2
effective_result_version=effective-system-eval-v2
effective_validator_version=effective-validator-v1
```

The canary manifest is frozen at:

```text
tests/fixtures/operational-live-canary/manifest.json
```

Manifest hash:

```text
6e59f0014e805eedfdb97c8fee5ea6c3053c7a913945b13afafb1b602d14e2d6
```

## Commands

No-provider checks:

```bash
npm run operational:live-canary:preflight
npm run operational:live-canary:dry-run
npm run operational:live-canary-db-resolution-smoke
npm run operational:live-canary-guard-parity-smoke
npm run operational:live-canary-block-reason-smoke
```

Paid command, for a future manual run only:

```bash
npm run operational:live-canary -- --confirm-paid-api --new-run
npm run operational:live-canary -- --confirm-paid-api --resume <run_public_id>
```

Read-only follow-up commands:

```bash
npm run operational:live-canary:inspect -- --run <run_public_id>
npm run operational:live-canary:report -- --run <run_public_id>
npm run operational:live-canary:review-export -- --run <run_public_id>
```

The implementation and smoke tests do not execute the paid canary. Dry run
applies pending migrations and seeds the synthetic fixture without dropping
historical canary runs. Failed paid attempts remain audit history and should
not be resumed if all planned steps are already terminal failures.

## Isolated Database

The canary uses a separate database name ending in:

```text
_live_canary_e2e
```

The default local name is:

```text
conversational_mcq_live_canary_e2e
```

The canary DB tools refuse to operate on `conversational_mcq` or `conversational_mcq_e2e`.
Database URL resolution is canonical and idempotent: resolving the base
`conversational_mcq` URL produces exactly one `_live_canary_e2e` suffix, and
resolving an already isolated URL returns the same URL. Repeated malformed
suffixes such as `_live_canary_live_canary_e2e` fail closed. The parent
`DATABASE_URL` remains the base URL; Prisma clients and app/worker child
processes receive the isolated canary URL explicitly.

Preflight and executor readiness share one typed readiness source. Blocked
canary steps store a typed `blocked_reason` and sanitized readiness snapshot.
Inspect and report recover legacy generic blocked reasons from immutable
effective-result metadata when older failed runs predate the dedicated columns.

## Scope

The manifest defines:

- 1 synthetic teacher
- 5 synthetic students
- 1 automatic assessment
- 2 ordered concept units
- 4 items per concept unit
- 2 teacher-side item verification scenarios
- 30 planned logical operational invocations
- coverage for all five active agents

No classroom live-call setting is changed by this infrastructure.
