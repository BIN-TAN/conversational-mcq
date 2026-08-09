# V16 Live Execution Freeze

This candidate is inactive and has not been authorized or executed.

## Required authorization

I authorize one live execution of formative-conversation-host-v5-executable-v16 for runtime candidate hash d96ec30d26637887127fe92dd5f3d074de788ee02dd9aea523df2f79ca718034 and evaluation protocol hash d545c4e8e8204b613e7daf0e26359d774930d4c8a2c90412941b9428c6687c26, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.

## Canonical command

```sh
node --import tsx scripts/operational-formative-conversation-v5-v16-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V16_ENV_FIFO" -- --mode=live --runtime-candidate-hash d96ec30d26637887127fe92dd5f3d074de788ee02dd9aea523df2f79ca718034 --evaluation-protocol-hash d545c4e8e8204b613e7daf0e26359d774930d4c8a2c90412941b9428c6687c26 --confirm-live-provider-calls --authorization "I authorize one live execution of formative-conversation-host-v5-executable-v16 for runtime candidate hash d96ec30d26637887127fe92dd5f3d074de788ee02dd9aea523df2f79ca718034 and evaluation protocol hash d545c4e8e8204b613e7daf0e26359d774930d4c8a2c90412941b9428c6687c26, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling."
```

The FIFO must be owner-only, one-use, and populated by an authorized secure environment retrieval mechanism. Never place secrets on the command line.
