# Pilot QA Checklist

This checklist supports a small local human usability pilot of the fixed IRT chat-native MVP. It is not evidence of classroom validity, and it must not be used with real student data until the research and deployment approvals are in place.

## Scope

- Fixed IRT MVP item set only.
- Chat-native student flow: initial item package, formative activity, targeted feedback, revision, next choice, optional transfer item, and completion.
- Operator-run local or private staging environment only.
- Live LLM smoke is manual and opt-in only.
- Teacher upload, additional item sets, transfer-item feedback, and public deployment are out of scope.

## Pre-Pilot Setup

- Confirm `.env` and `.env.local` remain ignored by Git.
- Use only synthetic accounts or approved pilot accounts.
- Do not paste API keys into chat, documentation, commits, screenshots, or issue reports.
- Confirm the fixed IRT MVP smoke tests pass before inviting a participant.
- If a manual live smoke is needed, configure secrets only in an ignored local env file or secure shell environment.
- Store real local OpenAI keys only in `.env.local`, an ignored credential file such as `.data/secrets/openai_api_key`, or a secure shell environment. `.env` should not contain real OpenAI keys.
- Run `npm run llm:readiness` before a browser walkthrough and confirm whether live item administration is authenticated and ready, or intentionally blocked. This check may contact OpenAI for lightweight model metadata when live config is present, but it must not generate model output or print secrets.
- If `.env` and `.env.local` both contain `OPENAI_API_KEY` with different safe fingerprints, readiness should fail closed. Remove or comment the duplicate key from `.env` and keep the live key in `.env.local`.
- For browser walkthroughs with live item administration, leave `ITEM_ADMIN_TUTOR_MODE=auto` and configure the server-side OpenAI provider, live-call flag, credential, and `OPENAI_MODEL_ITEM_ADMIN` or `OPENAI_MODEL_FOLLOWUP`.
- For intentional local mock walkthroughs, set `ITEM_ADMIN_TUTOR_MODE=mock` and `ALLOW_LOCAL_MOCK_RUNTIME=true`; deterministic item administration is not the intended real student experience.
- Record only status fields from live runs, not raw prompts, raw provider payloads, answer keys, or full student text.

## Canvas-Link Pilot Setup

Canvas is used only to post the public EDPY 507 Conversational MCQ landing-page URL. Do not configure Canvas LTI, OAuth, grade passback, roster sync, Developer Keys, or Canvas API access for the first classroom pilot.

The landing page should use a University of Alberta green/gold application style: dark green top bar, small gold accent, light application tiles, and the authorized official UAlberta logo/wordmark supplied by the operator for this course activity. Do not use scraped, hotlinked, or unofficial University of Alberta logo assets.

For the first public HTTPS staging pilot, use the Render Web Service plus Render Postgres path documented in `docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md`. Use non-free, classroom-pilot-appropriate Render resources and store secrets only in Render's server-side environment variable UI.

Supported Canvas placements:

- Assignment page: edit the assignment description in the Canvas Rich Content Editor and add an external hyperlink to the public HTTPS EDPY 507 landing-page URL.
- Module item: add an `External URL` item to a module, paste the public HTTPS EDPY 507 landing-page URL, and use `load in new tab` if desired.

Suggested Canvas wording:

```text
Open the Conversational MCQ activity using the link below. Use the classroom ID and access code provided by your instructor. Complete the activity in one sitting if possible. If the page says it could not safely review a response, follow the on-screen options to try again, choose another activity, or move on. Your teacher will review completion and research data inside the Conversational MCQ system, not through Canvas grade passback.
```

Canvas gradebook will not automatically receive completion or scores. Teacher/research completion review and exports happen inside Conversational MCQ.

After deployment, complete `docs/POST_DEPLOYMENT_CLASSROOM_DRY_RUN.md`, including landing-page visual checks and teacher dashboard logout, before sharing the Canvas link with students.

For a fresh Render database, run the explicit bootstrap command after migrations and before teacher/student login checks:

```bash
BOOTSTRAP_ENABLED=true \
BOOTSTRAP_TEACHER_USERNAME=<teacher-user-id> \
BOOTSTRAP_TEACHER_PASSWORD=<teacher-password> \
BOOTSTRAP_CLASSROOM_ID=<classroom-id> \
BOOTSTRAP_CLASSROOM_NAME=<classroom-name> \
BOOTSTRAP_STUDENT_COUNT=<number-of-students> \
BOOTSTRAP_DEFAULT_ASSESSMENT_ID=assessment_mvp_irt_theta_invariance \
npm run staging:bootstrap-pilot
```

