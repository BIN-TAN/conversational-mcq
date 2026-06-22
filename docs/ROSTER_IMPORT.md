# Roster Import

Phase 7A roster import is a preview-before-commit workflow for creating student accounts.

## CSV Format

Required:

```text
user_id
```

Optional:

```text
display_name
```

See `docs/sample-student-roster.csv`.

## Workflow

```text
upload or paste CSV -> preview -> inspect results -> commit -> download one-time credentials
```

Preview stores an audit batch but does not create users, generate access codes, update display names, reset codes, or deactivate missing students.

Commit creates valid new student accounts, stores only access-code hashes, and returns plaintext credentials once. Existing students retain their current access codes. Display-name changes apply only when explicitly requested.

## Validation

The preview detects:

- invalid user IDs
- invalid display names
- duplicate normalized user IDs within the file
- case-only duplicates
- existing student accounts
- display-name changes
- teacher-account conflicts

Missing roster rows never automatically deactivate students.

## Audit

`roster_import_batches` stores normalized preview payload and validation summaries. It must not store plaintext access codes.

`student_account_events` records account events from roster commits. It must not store plaintext access codes, access-code hashes, passwords, cookies, tokens, or environment values.

## Commands

```bash
npm run roster:import-smoke
```

The smoke test verifies preview nonmutation, duplicate detection, commit idempotency, one-time credential behavior, display-name update policy, missing-row behavior, student authorization exclusion, and no LLM calls.
