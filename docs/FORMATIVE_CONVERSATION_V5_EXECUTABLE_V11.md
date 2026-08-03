# Formative Conversation Host V5 Executable V11

## Status

V11 is an inactive, unapproved evaluation-governance successor to V10. It
does not change the formative-conversation model, teaching prompt, output
contract, validators, fixtures, persistence behavior, case order, or base call
graph. `approval.eligible` and `activation.permitted` remain `false`.

V10 remains immutable and `completed_pending_human_review`. Its retrospective
supplemental scan does not satisfy the failed preventive release control.

## V10 Failure Analysis

The V10 process-local runner captured ordinary child stdout and passed the
entire mixed buffer to `JSON.parse`. A non-JSON prefix caused parsing to throw;
the catch path returned no artifact roots. The V10 scanner then checked zero
files and zero ZIP entries but treated zero matches as success because it had
no expected-versus-actual coverage assertion. V10 artifacts had already been
written directly beneath the run root. The wrapper cleared its exact secret
array after that ineffective scan. The later supplemental scan used newly
retrieved values after artifacts were locally inspectable, so it cannot serve
as the original preventive attestation.

The original buffered child stdout was securely deleted. Evidence supports
attribution to the V10 evaluation-launcher child boundary, but not to a more
specific library or log statement. The observed outer parser diagnostic was
`jq: parse error: Invalid numeric literal at line 1, column 7`.

The canonical analysis is
`config/operational-candidates/formative-conversation-host-v5-executable-v11/v10-security-wrapper-failure-analysis.json`.

## Preventive Release Boundary

V11 uses a dedicated owner-only control file. Ordinary stdout and stderr are
never parsed for artifact paths or security state. The child writes exactly one
versioned control record after finalizing the package. Missing, malformed,
duplicate, or conflicting records fail closed.

The release sequence is:

1. Create an owner-only staging root and one-use control channel.
2. Write all artifacts and complete all ZIP files beneath staging.
3. Create the finalized artifact manifest with regular-file and ZIP-entry
   hashes and expected coverage counts.
4. Write the single control record naming the canonical staging root, release
   root, manifest path, manifest hash, provider run ID, and derived evaluation
   ID.
5. Canonicalize paths, reject traversal, symlinks, and special files, and
   compare the manifest inventory with the staging tree.
6. Scan every regular artifact, every uncompressed ZIP entry, the manifest,
   buffered stdout/stderr, and the resulting attestation for exact secret
   values and generic credential patterns.
7. Recheck artifact and manifest hashes and reject late or missing artifacts.
8. Persist a hash-bound, non-secret scan attestation containing counts and
   pass/fail state only.
9. Clear exact in-memory secret values.
10. Atomically rename the staging package into the release root and remove the
    FIFO and control channel.

Failure before promotion produces only a safe owner-only failure record. It
does not expose review links or promote the package.

Coverage fails closed when expected artifacts exist but zero files are scanned,
when any expected/actual count differs, or when a ZIP entry is omitted. It also
fails for exact or generic matches, unavailable exact values, path violations,
manifest mutation, hash drift, late files, or attestation failure.

## Secret Lifecycle

The process-local wrapper reads the authorized environment once from an
owner-only FIFO and immediately unlinks the FIFO. Exact values remain in the
wrapper only until the final package, ZIP entries, buffered child output, and
attestation have all passed scanning. Values are never written to artifacts,
logs, commands, paths, hashes, fingerprints, or attestations. They are cleared
before release. Cleanup also runs on every terminal failure.

## Provenance

Tracked candidate files contain immutable candidate and protocol identities,
not a self-referential source commit. Committed-source verification compares
tracked V11 bytes directly with `HEAD` and writes source commit, optional
deployed commit, timestamp, verified-file hashes, and provenance hash only to
an owner-only run-scoped artifact under `.data`.

Normal materialization is verification-only and fails if a tracked candidate
artifact differs. Initial package generation requires the explicit internal
`--initialize` flag and is only for preparing this uncommitted revision.

## Runtime Identity

The canonical runtime candidate is copied byte-for-byte from frozen V10 and is
recomputed with the repository runtime-fingerprint function. The V11 security
wrapper, release policy, attestation, protocol, and runner identities are
separate evaluation-governance fingerprints. Therefore the runtime candidate
hash remains equal to V10 unless canonical verification detects runtime drift.

## Render Environment Checklist

Do not create or change values solely for V11. A future authorized operator
must securely project the existing canonical Render service environment into
the one-use FIFO and verify these names are present:

