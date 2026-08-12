# V17 Live Execution Freeze

This candidate is inactive and has not been authorized or executed.

## Required authorization

I authorize one live execution of formative-conversation-host-v5-executable-v17 for runtime candidate hash b077ba062c37340eac2918a2578f118c36fa852006196d31ef4735598ed21e6e and evaluation protocol hash e8d76572f9fb11bf88069c3474c6f1a39469a68e2fe1fa1d2a827f42c2283d90, using exactly 11 isolated synthetic cases with 3 profiling base calls, 21 formative base calls, at most 35 logical calls, 105 provider attempts, 1100000 input tokens, 125500 output tokens, 1225500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 40 ceiling.

## Canonical command

```sh
node --import tsx scripts/operational-formative-conversation-v5-v17-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V17_ENV_FIFO" -- --mode=live --runtime-candidate-hash=b077ba062c37340eac2918a2578f118c36fa852006196d31ef4735598ed21e6e --evaluation-protocol-hash=e8d76572f9fb11bf88069c3474c6f1a39469a68e2fe1fa1d2a827f42c2283d90 --confirm-live-provider-calls --authorization="I authorize one live execution of formative-conversation-host-v5-executable-v17 for runtime candidate hash b077ba062c37340eac2918a2578f118c36fa852006196d31ef4735598ed21e6e and evaluation protocol hash e8d76572f9fb11bf88069c3474c6f1a39469a68e2fe1fa1d2a827f42c2283d90, using exactly 11 isolated synthetic cases with 3 profiling base calls, 21 formative base calls, at most 35 logical calls, 105 provider attempts, 1100000 input tokens, 125500 output tokens, 1225500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 40 ceiling."
```

The FIFO must be owner-only and one-use. Secrets must never appear on the command line or in artifacts.
