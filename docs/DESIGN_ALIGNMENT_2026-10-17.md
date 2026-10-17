# Design alignment with the dissertation: change record (2026-10-17)

**Status:** applied to the local working copy only. These changes have not been
committed, pushed or deployed (see "Release status").

**Context:** the 16 Oct 2026 testing pass
(`outputs/claude-audit-2026-10-16/Test_Report.html`) compared the dissertation's
working draft (Sections 3.1, 3.2.1, Appendices A–B) with the code. The researcher
then decided how each discrepancy should be resolved. Each decision is recorded here
with what changed, why, and how it affects the system, so that later contributors
(human or AI) do not need to rebuild the history.

**Code base:** branch `codex/luna-medium-profile-fix` at `a5c86a1`, plus the
uncommitted V41 conversation-repair work described in
`docs/release-records/handover-2026-10-15.md`. The changes below are layered on that
working copy. In `runtime.ts`, the one file both pieces of work touch, the edit is
limited to one `try/catch`.

## Decisions

| ID | Decision (researcher, 16–17 Oct 2026) | Source of the problem |
| --- | --- | --- |
| D1 | One topic per mini-test; students open each mini-test individually, with no automatic progression | Audit F5/F8: multi-topic attempts dead-ended after topic 1, and feedback was released per topic |
| D2 | "Students may end the conversation at any point" | Audit F4: ending was blocked while a tutor reply was pending or failed |
| D3 | "Profiles retain uncertainty"; profiles inform instructors and are not shown to students | Audit F3/F9 and the 16 Oct direction |
| D4 | Response time starts when the item first appears on screen | Audit F11 |
| D5 | Skipping is removed from the design | Audit F2; the dissertation text will change |
| D6 | Group AI roles by the dissertation's five modules, with module-level model settings; Appendix A to report the deployed configuration | Audit discrepancy (18 roles vs 5 modules) |
| D7 | Research pseudonymization must use a secret key in every deployed environment | Audit F7 |
| D8 | Add the instructor reporting module: an LLM reviews all students' response packages and conversation transcripts for a mini-test and writes an instructor report | Dissertation §3.1.5; the reporting module previously used no LLM |
| D9 | Five model configurations, one per module, with models chosen for accuracy, cost and response time (second pass, 17 Oct 01:27) | Researcher request: "five LLMs instead of 18" |
| D10 | Students must type their written explanations; pasting is blocked in those fields (17 Oct 01:40) | Researcher request |
| D11 | One active browser tab per attempt: opening the attempt in a new tab, window or browser makes older tabs read-only (17 Oct 02:15) | Researcher request; closes F-A3a |
| — | Recommend 3–5 items (system still accepts 3–12); three attempts per mini-test; 30 student turns per mini-test; multi-course support before the 2027 evaluation | Documentation only |

## Changes, rationale and effects

### D1 One topic per mini-test

- **Changed:**
  - `src/lib/services/assessment-availability/availability.ts`: new `MAX_PUBLISHED_TOPICS_PER_MINI_TEST = 1`. `assessmentHasValidPublishedContent` now requires exactly one published topic with 3–12 items.
  - `src/lib/services/content/publishing.ts`: `publishAssessment` and `publishConceptUnit` refuse a second non-archived topic, returning `publish_validation_failed` with `details.reason = "assessment_multiple_topics_unsupported"`.
  - `src/lib/services/student-assessment/formative-conversation/projection.ts`: conversation lookups are ordered by `started_at desc`, so legacy multi-topic attempts resolve deterministically.
- **Why:** with several topics, the runtime submitted, revealed and discussed topic 1 and then had no route to topic 2. Finishing required every topic to be closed, so students were stranded. Feedback was also released before the whole mini-test was answered, contrary to §3.1.2.
- **Effect:**
  - Feedback, profiling and the conversation now follow submission of the whole mini-test, and the 30-turn limit applies per mini-test.
  - An already-published multi-topic mini-test is shown as unavailable ("invalid content") for **new** attempts. Existing attempts and records are untouched, and exports still include them.
  - Teachers can still create additional topics in a draft, but cannot publish them in the same mini-test.