The command is not part of Render pre-deploy and should not run automatically on every deploy. It writes new student temporary password/access-code credentials under ignored `.data/bootstrap/` and does not print them by default. Teachers can also create students manually from `/teacher/students/new`, optionally record display name and email, and reset a temporary password later. Email is optional teacher/research PII and is not used for login or password reset.

Before a human pilot, verify teacher-managed account handling:

```bash
npm run student:teacher-student-account-smoke
```

Expected account behavior: `user_id` remains the login identifier, first-login temporary credentials require the student to choose a new password before assessment access, teachers can reset forgotten student passwords but cannot view current passwords, and inactive students cannot log in or start assessments.

Deletion behavior: deactivation/reactivation is the reversible account-control path. The irreversible delete action is teacher-only, previewed, and requires typing the exact `student_id` and `DELETE`. It removes the student account and associated system session/activity data, writes a safe deletion audit event, and does not remove previously downloaded exports or copies outside the system. Verify with:

```bash
npm run student:teacher-student-deletion-smoke
```

Assessment lifecycle behavior: Archive is the normal reversible mini-test
control. Archived mini tests are hidden by default in the teacher library and
can be restored. Permanent assessment deletion is available only in the
assessment detail danger zone after previewed aggregate counts. Verify unused
draft/archived deletion, strong-confirmation all-data deletion, no-orphan
cleanup, and safe aggregate audit records with:

```bash
npm run student:teacher-assessment-deletion-smoke
```

Before changing pilot content, verify teacher-managed item authoring:

```bash
npm run student:teacher-mcq-item-builder-smoke
```

Expected content-authoring behavior: teachers add a topic with a learning
objective and concept description, add MCQ items one at a time, mark one
teacher-only correct option, add correct-option and distractor diagnostic notes,
preview the student view without keys or notes, and publish only after backend
validation passes. Missing diagnostic notes should warn the teacher but should
not create student-facing text. JSON import remains available for prepared item
sets.

If older staging accounts existed before the first-login gate, repair only active temporary-credential students with:

```bash
MARK_STUDENT_PASSWORD_CHANGE_ENABLED=true npm run staging:mark-students-must-change-password
```

Add `MARK_STUDENT_USER_ID=<student-user-id>` or `MARK_STUDENT_CLASSROOM_ID=<classroom-id>` to narrow the repair. The command does not print passwords/access codes and does not touch teacher accounts.

## Local Run Commands

Start from a clean working tree and run the database and application setup used by the project:

```bash
npm install
npm run prisma:generate
npx prisma migrate status
npm run prisma:seed
npm run dev
```

For ordinary daily local startup after setup has already been completed, use the one-click launcher instead of re-running migrations and seed data:

```bash
npm run app:local:start
```

or double-click:

```text
launchers/Start Conversational MCQ.command
```

The launcher starts PostgreSQL, runs authenticated server-side LLM readiness, starts Next.js in the background, waits for `http://localhost:3000/api/health`, and opens the browser only if readiness passes. It writes logs and PID files under:

```text
.data/local-runtime/next-dev.log
.data/local-runtime/next-dev.pid
```

Stop the local app with:

```bash
npm run app:local:stop
```

or double-click:

```text
launchers/Stop Conversational MCQ.command
```

Check status with:

```bash
npm run app:local:status
```

or double-click:

```text
launchers/Status Conversational MCQ.command
```

The launcher does not silently use mock mode. If LLM readiness fails, it stops before opening the app and suggests `npm run llm:readiness`. Explicit mock walkthroughs require `ITEM_ADMIN_TUTOR_MODE=mock` and `ALLOW_LOCAL_MOCK_RUNTIME=true`.

Run non-live verification:

```bash
npm run typecheck
npm run lint
npm run build
npm run student:classroom-pilot-readiness-smoke
npm run student:classroom-pilot-workflow-review
npm run student:mvp-e2e-smoke
npm run student:ui-smoke
npm run student:initial-chat-ui-smoke
npm run student:conversational-flow-smoke
npm run student:transfer-item-smoke
npm run student:targeted-feedback-smoke
npm run student:live-llm-smoke
```

The last command should skip safely unless `RUN_LIVE_LLM_SMOKE=1` is explicitly set.

