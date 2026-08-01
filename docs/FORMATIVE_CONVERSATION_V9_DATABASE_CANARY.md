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
validation. V9 candidate materialization was blocked until this canary passed
its real 10-, 60-, and 90-second staging database scenarios.

## Corrected Canary Result

The single authorized corrected canary passed under isolated namespace
`fcv5v9_db_canary_20260801174128495_b588b3f0`. Its actual waits were 10,002,
60,001, and 90,001 milliseconds. All post-wait context reads succeeded; the
sound, largely-improved, and teacher-assistance transitions persisted with
provenance; replay created no duplicate turns, calls, events, evidence
references, or transitions; and teacher/export parity passed.

The canary recorded 15 transaction-only durations between 1,639 and 4,517
milliseconds, with no transaction open during any wait and no partial commit.
The research archive contained 16 expected entries. Exact-value scanning
checked three process-local secrets across two regular artifacts and all 16
uncompressed ZIP entries, finding zero exact or generic matches. Cleanup left
zero synthetic database records. Provider calls, model-auth requests, and
approval-evaluation dispatch checkpoints were all zero.

## V9 Inactive Package

The passed canary unblocked the no-provider V9 package. V9 preserves all V8
evidence as immutable and fingerprints the corrected prompt guidance,
profile-field semantics, transition validator, persistence contract, database
connection ownership and recovery, persistence diagnostics, and exact-secret
scanner. The 18 model assignments and operational runtime policy remain
unchanged from V8.

- Runtime candidate: `5c0347287fa10cb67b9e9677dff0fc679f99af78ea3b08fe086cf693af146198`
- Prompt: `formative-conversation-host-v5.3`
- Prompt hash: `30b616483a48c1f01e1a33d911d9dc1c27ed906dae421a99c9b0e2d7eeac945d`
- Protocol: `fcc7f5c3b7ffcbd10731fd27b626e431f1a012083702ea40ffbe388a1474aa13`
- Runner: `43a359e27046f882d462a040eeef303c872f1142f1ecc5d49d4f92623d975455`
- Fixture manifest: `764830d90b8cadc1a9f8ceb2862ba125b25e317700b0974bda8fa7de771ee708`
- Aggregate fixtures: `0f36e10c34bd3c59fea33f2c9e46e032c954106a7ab9fba08b625e771d34c345`
- Compiled plan: `6c14c3210bf975a58a8723faf59ee2579b7fa46df79604f198561e72d25f2131`
- Environment contract: `68b552ddf71fd35a23ddd05537f555091273d65aaca8ed39300a2ea37096cffe`

V9 remains inactive. `approval.eligible=false` and
`activation.permitted=false`. The corrected canary authorization does not
authorize a V9 provider execution, approval, activation, or deployment.
