# V18R1 Deployment-Provenance Live Freeze

This inactive executable candidate is ready to commit. It is not live-authorized; the exact committed and canonical deployed Git SHA must be independently verified and inserted into the authorization template after deployment.

## Required authorization

I authorize one live execution of formative-conversation-host-v5-executable-v18r1 from expected deployed Git SHA <expected_deployed_git_sha> for runtime candidate hash 17ca582ac937be7f790a2841d3542a4d79ec9364c04703fecdbfc282134378ca and evaluation protocol hash 1dda208e9a3f454c1b708663790c9f2181a4054b7b06d99951ab4da04a8c7881, using exactly 12 isolated synthetic cases with 4 profiling base calls, 24 formative base calls, at most 56 logical calls, 168 provider attempts, 1800000 input tokens, 368000 output tokens, 2168000 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 60 ceiling.

## Future command template

```sh
node --import tsx scripts/operational-formative-conversation-v5-v18r1-process-local-runner.mjs --env-fifo "$FORMATIVE_CONVERSATION_V18R1_ENV_FIFO" -- --mode=live --runtime-candidate-hash=17ca582ac937be7f790a2841d3542a4d79ec9364c04703fecdbfc282134378ca --evaluation-protocol-hash=1dda208e9a3f454c1b708663790c9f2181a4054b7b06d99951ab4da04a8c7881 --expected-deployed-git-sha="$FORMATIVE_CONVERSATION_V18R1_EXPECTED_DEPLOYED_GIT_SHA" --confirm-live-provider-calls --authorization="I authorize one live execution of formative-conversation-host-v5-executable-v18r1 from expected deployed Git SHA ${FORMATIVE_CONVERSATION_V18R1_EXPECTED_DEPLOYED_GIT_SHA} for runtime candidate hash 17ca582ac937be7f790a2841d3542a4d79ec9364c04703fecdbfc282134378ca and evaluation protocol hash 1dda208e9a3f454c1b708663790c9f2181a4054b7b06d99951ab4da04a8c7881, using exactly 12 isolated synthetic cases with 4 profiling base calls, 24 formative base calls, at most 56 logical calls, 168 provider attempts, 1800000 input tokens, 368000 output tokens, 2168000 total tokens, 7200000 milliseconds wall-clock time, concurrency 1, and a USD 60 ceiling."
```

The expected deployed Git SHA is a non-secret operator input and must equal RENDER_GIT_COMMIT. The FIFO remains owner-only and one-use for secrets.
