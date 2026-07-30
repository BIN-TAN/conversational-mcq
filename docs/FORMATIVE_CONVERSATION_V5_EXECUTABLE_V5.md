# Formative Conversation Host V5 Executable Evaluation V5

This revision repairs the failed v4 pre-dispatch path. It does not approve,
activate, or execute the inactive formative-conversation candidate.

## Preserved identities

- Active approved runtime: the existing 17-role derived approval bundle.
- Rollback runtime: the existing approved GPT-5.4-mini baseline.
- Inactive candidate runtime: the 18-role formative-conversation candidate.
- Failed v4 source and pre-dispatch evidence: immutable and non-rerunnable.

The active approved runtime hash and inactive candidate runtime hash are
different identities. Both must validate independently.

## Root causes

The v4 plan compiled package and export readiness without loading the exact
operational application configuration used by live mode. Consequently, it did
not catch a missing `OPERATIONAL_APPROVED_CONFIG_HASH` or validate the active
bundle, manifest, evidence, dedicated role configuration, or live-call policy.

The v4 sandbox launch used the `tsx` CLI. `tsx` creates an IPC socket before it
loads the target module, and the sandbox rejected that socket with `EPERM`.
Revision v5 uses one launcher for module probing, environment preflight, plan,
and live modes:

```text
node --import tsx prisma/operational-formative-conversation-v5-v5-evaluate.ts
```

The launcher is invoked through:

```text
npm run operational:formative-conversation-v5-v5-evaluate --
```

For an operator workstation, the authenticated Render values may be passed to
the launcher through
`scripts/operational-formative-conversation-v5-v5-process-local-runner.mjs`.
That wrapper accepts a mode-`0600`, owner-only FIFO, reads it exactly once,
unlinks it immediately, and releases child output only after scanning stdout,
stderr, and the generated plan for every exact secret value.

## Process-local Render snapshot

The operator must load the existing Render values directly into the launcher
process. Values must not be printed, passed as command-line arguments, written
to an env file, or persisted in an artifact.

Explicit Render values:

- `NODE_ENV`
- `APP_ENV`
- `APP_BASE_URL`
- `DATABASE_URL`
- `SESSION_SECRET`
- `LLM_PROVIDER`
- `LLM_LIVE_CALLS_ENABLED`
- `OPENAI_API_KEY`
- `OPENAI_MODEL_FORMATIVE_CONVERSATION`
- `OPENAI_REASONING_EFFORT_FORMATIVE_CONVERSATION`
- `OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_CONVERSATION`
- `FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED`
- `OPENAI_REQUEST_TIMEOUT_MS`
- `OPENAI_MAX_RETRIES`
- `OPERATIONAL_AGENT_MODE`
- `OPERATIONAL_APPROVED_CONFIG_HASH`
- `OPERATIONAL_APPROVAL_BUNDLE_PATH`
- `OPERATIONAL_APPROVED_MANIFEST_PATH`
- `OPERATIONAL_APPROVAL_EVIDENCE_PATH`
- `OPERATIONAL_EFFECTIVE_RESULT_VERSION`
- `OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION`
- `STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED`
- `TOPIC_DIALOGUE_LIVE_CALLS_ENABLED`
- `TOPIC_DIALOGUE_MAX_STUDENT_TURNS`
- `TOPIC_DIALOGUE_RECENT_TURN_WINDOW`
- `TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS`
- `TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS`
- `RESEARCH_PSEUDONYMIZATION_KEY`

Process-local evaluation values:

- `FORMATIVE_CONVERSATION_V5_V5_LIVE_EVALUATION_ENABLED=true`
  - source: the future explicit live-evaluation authorization boundary.

Validated application default:

- `OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED=true`
  - source: the application schema default currently used because Render does
    not set this variable explicitly.

The launcher must preserve absence for deprecated or optional aliases. In
particular, it must not inject
`OPERATIONAL_AGENT_INTEGRATION_ENABLED=false`; explicitly setting that legacy
alias changes guarded-mode conflict detection and is not equivalent to the
Render process.

When the Render approval artifact paths begin with `/app`, the launcher may
project only those three paths to verified local copies. It retains the
original Render paths as non-secret source metadata and requires every local
copy to pass the active bundle's hash checks.

Render's internal PostgreSQL hostname is reachable only from Render's private
network. A local process may supply the existing Render external database URL
through `FORMATIVE_CONVERSATION_V5_V5_LOCAL_DATABASE_URL`. Before replacing
the child process's `DATABASE_URL`, the launcher requires:

- PostgreSQL protocols on both URLs;
- identical database name, username, password, and port;
- a different external hostname whose prefix is the exact internal hostname.

The child records only
`database_connection.source=render_external_process_local` and
`identity_matched=true`. Neither URL nor any credential is recorded.

