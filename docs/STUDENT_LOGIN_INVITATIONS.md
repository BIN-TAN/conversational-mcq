# Roster Credentials and Retired Email Sending

## Current Workflow

Student accounts > Import roster accepts CSV identity columns `user_id`,
`display_name`, and optional `email`. Preview never changes credentials. Extra
columns in old credential exports are discarded before persistence.

Teachers choose individually generated passwords (the default) or enter a shared
temporary password for that import. A separate checkbox authorizes replacement of
unused temporary passwords for existing accounts. Only owned, active students with
no prior login, no private password, and no password change qualify. Eligibility
and credential version are checked again at commit; stale accounts are skipped.
The import result reports replaced and unchanged accounts. Concurrent commits of
the same batch cannot issue credentials twice.

Teacher-issued temporary passwords require at least 7 characters. Private student
passwords still require at least 8 characters and must differ from the temporary
password. First-login password change is mandatory before assessment access.
Shared passwords increase impersonation risk until students change them. They are
an explicit per-import choice, never a hardcoded application default.

Each account stores a separately salted hash. Plaintext appears only in the
one-time, non-cacheable credential response for teacher distribution. Preview
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
