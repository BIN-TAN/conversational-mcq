# E2E Failure Matrix

Phase 8B records deterministic expectations for operational failure categories without making provider calls.

## Covered Categories

The harness covers:

- timeout
- transient network failure
- rate limit
- provider 5xx
- refusal
- incomplete output
- invalid schema
- semantic validation failure
- safety validation failure
- permanent error
- usage-limit block
- manifest mismatch
- configuration hash mismatch

## Expected Effective Behavior

Operational workflow must:

- retry only bounded transient failures
- avoid duplicate provider requests
- fall back deterministically or preserve prior active profile/planning pointers
- keep save, exit, and resume available
- avoid student deadlock
- avoid raw exception exposure to students
- keep sanitized teacher audit records
- avoid OpenAI calls in Phase 8B

The Phase 8B failure-matrix command is a no-provider smoke:

```bash
npm run e2e:failure-matrix-smoke
```

It verifies that the synthetic matrix does not create OpenAI `agent_calls` and writes local evidence under `.data/e2e/<run>/failure-matrix.json`.
