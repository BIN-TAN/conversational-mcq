# Research capture and completion follow-up

Date: 27 September 2026. Original status: local fixes and verification.
Deployment addendum: pushed and verified Live on 27 September 2026 as
`6b522eb4c097a7e78440c2338c8e589853683459`, Render deployment
`dep-dasofmjl550s739gv0sg`. The release ledger records health, build and worker
evidence. The limitations below retain the original audit scope.

This follows the read-only production findings in [REPORT.md](REPORT.md).
The original report remains a historical audit, not a description of these
subsequent local changes. No production attempt or research record was changed.

## Why "planning completed" appeared

`planning_completed` is an internal preparation phase retained during the
free-text learning conversation. It is not the assessment completion status.
Exposing this internal label was misleading. There was also a workflow gap:
closing a conversation changed the conversation record but left its parent
assessment attempt open, with no explicit successful-completion action.

Teacher session lists, session overviews and student-account details now use
readable phase labels. Active/paused conversations are not relabeled as completed.
An ended conversation whose attempt is still open is distinguished from a
completed assessment. The topic counter describes submitted questions rather
than implying completion of learning activities.

After all published topics have an initial package and a closed learning
conversation with completed tutor receipts, students can choose **Finish
assessment**. The competing early-exit button is hidden at this point. Pausing
does not complete an attempt, and failed/pending tutor replies do not qualify.
The server verifies ownership and eligibility under a session lock; repeated
finish requests create one completion event. Student review, teacher counts and
the research export are checked against the same persisted completed status.

Finishing is a workflow action, not evidence of mastery. It neither creates a
final profile nor changes learning outcomes. Existing paused/exited attempts are
not automatically promoted or retrospectively completed. A failed tutor reply
still allows retry or teacher assistance instead of forced completion.

## Feedback display capture

The old client skipped display acknowledgement for canonical conversations and
otherwise attempted unsupported event names in a batch. Mounting a results card
could also acknowledge explanations that were not actually visible.

The current collector observes a visible document and partial viewport exposure
for at least 500 continuous milliseconds. It records separate first exposures
for a results summary, each expanded item explanation and each tutor message.
Hidden tabs, collapsed content and offscreen content do not qualify. The server
validates released content, topic ownership and tutor-turn identity. Stable IDs
and the existing bounded queue support retry/reload without duplicate rows.

New fields and calculations are documented in `docs/DATA_LOGGING_SPEC.md`,
`docs/ASSESSMENT_FLOW.md`, the event codebook and exported dictionaries.
`feedback_exposure_events.csv` includes contract version, content kind, observer
method, threshold, client identity, receipt time and tutor sequence reference.
The threshold is not reading duration; an observation does not establish reading
or understanding. Historical absent observations remain absent. Read-only review
does not create new in-attempt exposures. Legacy v1 semantics remain identifiable.

## Changed areas

- Student conversation lifecycle, finish eligibility, canonical state refresh and
  read-only review.
- Teacher phase labels and the submitted-topic counter.
- Viewport observer, durable browser delivery and server-side reference checks.
- Research exposure export, runtime-state projection and variable dictionaries.
- Database, browser and delivery regression tests; the new regression is included
  in both classroom-audit and student-demo-regression runners.

## Verification

- 11 focused suites passed, including explicit completion, simultaneous retries,
  ownership, failed-feedback/incomplete-package guards, teacher dashboard/list
  agreement, attempt comparison, event delivery and CSV joins.
- All 20 research regression suites passed after the collection changes; the
  synthetic research-quality audit passed 28/28 checks. These suites overlap with
  the focused run and should not be counted as 31 distinct suites.
- The production-build browser test passed 14 scenarios, using synthetic local
  data and no external AI calls. It checks hidden/offscreen/collapsed content,
  offline delivery followed by reload, per-item acknowledgements, typing/paste
  aggregates through CSV export, feedback failures, pause/resume and explicit
  completion. Desktop 1440 and mobile 390/320 layouts are checked for overflow.
- `npm run build`, `npm run typecheck`, `npm run lint` and `git diff --check`
  passed. Lint reports five existing unused-variable warnings outside the changed
  behavior; no lint errors.
- Tests ran on disposable localhost databases with external AI access blocked.
  Each runner reports successful database cleanup. No real student session was
  used for mutation or simulated replies.

The `followup-evidence/` directory retains focused/research/browser result
manifests, the 28-check quality report, completion/browser logs, initial failed
run manifests and inspected 1440/390/320 finish-screen captures. The result
manifests include test exits, elapsed times and log hashes.

Reproduction: run `node --import tsx prisma/feedback-display-completion-smoke-test.ts`
with the project's migrated disposable local fixture database and mock settings;
run `node --import tsx scripts/initial-preparation-ux-smoke.mjs` after a production
build in the same isolated setup. The browser script requires a database named
`conversational_mcq_classroom_audit_*`. The regular classroom runner includes the
new database regression; the complete classroom runner was not rerun in this task.

## Retained failed checks

- An initial new-test run passed its assertions but failed duplicate fixture
  cleanup. The redundant user deletion was removed, and the suite was rerun.
- The first browser extension expected no item observations after bringing an
  already-expanded results card into view. Those items were genuinely visible.
  The test now collapses them before visibility resumes and then opens them
  individually. Both corrected and final UI browser runs passed.
- A sandboxed build could not create its local IPC socket. The permitted local
  retry then exceeded an explicitly imposed 2 GiB build heap. Builds succeeded
  with an 8 GiB local build heap. This is not a change to Render runtime memory
  and is not proof of live service capacity.

## Remaining boundaries

At the time of the original local audit these fixes were not deployed. A production browser check and
a newly generated production ZIP are still needed before claiming the live
collection path is verified. The earlier production preflight and historical
ZIP checks do not substitute for that check. Missing historical display records
and absent final reassessments cannot be reconstructed from generated feedback.
Technical tests do not establish pedagogical validity or absence of all bugs.

The Word ledger now records the verified deployment as CMCQ-20260927-04.
