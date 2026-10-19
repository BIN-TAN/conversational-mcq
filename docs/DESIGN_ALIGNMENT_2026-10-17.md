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
| D12 | The understanding category always comes from the profile produced from the submitted mini-test; profile updates recommended during the conversation are stored and reported as a separate variable (19 Oct) | Researcher request: the post-mini-test category and the conversation update must be analysable separately |
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

## Fourth pass (17 Oct 2026, after 03:43): pre-release review

Three independent reviews read the release: the student flow, research-data
accuracy, and deployment readiness. They found one critical problem. Everything
the reviews rated High or Medium was fixed, apart from the items listed under
"Not changed".

### Critical: the working copy cannot be deployed as it is

- **Problem.** The project folder also contains the unreleased V41 tutor-repair work:
  profiling prompt `student-profiling-v10` (approved: v7) and tutor prompt v7.25.
  Live guarded AI compares each prompt with the approved configuration of
  CMCQ-20261013-03.
- **Evidence.** The approval check was run locally with the 13 October approved
  configuration. The full working copy failed (`active_agent_config_mismatch` for
  `student_profiling_agent`, plus three profile-fidelity guards). Deployed, live AI
  would switch itself off for every student while `/api/health` still reported ok.
- **Fix.**
  - Branch `release/design-alignment-2026-10-17` is the live commit `3aaf605` plus
    the 17 October changes only.
  - Two conflicts were resolved in favour of the live versions, keeping the D2
    rules: `finish-assessment.ts` and `runtime.ts`. A V41-only paragraph in
    `ASSESSMENT_FLOW.md` was dropped.
  - On this branch the approval check passes, the typecheck has no new errors,
    and the 36 design-alignment checks and both dictionary audits pass.
  - The branch is delivered as `.data/release-candidate-2026-10-17/design-alignment-2026-10-17.bundle`.
  - Release steps are in `docs/RELEASE_GUIDE_2026-10-17.md`.

### Fixed

| Finding | Fix |
| --- | --- |
| Stale-reply sweep rewrote historical receipts whenever a pilot student reopened an attempt (research H1) | Sweeps only live, active or paused conversations. Keeps an earlier failure category. Logs `formative_reply_marked_interrupted` with the prior status and the time the reply stalled. A sweep failure no longer breaks the student's state load |
| Attempts started before the deploy and continued after it mix two timing rules (research H2) | New `sessions.csv` column `data_collection_rules_changed_during_attempt`. `attempt_tab_claim_count` is blank, not 0, before the rules |
| Blocked pastes still counted as pastes in engagement signals, process features, the summary and the data audit (research M1) | Shared `blocked-paste.ts`. Blocked attempts are counted separately (`paste_blocked_attempt`, `blocked_paste_attempt_count`) |
| New payload fields not exported, and refused saves not logged (research M2) | Exports `payload_unanswered_message_count` and `payload_replaced_other_tab`. New event `attempt_save_refused_other_tab`. Definitions state that reloads count as claims |
| An item's own option E is scored as "I don't know yet" (research M4) | Publishing refuses an option labelled E. The item designer offers at most four options |
| Instructor report included waived attempts; order biased truncation; dropped rows were silent (research M3) | Same waiver rule as the dashboard, a stable order, and a note when rows are dropped. Items cannot change after attempts exist (content lock), so the item text matches what students saw |
| Report quotes such as "the" passed the check (research L6) | A quote needs three words or 12 characters, unless it is the student's whole answer |
| One credential-like phrase in student text would abort the restricted export (research L7) | The AI audit masks credential-like fragments |
| Codebook mislabelled the new events (research L1) | Explicit codebook entries for the four new events |
| Unanswered count included the system opening (research L3) | Excluded |
| A reload whose tab claim was slow or failed showed a false "open elsewhere" dialog and refused a save (student M1) | A refused save re-claims and retries once when this tab's own claim had not landed. Failed claims retry with backoff. The visibility check re-claims instead of reporting another tab |
| Unload events could wait on the claim and be lost (student L1) | Keepalive sends never wait |
| Ending the conversation during a send could re-enable the composer (student L3) | The composer stays busy until the send settles |
| Teacher JSON with a forbidden key made the report fail with an error 500 (deploy M4) | Forbidden keys are dropped before the provider call |
| Two local checks failed on the researcher's computer | The response-quality test now clears a developer's `ALLOW_LOCAL_MOCK_RUNTIME`. The script-review test follows the documented policy that accepts an affective message as limited evidence |
| Local checks on the release branch | `feedback-display-completion` follows the opening-excluded count. `student-response-quality` gives its test students a teacher (catalog rule). Its legacy end-to-end part is skipped by default: it expects prompt wording that no longer exists in the code, a letter reply rewritten as "I don't know the reason yet.", and an affective reply refused, all superseded by the current collection policy. The current behaviour is checked by the added step `13b-item-administration-audit` (`student-item-admin-audit-smoke-test.ts`) |
| Edit refused as "just changed by another save" after the correctness-display acknowledgement (student L2) | In-flow and package-review edits check the student's answer fields and revision count instead of `updated_at` |
| Retired route relied only on the middleware (student L5) | The route handler itself answers 410 (release branch; the working copy's file is beyond the bridge's folder depth) |