- `NODE_ENV`, `APP_ENV`, `APP_BASE_URL`, `DATABASE_URL`, `SESSION_SECRET`
- `LLM_PROVIDER`, `LLM_LIVE_CALLS_ENABLED`, `OPENAI_API_KEY`
- `OPENAI_MODEL_FORMATIVE_CONVERSATION`
- `OPENAI_REASONING_EFFORT_FORMATIVE_CONVERSATION`
- `OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_CONVERSATION`
- `FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED`
- `OPENAI_REQUEST_TIMEOUT_MS`, `OPENAI_MAX_RETRIES`
- `OPERATIONAL_AGENT_MODE`, `OPERATIONAL_APPROVED_CONFIG_HASH`
- `OPERATIONAL_APPROVAL_BUNDLE_PATH`
- `OPERATIONAL_APPROVED_MANIFEST_PATH`
- `OPERATIONAL_APPROVAL_EVIDENCE_PATH`
- `OPERATIONAL_EFFECTIVE_RESULT_VERSION`
- `OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION`
- `OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED`
- `STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED`
- `TOPIC_DIALOGUE_LIVE_CALLS_ENABLED`
- `TOPIC_DIALOGUE_MAX_STUDENT_TURNS`
- `TOPIC_DIALOGUE_RECENT_TURN_WINDOW`
- `TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS`
- `TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS`
- `RESEARCH_PSEUDONYMIZATION_KEY`
- `FORMATIVE_CONVERSATION_V5_V11_LIVE_EVALUATION_ENABLED=true`
- `FORMATIVE_CONVERSATION_V5_V11_DATABASE_CONNECTION_SOURCE`
- `FORMATIVE_CONVERSATION_V5_V11_DATABASE_IDENTITY_MATCHED=true`

For process-local execution, the operator must also provide the documented
`FORMATIVE_CONVERSATION_V5_V11_LOCAL_APPROVAL_BUNDLE_PATH`,
`FORMATIVE_CONVERSATION_V5_V11_LOCAL_APPROVED_MANIFEST_PATH`,
`FORMATIVE_CONVERSATION_V5_V11_LOCAL_APPROVAL_EVIDENCE_PATH`, and
`FORMATIVE_CONVERSATION_V5_V11_LOCAL_DATABASE_URL` projections while
preserving identity equivalence. The owner-only FIFO path is supplied as
`FORMATIVE_CONVERSATION_V11_ENV_FIFO`. The permanently deprecated
`conversational-mcq-staging` service must never be used.

## Future Execution

Canonical V11 identities:

- runtime candidate: `2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c`
- prompt: `30b616483a48c1f01e1a33d911d9dc1c27ed906dae421a99c9b0e2d7eeac945d`
- evaluation protocol: `b4053264bcc2caf72a7e77ff34ae1f90be17fdebb0a0857f09c98a15c293e6b5`
- runner implementation: `8d7673cdcabbce07fe4dbde73403e8d027b06bcffcafaf6233d918b5ebb56ed8`
- source candidate manifest: `333aa84f6ce81833b308da6967bd20925702f0232b240ceda928267110093b47`
- candidate revision manifest: `49e274b5352a54f451e6d7e37b1ee6b12b899e130d12f05107ae2b6b6f75f435`
- fixture manifest: `1d5fc259d18a914be31bc65d2ff75e87fbd4bd249767ed31d20d4853db95690c`
- aggregate fixture: `9b2db2c1d3631e26cd3a3143a2c74277a0c02aa58448408c58541bd8a4a933fd`
- compiled plan: `1455d5bbc679df9e7114cddfb8eb280e01d398869579409a4129291917cedf54`
- environment contract: `7855cde8e27282d809a2cb055bf2e883dc2093c51a04946cca9e4311ed35f9d6`
- security wrapper: `ef4c5d8343c88e3403ef95e82d17ac4d8b27d97a124ab24fcdcafee0ae39f6d9`
- scan-attestation schema: `f1fe56f12ddbadbb95fe592b5bd6076ad8b4961d059ac42111f39efe13df02da`

The final no-provider plan is
`.data/operational-formative-conversation-v5-evaluation-v11/plans/fcv5_plan_20260803105643_6eda8f02.json`
with SHA-256
`af059fc23e0be5bce6c99e699b8a7deabbdc03cd478ce684b16ef6a6c63d4785`.
It reached `ready_immediately_before_dispatch_checkpoint` with zero provider
calls, zero model-auth requests, and no checkpoint.

No prior authorization applies. Required exact future authorization:

```text
I authorize one live execution of formative-conversation-host-v5-executable-v11 for runtime candidate hash 2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c and evaluation protocol hash b4053264bcc2caf72a7e77ff34ae1f90be17fdebb0a0857f09c98a15c293e6b5, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.
```

The only dispatch-capable command uses the process-local security wrapper with
an owner-only one-use FIFO:

```bash
node scripts/operational-formative-conversation-v5-v11-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V11_ENV_FIFO" -- --mode=live --runtime-candidate-hash 2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c --evaluation-protocol-hash b4053264bcc2caf72a7e77ff34ae1f90be17fdebb0a0857f09c98a15c293e6b5 --confirm-live-provider-calls --authorization "I authorize one live execution of formative-conversation-host-v5-executable-v11 for runtime candidate hash 2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c and evaluation protocol hash b4053264bcc2caf72a7e77ff34ae1f90be17fdebb0a0857f09c98a15c293e6b5, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling."
```

No database migration is required. Retained V10 synthetic records must not be
removed until their diagnostic package is archived, V11 no longer depends on
them, and the user explicitly authorizes cleanup.
