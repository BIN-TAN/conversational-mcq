# Pilot QA Checklist

This checklist supports a small local human usability pilot of the fixed IRT chat-native MVP. It is not evidence of classroom validity, and it must not be used with real student data until the research and deployment approvals are in place.

## Scope

- Fixed IRT MVP item set only.
- Chat-native student flow: initial three-item package, formative activity, targeted feedback, revision, next choice, optional transfer item, and completion.
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

## Local Run Commands

Start from a clean working tree and run the database and application setup used by the project:

```bash
npm install
npm run prisma:generate
npx prisma migrate status
npm run prisma:seed
npm run dev
```

Run non-live verification:

```bash
npm run typecheck
npm run lint
npm run build
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

- Do not show correctness during the initial three-item package.
- Do not show answer keys during the initial three-item package, package review, or transfer-item administration.
- Do not show distractor rationale or misconception metadata to students.
- Do not give hints, explanations, or content help before the package is complete.
- Procedural clarification is allowed, but content help is deferred.
- Student-facing UI must not show internal terms such as `response profile`, `formative need`, `metadata`, `structured output`, `agent call`, `system prompt`, or `answer key`.
- Student-facing learning profile must not show all three status categories simultaneously.
- Process data must be treated as participation and evidence context, not misconduct evidence.

## Data Logging Checklist

Verify one completed synthetic session has expected records in:

- `item_responses` for selected answer, reasoning, confidence, tempting-option evidence, timing, and completion state.
- `conversation_turns` for agent prompts and student replies.
- `process_events` for item presentation, option clicks, reasoning submission, confidence selection, tempting-option submission, package review, and package submission.
- `response_packages` for the three-item evidence package.
- `agent_calls`, `student_profiles`, `formative_decisions`, and `followup_rounds` only where the MVP path actually invokes those layers.

No logs, exports, screenshots, or notes should contain API keys, cookies, auth tokens, session secrets, password hashes, access-code hashes, hidden prompts, or raw provider payloads.

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

## Known Limitations

- This checklist supports pilot readiness only; it does not establish classroom validity.
- Live LLM behavior requires manual operator configuration and an explicit opt-in smoke command.
- The fixed IRT MVP uses a limited item set.
- Teacher upload is not implemented in this rewrite phase.
- Transfer-item feedback is not implemented in this phase.
- Human review of usability, safety, timing, and data quality remains required before broader classroom use.
