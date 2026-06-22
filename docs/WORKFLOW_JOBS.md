# Workflow Jobs

Phase 6D2A adds a PostgreSQL-backed workflow queue for automatic sessions. Phase 6D2B extends the same queue with staged follow-up evidence update jobs inside the current concept unit. The workflow queue does not use Redis or browser-dependent execution.

## Job Types

These job types are implemented through Phase 6D2B:

- `run_initial_profiling`
- `run_initial_planning`
- `start_initial_followup`
- `run_followup_profile_update`
- `run_followup_planning_update`
- `finalize_followup_update`

Follow-up evidence updating is staged: profile update output and planning update output are saved on the update cycle first, then activated together only during finalization. Countdown timers and live Item Preparation behavior are not implemented. Phase 7C Response Collection Agent handling is student-message-triggered during initial administration and is not a workflow job type. Workflow jobs themselves do not generate CSV files or mutate export rows directly.

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
- follow-up profile update: follow-up update cycle + evidence package
- follow-up planning update: follow-up update cycle + staged updated profile
- follow-up finalization: follow-up update cycle

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
FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE=3
```

Retries use exponential backoff with jitter. Permanent validation/refusal failures should fail safely instead of looping indefinitely. `FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE` is a technical fallback for evidence updating and is not a pedagogical maximum number of turns.

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
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
```

The workflow smoke test verifies claim behavior, concurrent worker safety, lease recovery, pause skipping, safe payloads, and absence of OpenAI calls. The follow-up update smoke tests verify staged update cycles, final stop updates, idempotency, safe evidence packages, teacher serialization, and absence of OpenAI calls.

## Phase 6D3 Progression Jobs

Phase 6D3 adds `finalize_concept_progression`. This job resolves a student progression record after an optional final follow-up update. It may activate the next concept, complete the assessment, or leave the progression awaiting neutral unresolved-evidence confirmation.

Additional verification:

```bash
npm run concept:progression-smoke
npm run assessment:completion-smoke
```
