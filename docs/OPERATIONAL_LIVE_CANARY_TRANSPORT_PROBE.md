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

Transport environment inspection also makes no provider call:

```bash
npm run operational:live-canary:transport-environment
```

It reports only sanitized booleans and categories, including whether the
resolved base URL host is `api.openai.com`, whether a test-only transport hook
is active, whether Node fetch is available, the installed OpenAI SDK version,
and whether an API key is configured. It never prints the API key, headers,
database URL, or session secret.

Dry run makes no provider call, but validates the exact synthetic input,
provider descriptor, output schema, redaction check, budget/readiness state,
transport environment, local request serialization, error-normalization
readiness, and transport adapter that the paid probe would use:

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
dispatch attempt, OpenAI Responses transport selected, actual fetch invocation,
response headers/body received, provider request/response IDs persisted, usage
verified, cost persisted, and a usable effective result. Deterministic
fallback, mock provider output, missing request IDs, unverified usage, or
`cost_unverified_after_dispatch` never satisfy the full-canary gate.

## Failure Diagnosis

Transport probe attempts persist a stage trace and typed failure reason. Local
failures before fetch invocation are classified as `pre_dispatch_failed` or
`finalized_local_validation_failure`; they are not provider failures.
`finalized_provider_failure` requires evidence that the request reached the
transport boundary or received provider HTTP metadata.

Historical probe rows that did not persist the original exception are reported
as `historical_exact_local_error_unrecoverable`. The diagnostic command must not
invent a retrospective cause.

The transport error normalizer uses stable categories such as
`openai_authentication_failed`, `openai_permission_denied`,
`openai_model_not_found`, `openai_rate_limited`, `openai_quota_exceeded`,
`openai_bad_request`, `openai_server_error`, `openai_request_timeout`,
`openai_connection_failed`, `openai_dns_failed`, `openai_tls_failed`,
`openai_response_parse_failed`, `test_transport_hook_active`,
`nonapproved_base_url`, and `unknown_transport_error`.

## Safety

The probe:

- uses the same exact model snapshot and reasoning effort as the full canary
- stores immutable dispatch provenance
- records usage and cost only when returned by the provider
- never exposes API keys or headers
- never reads real or deidentified student data
- never mutates classroom workflow records
