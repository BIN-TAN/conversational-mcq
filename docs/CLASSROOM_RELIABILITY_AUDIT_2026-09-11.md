# Classroom Reliability Audit - 2026-09-11

## Scope and disposition

Base commit: `aabf15118d526f52dd333e35a8eb22742b62eb31`.

This is a local engineering audit and correction set, not a live evaluation,
deployment approval, psychometric validation, or guarantee that all defects
have been found. The review followed student requests through persistence,
teacher authoring/account administration, and research projections/exports.
It did not inspect every historical evaluation file line by line.

Only synthetic records in a disposable local PostgreSQL database were used.
No Render service, classroom database, provider endpoint, or model-auth endpoint
was accessed. No real dispatch checkpoint was created. Nothing was committed,
pushed, deployed, approved, or activated.

The corrections below pass the current no-provider suite. The outstanding
failure-recovery risks listed separately mean this is not an unconditional
classroom-readiness certification.

## Findings corrected

| Priority | Finding and impact | Correction and verification |
| --- | --- | --- |
| P1 | Distinct messages from two tabs could both be reserved while a tutor response was unresolved, mixing the next response context. | Under the existing conversation row lock, recheck same-message replay and reject another unresolved student message. Exact replay remains accepted; failed responses must be retried instead of bypassed. Parallel-message and replay tests pass. |
| P1 | A stale resume could change an already-ended conversation back to active. | Compare-and-set the prior lifecycle status at the database write. Injected competing end remains terminal and does not acquire a false resumed event. |
| P1 | Lifecycle state and its research event were separate commits. An event failure left unaudited state changes. | Store the status change and lifecycle event in one transaction. Injected event failure rolls back both. |
| P1 | A teacher save checked a version, reread a newer version, then used that newer value to overwrite a concurrent edit. | Use the version from the validated design read for the final optimistic write. Injected newer edits survive; stale saves fail. |
| P1 | A delayed design or assistant save could update content after its earlier draft check became stale. | The write also requires a draft assessment with no student sessions. A publication inserted between validation and save blocks the save. This is not proof that every possible publication/start interleaving is serialized. |
| P1 | Invalid events later in a telemetry batch could leave the valid prefix committed. Retrying the batch could duplicate research events. | Make the entire bounded batch atomic. Injected invalid display metadata leaves no committed prefix. |
| P1 | Concurrent display acknowledgements could pass the same existence check and both be recorded. | Lock the assessment session during acknowledgement deduplication and recording. Eight parallel acknowledgements produce one accepted event. |
| P1 | Unknown/foreign event topics could fall back to the current topic; delayed item events could be associated with the wrong topic. | Resolve explicit item/topic identity within the owned session and assessment. Reject invalid references rather than silently relabeling them. Valid original-context events retain their item/topic linkage. |
| P1 | Deactivating a student silently removed existing responses from research and summary CSV exports. | Remove active-account-only filters from export selection, not authentication. Historical evidence remains exportable; an unrelated teacher's records remain excluded in the regression. |
| P1 | The normalized research ZIP read primary and supplemental evidence at different database moments. | Load both in one bounded repeatable-read transaction, then serialize outside it. A concurrent supplemental insert appears in the next export, not half of the current export. |
| P1, conditional privacy exposure | Unexpected export errors could return raw infrastructure error text to the browser or job options. | Use a generic safe failure message for unexpected errors. Typed content errors remain actionable. Existing export error-UI checks pass; no real-secret failure was injected. |

These fixes change persistence/request behavior. They do not change teaching
prompts, answer keys, profile meanings, transition criteria, database schema,
CSV schema, or historical frozen candidate/evaluation artifacts.

## Verification

- All 61 committed migrations applied successfully to the disposable local database.
- `npm run classroom:audit`: 37/37 scripts passed.
- The new `prisma/classroom-data-integrity-smoke-test.ts`: 14 deterministic checks,
  including 30 concurrent synthetic students keeping separate saved messages.
- The new reproductions initially exposed six failures in seven baseline checks;
  later checks added rollback, snapshot, publication, and parallel-load coverage.
- `npm run typecheck`: passed, including the final test additions.
- `npm run lint`: passed with five pre-existing unused-variable warnings in
  historical V18 evaluation/materializer files; no errors.
- `npm run build`: passed on the final source, separately from test servers,
  using a fresh generated cache and an 8 GB Node heap.
- `git diff --check`: passed.

The suite includes student start/resume conflicts, attempt lifecycle, package
review edits, package-feedback recovery, variable item counts, timing and process
logging, account deactivation/auth isolation, teacher account HTTP endpoints,
batch cleanup, content revisions, item design/uploads, current V18R2 conversation
contracts/pipeline/lifecycle, transition provenance, research integrity,
pseudonymization, readable transcripts, and selected-session/bulk exports.

Tests use a real local database where relevant, deterministic substitutes for
model outputs, and some source-contract assertions. Thirty concurrent message
reservations are not thirty full browser/provider conversations and do not
establish a production latency or throughput SLA.

### Known historical test failure

`prisma/student-formative-conversation-runtime-smoke-test.ts` still expects
`formative-conversation-host-v5.3`. Its compatibility runner uses v5.4, and its
old fixtures lack the canonical claim catalog now required by the transition
contract. Changing only the assertion exposes that second mismatch. The
historical file and its validators were left unchanged, not weakened to obtain
a green result. The audit runner reports this exclusion explicitly and runs
current V18R2 pipeline/lifecycle tests instead. Thus 37/37 is the selected
current-runtime suite, not a claim that every repository test passes.

### Build isolation