- **Action for the instructor:** find affected mini-tests and split each extra topic into its own mini-test:
  ```sql
  SELECT a.assessment_public_id, a.title, count(*) FROM concept_units c
  JOIN assessments a ON a.id = c.assessment_db_id
  WHERE c.status = 'published' AND a.status = 'published'
  GROUP BY 1, 2 HAVING count(*) > 1;
  ```

### D2 Students may end the conversation at any point

- **Changed:**
  - `projection.ts`:
    - `can_end` is true whenever the attempt is active and the conversation is active or paused.
    - `end` no longer throws "The tutor response is not ready". It records how many messages were unanswered in a new process event `formative_conversation_ended_by_student` (added to `src/lib/domain/enums.ts`).
  - `finish-assessment.ts`: a conversation closed by the student (`lifecycle_reason = "student_ended_conversation"`) satisfies the Finish rule even if the opening or a reply was pending or failed. Platform-failure closures still require completed replies.
  - `runtime.ts`: if the student ends while the final (30th) reply is being saved, the turn-limit closure no longer raises a 500. The explicit stop is kept, matching the existing replay path.
  - `src/components/student-assessment/assessment-session-client.tsx`:
    - The waiting indicator shows an End control.
    - The end confirmation works while a message is in flight.
    - A send that completes after the stop no longer restores the "active" view, and no longer shows a retry prompt.
- **Why:** §3.1.4 and Appendix B. Stopping is a participation decision and must be honoured. `AGENTS.md` treats disregarding an explicit stop as a release blocker.
- **Effect:** a stuck or failed tutor reply can no longer trap a student. Unanswered messages remain stored. A reply that finishes after the stop is not shown, because saving it requires an active conversation. The runtime records that receipt as a persistence failure.
- **Not changed:** there is still no sweeper that converts a reply stuck in `pending` into `failed`, so the Retry button does not appear for it. With D2 the student can always end instead. See follow-ups.

### D3 Profiles retain uncertainty and stay instructor-facing

- **Changed:**
  - `src/lib/services/student-assessment/service.ts`: `learning_profile` in the student session state is always `null` (`STUDENT_LEARNING_PROFILE_VISIBLE = false`). The UI never rendered it, and students keep the answer review and tailored feedback.
  - `src/lib/services/student-assessment/profile-record.ts`:
    - A profile counts as a technical fallback when its caution text says so **or** when its `student_profiling_agent` source call did not succeed. Detection previously depended on the caution wording alone.
    - Provenance now includes `profile_source_provider` (`openai` or `mock`), exported as a research column with a data-dictionary definition.
  - `src/lib/services/student-assessment/formative-profile.ts`: when there is no evidence bundle, the intermediate planning profile records `insufficient_process_evidence`, `limited` evidence and `low` confidence. It previously asserted adequate engagement, adequate evidence and medium confidence.
- **Why:** §3.1.3 requires profiles to keep uncertainty when evidence is incomplete, and the researcher decided profiles need not be shown to students.
- **Effect:**
  - Dashboard and exports distinguish fallback profiles reliably.
  - Mock-generated profiles can be filtered by provider.
  - Students see no profile labels.
  - Existing stored profiles are not rewritten.

### D4 Response time starts at item presentation

- **Changed:**
  - `service.ts` (`getOrCreateItemResponse`): `item_started_at` is the earliest `item_presented` or `transfer_item_presented` event for that item in the attempt. It falls back to the current time if no event exists.
  - The data dictionary (`dictionary.ts`) states the change date.
