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

- Teacher login.
- View synthetic classroom accounts.
- Student login.
- Complete initial assessment items.
- Send free-text reasoning for response collection.
- Save, exit, and resume.
- Try off-topic/help/correctness requests and verify neutral student-facing handling.
- Review the session as teacher.
- Inspect agent audit and effective-result visibility on teacher pages.
- Generate/download a master CSV export and check privacy.
- Run `npm run staging:private:report`.

## Hard Blocks

- Roster import preview and commit APIs return `403` when `PRIVATE_STAGING_MODE=true`.
- The private staging launch binds to `127.0.0.1`; it is not public deployment.
- The fixture uses only `phase8d_*` synthetic accounts and assessment content.
- Reports keep `classroom_validity=false` and `human_review_pending=true`.

## Cleanup

`npm run staging:private:cleanup` stops the local app and worker, removes ignored
runtime files, and drops only the database ending in `_private_staging`.