### Not changed (reasons)

- **Paste blocking and assistive technology (student M2). Researcher decision (17 Oct):**
  no exception. Written explanations must be typed, for every student. Dictation
  tools that insert text by pasting will not work in those two fields; the
  conversation still accepts pasted text.
- **Tab-claim ordering by server time (student L4).** Fine on a single Render
  instance.
- **Legacy multi-topic attempts cannot finish (student L6; deploy H1).** Before
  deploying, check that every published mini test has one topic (Release guide,
  step 4). Restore an attempt for any student caught in an old multi-topic attempt.
- **Instructor-report call outside the approval bundle (deploy M1).** Recorded as
  an unapproved, teacher-triggered role. It is off until its two Render variables
  are set.
- **`process_event_count` now includes tab-claim events (research L2).**
  Documented here. Filter by `event_category` when comparing with pilot attempts.
- **Evidence-stage caveats (research L5).** `finish_chosen` means the attempt
  status is "completed". `conversation_started` is true once the system opens the
  conversation; use `conversation_student_message_count` for participation.
- **Profile fallback reclassification (research L4).** Historical profiles whose
  profiling call failed are now labelled `fallback` instead of `unverified`. This
  is intended (D3); mention it in the change notes.

### Fourth-pass verification

- Typecheck: no new errors in either tree.
- Design-alignment checks: 36 pass (6 new) in the working copy and on the release
  branch.
- Dictionary semantic and timing audits pass.
- DB-free regression suite: 154 pass in the working copy, the same as before.
  One test caught a raw `console.error`; it now uses the production-safe logger.
- Approval check with the 13 October configuration: the release branch is valid;
  the working copy is invalid (see Critical).
- Not run here: the database tests and the paid simulation, which need the
  researcher's computer (steps in the Release guide).

## Fifth pass (17–18 Oct 2026): live browser test with the paid models

The release branch ran on the researcher's computer against a new local test
database (`cmcq_ai_students_<hex>`), with the approved 13 October models (GPT-5.6
Luna medium; GPT-6.1 Sol medium for the tutor) and the Render usage limits. A test
teacher and test students used the app in a browser. No live site or pilot data was
touched.

### Checked and working

- Teacher: the item design assistant (four items, four options, no fifth choice)
  and publishing one topic.
- Refusals: a second topic (on create, on JSON import, with nothing half-created),
  an item's own option E (`reserved_option_label`), and changes after attempts
  exist (`content_locked_after_student_session`).
- Student, item administration: live classification. An incomplete reason gets one
  neutral clarification. "I'm confused." and "I don't know yet" are accepted.
- Student, other steps:
  - package-review edit;
  - feedback and profiling, with repairs logged and a retry after failure;
  - pause and resume.
- Tutor conversation (Sol): accurate, explanatory and personalized. A reply takes
  about 15–45 s; the opening took 45–107 s after "Finish review".
- D10: paste is blocked in both explanation fields and a notice is shown.
- D11: one active tab. The older tab is refused and `attempt_save_refused_other_tab`
  is logged.
- D2: the student can end while a reply is pending. The late reply is not shown and
  does not reopen the conversation. `payload_unanswered_message_count` = 1.
- Attempt limit: "2 of 3" and then "1 of 3" are shown. After the third attempt there
  is no start button, and the start API answers 409 `assessment_attempt_limit_reached`.
- Review of past attempts is read-only, with no inputs. Saves to a finished attempt
  are refused (409).
- Server-side refusals:
  - skipping an item (400);
  - the retired route (410);
  - a student calling teacher APIs, or another student's attempt (403).
- Instructor report, dashboard and exports:
  - The instructor report generated (about 46 s).
  - The dashboard loaded.
  - The ordinary export has no `ai_call_audit.csv`, no answer key, and no student
    user IDs; students appear only as `rs_` pseudonyms.
  - The restricted export adds only the AI-call audit and its dictionary (pseudonyms only).
  - New attempts carry `data_collection_rules_version` =
    `data-collection-rules-2026-10-17` and
    `data_collection_rules_changed_during_attempt` = false.

### Defects found and fixed

