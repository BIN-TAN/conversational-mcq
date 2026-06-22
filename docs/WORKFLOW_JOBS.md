# Workflow Jobs

Phase 6D2A adds a PostgreSQL-backed workflow queue for automatic sessions. It does not use Redis or browser-dependent execution.

## Job Types

Only these job types are implemented in Phase 6D2A:

- `run_initial_profiling`
- `run_initial_planning`
- `start_initial_followup`

No follow-up evidence profile updating, replanning, second follow-up round, or next-concept progression is implemented.

## Statuses

- `pending`
- `running`
- `retryable`
- `completed`
- `failed`
- `cancelled`

Jobs store public IDs, internal relations, idempotency keys, bounded payloads, attempt counts, retry timing, lock metadata, sanitized errors, and completion timestamps.

## Idempotency

Each logical automatic step has an idempotency key based on the concept-unit session and the evidence record that justifies the step:

- profiling: concept-unit session + initial response package
- planning: concept-unit session + latest student profile
- follow-up startup: concept-unit session + latest formative decision

Retries must not duplicate successful profiles, decisions, follow-up rounds, or assistant openings.

## Claiming And Leases

Workers claim jobs with PostgreSQL row locking. Paused sessions are skipped. Running jobs whose lock exceeds `WORKFLOW_JOB_LEASE_TIMEOUT_MS` become retryable.

Environment variables:

```text
WORKFLOW_JOB_MAX_ATTEMPTS=3
WORKFLOW_JOB_BASE_RETRY_MS=5000
WORKFLOW_JOB_MAX_RETRY_MS=300000
WORKFLOW_JOB_LEASE_TIMEOUT_MS=300000
WORKFLOW_JOB_POLL_INTERVAL_MS=2000
```

Retries use exponential backoff with jitter. Permanent validation/refusal failures should fail safely instead of looping indefinitely.

## Commands

```bash
npm run workflow:drain-once
npm run workflow:worker
```

`workflow:drain-once` processes currently available jobs until none remain. `workflow:worker` runs continuously with clean shutdown handling.

## Secrets

Workflow payloads must not contain API keys, Authorization headers, cookies, session secrets, password hashes, access-code hashes, database URLs, or raw environment variables.

## Verification

Run:

```bash
npm run workflow:worker-smoke
```

The smoke test verifies claim behavior, concurrent worker safety, lease recovery, pause skipping, safe payloads, and absence of OpenAI calls.