- **Why:** the researcher's decision; `DATA_LOGGING_SPEC.md` already described item time as starting at presentation.
- **Effect:**
  - `item_response_time_ms`, `total_item_time_ms` and `response_time_answer_ms` now include reading time.
  - **Records created before this change start at the student's first answer action.** Do not pool the two without noting the change date.
  - The presentation event is logged by the server in the same response that renders the item.

### D5 No skipping

- **Changed:**
  - `service.ts` (`submitItemResponse`): requests with `skip_item`, `skip_reasoning`, `skip_confidence` or `confirm_skip` are rejected (400, `reason: skipping_not_supported`). This closes an API-only path where a crafted request could erase a recorded answer.
  - The topic-submission error no longer mentions "explicit skip".
- **Why:** the researcher removed skipping from the design. Students use "E · I don't know yet", a brief or uncertain reason, and "No" for the alternative.
- **Effect:**
  - No student-visible change.
  - The `skipped_*` columns remain in the schema and exports and are always false.
  - Suggested dissertation wording is in `docs/DISSERTATION_TEXT_UPDATES_2026-10-17.md`.

### D6 AI roles grouped into the five modules

- **Changed:**
  - New `src/lib/llm/assessment-modules.ts` maps every role to a module, with a usage status (current, conditional, retained).
  - `src/lib/llm/config.ts`: each role's model sources are now its own variable, then its module's variable (`OPENAI_MODEL_MODULE_*`, `OPENAI_REASONING_EFFORT_MODULE_*`), then the older cross-role fallbacks.
  - `src/lib/env.ts` and `.env.example` declare the new variables.
  - New `docs/AI_ROLES_AND_MODULES.md` explains the mapping.
- **Why:** the dissertation describes five LLM-supported modules. The code has 18 bounded tasks, which stay separate because each has its own validator.
- **Effect:**
  - With none of the new variables set, model resolution is unchanged.
  - An active operational approval bundle still overrides environment settings.
  - When a bundle is active, module variables are ignored for the bundle's roles (the approval check compares only role variables with the bundle). The "Models by module" status table (D9) shows the bundle's assignments by module.
  - Some roles allow only certain model families (for example, the conversation role does not accept `gpt-5.6-terra`). If a module model is not allowed for a role, that role reports `model_not_allowed_for_agent` and needs a role-specific value.

### D7 Pseudonymization key required when deployed

- **Changed:**
  - `src/lib/services/teacher-research-data/pseudonymization.ts`: the in-source test key is used only when `APP_ENV` is unset, `local`, `development` or `test`. Any other value, including the Render service's `staging`, requires `RESEARCH_PSEUDONYMIZATION_KEY` (at least 16 characters).
  - `render.yaml` declares the key, and the instructor-report model variables, as `sync: false`.
- **Why:** without a key, research IDs could be recomputed from the public repository (audit F7, demonstrated).
- **Effect and action:**
  - On 17 Oct the key was found to be **already set on Render**, so live exports already use a secret key and research IDs do not change with this release. Without a key, a deployed export would now stop with a clear error instead of falling back to the public test key.
  - Check an earlier export's metadata: fingerprint `24ed8c05daf5` means it used the public test key (for example, exports made before the key was added).

### D8 Instructor reporting module

- **Added:**
  - `src/lib/services/instructor-report/`:
    - `contract.ts`: prompt, output schema, limits.
    - `evidence.ts`: builds the input from the database.
    - `validate.ts`: evidence checks.
    - `service.ts`: generation, storage, status.
  - Route `GET/POST /api/teacher/assessments/[assessmentPublicId]/instructor-report`.
  - Dashboard tab **Instructor report** (`instructor-report-panel.tsx`).
