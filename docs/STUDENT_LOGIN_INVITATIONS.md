# Roster Credentials and Retired Email Sending

## Current Workflow

Student accounts > Import roster accepts CSV identity columns `user_id`,
`display_name`, and optional `email`. Preview never changes credentials. Extra
columns in old credential exports are discarded before persistence.

New students use the course temporary password, `edpy507`, by default in roster
imports and the Create student page. Random generation is an explicit alternative,
not the fallback for a blank password. Teachers can also enter a custom temporary
password. The backend applies the same default even when creation requests omit
password options. A separate checkbox authorizes replacement of
unused temporary passwords for existing accounts. Only owned, active students with
no prior login, no private password, and no password change qualify. Eligibility
and credential version are checked again at commit; stale accounts are skipped.
The import result reports replaced and unchanged accounts. Concurrent commits of
the same batch cannot issue credentials twice.

Teacher-issued temporary passwords require at least 7 characters. Private student
passwords still require at least 8 characters and must differ from the temporary
password. First-login password change is mandatory before assessment access.
Shared passwords increase impersonation risk until students change them. They are
the course's requested bootstrap policy, not a permanent private password or a
secret suitable for protecting student data before first login. Deployments can
override it with server-only `STUDENT_DEFAULT_TEMPORARY_PASSWORD`; the same value
is shown only on authenticated teacher creation/import pages. Password resets
from a student's detail page retain their existing explicit reset workflow.

Each account stores a separately salted hash. The shared course default is
displayed on authenticated teacher creation/import pages. Issued credentials are
returned in the one-time, non-cacheable response for teacher distribution. Preview
batches and audit events contain no passwords. A browser reload loses that
one-time display; repeating the commit does not recover it or reissue passwords.

## Email Retirement

Teachers send login instructions from their own email application. The login-email
page redirects to Student accounts. Old configuration, preview, connection and
send endpoints return HTTP 410 and clear the short-lived Gmail connection cookie.
No Gmail provider code remains, and no Google setup is required.

Historical delivery records and their database migration remain intact for audit
and rollback. They are not included in research exports. Roster credential changes
do not remove students, alter assessment chances, or delete research evidence.

## Verification

Run the shared roster credential smoke test only against a disposable localhost
classroom-audit database, with `scripts/classroom-audit-network-guard.mjs` loaded.
It covers new accounts, opt-in replacement, ownership, stale versions, first login,
private-password protection, duplicate commits, secret-free audits and retired
email endpoints. The roster UX smoke test uses synthetic data only.

`prisma/default-student-password-smoke-test.ts` verifies default creation/import,
explicit random opt-in, confirmed reissue, private-password preservation, and
password-free audits. The browser smoke verifies default selection across reloads
and both account-creation entry points.
