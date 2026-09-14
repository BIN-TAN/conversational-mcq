# Demo Recovery and Research Integrity Audit

Date: 2026-09-14. Base commit: `4be3ff88a6e349d8fe050e9ad4656465a1f47243`.
This report covers local working-tree fixes, not a deployment or approval.

## Findings and Corrections

1. **Ended attempts could retain active conversation controls.** Ending the parent attempt did not close its child formative conversation. The student projection also trusted the child independently of the parent. Ending now closes both in one transaction. Student and teacher views treat historical active children of terminal attempts as ended, without rewriting historical rows. Opening an ended attempt's original URL now shows read-only review.
2. **Concurrent or delayed operations could conflict with ending.** End, pause, formative message/profile writes, and shared phase updates now lock the parent attempt before making their decisions. Locks are held for database work only, never for a provider wait. New conversation writes are rejected after termination, and background phase updates cannot resume paused or terminal attempts. Phase events and their state changes commit or roll back together. A late error cannot change an ended attempt into a needs-review attempt.
3. **An uncertain end response could look like failure after a successful save.** The client now performs one authenticated state read after an end-request error. It treats the action as successful only when the server confirms termination; otherwise it preserves the error. It does not automatically send another end request. Already-saved message and lifecycle-handoff receipts remain replayable without duplicates.
   Failure bookkeeping for already-reserved openings/messages remains permitted after pause/end, without creating a reply or profile update. This prevents a paused in-flight request from remaining permanently pending; retry is permitted only after the attempt is active again.
4. **The initial profiling fallback lost the useful guard explanation.** Initial profiling now preserves typed operational blocking reasons and an allowlisted usage-limit reason in process/effective-result diagnostics. Teacher-visible warnings distinguish operational blocking from an LLM-derived profile. No readiness snapshot, secret, prompt, or answer key is added. Operational guards and conservative fallback behavior are not relaxed.
5. **The research audit falsely omitted session-level events.** It previously collected only events attached to concept-unit sessions. The audit now reads all events attached to the assessment session once, including `session_started`, without duplicating child events. Optional answer changes, typing starts, and tempting-option reasons are not universally required events.
6. **The research audit assumed three response records meant completeness.** Version 2 checks the included item identities in the saved package and requires one response with answer, reasoning, confidence, and applicable tempting-option evidence per included item. Three responses do not complete a six-item test; duplicate records do not substitute for missing items. Missing or ambiguous item identity metadata yields unknown, not complete. This is evidence completeness, not mastery or assessment validity.

The original live end-request error itself was not conclusively traced: browser automation also encountered dialog timeouts. The inconsistent persisted child state and missing recovery behavior were independently reproduced locally and corrected.

## Verification

- Focused backend gate: 20/20 passed, including lifecycle, shared services, concurrency, profile handoff, V18R2 pipeline/lifecycle, research delivery/exports, timing, data quality, and privacy checks.
- Browser gate: 26/26 passed on the final build; desktop/mobile screenshots were inspected. The harness reported no external requests and no unexpected writes. Final results and screenshots: `/var/folders/rx/k94y88g53hnfdy9hf6j6dt1c0000gn/T/cmcq-ux-smoke-VT3gDP/`.
- Typecheck: passed on the final source.
- Lint: no errors; five existing unused-variable warnings in historical V18 materializer/runner files.
- Production build: passed on the final source, including all 77 static pages.
- `git diff --check`: passed.
- No provider calls, model-auth requests, production writes, deployment, approval, or activation in this task.
- Tests use disposable loopback PostgreSQL databases with the `conversational_mcq_classroom_audit_` prefix, mock providers, blank provider keys, and an external-HTTP guard.

Commands (run from the repository root):

```sh
DATABASE_URL=<isolated-local-audit-database> node scripts/student-demo-regression.mjs
DATABASE_URL=<isolated-local-ux-audit-database> node scripts/classroom-ux-smoke.mjs
npm run typecheck
npm run lint
npm run build
git diff --check
```