Do not run the suite and `npm run build` concurrently in the same checkout.
The existing teacher-account HTTP test starts `next dev`, which writes `.next`.
An overlapping audit build compiled successfully but failed page collection
after that generated cache was overwritten. The final build is run separately
with a fresh cache and an 8 GB Node heap. The initial sandbox socket restriction
was also a test-environment limitation, not an application compile defect.

## Remaining risks and unverified failure modes

1. **P1 recovery risk: interrupted provider work.** The formative runtime treats
   an existing `AgentCall` with `call_status=started` as still running
   (`formative-conversation/runtime.ts`, `executeOrResumeAgentCall`). Item-design
   generation uses a similar guard. A process killed after reserving a call can
   therefore leave it pending without a worker that will complete it. Ordinary
   caught provider failures have retry handling; process death is different.
   Do not solve this by blindly retrying ambiguous calls. A focused correction
   needs persisted completion reconciliation and stale-worker protection.
   No process-kill/provider canary was executed in this audit.

2. **P1 provenance recovery risk: response visibility precedes final evidence.**
   `persistFormativeConversationAssistantMessage` marks a receipt completed;
   `processFormativeConversationStudentMessage` subsequently writes telemetry
   and profile evidence. Failure or interruption between those operations can
   expose a saved tutor response before final evidence is complete. Same-message
   replay has repair logic, but this audit did not establish automatic repair
   after reload or block every next-message interleaving in that interval.
   The new reservation guard covers unresolved responses, not this entire
   post-response interval. A focused finalization/reconciliation contract is
   needed before claiming atomic end-to-end response completion.

3. **P1 initial-action recovery risk.** The older `withActionIdempotency` helper
   in `student-assessment/service.ts` runs multiple independently committed
   writes and removes the receipt on exceptions. A late logging/projection
   failure is not equivalent to an uncommitted action. Current ordinary/replay
   tests pass, but partial-commit failure injection across all answer/reasoning/
   confidence paths is not covered. Do not claim exactly-once recording for
   every initial-administration action based on the formative reservation fix.

4. **Client disconnection and timing completeness.** Browser event submission
   still has best-effort paths, and pending conversation state does not have a
   general background reconciliation loop after reload. Closed tabs, offline
   devices, or dropped acknowledgements can leave missing timing intervals.
   Missingness must remain explicit; it must not be imputed as student
   disengagement, zero response time, or misconduct.

5. **Scale, deployment, and governance.** Real model latency, rate limits,
   Render instance/database capacity, large-course export memory use, and a
   complete multi-browser classroom exercise were not measured. Only the main
   normalized research ZIP now uses a single database snapshot; separate legacy
   CSV/ZIP formats are not all covered by that guarantee. Current active and
   rollback bundles were not altered. Runtime source changes require the usual
   identity/readiness review before a future deployment; historical live
   approval must not silently be treated as approval of these changes.

6. **Research privacy and validity.** Identifier pseudonymization is preserved,
   but student-authored free text can itself contain identifying information.
   Pseudonymous files are not automatically anonymous. Teacher/researcher role
   policy remains the existing single-course pilot policy, not a new
   multi-tenant authorization architecture. Passing engineering checks does
   not validate LLM judgments, construct measurement, or learning effects.

## Changed-file inventory

- `src/lib/services/student-assessment/formative-conversation/service.ts`
- `src/lib/services/student-assessment/formative-conversation/projection.ts`
- `src/lib/services/student-assessment/formative-conversation/telemetry.ts`
- `src/lib/services/student-assessment/api.ts`
- `src/app/api/student/sessions/[sessionPublicId]/formative-conversation/messages/route.ts`
- `src/lib/services/student-assessment/service.ts`
- `src/lib/services/process-events.ts`
- `src/lib/services/content/item-design.ts`
- `src/lib/services/teacher-research-data/analysis-ready-export.ts`
- `src/lib/services/teacher-simple-csv-export/service.ts`
- `src/lib/services/teacher-detailed-csv-export/service.ts`
- `src/app/api/teacher/research-data/analysis-ready/route.ts`
- `prisma/classroom-data-integrity-smoke-test.ts`
- `scripts/classroom-audit-network-guard.mjs`
- `scripts/classroom-audit.mjs`
- `package.json`
- `docs/CLASSROOM_RELIABILITY_AUDIT_2026-09-11.md`

## Reproduction and cleanup

The audit runner refuses non-loopback databases or database names without the
`conversational_mcq_classroom_audit_` prefix. Use a newly created disposable local
database, apply committed migrations, supply only development/test credentials,
then run `npm run classroom:audit`. It forces mocked LLM configuration and
preloads an external-HTTP guard, including into child test servers. The suite
contains destructive synthetic-fixture cleanup; never point it at classroom data.

Run typecheck, lint, and production build separately after the test servers exit.
Generated `.data` results, build cache, and local logs are not commit inputs.
The disposable database `conversational_mcq_classroom_audit_20260911` was dropped
after verification. Temporary conflicting build caches were removed. No
classroom database was used or changed. Test and build logs remain locally at
`/tmp/conversational-mcq-classroom-audit-tests.log` and
`/tmp/conversational-mcq-classroom-audit-build.log`; they are not commit inputs.

## Subsequent UX Release Verification

The user subsequently authorized the usability revisions and deployment. The
combined local release suite passed 43/43 no-provider scripts (the 37 checks
above plus six affected UI contracts). A separate synthetic browser suite
passed 24 checks, including delayed saves, cancelled navigation, modal focus,
four viewport sizes, export controls, and truthful student waiting notices.
See `docs/UX_USABILITY_REVIEW_2026-09-11.md` for the changes and limitations.
These additional checks do not resolve or waive the interruption, reconciliation,
large-course scale, or research-validity risks listed above. They do not create
new model approval evidence or modify the active/rollback bundles.