- **Behaviour:**
  - **Input.** For the teacher's own mini-test, each eligible student's latest attempt with a sealed initial response package, using the same rule as the dashboard results, plus that attempt's conversation transcript.
  - **Labels.** Students appear only as S1…Sn and items as Q1…Qn. Names, account IDs and item IDs are not sent to the model. The label-to-record index stays on the server.
  - **Size limits.** At most 120 students, 1,200 characters per answer text, and 60 conversation messages per student. Truncation is reported in the report's limitations.
  - **Output.** Overview, participation, at most 8 findings with category, student count, evidence strength, verbatim evidence quotes and an interpretation caution, plus item notes, a conversation summary, suggested actions and limitations.
  - **Validation before saving.** Every quote must appear in the cited student's own justification, alternative reasoning or conversation turns; quoting tutor text is rejected. Student and item labels must exist, and `student_count` must cover the cited students and not exceed the cohort. A failed check triggers one retry that is told the problems; otherwise nothing is saved and earlier reports are unchanged.
  - **Storage.** Reports are `agent_calls` rows (`agent_name = instructor_report_agent`, key prefix `instructor-report:<assessment>:`), with the exact input, the label index and the validated output. No database migration is needed.
  - **Controls.**
    - One generation at a time per mini-test, enforced by an advisory lock.
    - At most 10 AI reports per mini-test per UTC day.
    - Report calls are excluded from the students' daily class budget (`usage-accounting.ts`), so teacher reports cannot block students' tutor calls.
  - **Configuration.** `OPENAI_MODEL_INSTRUCTOR_REPORT` (or `OPENAI_MODEL_MODULE_INSTRUCTOR_REPORTING`), with optional reasoning and token variables. With `LLM_PROVIDER=mock`, a deterministic summary clearly labelled "Local test summary — not AI-generated" is produced.
  - **Instructor view.** Each quote links to the student's attempt page, so every claim can be checked against the record (§3.1.5).
- **Not yet validated:** report quality with a live model. This is a new prompt; review a few real reports before relying on them.

## Second pass (17 Oct 2026, after 01:27): D9, D10 and the follow-ups

### D9 Five model configurations, one per module

- **Changed:**
  - `src/lib/llm/assessment-modules.ts`: `MODULE_MODEL_POLICY` records the selected model and reasoning effort for each module, with the rationale and evidence. `moduleModelPolicyStatus()` reports, per module, whether its current-workflow roles share one configuration and whether it matches the selection.
  - `src/lib/llm/config.ts`: without an approval bundle, the module variable (`OPENAI_MODEL_MODULE_*`) is resolved first; a role-specific variable applies only when its module variable is empty (`liveModelRoleResolutionSources`). The listed order returned by `liveModelRoleEnvSources` keeps each role's own variable first, because approval verification reads entry [0] (a regression run caught this). Token limits stay role-specific. The reasoning effort comes from the same source as the model: with `OPENAI_MODEL_MODULE_X` set, set `OPENAI_REASONING_EFFORT_MODULE_X` too, or the provider default applies. Under an active approval bundle, module variables are ignored and only role variables are checked against the bundle.
  - `src/lib/services/instructor-report/service.ts`: the same module-first order; the provider timeout rises from 180 s to 300 s, because GPT-6.1 Sol streams about 50 tokens/s and a full 12,000-token report needs about 4 minutes. Generation runs inside the request, so a worst case (two attempts) takes up to about 10 minutes; check that Render's request timeout allows this, or move generation to the background worker (follow-up F-D8a).
  - `src/lib/llm/readiness.ts` and `src/app/teacher/system/llm/page.tsx`: a "Models by module" table on the teacher LLM status page.
  - `.env.example`: the selected configuration is listed.
- **Selection:** Luna medium for item preparation, item administration, and profiling and feedback; GPT-6.1 Sol medium for the formative conversation and instructor reporting. Modules 1–4 match the configuration verified live in CMCQ-20261013-03, so the approval bundle does not change. Reasons and candidates for later evaluation are in `AI_ROLES_AND_MODULES.md`.
- **Why not five prompts:** each of the 18 roles has its own output schema and validator; merging them would remove checks and invalidate the evaluation evidence. The roles stay; the models are five.
- **Effect:** nothing changes on Render while the approval bundle is active, because the bundle already assigns these models. The status page shows any module whose roles disagree.

