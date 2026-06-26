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
- `transport`
- `adapter_version`
- `network_dispatch_expected`
- `network_dispatch_started`
- `transport_adapter_entered`
- `request_serialization_completed`
- `fetch_invoked`
- `response_headers_received`
- `response_body_received`
- `network_request_attempt_count`
- `provider_acknowledged_request_count`
- `accounting_complete`
- `model_snapshot`
- `reasoning_effort`
- `execution_path`
- `provenance_type`
- `lifecycle_status`
- `last_completed_stage`
- `failure_stage`
- `typed_failure_reason`
- sanitized OpenAI error class/type/status/code metadata when available
- provider request/response IDs when available
- token counts and estimated cost when usage is verified
- `usage_status` and `cost_status`
- `transport_objective_json`

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
finalized_local_validation_failure
unknown_after_dispatch
cancelled_before_dispatch
```

The runner records `reserved` before local validation. New rows record
`transport_adapter_entered` when the Responses adapter is entered,
`request_serialization_completed` after the request body is built, and
`fetch_invoked` when the SDK reaches the actual HTTP/fetch boundary.
`network_dispatch_started` is now derived from `fetch_invoked` for new rows.
Historical rows may have a legacy `network_dispatch_started` marker that only
means the earlier adapter observer fired; it is not proof that fetch was
invoked.

Execution stages are:

```text
readiness_validated
canary_context_validated
synthetic_input_built
input_contract_validated
redaction_validated
output_schema_compiled
budget_reserved
provider_resolved
transport_adapter_resolved
dispatch_attempt_created
transport_adapter_entered
request_serialization_completed
fetch_invoked
dispatch_started
response_headers_received
response_body_received
response_received
raw_response_persisted
usage_persisted
raw_output_validated
effective_result_persisted
step_finalized
```

Input, redaction, readiness, budget, provider-selection, transport-selection,
and local schema failures are pre-dispatch/local validation failures unless the
transport boundary was entered.

If fetch is invoked and no response/usage is captured, the row is marked
`cost_status=cost_unverified_after_dispatch`, `accounting_complete=false`, and
the run is not safe to resume automatically. The system does not treat this as
verified zero cost.

Provider request accounting is split into:

- `dispatch_attempt_count`: rows reserved in the dispatch ledger
- `network_request_attempt_count`: rows that reached fetch invocation
- `provider_acknowledged_request_count`: rows where OpenAI returned a request
  ID, response ID, or HTTP response metadata

For corrected Phase 8C diagnostics, `provider_request_count` means actual
network request attempts. Historical run rows are not rewritten, so reports show
the preserved `run_provider_request_count` and the derived
`derived_provider_request_count` side by side when they differ.

## Successful Response Normalization

The OpenAI Responses SDK result is normalized before raw schema, semantic,
safety, canonicalization, or fallback handling. The normalizer preserves request
ID, response ID, response status, incomplete details, sanitized response
metadata, raw output evidence, usage source paths, and a raw response hash.

Usage is verified only when the response contains internally consistent token
counts. The supported Responses API paths include:

- `usage.input_tokens`
- `usage.input_tokens_details.cached_tokens`
- `usage.output_tokens`
- `usage.output_tokens_details.reasoning_tokens`
- `usage.total_tokens`

The system does not guess usage, invent zero values, or treat missing usage as
verified zero cost. Cost is calculated only after verified usage resolves
against the versioned pricing registry.

## Outcome Separation

Phase 8C separates three outcomes:

- `transport_outcome`: `live_provider_success`, `live_provider_error`,
  `no_dispatch`, or `unknown`
- `raw_output_outcome`: `valid`, `schema_invalid`, `semantic_invalid`,
  `safety_invalid`, `refused`, `incomplete`, `missing`, or `unknown`
- `effective_system_outcome`: `provider_output_used`,
  `canonicalized_provider_output_used`, `deterministic_fallback_used`,
  `blocked`, or `unusable`

A live provider response can therefore be transport-successful while the
effective system safely uses a deterministic fallback. Fallback provenance does
not erase provider request IDs, response IDs, usage, cost, or raw-output
validation evidence.

Fallback reasons are stable audit values such as
`provider_output_schema_invalid`, `provider_output_semantic_invalid`,
`provider_output_safety_invalid`, `provider_output_refused`,
`provider_output_incomplete`, `provider_output_missing`,
`provider_usage_unverified`, `operational_canonicalization_failed`, and
`unexpected_post_response_error`.

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
- `transport_execution`
- `raw_output_validation`
- `effective_execution`
- `accounting`
- `integrity`

Readiness requires verified provider accounting, a passed transport objective,
usable effective results, and completed review. Completed legacy rows without
dispatch attempts are preserved but are not treated as verified provider calls.

Read-only response commands are available for historical analysis:

```bash
npm run operational:live-canary:response-audit -- --run <run_public_id>
npm run operational:live-canary:response-replay -- --run <run_public_id>
```

They do not call the provider or mutate canary records. Replay uses the
persisted sanitized provider-response snapshot when available and reports
whether the complete SDK response object was stored.