The build was also run with mock/live-disabled environment overrides, blank provider keys, and `NODE_OPTIONS='--import ./scripts/classroom-audit-network-guard.mjs'`. Do not substitute a production database in these commands.

A local mock preview was left running at `http://127.0.0.1:60017/student/login` (process 95197), using only the disposable UX database and blocking external HTTP. It is not the production service.

## Changed Files

- `src/lib/services/student-assessment/formative-conversation/attempt-boundary.ts`: shared parent lifecycle guard and transaction lock.
- `src/lib/services/student-assessment/formative-conversation/service.ts`: conversation creation, message/opening, handoff, and turn-limit write boundaries.
- `src/lib/services/student-assessment/formative-conversation/projection.ts`: parent-aware controls and lifecycle mutation guards.
- `src/lib/services/student-assessment/formative-conversation/profile-update.ts`: active-parent guard for profile transition commits.
- `src/lib/services/student-assessment/formative-conversation/profile-update-v18.ts`: corresponding V18 contract write guard.
- `src/lib/services/student-assessment/service.ts`: atomic/idempotent ending, pause race protection, terminal state projection.
- `src/lib/services/session-state.ts`: transactional phase updates and late failure protection.
- `src/components/student-assessment/api.ts`: read-only reconciliation after uncertain end responses.
- `src/components/student-assessment/assessment-session-client.tsx`: terminal review and non-pending ended controls.
- `src/lib/agents/student-profiling/service.ts`: sanitized blocking diagnostics for initial profile fallback.
- `src/lib/services/teacher-review/session-detail.ts`: consistent terminal conversation display.
- `src/lib/services/teacher-review/session-data-audit.ts`: complete event scope and variable-length package completeness.
- `src/components/teacher-review/types.ts`: version-2 completeness field.
- `prisma/student-demo-recovery-smoke-test.ts`: new focused negative/concurrency/recovery/completeness regression cases.
- `prisma/student-package-feedback-recovery-smoke-test.ts`: align synthetic student ownership with the existing catalog policy; no authorization weakening.
- `scripts/student-demo-regression.mjs`: guarded local-only 20-check runner.
- `scripts/classroom-ux-smoke.mjs`: original-URL terminal review checks on desktop and mobile.
- `docs/DEMO_RECOVERY_AUDIT_2026-09-14.md`: this report.

The data-audit output version is now `session-data-completeness-review-v2`. Its old `response_package_evidence_complete_for_initial_three` field is replaced by `response_package_evidence_complete_for_included_items` (`true`, `false`, or `null` for unknown). Historical exported files are not regenerated. Downstream consumers of this audit field should branch on the report version.

## Remaining Limits and Release Checks

- The two historical operationally blocked profiling calls did not persist their exact guard reasons. This work improves future diagnosis; it does not establish or fix their unknown original trigger. Do not describe those profiles as successful live LLM profiles.
- No further live demo calls were made. Live tutor latency and classroom-scale capacity remain unverified; a focused authorized test should measure both after release checks.
- Local concurrency tests exercise one attempt under contention and existing ownership/start-resume boundaries. They are not a full class-size load test.
- Historical synthetic demo attempts remain untouched and must be excluded from substantive classroom/research analyses. No fabricated events or profile evidence were backfilled.
- Read-only presentation prevents use of inconsistent historical child records; it does not repair the raw historical rows. Any historical correction needs a separately reviewed, auditable operation.
- Pedagogy, answer-key/privacy protection, grading logic, prompts, database schema, and frozen live-evaluation artifacts were not changed. Operational write boundaries did change, so current-source runtime/provenance and authorization compatibility must be rechecked before deployment; this report does not assert unchanged frozen identities.
- No commit, push, Render access, configuration edit, approval, or activation was performed. Preexisting untracked `outputs/` content was preserved.