## Fast Local Demo Reset

The fixed IRT MVP currently uses one normal student attempt per assessment. For repeated local pilot walkthroughs with the synthetic `student_demo` account, reset only that student's fixed MVP attempt data:

```bash
cd "/Users/binbin/Documents/Conversational MCQ"
npm run db:up
npm run dev
```

In a separate terminal, run:

```bash
npm run demo:reset-student-mvp
```

Then refresh the student assessment dashboard:

```text
http://localhost:3000/student/assessment
```

If the fixed MVP fixture has not been created yet, run `npm run prisma:seed` once before the reset command. The reset command is developer-only and scoped to `student_demo` plus the fixed IRT MVP assessment; it does not delete other users, teacher data, item metadata, answer keys, or seed definitions.

## Manual Live Smoke

Run this only after the operator has configured local secrets outside the repository:

```bash
RUN_LIVE_LLM_SMOKE=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
OPENAI_MODEL_PLANNING=<model> \
OPENAI_MODEL_FOLLOWUP=<model> \
npm run student:live-llm-smoke
```

After the manual run, confirm only these status fields:

```text
profile_call_status = succeeded
profile_output_validated = true
targeted_call_status = succeeded
targeted_output_validated = true
```

If the live smoke reports `invalid_output`, `failed`, or `output_validated = false` for the formative profile or targeted feedback call, stop the pilot-readiness check and use the sanitized diagnostics. The runtime should preserve student progress and show the temporary unavailable message rather than continuing with invalid live output.

Failed paid live-smoke runs retain the failed synthetic session by default and write a sanitized artifact under `.data/student-live-llm-smoke/failures/`. Do not commit generated artifacts. If the failure details include an `agent_call_id` or `session_public_id`, inspect only sanitized fields:

```bash
npm run student:live-llm-audit-diagnose -- --agent-call-id <agent_call_id>
npm run student:live-llm-audit-diagnose -- --session-public-id <session_public_id>
npm run student:live-llm-audit-diagnose -- --latest-failure
```

If the DB row was manually cleaned up, use the `diagnostic_artifact_path` printed by the failed smoke:

```bash
npm run student:live-llm-audit-diagnose -- --artifact <diagnostic_artifact_path>
```

After inspection, clean up retained synthetic live-smoke data:

```bash
npm run student:live-llm-smoke:cleanup-failures
```

## Student Flow Checklist

- Student can log in and reach `/student/assessment`.
- Student can start a session.
- Question 1 of 3 appears as an agent chat bubble with stem and A/B/C/D options.
- Clicking an answer option card creates a student chat bubble and advances to the reasoning prompt.
- Reasoning is entered through the text composer.
- Confidence appears as Low, Medium, and High chips.
- Clicking confidence creates a student chat bubble and advances to the tempting-option prompt.
- Selecting `No` for tempting option advances to the next item without an extra continue step.
- Selecting A/B/C/D as a tempting option asks for why that option was tempting.
- The same answer, reason, confidence, and tempting-option pattern works for all three initial items.
- After the third item, the package-level review appears.
- The student can edit a package-review response before continuing to feedback preparation.
- The student can continue from package review to feedback preparation.
- The formative activity appears as a chat interaction.
- The learning profile, when shown after package analysis begins, displays one current status only: `Mostly understood`, `Still developing`, or `Needs more work`, plus a short explanation and next-focus statement.
- Targeted feedback appears after the formative response.
- Revision can be entered naturally in the text composer.
- Next choice appears after revision.
- Choosing the transfer path presents the transfer item.
- Completing the final path ends with a clear completion message.

## Chat-Native UX Checklist

- Agent messages are visually aligned left.
- Student messages are visually aligned right.
- Item stems and options appear inside the agent message, not as a survey form.
- Answer choices are clickable option cards, and confidence choices are chips.
- There is no item-level submit button during initial administration.
- There is no `Saved` status message during the initial item flow.
- There is no `Continue` button after answer selection, confidence selection, or `No` tempting-option selection.
- Previous choices appear as chat history rather than editable form fields, except at package-level review.
- Package-level review includes an `Edit response` action for each initial item before feedback begins.

## Safety Checklist

