# Production-Like Synthetic E2E Testing

Phase 8B validates the local platform as a production-like synthetic classroom run. It does not authorize classroom live OpenAI use, does not use real or deidentified student data, and does not deploy the system publicly.

## Runtime Shape

The harness uses:

- isolated PostgreSQL database ending in `_e2e`
- all existing Prisma migrations
- `next build`
- `next start` on `http://127.0.0.1:3100`
- real workflow worker process
- Playwright browser contexts for student and teacher journeys
- synthetic-only fixture records
- `OPERATIONAL_AGENT_MODE=mock`
- `LLM_PROVIDER=mock`
- `LLM_LIVE_CALLS_ENABLED=false`
- `E2E_FORBID_EXTERNAL_PROVIDER_CALLS=true`

No E2E script should call OpenAI or enable classroom live calls.

## Commands

```bash
npm run e2e:production-like:preflight
npm run e2e:db:prepare
npm run e2e:db:reset
npm run e2e:db:cleanup
npm run e2e:cleanup
npm run e2e:production-like
npm run e2e:production-like:report -- --run <e2e_run_id>
```

Focused suites:

```bash
npm run e2e:browser-smoke
npm run e2e:worker-restart-smoke
npm run e2e:app-restart-smoke
npm run e2e:failure-matrix-smoke
npm run e2e:concurrency-smoke
npm run e2e:export-smoke
npm run e2e:privacy-smoke
```

## Artifacts

Each run writes ignored files under:

```text
.data/e2e/<e2e_run_id>/
```

Expected files include:

- `report.json`
- `summary.md`
- `app.log`
- `worker.log`
- `browser-results/`
- `screenshots-on-failure/`
- `network-attempts.json`
- `database-invariant-report.json`
- `export-verification.json`

These files are local test evidence and must not be committed.

## Readiness Label

The report label is:

```text
production-like synthetic end-to-end readiness
```

The report always states:

```text
classroom_validity=false
real_student_data_used=false
external_llm_calls=0
```

A passing synthetic run may recommend:

```text
ready_for_guarded_live_synthetic_canary
```

That recommendation is still not classroom validity and does not enable live operational calls.
