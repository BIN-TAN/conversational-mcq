# Operational Live Canary Transport Probe

The full 30-step guarded-live canary requires a successful one-call transport
probe first.

## Purpose

The probe verifies the real provider transport path with exactly one synthetic
Response Collection invocation before the full canary can start.

It is still synthetic-only and isolated from classroom workflows.

## Commands

Preflight makes no provider call:

```bash
npm run operational:live-canary:transport-probe:preflight
```

Dry run makes no provider call, but validates the exact synthetic input,
provider descriptor, output schema, redaction check, budget/readiness state,
and transport adapter that the paid probe would use:

```bash
npm run operational:live-canary:transport-probe:dry-run
```

Read-only diagnosis of an existing probe run:

```bash
npm run operational:live-canary:transport-probe:diagnose -- --run <run_public_id>
```

Paid execution is manual only:

```bash
npm run operational:live-canary:transport-probe -- --confirm-paid-api
```

Do not run the paid probe during tests, builds, migrations, or implementation.

## Gate

The full command:

```bash
npm run operational:live-canary -- --confirm-paid-api --new-run
```

refuses to start unless a successful one-call probe exists in the isolated
canary database.

The successful probe is represented as a one-step completed canary run with
`failure_reason=transport_probe_success`. That value is a gate marker only; it
does not authorize classroom live calls.

A successful probe must also prove the transport objective: exactly one live
dispatch, OpenAI Responses transport selected, dispatch boundary entered,
provider request/response IDs persisted, usage verified, cost persisted, and a
usable effective result. Deterministic fallback, mock provider output, missing
request IDs, or unverified usage never satisfy the full-canary gate.

## Failure Diagnosis

Transport probe attempts persist a stage trace and typed failure reason. Local
failures before the OpenAI Responses boundary are classified as
`pre_dispatch_failed` or `finalized_local_validation_failure`; they are not
provider failures. `finalized_provider_failure` requires evidence that the
transport boundary was entered.

Historical probe rows that did not persist the original exception are reported
as `historical_exact_local_error_unrecoverable`. The diagnostic command must not
invent a retrospective cause.

## Safety

The probe:

- uses the same exact model snapshot and reasoning effort as the full canary
- stores immutable dispatch provenance
- records usage and cost only when returned by the provider
- never exposes API keys or headers
- never reads real or deidentified student data
- never mutates classroom workflow records