### D10 Typed written explanations

- **Changed:** `src/components/student-assessment/assessment-session-client.tsx` blocks paste and drop in the justification and tempting-option explanation fields, including both edit panels, and shows "Pasting is turned off here. Please type your explanation in your own words." `process-events.ts` adds `paste_blocked: true` to the existing `paste_detected` event (allowed in `process-event-delivery.ts`). `engagement-evidence.ts` ignores blocked pastes when reconstructing typing time, because no text was inserted.
- **Not changed:** the optional learning conversation still accepts pasted text, and external GenAI use is not otherwise restricted.
- **Limits:** this is a browser control. Browser extensions, speech-to-text or retyping can still enter outside text; the event record shows attempts, not intent.
- **Data:** `paste_blocked` is stored in the raw event payload. The analysis-ready export does not yet have a column for it (adding one changes the export schema and its tests); use the raw process-event payload.

### Follow-ups resolved

- **F-D2a (stuck replies):** `projection.ts` marks a tutor reply failed when it has been `pending` or `retrying` for more than 15 minutes with no reply saved (longer than the longest legitimate generation). The guarded update leaves a reply untouched if it completed meanwhile. Retry then appears through the existing claim.
- **F-D3a (engagement):** the intermediate planning profile now records `insufficient_process_evidence` in both cases. The evidence-integrated bundle has no engagement field and its validator forbids process inferences, so "adequate engagement" was unsupported.
- **F-D3b (fallback profiles): decided, no regeneration.** A fallback is recorded when profiling fails at submission, and the conversation then opens on that baseline. Replacing the baseline later would change the record the tutor used. The profile is clearly marked as a fallback, the existing empty-conversation repair path still applies, and the instructor report reads students' raw responses, so instructors are not left without information.
- **F-D1a (draft topics):** `concept-units.ts` (`assertTopicCapacity`) refuses a second non-archived topic when one is created, and `import-json.ts` checks before importing (`validation_failed`, 422, `reason: assessment_multiple_topics_unsupported`). The standard flow never offered "Add topic"; this closes the direct page and API routes. Importing JSON into an existing mini test that already has its (possibly empty) primary topic is therefore refused; the import page creates a new mini test, so only direct API use is affected. `content-smoke-test.ts` and `teacher-mcq-item-builder-smoke-test.ts` now give each extra topic its own mini test; the publish-time refusal is still tested on simulated legacy data.
- **F-A3 (edit races):** package-review and in-flow edits now take the session row lock (the one sealing takes) and refuse an edit once the package is sealed; in normal use the phase checks already refuse such edits, so this is a backstop. Of two simultaneous saves of the same response, the second is refused (409) instead of silently overwriting. An old browser tab that saves later is **not** detected, because the client does not yet send the version it edited (follow-up F-A3a). Sealing in `completeInitialConceptUnitAdministration` runs under the same lock (30 s transaction timeout). The unused `initial/messages` route is retired (410), and `e2e-production-like.ts` no longer calls it.
- **F-A4:** the default draft item count is 4 (was 6), and the hint reads "3-5 items per mini-test are recommended; 3-12 are allowed."
- **F-A2 (missingness and evidence links): closed by design.** With skipping removed, a submitted package has no missing-response categories. Non-submission appears in participation counts, and the instructor report links each finding to the students' records.
- **Retired tests:** `concept-progression-smoke-test.ts`, `classroom-nonintervention-smoke-test.ts` and `student-progression-ui-smoke-test.ts` exit with "RETIRED" unless `RUN_RETIRED_MULTI_TOPIC_TESTS=1`. `assessment-completion-smoke-test.ts` uses one topic and stays active. `e2e-production-like.ts` still builds a three-topic fixture; converting it needs a local run (listed below).

### Second-pass verification (17 Oct)

