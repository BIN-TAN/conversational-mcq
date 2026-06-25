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

## Safety

The probe:

- uses the same exact model snapshot and reasoning effort as the full canary
- stores immutable dispatch provenance
- records usage and cost only when returned by the provider
- never exposes API keys or headers
- never reads real or deidentified student data
- never mutates classroom workflow records
