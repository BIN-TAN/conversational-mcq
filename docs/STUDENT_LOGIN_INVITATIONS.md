# Student Login Invitations

## Teacher Workflow

Student accounts has **Prepare login emails**, opening a standalone page. A row
selection preselects matching recipients; otherwise all eligible CSV matches are
selected. Upload the one-time credential CSV generated during account creation or
password reset. The columns are `user_id`, `email`, and `temporary_password` (the
legacy `temporary_access_code` column also works). Up to 100 rows and 256 KB are
accepted. The original `display_name` column is optional; the current account name
is used. The system cannot recover a lost plaintext password from its hash.

Edit one shared subject/body and preview the individual emails. Current ownership,
active status, pending password change, recipient email, and password hash are
verified for every row. Incorrect or changed credentials are excluded. Duplicate
usernames and shared recipient addresses are rejected. The preview is valid for
15 minutes and must be regenerated after changing the template or sender account.

Connect Gmail, review recipients and login details, check the approval box, and
select **Send emails with Gmail**. The connected Gmail address is both sender and
student contact address. The default message explains the first-login password
change, three chances per assessment, prior-attempt review, and contacting the
instructor for forgotten passwords or additional attempts. Three chances is not a
research retention limit. Requesting additional chances does not automatically
grant an exception or alter the assessment policy.

Each email has one recipient and no CC/BCC. Sending is sequential while the page
is open. Stop finishes the current request and leaves remaining recipients alone.
Leaving/refreshing clears credentials from page memory; any in-flight email may
still finish. Re-uploading the credential CSV and refreshing the preview reads
the recorded send statuses. It does not reset passwords or send messages.

## One-Time Gmail Setup

Sending remains disabled until the operator supplies a Google OAuth web client.
Previews work without it. No Google account was connected and no mail was sent
while implementing or testing this feature.

1. Enable Gmail API in a Google Cloud project and configure its consent screen.
   University-managed accounts may require Workspace administrator authorization;
   do not bypass university policy or use an app password.
2. Create a Web application OAuth client. Register the exact application origin
   as an authorized JavaScript origin and as the popup exchange redirect origin:
   `https://conversational-mcq.onrender.com` (without a trailing slash).
   Register a localhost origin separately for local Google integration testing.
3. Configure `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` on the canonical service.
   Never put the secret in a `NEXT_PUBLIC_*` variable or commit credentials.
4. Set `APP_BASE_URL=https://conversational-mcq.onrender.com`. Optionally set
   `STUDENT_INVITATION_CONTACT_EMAIL=btan4@ualberta.ca` for the requested instructor
   default; otherwise the current teacher's account email is used. Connecting a
   different verified Google account updates the sender and invalidates previews.
5. Apply `20260916010000_student_login_invitations` before serving this version.
6. The instructor selects **Connect Gmail** and authorizes their university Gmail.
   Connecting is not consent to send. The preview confirmation is separate.

The app uses Google's popup authorization-code model, with origin/custom-header
CSRF checks and server-side code exchange. Only `gmail.send` and account email
identity scopes are requested; inbox and draft-reading scopes are not requested.
The returned address must be verified by Google. Sender identity cannot be set by
an arbitrary From header. Access tokens live only in a short-lived, encrypted,
HttpOnly, SameSite=Strict cookie bound to the teacher and auth version. No refresh
token is retained, no background mail is scheduled, and expired access requires
reconnection. Disconnect clears the local token cookie; consent can also be
revoked in the instructor's Google account permissions.

Official integration references:
- [Authorization-code popup flow](https://developers.google.com/identity/oauth2/web/guides/use-code-model)
- [Gmail message sending](https://developers.google.com/workspace/gmail/api/guides/sending)
- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

## Delivery and Data Boundaries

`student_login_invitations` is an operational delivery ledger, not learning/process
evidence. It records teacher/student IDs, sender/recipient addresses, a stable
credential-version delivery key, keyed message digest, request count, timestamps,
safe failure code, and provider message ID. No plaintext password, CSV, subject,
body, Google code/token, cookie, or provider error body is saved or logged. Research
datasets do not include this ledger. Account deletion cascades its related rows.

The unique delivery key covers student, recipient address, auth version, and the
already salted current credential hash. It survives a new preview or template
change. Concurrent requests cannot send the same credential twice after a success.
An explicit retry is allowed only after a definite Gmail rejection, at most three
requests per credential. A timeout, ambiguous server response, or lost database
receipt is **unknown**, not failed: automatic and manual resends are blocked.
An old `sending` receipt is also shown as unknown. Check Gmail Sent and resolve
with the operator; use an explicitly approved new password only if necessary.
Gmail's accepted message ID establishes acceptance, not delivery to the inbox.

Requests are owner-scoped, bounded, authenticated, origin-checked and rate-limited.
Previews bind the exact email content to teacher/auth version, credential version,
recipient and expiry using a signed ticket. Send rechecks account state and Gmail
identity. A student login or password reset after preview requires a new preview.
There is no atomic transaction across Google and the application database: a
credential change racing an already in-flight email can still invalidate that
email. Do not reset passwords while their invitations are sending.

Sending puts the student's temporary credentials in the recipient inbox and the
instructor's Gmail Sent folder. Retention and mailbox access are subject to the
university's email policies. This feature does not make email an encrypted secret
delivery channel or delete downloaded credential CSVs or copies in Gmail.

## Checks

Run `prisma/student-invitations-smoke-test.ts` with `tsx` and the classroom network
guard against an explicit localhost `conversational_mcq_classroom_audit_*` database,
with `LLM_LIVE_CALLS_ENABLED=false`. Google OAuth and sends are stubbed at the
transport boundary. The suite verifies matching, privacy, ownership, scopes,
tampering, stale previews, concurrency, duplicate prevention and uncertain sends.
No production Google authorization or real-mail delivery is claimed by these tests.