- `npm run test:design-alignment`: **25/25 passed** (19 earlier plus D9, D10, F-D2a, F-D1a, F-A3 and F-A4 checks).
- Typecheck with the same harness: no new errors in application code or in the changed tests. The only new messages are stub-related Playwright type errors in `e2e-production-like.ts`, which the earlier run did not include.
- The 351 database-free scripts: **154 passed**, against 153 before. The only change is the retired `student-progression-ui-smoke-test.ts`, which now exits as retired. One regression found in an intermediate run (`operational-full-gpt56-v2-candidate-smoke-test.ts`, caused by reordering the listed env sources) was fixed before the files were written back.
- An independent review of the second-pass diff found two smoke tests that would break under F-D1a and an overstated stale-tab claim. Both are fixed, together with the smaller points (seal transaction timeout, report-timeout and reasoning-effort notes).
- Not run here, as before: database smoke tests, lint, build, browser checks and live-model reports.

## Third pass (17 Oct 2026, after 02:15): D11, the e2e test, the retired route and research-data fixes

### D11 One active tab per attempt

- **Changed:**
  - `src/lib/services/student-assessment/attempt-tab.ts` (new): each time an attempt page opens, it claims the attempt for that browser tab, recorded as an `attempt_tab_claimed` process event.
  - `src/app/api/student/sessions/[sessionPublicId]/tab-claim/route.ts` (new): POST claims; GET reports whether this tab still holds the attempt.
  - `requireStudent()` (`src/lib/services/student-assessment/api.ts`) refuses a saving request whose `x-cmcq-attempt-tab` header names a tab that is no longer the latest claimant (409 `attempt_open_elsewhere`). Requests without the header (scripts, tests, older pages) are not checked; process-event delivery does not send it, so an old tab's telemetry is still recorded.
  - `src/components/student-assessment/api.ts`: saving requests for the open attempt carry the header and wait for the tab's own claim, so a reload never races itself.
  - `assessment-session-client.tsx`: the attempt page claims on open, checks again whenever the tab becomes visible, and shows "This attempt is open somewhere else" with **Use this tab** (claims and reloads) or **Back to my assessments**.
- **Why:** an old tab saving later could overwrite newer work (F-A3a). The researcher chose to invalidate older tabs.
- **Effect:** saved work is never lost; the old tab simply cannot save. Each claim is exported as `sessions.attempt_tab_claim_count`, which documents reloads and multi-tab use.
- **Limits:** a save waits at most 4 seconds for its own tab's claim. The header can be left off by a deliberate script, so this prevents accidental overwrites from an old tab, not a determined bypass. An old tab's conversation lifecycle notices (left, re-entered) are refused once it is superseded; its page-visibility telemetry is still recorded.

### Retired route without the deep file

`src/middleware.ts` (new) answers `/api/student/sessions/:id/initial/messages` with 410 before the route handler runs. This replaces the earlier route-file edit, which could not be written to the researcher's folder; that route file is back to its original content. The handler itself still contains the old write, so the middleware is the only barrier: keep its matcher (the unit check asserts it), and when convenient replace the route file with a 410-only handler for defence in depth. The `docs/release-records/manual-copy/` folder is no longer needed.

### e2e production-like test converted to one topic

`prisma/e2e-production-like.ts` builds a single-topic mini test with 4 items (was 3 topics, 12 items). Every simulated journey completes the topic and finishes the mini test; `fullCompletion` no longer changes the path. It still exercises the earlier follow-up phases, so run it locally to confirm it matches the current conversation flow.

### Research-data fixes (see `docs/RESEARCH_DATA_REVIEW_2026-10-17.md`)

