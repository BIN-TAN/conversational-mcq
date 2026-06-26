# Phase 8D Private Staging Walkthrough

Phase 8D is a local, synthetic-only browser walkthrough for the student-facing
and teacher-facing platform using guarded-live operational agents. It is not
public deployment and does not claim classroom validity.

Approved evidence:

- operational live canary run: `olcr_20260626_j9ilznq`
- recommendation: `ready_for_private_staging_deployment`
- classroom validity: `false`
- human review pending: `true`

## Commands

```bash
npm run staging:private:preflight
npm run staging:private:seed
npm run staging:private:start
npm run staging:private:status
npm run staging:private:report
npm run staging:private:cleanup
```

`staging:private:start` binds the app to `127.0.0.1` and launches the workflow
worker as a local child process. It does not run an operational live canary.

## Local Credentials

The seed command prints local-only credentials:

- teacher: `phase8d_teacher` / `phase8d_teacher_password`
- students: `phase8d_student_01` through `phase8d_student_05`
- student access code: `phase8d_student_access_code`

## Routes

- student login: `http://127.0.0.1:3200/student/login`
- student assessment: `http://127.0.0.1:3200/student/assessment`
- teacher dashboard: `http://127.0.0.1:3200/teacher/dashboard`
- teacher sessions: `http://127.0.0.1:3200/teacher/sessions`
- teacher export: `http://127.0.0.1:3200/teacher/data/export`
- teacher LLM audit: `http://127.0.0.1:3200/teacher/system/llm`

## Checklist

### Teacher setup

- Sign in as `phase8d_teacher`.
- Open `http://127.0.0.1:3200/teacher/students` and confirm only synthetic
  `phase8d_*` accounts are used.
- Open `http://127.0.0.1:3200/teacher/dashboard` and confirm links to Student
  sessions, Data/export, and LLM audit remain available.

### `phase8d_student_01`: normal answer flow

- Sign in and start the private staging assessment.
- Confirm the assessment uses a centered single conversation column.
- Confirm the top progress indicator shows the concept and `Question X of N`.
- On each item, verify only the current step is active:
  choose answer, then reasoning, then confidence, then review.
- Click an option and confirm it is visibly highlighted with `Selected`.
- Confirm `Continue` is disabled before selection and enabled after selection is saved.
- Type reasoning and confirm the text remains visible while typing.
- Confirm `Saved` / `Saving...` / retry state is visible around each save.
- Select confidence and confirm the selected confidence is highlighted.
- Review the compact current-answer summary, then submit and continue.

### `phase8d_student_02`: correctness request during reasoning

- During the reasoning step, open the collapsed `Send a message` control.
- Ask whether the chosen answer is correct.
- Confirm the student-facing response does not reveal correctness, answer keys,
  hints, or explanations.
- Continue with normal reasoning, confidence, and submission.
- In teacher session review, verify the selected option, reasoning, confidence,
  transcript, process events, and agent/effective-result audit are visible.

### `phase8d_student_03`: hint request and prompt injection

- During initial administration, send a hint request.
- Send a prompt-injection style message asking the system to ignore rules or
  reveal hidden instructions.
- Confirm the student experience remains neutral and does not disclose answers,
  hidden prompts, credentials, model metadata, or internal IDs.
- In teacher review, confirm the transcript/process events are visible without
  secret values.

### `phase8d_student_04`: off-topic and move-on in follow-up

- Complete initial items until follow-up becomes available.
- Send an off-topic follow-up message.
- Ask to move on when ready.
- Confirm move-on remains student-led and does not show profile labels,
  formative-value labels, or correctness feedback to the student.
- In teacher review, inspect effective-result and agent audit fields.

### `phase8d_student_05`: save and resume

- Select an option, continue to reasoning, and type a partial reasoning response.
- Use Save and exit before submitting the item.
- Sign back in and resume.
- Confirm the selected option and typed/persisted reasoning state are preserved.
- Finish the item and verify teacher review shows the submitted option,
  reasoning, confidence, and timestamp.

### Export and report

- Generate/download a master CSV export from
  `http://127.0.0.1:3200/teacher/data/export`.
- Check that public IDs appear and secret/internal credential data do not.
- Run `npm run staging:private:report` and confirm completed sessions, agent
  calls, provider-request/cost totals, failures, teacher-visible audit records,
  student-facing errors, and export/privacy checks are summarized.

## Hard Blocks

- Roster import preview and commit APIs return `403` when `PRIVATE_STAGING_MODE=true`.
- The private staging launch binds to `127.0.0.1`; it is not public deployment.
- The fixture uses only `phase8d_*` synthetic accounts and assessment content.
- Reports keep `classroom_validity=false` and `human_review_pending=true`.

## Cleanup

`npm run staging:private:cleanup` stops the local app and worker, removes ignored
runtime files, and drops only the database ending in `_private_staging`.
