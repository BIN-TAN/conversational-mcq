# Continuous integration (GitHub Actions)

The workflow `.github/workflows/ci.yml` runs on every push to any branch, on pull requests, and on
demand (Actions tab, "CI", "Run workflow"). A newer push to the same branch or pull request cancels
the run still in progress.

CI never makes a live model call. Every job uses `LLM_PROVIDER=mock` with
`LLM_LIVE_CALLS_ENABLED=false`, no job has an OpenAI key, and the test runner loads
`scripts/classroom-audit-network-guard.mjs` into every test, so a request to any host other than
localhost throws. Secrets in the workflow are placeholders that are not used anywhere else. The live
decision runs (`interpretation-v8-evaluation-cli.ts run --engine live`,
`item-preparation-v8-live-check.ts`) stay on the researcher's computer.

## What runs

| Job | Needs | What it does |
| --- | --- | --- |
| `checks` | | `npm ci`, `npx prisma generate`, `npm run lint`, the `unit` list, `npm run test:redesign-v8`, `npm run build`, `npm run typecheck` |
| `database` | `checks` | PostgreSQL 16 service, `npx prisma migrate deploy` on a fresh database, `npm run prisma:seed`, the `database` list |
| `browser` | `checks` | PostgreSQL 16, Chromium, migrations, seed, `npm run build`, starts the app (web server and preparation worker) and checks `/api/health`, then the `browser` list |

In `checks`, every step after `prisma generate` runs even when an earlier one fails, so one run shows
every problem. If `checks` fails, `database` and `browser` do not start. The typecheck runs after the build because `next-env.d.ts` refers to
`.next/types/routes.d.ts`, which the build writes.

The `browser` job is allowed to fail (`continue-on-error: true`): its result is shown, but it does
not make the run fail. Remove that line once the browser scripts pass reliably.

The test database is `conversational_mcq_classroom_audit_ci`, owned by the superuser `cmcq`. Many
tests refuse to run unless the database name starts with `conversational_mcq_classroom_audit_`, and
some tests and the runner create further databases, which needs the superuser.

## The test lists

All lists are in `config/ci-tests.json`:

- `unit`: tests that need no database. They run with `DATABASE_URL` set to an address where nothing
  listens.
- `database`: tests that need PostgreSQL.
- `browser`: Playwright scripts. Each starts the built app itself on a free port.
- `excluded`: files deliberately not run, with the reason.

`scripts/ci-run-tests.mjs` runs one list, one test at a time, through the tsx CLI (the same as
`npx tsx <file>`). Locally:

```bash
npm run ci:unit
npm run ci:db                                              # needs a local database
node scripts/ci-run-tests.mjs database --filter roster     # only entries whose path contains "roster"
node scripts/ci-run-tests.mjs browser --dry-run            # list what would run
```

## Adding a test

Append the test's path to the right list in `config/ci-tests.json`, for example
`"prisma/new-feature-unit-test.ts"`. If the test needs more, use an object:

```json
{
  "path": "prisma/new-feature-smoke-test.ts",
  "database": "conversational_mcq_classroom_audit_new_feature",
  "args": ["--database"],
  "timeoutMinutes": 20,
  "env": { "SOME_FLAG": "1" },
  "allowFailure": "Why it may fail for now",
  "note": "Anything a reader should know"
}
```

- `database`: run this test against its own database of that name on the same server. The runner
  creates, migrates and seeds it the first time it is needed. Use this when the test's guard needs a
  particular name (for example `..._catalog_smoke` or `..._ux`).
- `timeoutMinutes`: the default is 10. The runner stops the test and everything it started at the
  limit.
- `allowFailure`: the test runs and is reported, but its failure does not fail the job. The summary
  says when such a test passes, so the flag can be removed.

A test must not need a live model call. If it can make one, it belongs on the researcher's
computer, not in CI.

## Reading a failure

1. Open the failed run in the Actions tab. The job summary has a table per list, with failed tests
   first.
2. In the step log, each failed test has an "Output of ..." group with the last 300 lines of its
   output and an error annotation.
3. The full log of every test is in the run's artifacts (`checks-logs`, `database-logs`,
   `browser-logs`, kept 14 days) under `ci-logs/<list>/<test>.log`, with `junit.xml`. The browser
   artifact also has the app start-up log, the health response, and the screenshots the scripts
   save.
4. Reproduce locally with `npx tsx <test path>`, or with
   `node scripts/ci-run-tests.mjs <list> --filter <name>`.

## Cost

The repository is private, so runs use the account's GitHub Actions minutes (Linux minutes count
once each). Expected times before the first run, to be replaced by measured ones:

| Job | Estimate |
| --- | --- |
| `checks` | 13-20 minutes (the 150 database-free tests took 3 minutes in a sandbox) |
| `database` | 20-35 minutes |
| `browser` | 15-30 minutes |

`database` and `browser` run side by side after `checks`, so a run takes about 35-55 minutes from
push to result and uses about 50-85 billed minutes. A push that only changes documentation still
runs everything, and a pull request from a branch in this repository runs once for the push and
once for the pull request.
