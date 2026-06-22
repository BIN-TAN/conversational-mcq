# Access-Code Security

Phase 7A uses teacher-issued student access codes for local classroom use.

## Generation

Access codes are generated with Node's cryptographically secure random-number generator. The default length is 16 characters and the alphabet avoids visually ambiguous characters where practical.

Production code must not use `Math.random`, dates, sequential IDs, or predictable roster values for access codes.

## Storage

Only hashes are stored in `users.access_code_hash`. Plaintext access codes must never be stored in:

- database rows
- roster import batches
- account events
- process events
- response packages
- exports
- logs
- Git fixtures

## One-Time Visibility

Plaintext codes are returned only immediately after:

- creating one student
- committing a roster batch that creates new students
- resetting one student's access code

The teacher warning is:

```text
Download or securely record these access codes now. For security, they cannot be displayed again. If a code is lost, generate a new one.
```

If a code is lost, reset it. Resetting increments `users.auth_version`, updates `credential_updated_at`, and invalidates old student cookies.

## Credential CSV

One-time credential CSV columns:

```text
user_id,display_name,temporary_access_code
```

The CSV is generated directly from the authenticated response or browser memory. It is not stored in public static files, `.data/exports`, export job history, or the database.

User-controlled fields receive spreadsheet formula protection before download.

## Account Status

Deactivation increments `auth_version` and blocks login. Reactivation increments `auth_version` and allows login with the current access code unless the teacher separately resets it.

Account status changes preserve assessment sessions, transcripts, process events, profiles, decisions, and summative outcomes.
