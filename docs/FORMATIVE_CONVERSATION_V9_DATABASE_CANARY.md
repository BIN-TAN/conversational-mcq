# Formative Conversation V9 Database Canary

## Prior Harness Run

The first remote database canary attempt under the superseded harness is
classified as `harness_failed`. Its database lifecycle result is
`database_lifecycle_result_inconclusive`; it is not reusable as database
evidence and is not rerunnable under the old contract.

The process-local scanner misclassified the non-secret boolean marker `true`
as secret material because its environment-variable name ended in `_SECRET`.
The wrapper stopped before producing a provider run, model-auth request, or
approval-evaluation dispatch checkpoint. No historical V8 evidence is changed
by this classification.

## Corrected Contract

The corrected no-provider canary contract hash is
`046beb25c1e3b66c18f54e196dbc73762aae3915ed34207e13063b41b7266423`.
It requires the committed source-only parity preflight, an owner-only one-use
FIFO environment broker, no provider credential, exact-value artifact
scanning, safe failure artifacts, and cleanup after artifact and export
validation. V9 candidate materialization remains blocked until this canary
passes its real 10-, 60-, and 90-second staging database scenarios.