- **R1 Attempt provenance:** `session-state.ts` stamps `application_git_commit` and `data_collection_rules_version` (`data-collection-rules-2026-10-17`) in the `session_started` event. The export adds `collecting_application_git_commit`, `data_collection_rules_version` and `attempt_tab_claim_count` to `sessions.csv`. The dictionary ties the D4 timing change to that version instead of a date.
- **R2 Clearer flags:** `item_responses.csv` adds `final_idk_selected`, `ever_idk_selected` and `ai_flagged_insufficient_knowledge`; `process_events.csv` adds `payload_paste_blocked` (closes F-D10a).
- **R3 Researcher-only AI audit:** `src/lib/services/teacher-research-data/ai-call-audit-export.ts` (new). Restricted research exports add `ai_call_audit.csv`: every model call per attempt plus instructor reports, with inputs, raw output (including rejected drafts), validated output, model, effort, prompt version and hash, status and validation error. They also add `ai_call_audit_data_dictionary.csv`. Default exports never include these files, and students never see them.
- **R4 Evidence stage:** `sessions.csv` adds `initial_package_sealed`, `feedback_shown`, `conversation_started`, `conversation_student_message_count`, `finish_chosen` and `evidence_stage`. Early pilot attempts often never reached "completed" because of defects that were fixed later.
- **Local checks:** `scripts/local/run-local-checks.ps1` (new) runs every local check and saves logs in `local-check-results/`; see `docs/LOCAL_CHECKS_GUIDE.md`.
- Consent is collected with Google Forms (researcher decision) and applied as an analysis filter; the remaining open research-data items are listed in the review.

## Verification

All checks ran in an isolated cloud workspace without the app's full dependency set.
The npm registry and Prisma engine downloads were blocked, and no shell could be
started on the researcher's computer. Methods:

1. **Typecheck.** TypeScript 6.0 run against the real generated Prisma client types
   (copied from the local install; they match the schema exactly) and React types,
   with Next.js, OpenAI and other packages stubbed. The baseline before the changes
   had 110 errors, all caused by the stubs. **After the changes: the same 110 errors
   and no new ones**, including in the seven updated or new test files.
2. **New unit checks:** `prisma/design-alignment-unit-test.ts`
   (`npm run test:design-alignment`). **19/19 passed.** They cover the D1 content rule, D2
   finish rules, D3 provenance and dictionary, D6 module mapping and resolution order,
   D7 key policy, and D8 evidence validation and the local summary.
3. **Existing database-free scripts.** 351 candidate scripts under `prisma/` were run
   on both the original and the changed code, with identical tooling. **153 passed and
   198 failed on both, with identical per-script outcomes, so the changes introduced no
   regressions.** All 198 failures are environmental and occur identically before the
   change: no Prisma query engine for Linux, missing packages such as SheetJS
   `cpexcel`, `mammoth` and `esbuild`, and stubbed OpenAI schema helpers, which
   explain the assertion failures in the V41 request-schema scripts (for example
   `luna-conversation-repair-approval`). The passing set includes
   `formative-conversation-finish-limit`, `formative-conversation-continuity`,
   `learning-profile-summary`, `student-data-dictionary-pseudonymization` and
   `student-research-export-readiness`.
4. **Independent code review** of the diff by a separate reviewer. Must-fix findings
   were addressed: the late final-reply 500 after a stop, module-source ordering and
   token limits, the report budget and concurrency, thrown provider errors, and the
   tests asserting old behaviour.
5. **Not run here:**
   - database-backed smoke tests;
   - `npm run lint`;
   - `npm run build`;
   - browser workflows;
   - live-model report quality.

   These need the local Windows environment (see "How to verify locally").

### Existing tests updated to the new behaviour

- `prisma/feedback-display-completion-smoke-test.ts`: ending with a failed reply now succeeds and records the unanswered count. Finish after a student stop is allowed, and a platform-failure closure still blocks it.
- `prisma/content-smoke-test.ts`: publishing a second topic in the same mini-test is refused.
- `prisma/student-response-quality-smoke-test.ts`, `prisma/student-script-review-smoke-test.ts`, `prisma/student-formative-evaluation-smoke-test.ts`, `prisma/student-formative-live-validation-smoke-test.ts`: student state must not expose `learning_profile`.