| Defect | Fix |
| --- | --- |
| Real attempts did not record `data_collection_rules_version` or the build (only the unused session-state path did) | The student start path in `service.ts` records both on `session_started` |
| Every instructor report request failed (error 500): `$queryRaw` cannot read the void result of `pg_advisory_xact_lock` | `$executeRaw` |
| The end-conversation control was hidden for the first 10 seconds of a pending reply | Shown from the start |
| Opening a finished attempt's page recorded a new tab claim, inflating `attempt_tab_claim_count` and `replaced_other_tab` | Claims on finished attempts are accepted but not recorded |
| A reply that arrived after the student ended the conversation was recorded as `assistant_response_persistence_failure`, so a student's choice to stop counted as a system failure | New category `conversation_closed_before_reply` (documented in the export dictionary). A paused conversation keeps the old category so its finished reply is reused on resume |

Both new fixes were re-checked live after the update (18 Oct, new test database, all
local checks passing). Reopening the finished attempt and a direct claim request both
returned `attempt_closed` and left `attempt_tab_claim_count` at 1. The reply that
arrived after the student ended the conversation is exported as
`conversation_closed_before_reply`. `collecting_application_git_commit` showed the
built commit. The teacher session pages (overview, conversation, item responses,
transcript, process data, assessment log, advanced records), the dashboard, the
student page, the research data and explorer pages, and the AI settings page loaded
without errors.

### Seen, not changed

- `feedback_shown` was false for some test attempts. Display acknowledgement needs
  the page to be visible on screen, and the test browser was minimized. Real
  students see the page.
- After a clarification, the rejected draft stays in the text box and the current
  question is shown again. This is harmless, and the student can edit.
- `collecting_application_git_commit` showed an older commit locally. Local
  development reads `build/application-build-info.json` from the last
  `npm run build`. Render runs `npm run build` on every deploy, so it is correct
  there.
- Items with more than four options and labels other than E (for example A–D and F)
  can still be published through imports. The design screen allows only three or
  four options. Check imported items by eye.
- The ordinary export keeps the session-level `unsupported_correct_response_count`.
  It does not reveal any item's answer key. This field predates this release.

## Instructor sign-in page (18 Oct 2026)

Teachers and students used one sign-in page at `/student/login`, and every teacher
page sent signed-out visitors there. Instructors found the address confusing.

- New instructor sign-in page at `/teacher/login`, headed "Instructor sign in".
  - It asks for a password only, because instructor accounts don't use access codes.
  - A teacher who is already signed in is sent straight to the dashboard.
- Every teacher page now sends signed-out visitors to `/teacher/login`.
- The student page is unchanged and still accepts every account, so existing links and
  bookmarks keep working. Each sign-in page links to the other.
- **How it's built:** the page is `src/app/instructor-login/page.tsx`, and a rewrite in
  `next.config.mjs` serves it at `/teacher/login`. It sits outside `src/app/teacher`
  because the teacher layout redirects signed-out visitors, which would loop.
- **Unchanged:** the sign-in API, session rules and roles. No prompt, model or
  approval-bound file changed.

## Research-data review: activity attribution, response time and attempt order (18 Oct 2026)

Three concerns were raised about how research data can be interpreted.

**1. Activity recorded against the wrong question.**
- **What the code does.** Students can edit only the current question during the item
  flow (`updateInFlowItemResponse` refuses any other question). Earlier questions can be
  revised only in the final review, when no question is current. So activity is never
  recorded against a later unfinished question.
- **The real gap.** During final-review edits, general browser activity events (typing
  summaries, pastes, focus and visibility) had no question, so they did not count toward
  the question being revised. The stage observations themselves were already attributed
  correctly.
- **Fix.** These events now carry the question being revised. The dictionary explains
  the attribution and the gap in attempts recorded earlier.

**2. Response time is not thinking time.**
- **What was exported.** `item_elapsed_response_time_ms` runs from item display to
  submission. It includes system/AI waiting, hidden pages, other windows and idle time.
  The pieces needed to exclude this existed only per stage or submission; no item-level
  measure was exported.
- **New measures** (`response-stage-derivation-v4`):
  - per submission: `student_interval_hidden_ms`, `student_interval_unfocused_ms`,
    `student_focused_response_ms`;
  - per item, in `item_behavior_summary.csv`: `student_response_time_ms` (student's
    own intervals only), `student_unfocused_time_ms`, `student_focused_response_time_ms`
    (recommended for analysis), `student_response_interval_count` and
    `unsubmitted_visit_count`.
- **New raw field.** The browser now records whether the window had focus when a stage
  became ready (`document_has_focus`).
- **Clock basis.** Durations use one page load's monotonic clock, so neither device
  clock changes nor the browser/server clock difference affect them. Browser and server
  timestamps must never be subtracted from each other; the notes file and dictionary
  say so.
