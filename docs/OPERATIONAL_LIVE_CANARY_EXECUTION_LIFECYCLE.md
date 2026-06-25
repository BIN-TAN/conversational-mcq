# Operational Live Canary Execution Lifecycle

Phase 8C live-canary execution now records provider provenance in an immutable
dispatch ledger before a provider request can be counted as verified.

## Dispatch Attempts

Each provider attempt is represented by
`operational_live_canary_dispatch_attempts`.

Important fields:

- `dispatch_public_id`
- `run_db_id`, `step_db_id`, `agent_call_db_id`
- `logical_invocation_key`
- `attempt_index`
- `dispatch_key`
- `client_dispatch_id`
- `provider`
- `model_snapshot`
- `reasoning_effort`
- `execution_path`
- `provenance_type`
- `lifecycle_status`
- provider request/response IDs when available
- token counts and estimated cost when usage is verified

The ledger is append-only for audit purposes. Historical runs created before
this table are preserved and classified as `unknown_legacy_provenance` unless a
verified dispatch row exists.

## Lifecycle Status

Allowed lifecycle statuses are:

```text
reserved
pre_dispatch_failed
dispatch_started
response_received
usage_verified
finalized_success
finalized_provider_failure
unknown_after_dispatch
cancelled_before_dispatch
```

The runner records `reserved` before dispatch and `dispatch_started` before the
provider boundary. Results are finalized only after response, usage, and cost
data have been persisted or the failure is known.

If a request may have crossed the provider boundary but usage cannot be
verified, the step is marked for reconciliation instead of being retried.

## Provenance Classification

Forensics classifies each step as:

```text
live_provider_verified
live_provider_failed_verified
dispatch_possible_but_unverified
deterministic_fallback
mock_provider
blocked_pre_dispatch
reused_verified_result
no_dispatch
unknown_legacy_provenance
```

`unknown_legacy_provenance` is not counted as a paid provider request and cannot
support readiness.

## Leases and Interruption

Runs and steps store:

- `runner_instance_id`
- `claimed_at`
- `heartbeat_at`
- `lease_expires_at`
- `interruption_detected_at`
- `recovery_status`

The CLI emits sanitized start, finish, and interrupt progress events when
`--json-progress` is used. Signal handling does not print secrets.

## Report Layers

Reports separate:

- `provider_execution`
- `effective_execution`
- `integrity`

Readiness requires verified provider accounting, usable effective results, and
completed review. Completed legacy rows without dispatch attempts are preserved
but are not treated as verified provider calls.
