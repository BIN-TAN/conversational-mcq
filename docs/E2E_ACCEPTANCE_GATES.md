# E2E Acceptance Gates

Phase 8B gates are synthetic engineering gates. They do not establish classroom validity.

## Required Gates

A production-like synthetic run should verify:

- isolated `_e2e` database guard
- all migrations applied
- synthetic fixture seeded
- production build succeeds
- `next start` responds on `127.0.0.1:3100`
- workflow worker runs as a separate process
- `/api/health` returns 200
- student standard completion journey
- save/resume journey
- disallowed help and prompt-injection handling
- off-topic and move-on journey
- teacher review and audit navigation
- release/close/resume availability rules
- auth and role guards
- student payload protection
- export generation and CSV parsing
- concurrency probe with no unexplained errors
- worker restart without duplicate completion
- app restart with resumable state
- database invariants
- zero OpenAI calls

## Report Recommendation

If all gates pass, the report recommendation is:

```text
ready_for_guarded_live_synthetic_canary
```

If any gate fails, the recommendation is:

```text
not_ready_for_guarded_live_synthetic_canary
```

In both cases:

```text
classroom_validity=false
```
