# Student Account Management

Phase 7A adds teacher_researcher-managed student accounts for local classroom preparation.

## Scope

Teachers can:

- create one student
- import a roster CSV
- preview validation results before commit
- download one-time credentials immediately after creation/import/reset
- search student accounts
- update display names
- reset access codes
- deactivate and reactivate students

Students do not self-register. The system does not send email or SMS and does not require student email addresses.

## Identity

`users.user_id` is the canonical classroom and research linkage ID. It is immutable through normal teacher UI/API routes.

`users.user_id_normalized` is used only for matching and uniqueness. It trims surrounding whitespace, applies Unicode normalization, and lowercases for comparison. Case-only duplicates are rejected.

If a wrong user ID is created, create the correct account and deactivate the incorrect account. Do not merge records automatically.

## Display Names

`display_name` is optional, supports Unicode, and can be changed by the teacher_researcher. Changing the display name does not change routes, sessions, summative outcomes, or exports.

## Status

Active students can log in and continue normal assessment workflows. Inactive students cannot log in, start, resume, participate in follow-up, or complete assessments.

Deactivation preserves all assessment and research records. There is no hard-delete UI/API for student accounts.

## Routes

Teacher pages:

- `/teacher/students`
- `/teacher/students/new`
- `/teacher/students/import`
- `/teacher/students/[userId]`

Teacher APIs:

- `GET /api/teacher/students`
- `POST /api/teacher/students`
- `GET /api/teacher/students/[userId]`
- `PATCH /api/teacher/students/[userId]`
- `POST /api/teacher/students/[userId]/reset-access-code`
- `POST /api/teacher/students/[userId]/deactivate`
- `POST /api/teacher/students/[userId]/reactivate`

All account routes require `teacher_researcher`. Students receive 403 for APIs and are redirected away from pages.

## Verification

```bash
npm run demo:roster
npm run demo:roster:cleanup
npm run student:account-smoke
npm run student:account-ui-smoke
npm run auth:account-status-smoke
```

No OpenAI call is made by these commands.
