# V15 Live Execution Freeze

This candidate is inactive and has not been authorized or executed.

## Required authorization

I authorize one live execution of formative-conversation-host-v5-executable-v15 for runtime candidate hash e8b13b130a78f966cc2fec7bb433859df81ecbd791b7d7ed6ffd58ec502bbc60 and evaluation protocol hash 8937e12a3f0b0f96efdafe1faba07edcde614fb880cc58c557f3725abd9bcc4f, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling.

## Canonical command

```sh
node --import tsx scripts/operational-formative-conversation-v5-v15-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V15_ENV_FIFO" -- --mode=live --runtime-candidate-hash e8b13b130a78f966cc2fec7bb433859df81ecbd791b7d7ed6ffd58ec502bbc60 --evaluation-protocol-hash 8937e12a3f0b0f96efdafe1faba07edcde614fb880cc58c557f3725abd9bcc4f --confirm-live-provider-calls --authorization "I authorize one live execution of formative-conversation-host-v5-executable-v15 for runtime candidate hash e8b13b130a78f966cc2fec7bb433859df81ecbd791b7d7ed6ffd58ec502bbc60 and evaluation protocol hash 8937e12a3f0b0f96efdafe1faba07edcde614fb880cc58c557f3725abd9bcc4f, using exactly 8 isolated synthetic cases with at most 29 logical calls, 87 provider attempts, 900000 input tokens, 101500 output tokens, 1001500 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 30 ceiling."
```

The FIFO must be owner-only, one-use, and populated by an authorized secure environment retrieval mechanism. Never place secrets on the command line.
