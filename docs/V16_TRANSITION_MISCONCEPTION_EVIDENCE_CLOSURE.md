# V16 Transition Misconception Evidence Closure

V16 is an inactive successor to V15. It changes only the
acceptance boundary for updates to canonical `misconception_indicators`.
V15 candidate files and completed evidence remain immutable.

## Correction

When a terminal recommendation changes current misconception evidence, each
prior indicator must be represented as atomic claims. Every atomic claim must
be marked as either:

- resolved by cited student conversation evidence; or
- retained as a current misconception in the updated profile.

The validator rejects a transition when a retained claim is absent, a resolved
claim lacks student evidence, a resolved claim remains current, or a retained
entry is actually a limitation, uncertainty, or resolved history. This is a
provenance and semantic-closure check, not a mastery threshold.

## V15 Replay

The offline replay covers Cases 5 and 6 from provider run
`fcv5v15_provider_20260804202844_8d9e3943`. It preserves the
`largely_improved_understanding` outcome while retaining the unresolved current
claim that SEM reveals an exact true score. Historical transcript artifacts
are referenced by SHA-256 and are not required as local `.data` dependencies.

## Governance

- Teaching prompt: unchanged.
- Pedagogy and profile meanings: unchanged.
- Database schema, exports, privacy controls, and execution boundary: unchanged.
- Freeze-time provider calls, model-auth requests, and dispatch checkpoints:
  zero.
- `approval.eligible`: false.
- `activation.permitted`: false.
- Live execution package: prepared but inactive and not authorized.

Because runtime acceptance behavior changes, V16 has a new runtime candidate
hash. A separately frozen and authorized live evaluation is required before
V16 could become approval-eligible.
