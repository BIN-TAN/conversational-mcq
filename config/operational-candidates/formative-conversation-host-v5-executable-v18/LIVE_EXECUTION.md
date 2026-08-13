# V18 Live Execution Freeze

This candidate is inactive and has not been authorized or executed.

## Required authorization

I authorize one live execution of formative-conversation-host-v5-executable-v18 for runtime candidate hash 17ca582ac937be7f790a2841d3542a4d79ec9364c04703fecdbfc282134378ca and evaluation protocol hash 0709d61e2f681e5a73a8b488165bfeffb7a030b5e12bf5dd171eb15a06f4d5ef, using exactly 12 isolated synthetic cases with 4 profiling base calls, 24 formative base calls, at most 56 logical calls, 168 provider attempts, 1800000 input tokens, 368000 output tokens, 2168000 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 60 ceiling.

## Canonical command

```sh
node --import tsx scripts/operational-formative-conversation-v5-v18-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V18_ENV_FIFO" -- --mode=live --runtime-candidate-hash=17ca582ac937be7f790a2841d3542a4d79ec9364c04703fecdbfc282134378ca --evaluation-protocol-hash=0709d61e2f681e5a73a8b488165bfeffb7a030b5e12bf5dd171eb15a06f4d5ef --confirm-live-provider-calls --authorization="I authorize one live execution of formative-conversation-host-v5-executable-v18 for runtime candidate hash 17ca582ac937be7f790a2841d3542a4d79ec9364c04703fecdbfc282134378ca and evaluation protocol hash 0709d61e2f681e5a73a8b488165bfeffb7a030b5e12bf5dd171eb15a06f4d5ef, using exactly 12 isolated synthetic cases with 4 profiling base calls, 24 formative base calls, at most 56 logical calls, 168 provider attempts, 1800000 input tokens, 368000 output tokens, 2168000 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 60 ceiling."
```

The FIFO must be owner-only and one-use. Secrets must never appear on the command line or in artifacts.
