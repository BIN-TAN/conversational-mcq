# Synthetic Classroom Fixture

Phase 8B creates a synthetic one-course fixture for local E2E validation only.

## Fixture Scope

The fixture creates:

- one teacher account
- thirty synthetic student accounts
- one automatic assessment
- three ordered concept units
- four included items per concept unit
- additional release/close availability assessments
- synthetic summative outcomes for export verification

All IDs use the `e2e_phase8b` namespace. No real student data, deidentified student data, classroom transcripts, or summative records are imported.

## Personas

Synthetic student actions cover:

- robust understanding
- misconception-like answer choice
- fragile correct reasoning
- underconfident response
- insufficient evidence and skipped evidence
- low-engagement style response
- mixed reasoning plus correctness request
- hint request
- prompt-injection attempt
- off-topic response
- save/resume
- move-on request

These personas are test controls, not labels applied to real students.

## Credentials

Local E2E credentials are fake:

```text
teacher user_id: e2e_phase8b_teacher
teacher password: phase8b_teacher_password
student access code: phase8b_student_access_code
```

The database stores only hashed credentials.

## Cleanup

The E2E database is isolated by name and must end in `_e2e`. Use:

```bash
npm run e2e:db:cleanup
```

Report files can be removed with:

```bash
npm run e2e:cleanup
```