## Pre-dispatch boundary

The exact launcher supports these no-provider modes:

```bash
npm run operational:formative-conversation-v5-v5-evaluate -- --mode=module-load-probe
npm run operational:formative-conversation-v5-v5-evaluate -- --mode=environment-preflight
npm run operational:formative-conversation-v5-v5-evaluate -- --mode=preflight
npm run operational:formative-conversation-v5-v5-evaluate -- --mode=plan
```

`environment-preflight` performs no database or provider request. `preflight`
and `plan` perform one database-backed research-export readiness check. None of
these modes performs a provider request, model-auth request, dispatch
checkpoint, provider run, or derived evaluation.

The dispatch checkpoint callback is available only to live mode and is invoked
exactly once, immediately before the first generation request.

## Secure handling

Secret values are limited to the child process:

- `DATABASE_URL`
- `SESSION_SECRET`
- `OPENAI_API_KEY` or `OPENAI_API_KEY_FILE`
- `RESEARCH_PSEUDONYMIZATION_KEY`

The plan records only presence booleans. It records neither secret values nor
secret fingerprints. The process environment and browser clipboard must be
cleared after the child exits, and the generated plan must be scanned for every
exact secret value before it is retained.

## Governance

The candidate remains inactive:

```text
approval.eligible=false
activation.permitted=false
```

The exact protocol hash, runner hash, fixture manifest hash, compiled-plan
hash, authorization text, and live command are emitted by the materialized v5
package. A fresh exact authorization is required. No v4 authorization applies
to v5.

## Frozen v5 identity

- Runtime candidate hash:
  `a408b08c39aa614d967552e1fd321fabf0b83c96a3d83c82a7bd381fa8e899b3`
- Evaluation protocol hash:
  `7b42d2b1ffd3c5cfa1bef52cf60759b6eea7e891327077144d81e7f09788aa4c`
- Runner implementation hash:
  `ae815d02b3e466067431191c9cb26b0a6c128f875c56297f92e3063b427c7da6`
- Candidate revision manifest hash:
  `0a4f0c9900c0baa5687c7aa72b18b97da1aa6427ed016af8313d87132067f918`
- Fixture manifest hash:
  `57c523914804a8c32cc37b0813e5780e214c1ee703d0ce01a793ba52750f4e8a`
- Aggregate fixture hash:
  `e6450e0b61afb81ad98cfbcde782b9d148d9a56c3af550e7c4b30b73dde516fc`
- Compiled execution plan hash:
  `20ebc33c45f98e0ce64aa6bd0fdfb486fac124a2a1931632d15b085e4cbe4f1a`
- Live-environment contract hash:
  `5da91ae82a0c672cad65bf8ef6643447be0e5fda7a39f0b8692d986db46f6c6f`

The completed process-local no-provider plan is:

```text
.data/operational-formative-conversation-v5-evaluation-v5/plans/fcv5_plan_20260730120941_64b8cf38.json
```

Its SHA-256 is:

```text
eb6994af76625bbf149d0848cb489faa4323bec389f16c57801a3f57214306a3
```

The plan reached
`ready_immediately_before_dispatch_checkpoint` with one database readiness
query, zero provider calls, zero provider-auth network requests, and no
dispatch checkpoint.

## Required future authorization

```text
I authorize one live execution of formative-conversation-host-v5-executable-v5 for runtime candidate hash a408b08c39aa614d967552e1fd321fabf0b83c96a3d83c82a7bd381fa8e899b3 and evaluation protocol hash 7b42d2b1ffd3c5cfa1bef52cf60759b6eea7e891327077144d81e7f09788aa4c, using exactly 8 isolated synthetic cases with at most 21 logical calls, 63 provider attempts, 900000 input tokens, 73500 output tokens, 973500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.
```

After the same secure process-local Render environment injection, the exact
future live command is:

```bash
npm run operational:formative-conversation-v5-v5-evaluate -- --mode=live --runtime-candidate-hash a408b08c39aa614d967552e1fd321fabf0b83c96a3d83c82a7bd381fa8e899b3 --evaluation-protocol-hash 7b42d2b1ffd3c5cfa1bef52cf60759b6eea7e891327077144d81e7f09788aa4c --confirm-live-provider-calls --authorization "I authorize one live execution of formative-conversation-host-v5-executable-v5 for runtime candidate hash a408b08c39aa614d967552e1fd321fabf0b83c96a3d83c82a7bd381fa8e899b3 and evaluation protocol hash 7b42d2b1ffd3c5cfa1bef52cf60759b6eea7e891327077144d81e7f09788aa4c, using exactly 8 isolated synthetic cases with at most 21 logical calls, 63 provider attempts, 900000 input tokens, 73500 output tokens, 973500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling."
```