- **Limitation.** Idle time with the page visible and focused cannot be told apart from
  thinking and remains included.

**3. Attempt numbering across corrected versions.**
- **The problem.** `attempt_number` restarts at 1 on a corrected version, while the
  three-attempt limit counts the whole revision family.
- **Fix.** `sessions.csv` and `attempt_records.csv` now also carry
  `assessment_family_public_id` and `family_attempt_number`: the attempt's order among
  all of the student's attempts in the family, by creation time. `attempt_number` is
  unchanged, because the comparison views need identical items within one version.

**Rules version.** The 17 October release was deployed at 08:10 on 18 October, before
these changes. New attempts therefore record `data-collection-rules-2026-10-18`, so they
can be told apart from attempts collected under that deployment
(`data-collection-rules-2026-10-17`, no review-phase attribution or focus field).
Attempts that span the update are flagged `data_collection_rules_changed_during_attempt`.

**Scope and checks.**
- No prompt, model or approval-bound file changed.
- The new fields apply to attempts recorded after deployment. Historical rows are
  derived where the raw data allow it: focused time without `document_has_focus`
  assumes focus at ready.
- Design checks 42 of 42; dictionary audits and export smoke tests pass.

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
- Six changed files are in the approval bundle's recorded source inventory: `config.ts`, `finish-assessment.ts`, `runtime.ts`, `formative-profile.ts`, `profile-record.ts` and `analysis-ready-export.ts`. No model, prompt or effort changed. The post-deploy check that compares deployed source hashes will still report them, so record the change in the release entry as the approval process requires.
- **Release from `release/design-alignment-2026-10-17`, not from the working copy** (see Fourth pass, Critical, and `docs/RELEASE_GUIDE_2026-10-17.md`).
- The V41 conversation-repair candidate in the same working copy has its own release prerequisites (`handover-2026-10-15.md`). In particular, its prompt version v7.25 needs a matching approved configuration. Release the two pieces of work separately if needed.

## D12 Mini-test category kept separate from conversation updates (19 Oct 2026)

- **Before:** profiles were already stored as separate records (the initial profile is never edited; each validated conversation update creates a new profile record and a transition). But the dashboard label and the session-level export columns (`understanding_label`, `latest_student_safe_status` and related fields) were derived from the *latest* profile, so a conversation update replaced the post-mini-test category in reports.
- **Changed:** `learning-profile-summary.ts` adds `initialLearningProfile` and `conversationUpdateSummary`. The dashboard, the analysis-ready research export (`sessions.csv`, assessment summary), and the simple and detailed teacher CSV exports now derive the category from the mini-test profile. New columns report the conversation separately: `conversation_profile_update` (Sound understanding, Largely improved understanding, Instructor assistance recommended, No profile update), `conversation_profile_update_count`, `conversation_updated_understanding_label`, `conversation_updated_profile_record_id`, `conversation_update_summary_version`. The dashboard adds an "After the conversation" card.
- **Unchanged:** the formative conversation still works from the latest validated profile (`current_student_profile`), the session detail page still shows both the initial and current profiles, and no stored profile, transition or student record is modified.
- **Versions:** `understanding-summary-v3`, `conversation-update-summary-v1`, `teacher-assessment-dashboard-v3`. Exports made before this change used `understanding-summary-v2`, where the label could reflect a conversation update.
- **Tests updated:** `learning-profile-summary-smoke-test.ts` (initial profile kept; unvalidated transitions ignored), `profile-record-projection-smoke-test.ts` (v3 and the new columns), `formative-conversation-v18r2-pipeline-runtime-smoke-test.ts` (with a validated transition, the category stays on the prior profile and the update is reported separately).

## Follow-ups (still open)

| ID | Item | Why open |
| --- | --- | --- |
| F-A1 | Teacher routes are not scoped by owner (audit F6) | Deferred by the researcher to the multi-course work before 2027 |
| R-M3 | Attribute typing and paste events to the field typed in | Client event change; only matters if process data support claims |
| R-H2 | Monitor conversation participation after each class | Researcher decision (17 Oct): keep free-text chat and explanatory, accessible tutor messages; no suggested replies or length limits |
| F-D9a | Evaluate `gpt-6-luna` for modules 1–3 and GPT-6.1 Sol for item preparation | Needs the seven-case review and a new approval record |

Resolved in the third pass: F-A3a (D11), F-E1, F-D10a. F-D8a closed by decision: instructors generate the report manually after most students finish, so a several-minute wait is acceptable.

Resolved in the second pass: F-D2a, F-D3a, F-D3b (decision), F-D1a, F-D6a (Appendix A text in `DISSERTATION_TEXT_UPDATES_2026-10-17.md`), F-A2, F-A3, F-A4.
