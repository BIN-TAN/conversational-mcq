# V15 Live Execution Freeze

V15 uses one canonical loading chain for module probes, environment preflight,
plan, and live execution:

```text
node --import tsx
  -> operational-formative-conversation-v5-v15-process-local-runner.mjs
  -> operational-formative-conversation-v5-v15-launcher.mjs
  -> operational-formative-conversation-v5-v15-evaluate.ts
```

Bare `node` invocation is rejected before package loading. Plan and live modes
therefore resolve TypeScript and `@/` aliases through the same `tsx` import
hook.

## Environment boundary

Future live execution requires an owner-only, one-use FIFO. The outer runner
reads the environment once, injects it only into the evaluation child process,
scans buffered output and every releasable artifact with the exact in-memory
secret values, clears those values, and removes the secure channels. Secrets
must never be supplied as command-line arguments or persisted in the package.

The environment preflight verifies the canonical `conversational-mcq` service,
database identity and connectivity, current Prisma migrations, active approval
bundle and rollback identity, OpenAI configuration, research pseudonymization
configuration, and the frozen V15 runtime and protocol identities. The
deprecated `conversational-mcq-staging` identity is rejected.

## Dispatch boundary

Plan mode creates no dispatch checkpoint. Live mode creates one exclusive,
identity-bound checkpoint immediately before the first provider request. An
existing checkpoint blocks every rerun. The checkpoint binds the provider and
evaluation IDs, runtime, protocol, runner, fixtures, compiled plan, environment
contract, and checkpoint contract.

The exact future authorization text and executable command are generated in:

- `config/operational-candidates/formative-conversation-host-v5-executable-v15/live-execution-authorization.json`
- `config/operational-candidates/formative-conversation-host-v5-executable-v15/LIVE_EXECUTION.md`

Generation of these files does not authorize execution. V15 remains inactive,
with `approval.eligible=false` and `activation.permitted=false`.
