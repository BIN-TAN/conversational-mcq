# Student navigation audit, 2026-09-22

## Scope and safety

This is a branch-and-transition regression audit, not a proof over every possible
sequence of student actions or every possible LLM reply. All runs used disposable
local PostgreSQL databases, synthetic users, and deterministic/mock agent output.
No classroom accounts, production responses, or Render data were changed.

Database names are restricted by the audit scripts to local
`conversational_mcq_classroom_audit_*` databases. The server-side runner also
blocks external network access. Live-provider keys are not used.

## Reproduced issues and fixes

| Issue | Corrected behavior |
| --- | --- |
| A student changes their answer to the option they previously found tempting. | Save the new answer, retain historical evidence, clear the now-invalid alternative, and ask about a new alternative. |
| A student selects a tempting option, then changes to No. | Accept No without requiring an explanation for the abandoned alternative. |
| More than ten unrelated edits push the original tempting selection out of the lookup window. | Retrieve the latest relevant tempting-evidence turn, rather than scanning only ten recent turns. |
| A stale page edits an earlier item after progression or edits a paused attempt. | Reject the write; earlier items are edited through package review and paused attempts must first resume. |
| The server saves a response but the browser loses its reply. | Retry with the original action ID and observation link; replay the saved outcome instead of submitting another response. |
| Simultaneous identical requests race while claiming their action ID. | Return a recoverable conflict instead of a raw database error; the eventual retry returns the saved result. |
| Repeated Start questions requests reset the start timestamp or repeat presentation events. | Return current state for an already-started question set without rewriting start/presentation evidence. |

Changing a tempting option also clears the old option's explanation unless the
student provides a new explanation. Canceling an edit does not change responses.

## Automated coverage

The default `scripts/student-navigation-audit.mjs` run passed **20/20 suites**.
Its new `prisma/student-navigation-matrix-test.ts` passed **62 named scenarios**:

- 45 combinations: five answer choices (including uncertainty), three confidence
  levels, and three alternative-option paths (No, choice plus explanation,
  choice followed by a separate explanation). State is reloaded after each step;
  replaying the completion request must not duplicate `item_completed`.
- Changes between selected and tempting answers, abandoning a tempting choice,
  changing the tempting choice, and retaining evidence after twelve edits.
- Pause/resume at answer, reasoning, confidence, tempting choice, and tempting
  explanation; stale writes cannot alter response snapshots.
- Earlier-item edits, ended-attempt writes, and cross-student access rejection.
- Content questions, answer requests, procedural questions, and gibberish do not
  become initial reasoning evidence; explicit uncertainty can continue.
- Simultaneous identical requests, replay, and repeated-start timing/events.

The other suites cover variable item counts, package review/editing, feedback
recovery, attempt lifecycle and start conflicts, background preparation,
conversation pipeline/lifecycle, the 30-turn boundary, misconception-coverage
guards, readable transcripts, and research-export integrity. Coverage of
misconception guards does not establish the instructional quality of every
future live-generated conversation.

### Browser and research checks

- `classroom-login-progression-browser-smoke.mjs`: real instructor sign-in and
  refresh, student progression after alternative edits, recovery of an older
  stranded complete response, lost-reply retry, content-question deferral,
  uncertainty, answer editing, cancellation, reload, and pause/resume at 390 px.
  Passed package review edit/cancel/save/reload, end-attempt cancellation and
  confirmation, and reopening read-only history. No page errors or horizontal
  document overflow were detected.
- `response-stage-browser-smoke.mjs`: passed. Actual browser stage observations,
  first input, rejected/accepted reasoning, confidence, next item, offline/online,
  reload, pause, delivery deduplication, forged-outcome rejection, student
  isolation, and read-only history checks. Nine stage visits were captured;
  database records, teacher desktop/mobile review, and the research ZIP agreed.
  No live provider calls were made.
- `initial-preparation-ux-smoke.mjs`: passed all ten checks. Authenticated
  submission returned HTTP 202 in 121 ms in this local run (not a production
  latency prediction). Saved answers remained reviewable while waiting; reload
  and a simulated connection outage did not submit again. A failed job could be
  retried with the same identity, and the worker delivered one validated opening.
  Waiting/review layouts were checked at 320, 390, and 1440 px. Typing and paste
  aggregates survived reload and appeared in research CSVs without raw unsent or
  clipboard text. The production launcher started and stopped web/worker services.

### Verification record

- Production build: passed, including framework type/lint validation.
- Standalone lint: zero errors; five existing unused-variable/import warnings
  in unrelated evaluation/fixture files.
- Server suite output: `cmcq-navigation-audit-HhsfeZ/results.json` (20/20).
- Final login/progression browser output: `cmcq-login-progression-5C5se5`.
- Research telemetry browser output: `cmcq-response-stage-bqkRUI`.
- Preparation browser output: `cmcq-preparation-ux-fVcHKl`.

These artifact directories were created under the machine's temporary directory.
The audit tested changes on baseline `77a5c8a7` before deployment. These local
results do not establish that production has the fixes; deployment requires
separate verification of the exact Render source commit and service health.

The original request failure and the authoritative accepted server outcome are
different observations: a lost network reply must not be interpreted as loss of
the student's response. This relationship, and the tempting-evidence reset, are
documented in `DATA_LOGGING_SPEC.md`. Historical turns are retained, not rewritten.

## Reproduction

Use a fresh local database with all Prisma migrations and the repository's demo
seed. Do not point these commands at classroom data. Set `DATABASE_URL` to that
local database before running:

```sh
npm run typecheck
npm run lint
npm run build
node scripts/student-navigation-audit.mjs
node --import tsx scripts/classroom-login-progression-browser-smoke.mjs
node --import tsx scripts/response-stage-browser-smoke.mjs
LLM_LIVE_CALLS_ENABLED=false node --import tsx scripts/initial-preparation-ux-smoke.mjs
git diff --check
```

The navigation runner and login browser test require a database name beginning
`conversational_mcq_classroom_audit_login_flow_`. The response-stage browser test
requires its own `conversational_mcq_classroom_audit_ux_` database. Each browser
script starts and stops its own local application server. The preparation test
also starts and stops the background worker.

## Remaining limitations

- No fresh live AI calls or production deployment are part of this audit.
- Three older exploratory smoke scripts were not counted as passing:
  `student-transfer-item-smoke-test` assumes the superseded transfer flow;
  `student-response-quality-smoke-test` uses obsolete model-policy assumptions;
  `student-formative-conversation-runtime-smoke-test` expects an older prompt
  contract and legacy misconception catalog. They need separate test-maintenance
  work. Current paths are exercised by the matrix and v18r2 suites instead.
- The checks cover same-ID request races and representative stale-tab behavior,
  not every differently-keyed concurrent action, pause/write race, or arbitrary
  network outage. They are not a classroom-scale load test.
- Real browser visibility and timing are observations, not proof of attention,
  engagement, mastery, or misconduct.

## Changed areas

- `src/lib/services/student-assessment/service.ts`: state, evidence lookup,
  editing, pause protection, idempotency, and start behavior.
- `src/lib/services/response-packages.ts`: projection of an explicit alternative
  reset without resurrecting superseded evidence.
- `src/components/student-assessment/{api.ts,assessment-session-client.tsx}`:
  stable retry identity and immediate duplicate-click protection.
- New navigation matrix/runner and expanded browser regression checks; legacy
  fixture ownership and cleanup corrected where needed for current tests.
- `ASSESSMENT_FLOW.md` and `DATA_LOGGING_SPEC.md`: behavior and evidence semantics.