- Do not show correctness during the initial item package.
- Do not show answer keys during the initial item package, package review, or transfer-item administration.
- Do not show distractor rationale or misconception metadata to students.
- Do not give hints, explanations, or content help before the package is complete.
- Procedural clarification is allowed, but content help is deferred.
- Student-facing UI must not show internal terms such as `response profile`, `formative need`, `metadata`, `structured output`, `agent call`, `system prompt`, or `answer key`.
- Student-facing learning profile must not show all three status categories simultaneously.
- Process data must be treated as participation and evidence context, not misconduct evidence.

## Teacher Mini-Test Builder Checklist

- Teacher dashboard cards are actionable links, not static informational cards.
- `Assessments / Mini tests` opens the mini-test list.
- Mini tests are grouped by folder/week/module when a folder label is present.
- The mini-test list supports search, status/folder filters, collapsible
  folders, item/session counts, archive/restore, and default hiding of archived
  mini tests.
- Creating a mini test asks for assessment name, diagnostic focus, optional
  folder/week/module, release date/time, and closing date/time.
- Workflow mode and response collection mode are not normal teacher-facing
  selectors in the mini-test path.
- The mini-test detail page shows `Add MCQ item` even when the mini test has no
  items yet.
- Teachers add MCQ items directly from the mini-test page; internal
  topic/concept-unit records are not visible in the normal workflow.
- Add/edit MCQ item pages show breadcrumbs and a `Back to mini test` action.
- Add MCQ item supports `Save item and add another`, `Save item and return to
  mini test`, and `Cancel`. Cancel and Back warn before discarding unsaved
  changes.
- Repeated authoring can leave item order blank; the backend assigns the next
  available order within the mini test.
- The mini-test item list shows item-count readiness, a top `Add MCQ item`
  action, a bottom `Add another MCQ item` action, and separate Edit, Teacher
  preview, and Student preview links.
- The mini-test detail page also shows `Import MCQ items` for the selected mini
  test. CSV, XLSX, Word `.docx`, pasted plain text, and project JSON imports
  must open a preview first; no production item is written until the teacher
  confirms the import. Old `.doc` and macro-enabled `.docm` files should show
  safe rejection guidance.
- Import preview should preserve original wording, keep missing fields blank,
  flag malformed or duplicate candidates, and store imported keys separately
  from teacher-confirmed keys. Missing keys are allowed for draft import but
  must block publishing until the teacher confirms exactly one valid key.
- DOCX import should flag embedded images, equations/objects, external
  relationships, and unresolved tracked changes for teacher review. It must not
  silently discard those references or claim the LLM viewed images.
- Optional formatting assistance must remain teacher-reviewed. `Help resolve
  formatting` should show original source versus proposed structure, keep
  missing fields blank, preserve wording, and require Accept, Edit and accept,
  Reject, or Leave unresolved review. Browser/runtime formatting suggestions
  require live server-side configuration and `OPENAI_MODEL_MCQ_FORMATTING`;
  mock formatting is test-only.
- Optional diagnostic suggestions must remain teacher-reviewed. The teacher can
  Accept, Edit and accept, Reject, or Leave blank per field. Non-empty
  teacher-authored notes should not be overwritten by default. Browser/runtime
  suggestions require live server-side configuration and
  `OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING`; mock suggestions are test-only and
  must not be presented as production suggestions.
- Advanced topic settings and fixed workflow/response implementation facts are
  absent from the normal mini-test detail page.
- The normal MCQ editor does not show an item-purpose dropdown. Teacher-created
  MCQs default internally to initial item administration.
- The item editor shows higher-order item guidance: initial MCQs should usually
  ask students to apply, analyze, or evaluate ideas; basic recall should have a
  clear diagnostic reason; creation belongs in later constructed-response
  activity dialogue.
- Correct-option notes are limited to target reasoning and strong-reasoning
  guidance.
- Distractor diagnostic notes appear as one plain-language teacher-only box,
  not separate per-distractor hypothesis fields.
- The editor copy states that selected distractors are indirect evidence only.
- Optional media authoring supports images, video links, and reference links
  with required accessible descriptions. Video links need a transcript or
  content summary. Browser uploads should remain disabled unless server-side
  storage is configured.
- Student preview shows only stem, options, and safe media fields. It must not
  expose storage keys, media hashes, answer keys, correct options, distractor
  metadata, or teacher-only notes.
- Teacher preview shows the key and teacher-only diagnostic notes.
- Publishing gives teacher-friendly validation messages for missing item
  requirements and keeps diagnostic notes teacher-only.
- Imported test-bank content should be reviewed for copyright/licensing
  permission before classroom use.

