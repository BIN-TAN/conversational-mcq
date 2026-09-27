# Initial conversation preparation retry incident

## Status

Local correction, regression verification, and production build completed.
Deployment requested; verified release evidence is recorded in the release ledger.
Production session recovery and the cause of the original provider failure remain
unverified at this stage. This report deliberately omits student names,
account identifiers, session identifiers, answers, and credentials.

## Observed evidence

- A student reported two attempts stuck preparing the learning conversation after
  initial submission. Reloading, signing in again, and clearing cache did not help.
- Render application logs inspected read-only showed repeated AgentCall creation
  failures on the unique `agent_invocation_key` around 19:57-20:07 Edmonton time.
- Public health and student login returned HTTP 200 at approximately 20:53; the
  database/schema health check passed. That does not prove the affected workflow
  was functioning or identify the first failure.
- Further Render access was blocked by browser safety review. No production
  attempts were reset, deleted, requeued, or modified. Read-only permission was
  requested before further inspection.

## Reproduced failure

The initial-profile path only replayed a successful call. After a failed or
invalid call it attempted to create another AgentCall using the same unique key.
The database correctly rejected it, so subsequent preparation retries could fail
without invoking the provider. This explains a reproducible recovery defect, not
the reason for the first rejection, timeout, or usage/configuration failure.

A disposable-database regression injected an invalid profile result into the
actual preparation pipeline. Before the correction, the next workflow attempt
logged the same unique-key error and returned `retryable` instead of completing.

## Correction

- Preserve the failed AgentCall and reserve a new numbered retry record. Keep the
  original key for attempt zero and append `:retry:00000001`, etc. for retries.
- Serialize only the short reservation on the topic-session database row. No lock
  is held during provider execution. Concurrent requests reuse the reservation
  instead of dispatching duplicate provider calls.
- Reuse validated successful retries. Do not automatically repeat calls marked
  `started` or `needs_review` and do not relax any content/evidence validation.
- Record unexpected provider execution exceptions as failed with a fixed safe
  diagnostic, not raw exception text. Preserve already recorded outcomes.
- Keep the existing workflow retry limits, usage guards, student chance limits,
  sealed response packages, and source checks unchanged.

The change is scoped to initial profile preparation shared by assessments. It is
not an account-specific reset, a change to scoring, or a relaxation of answer-key
or research evidence protections. Legacy targeted-feedback retry code is not
changed in this incident.

## Verification and limitations

- The reproduced preparation regression passed after the fix: the failed audit
  remained byte-for-byte equivalent as a database record, the sealed package was
  unchanged, a separate validated call was created, and the conversation opening
  became ready. Subsequent replay did not duplicate the opening/profile call.
- The expanded preparation suite passed 17 checks, including three concurrent
  retry reservations over twelve retry generations, successful-call reuse,
  session-scope enforcement, worker recovery, and preserved student evidence.
- The simulated live-provider boundary also demonstrated invalid-output followed
  by valid-output recovery with the original failure/tokens/metadata retained.
  The initial-profile-only suite passed after the fixture correction below.
  These were synthetic provider outputs; no OpenAI requests were made.
- An unrestricted legacy formative validation suite failed at an expected
  `REVISION` state after targeted feedback. That legacy expectation is outside
  this initial-preparation correction and is not reported as a passing check.
- The initial-profile-only suite exposed an outdated `long_text` fixture: its
  text was below current length limits and lacked sentence endings. It is split
  into unfinished-text and genuinely oversized-text cases, retaining rejection
  coverage without changing production validators.
- `npm run typecheck` and `git diff --check` passed. `npm run lint` passed with
  five existing unused-variable warnings and no errors.
- Production build passed with 83 static pages using a local build-only 8 GiB
  heap. The first sandboxed run could not open the build tool's IPC socket; the
  first permitted run hit the local default 4 GiB heap. The successful rerun did
  not change deployment settings or the application's web/worker memory budgets.
  Webpack cache performance warnings and two existing build lint warnings remain.
- The final focused disposable-database run passed all 16 suites: collection
  summaries, item-admin audit, interpretation policy, transcript quality, initial
  administration, the 65-scenario navigation matrix, V18R2 contracts/pipeline/
  lifecycle, analysis-ready and selected-session exports, master export, research
  integrity and error UI, initial preparation, and initial-profile provider
  validation. The temporary database was dropped. External AI networking was
  blocked throughout; this is not a production-session recovery result.
- A hard process termination can still leave a started call whose outcome is
  unknown. This patch does not guess that repeating that call is safe. Production
  inspection is needed before claiming the affected student can resume.
- No new test attempts should be requested merely to work around this failure.
  Any technical chance restoration needs a separate authorized, audited action;
  it should not delete original research records.

See `DATA_LOGGING_SPEC.md` for the distinction between application retry indices,
provider transport retry counts, and student attempt chances.
