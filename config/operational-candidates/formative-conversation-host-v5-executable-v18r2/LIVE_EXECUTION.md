# V18R2 Deployment-Provenance Live Freeze

This inactive executable candidate is ready to commit. It is not live-authorized; the exact committed and canonical deployed Git SHA must be independently verified and inserted into the authorization template after deployment.

## Required authorization

I authorize one live execution of formative-conversation-host-v5-executable-v18r2 from expected deployed Git SHA <expected_deployed_git_sha> for runtime candidate hash db71fa1ed5e9d5ce007bddf21a102cd006ab337584708386a9c4e081a556d58e and evaluation protocol hash 0b491563a116efcdc83e3a46fff31cc8f2751256357a3921f40e31645e8ce870, using exactly 12 isolated synthetic cases with 4 profiling base calls, 24 formative base calls, at most 56 logical calls, 168 provider attempts, 1800000 input tokens, 368000 output tokens, 2168000 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 60 ceiling.

## Future command template

```sh
node --import tsx scripts/operational-formative-conversation-v5-v18r2-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V18R2_ENV_FIFO" -- --mode=live --runtime-candidate-hash=db71fa1ed5e9d5ce007bddf21a102cd006ab337584708386a9c4e081a556d58e --evaluation-protocol-hash=0b491563a116efcdc83e3a46fff31cc8f2751256357a3921f40e31645e8ce870 --expected-deployed-git-sha="$FORMATIVE_CONVERSATION_V18R2_EXPECTED_DEPLOYED_GIT_SHA" --confirm-live-provider-calls --authorization="I authorize one live execution of formative-conversation-host-v5-executable-v18r2 from expected deployed Git SHA ${FORMATIVE_CONVERSATION_V18R2_EXPECTED_DEPLOYED_GIT_SHA} for runtime candidate hash db71fa1ed5e9d5ce007bddf21a102cd006ab337584708386a9c4e081a556d58e and evaluation protocol hash 0b491563a116efcdc83e3a46fff31cc8f2751256357a3921f40e31645e8ce870, using exactly 12 isolated synthetic cases with 4 profiling base calls, 24 formative base calls, at most 56 logical calls, 168 provider attempts, 1800000 input tokens, 368000 output tokens, 2168000 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 60 ceiling."
```

The expected deployed Git SHA is a non-secret operator input and must equal RENDER_GIT_COMMIT. The FIFO remains owner-only and one-use for secrets.