## Data Logging Checklist

Verify one completed synthetic session has expected records in:

- `item_responses` for selected answer, reasoning, confidence, tempting-option evidence, timing, and completion state.
- `conversation_turns` for agent prompts and student replies.
- `process_events` for item presentation, option clicks, reasoning submission, confidence selection, tempting-option submission, package review, and package submission.
- `response_packages` for the initial item evidence package.
- `agent_calls`, `student_profiles`, `formative_decisions`, and `followup_rounds` only where the MVP path actually invokes those layers.

Teacher/research quick CSV checks:

- `/teacher/data/explorer` loads for the teacher/research account.
- `Download assessment CSV` produces `assessment_<id>_students.csv` with one row per student-assessment session attempt for the selected assessment.
- `Download student CSV` produces `student_<student_id>_sessions.csv` with one row per assessment session attempt for the selected student.
- `Download matrix CSV` produces `student_assessment_matrix.csv` with one row per current student and assessment pair.
- Assessment/student detailed ZIP downloads contain exactly `analysis_rows.csv`, `process_events.csv`, `turn_response_latencies.csv`, and `conversation_turns.csv`.
- An assessment with no student sessions should show `No student sessions are available for this assessment.` and should not download a misleading header-only CSV.
- Simple CSVs include safe count/status fields and limitations only. They must not include email by default, raw response text, process payloads, provider output, answer keys, correct options, correctness labels, distractor metadata, diagnostic notes, credentials, or secrets.
- Detailed CSV bundles may include readable student response/conversation text for teacher/research review, but must not include raw process payloads, provider output, answer keys, correct options, raw distractor metadata, credentials, or secrets.

No logs, exports, screenshots, or notes should contain API keys, cookies, auth tokens, session secrets, password hashes, access-code hashes, hidden prompts, or raw provider payloads.

## Teacher Recovery Checklist

- Teacher username remains the sign-in identifier; recovery email is not a login ID.
- Existing staging/production teacher recovery email is set through
  `npm run operator:set-teacher-email`, not through source code or migrations.
- Fresh bootstrap may use `BOOTSTRAP_TEACHER_EMAIL`; output should show only
  masked recovery-email status.
- Forgot-password requests use a non-enumerating response for known teacher,
  unknown, student, unverified, provider-unavailable, and rate-limited cases.
- Reset and verification links are single-use, expiring, hash-stored tokens.
- Password reset invalidates older teacher sessions and sends no plaintext
  password.
- Authenticated email change requires current password, stores the new address
  as pending, verifies by link before replacing the old address, and allows
  cancellation.
- Teacher email is visible only to the authenticated teacher on Account
  settings and should not appear in student pages, public pages, default
  research exports, agent prompts, or process-event payloads.
- Live email delivery smoke is skipped by default; run it only with
  `RUN_LIVE_TEACHER_EMAIL_SECURITY_SMOKE=1` and a safe
  `LIVE_TEACHER_EMAIL_SMOKE_RECIPIENT`.

## What To Record During A Human Usability Pilot

- Browser, device, operating system, and approximate network condition.
- Whether login and session start were clear.
- Where the participant hesitated or asked what to do next.
- Whether the chat sequence felt conversational rather than survey-like.
- Whether any wording implied grading, correctness feedback, or hidden labels.
- Whether answer/confidence chips advanced as expected.
- Whether save, exit, and resume were understandable.
- Whether targeted feedback and revision felt clear.
- Any student-facing error messages or stalled states.
- For developer audit, whether process-event or conversation-turn payloads show `item_admin_tutor_source` as `live_llm`, `deterministic_mock`, `safe_block_after_live_failure`, or `configuration_blocked`.
- Whether teacher review and exports show the expected synthetic records after the session.
- Whether `npm run student:classroom-pilot-workflow-review` reports `passed` or `completed_with_limitations`, and which limitations remain.

## Known Limitations

- This checklist supports pilot readiness only; it does not establish classroom validity.
- Live LLM behavior requires manual operator configuration and an explicit opt-in smoke command.
- The fixed IRT MVP uses a limited item set.
- Teacher upload is not implemented in this rewrite phase.
- Transfer-item feedback is not implemented in this phase.
- Older or incomplete sessions may lack activity runtime attempts, post-activity evidence records, or diagnostic snapshots; the classroom pilot workflow review reports these as limitations.
- Human review of usability, safety, timing, and data quality remains required before broader classroom use.