### Tests that exercise retired multi-topic progression (expected to fail after D1)

These start attempts on synthetic multi-topic mini-tests: `concept-progression-smoke-test.ts`,
`assessment-completion-smoke-test.ts`, `classroom-nonintervention-smoke-test.ts` and
`student-progression-ui-smoke-test.ts` (all through `concept-progression-smoke-helpers.ts`),
and `e2e-production-like.ts` when run with `conceptCount > 1`. Retire them or convert
them to single-topic fixtures. Their original results remain in the history.

## How to verify locally (Windows workspace)

```powershell
npm run typecheck
npm run lint
npm run test:design-alignment
npx tsx prisma/feedback-display-completion-smoke-test.ts
npx tsx prisma/content-smoke-test.ts
npx tsx prisma/student-response-quality-smoke-test.ts
npx tsx prisma/profile-record-projection-smoke-test.ts
npx tsx prisma/teacher-dashboard-smoke-test.ts
npm run build
```

Then, with `LLM_PROVIDER=mock` against the local synthetic database, check the following:

1. Publish a one-topic mini-test, and confirm that adding a second topic is refused at publish.
2. Complete an attempt, start the conversation, and end it while a reply is pending: there should be no block, and Finish should work.
3. Open **Dashboard → Instructor report → Generate report**. It should show the labelled local test summary.

## Release status

- Not committed, pushed or deployed. The earlier session could only read the GitHub repository, and its shell on the researcher's computer was unavailable.
- Per `AGENTS.md`, release only after the local checks above pass. Then commit the scoped changes, push, verify the exact commit is Live on Render, and append a release entry to `docs/release-records/releases.json` and the Word record.
- `RESEARCH_PSEUDONYMIZATION_KEY` **already exists on Render** (checked 17 Oct: Render refused a duplicate key). Live exports already use it, so research IDs do not change. Confirm it is at least 16 characters.
- Before using D8 live, add `OPENAI_MODEL_INSTRUCTOR_REPORT=gpt-6.1-sol` and `OPENAI_REASONING_EFFORT_INSTRUCTOR_REPORT=medium` on Render ("Save only"). Review a few reports before relying on them.
- Five changed files are in the approval bundle's recorded source inventory: `config.ts`, `finish-assessment.ts`, `runtime.ts`, `formative-profile.ts` and `profile-record.ts`. No model, prompt or effort changed. The post-deploy check that compares deployed source hashes will still report them, so record the change in the release entry as the approval process requires.
- The V41 conversation-repair candidate in the same working copy has its own release prerequisites (`handover-2026-10-15.md`). In particular, its prompt version v7.25 needs a matching approved configuration. Release the two pieces of work separately if needed.

## Follow-ups (still open)

| ID | Item | Why open |
| --- | --- | --- |
| F-A1 | Teacher routes are not scoped by owner (audit F6) | Deferred by the researcher to the multi-course work before 2027 |
| R-M3 | Attribute typing and paste events to the field typed in | Client event change; only matters if process data support claims |
| R-H2 | Monitor conversation participation after each class | Researcher decision (17 Oct): keep free-text chat and explanatory, accessible tutor messages; no suggested replies or length limits |
| F-D9a | Evaluate `gpt-6-luna` for modules 1–3 and GPT-6.1 Sol for item preparation | Needs the seven-case review and a new approval record |

Resolved in the third pass: F-A3a (D11), F-E1, F-D10a. F-D8a closed by decision: instructors generate the report manually after most students finish, so a several-minute wait is acceptable.

Resolved in the second pass: F-D2a, F-D3a, F-D3b (decision), F-D1a, F-D6a (Appendix A text in `DISSERTATION_TEXT_UPDATES_2026-10-17.md`), F-A2, F-A3, F-A4.
