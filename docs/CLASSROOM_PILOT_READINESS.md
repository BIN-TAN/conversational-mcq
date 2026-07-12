# Classroom Pilot Readiness

Phase 31a is a local readiness audit for a small classroom pilot of the fixed IRT, chat-native MVP. It is not a classroom-validity claim and does not authorize public deployment.

## Scope

The readiness layer checks that the implemented teacher-student workflow can be exercised with synthetic accounts and that teacher/research evidence surfaces are available after a session. It does not change item content, correct answers, scoring, misconception logic, provider prompts, or live provider configuration.

Run the no-live smoke:

```bash
npm run student:classroom-pilot-readiness-smoke
```

Run the latest-session workflow review:

```bash
npm run student:classroom-pilot-workflow-review
```

The review command writes a redacted local artifact under:

```text
.data/classroom-pilot-workflow-review/
```

Generated artifacts are ignored and must not be committed.

## Teacher Setup Flow

1. Seed local users and the fixed IRT MVP assessment.
2. Confirm the `teacher_demo` account exists and is active as `teacher_researcher`.
3. Confirm the fixed IRT MVP assessment remains published for the synthetic student start path.
4. Confirm teacher review routes load session detail, readable transcript, structured event log, session evidence audit, and research export.
5. Confirm default research export integrity is ready or ready with documented limitations.

Teacher/research surfaces may show aggregate counts, safe public IDs, timestamps, safe labels, provider metadata presence, token usage presence, and explicit limitations. They must not show answer keys, correct options, raw provider input/output, raw process payloads, raw distractor metadata, raw misconception IDs, internal database UUIDs, credentials, cookies, or secrets.

## Student Flow

The student pathway remains:

```text
student login
-> start fixed IRT MVP assessment
-> three protected initial items
-> package review
-> package analysis
-> activity runtime
-> activity response
-> choose another activity or move on
-> later completion path
```

The app owns assessment state, persistence, answer-key protection, and process-event logging. The LLM may generate conversational content only inside validated backend boundaries. The student UI must remain chat-native and must not show survey-style item submits during protected initial administration.

## Research Data Flow

After a completed or partially completed classroom session, teacher/research review should provide:

- response package;
- process-event summary;
- readable transcript;
- structured redacted transcript;
- turn-level response latency rows;
- engagement process feature rows;
- activity runtime attempt when the activity phase was reached;
- activity misconception evidence when a response was evaluated;
- post-activity diagnostic snapshot when the evaluator persisted evidence;
- agent audit summaries when LLM calls occurred;
- session data-completeness record;
- summary assessment/student/matrix CSV downloads from `/teacher/data/explorer`;
- detailed assessment/student/all-authorized CSV ZIP bundles from `/teacher/data/explorer`;
- bulk research export;
- research export integrity review.

Older sessions or sessions stopped before activity runtime may legitimately lack activity attempts, post-activity evidence, or diagnostic snapshots. These are limitations, not automatic integrity failures.

## Failure Modes

Student-facing failure states must fail closed and preserve progress. Safe wording is:

```text
I could not safely review this response right now. You can try again, choose another activity, or move on.
```

```text
I could not safely prepare this activity right now. You can try again or move on.
```

The system must handle duplicate submit, refresh during an active item, refresh during activity, empty activity response, missing live activity packet, stale/missing activity attempt, old sessions without newer records, and export of incomplete sessions. Student-facing errors must not mention provider, validator, LLM, schema, agent, prompt, raw output, metadata, answer keys, or internal error details.

## Readiness Criteria

Phase 31a readiness requires:

- synthetic teacher and student accounts exist;
- a student session can initialize;
- the initial flow reaches package completion without live provider calls;
- the activity runtime projection is student-safe;
- injected evaluator output can create post-activity evidence in no-live smoke;
- move-on and choose-another paths are safe;
- teacher session detail, session evidence audit, readable transcript, structured event log, and bulk export load;
- research export integrity passes or reports only documented limitations;
- student projection excludes teacher/research/internal fields;
- teacher/research projection excludes protected raw data;
- activity runtime does not overwrite operational profile records;
- activity runtime does not mutate response packages;
- no OpenAI call occurs.

Readiness is a local engineering and workflow check. It does not establish learning impact, psychometric validity, classroom validity, or deployment readiness.

## Manual Dry Run

1. Start the local app.
2. Run `npm run llm:readiness`.
3. Log in as teacher and confirm classroom/student accounts.
4. Log in as student.
5. Complete the three-item package.
6. Enter the activity phase.
7. Submit an activity response.
8. Use continue, choose another, or move on.
9. Log in as teacher.
10. Open the session detail.
11. Inspect readable transcript, structured event log, process events, and session evidence audit.
12. Open `/teacher/data/explorer` and download the assessment CSV, student CSV, and matrix CSV for a safe spreadsheet-level summary.
13. Download all research data.
14. Run `npm run student:research-export-integrity-review`.
15. Confirm no protected data leaks.

Record only pass/fail observations, session public IDs, artifact paths, status fields, and limitations. Do not record secrets, raw provider payloads, answer keys, raw process payloads, or raw student text outside approved research artifacts.

## Production Web Pilot Checklist

Phase 31b adds deployment readiness checks for a future public HTTPS classroom pilot. It does not authorize public deployment or claim classroom validity. Canvas is used only to post a link to the public EDPY 507 Conversational MCQ landing page; Canvas LTI, OAuth, grade passback, roster sync, Developer Key configuration, and Canvas API integration are not part of this pilot. The landing page uses a University of Alberta green/gold course-access style and the authorized official UAlberta logo asset supplied by the operator. See `docs/PRODUCTION_DEPLOYMENT_READINESS.md`.

Before using a public URL with students:

1. Deploy a Render staging HTTPS URL with `render.yaml` as the recommended first path.
2. Configure server-side secrets through the hosting provider, not browser-visible variables.
3. Run `npm run student:render-staging-readiness-smoke`.
4. Run `npm run student:production-deployment-readiness-smoke`.
5. Confirm Render pre-deploy ran `npm run prisma:migrate:deploy` against the deployment database.
6. On a fresh database, run `npm run staging:bootstrap-pilot` once with explicit `BOOTSTRAP_*` environment variables.
7. Store the generated student temporary-credential CSV securely and delete transient copies when no longer needed.
8. Verify `GET /api/health` returns a safe healthy response.
9. Verify the EDPY 507 landing page uses the green/gold course-access style, includes the authorized UAlberta logo, and contains no prototype/scaffold language.
10. Verify teacher login and dashboard logout on the public URL.
11. Create or import the classroom if a later schema adds classroom records; in this schema version, use the bootstrap classroom ID as the course/access label.
12. Create or import approved student accounts and temporary credentials.
13. Copy the public HTTPS EDPY 507 landing-page URL.
14. Add the URL to a Canvas assignment page or Canvas module item.
15. Test the link from a non-development student device or browser profile.
16. Student signs in with classroom ID and temporary password/access code or a student-changed password inside Conversational MCQ.
17. Student completes the three-item package.
18. Student completes one activity response path.
19. Teacher opens session detail.
20. Teacher reviews readable transcript, structured event log, process events, and session evidence audit.
21. Teacher downloads all research data.
22. Run `npm run student:research-export-integrity-smoke`.
23. Complete `docs/POST_DEPLOYMENT_CLASSROOM_DRY_RUN.md`.

Canvas assignment/module wording:

```text
Open the Conversational MCQ activity using the link below. Use the classroom ID and access code provided by your instructor. Complete the activity in one sitting if possible. If the page says it could not safely review a response, follow the on-screen options to try again, choose another activity, or move on. Your teacher will review completion and research data inside the Conversational MCQ system, not through Canvas grade passback.
```

The public deployment must preserve the same protected-data boundaries as local readiness: no answer keys, correct options, correctness labels, raw provider payloads, raw process payloads, raw distractor metadata, raw misconception IDs, credentials, cookies, database URLs, API keys, or session secrets in student-facing UI or public logs.

Canvas gradebook will not automatically receive completion or scores. Teacher/research review and exports remain inside Conversational MCQ.

Render staging resources should use non-free, classroom-pilot-appropriate plans. Store `OPENAI_API_KEY`, `DATABASE_URL`, `SESSION_SECRET`, and any other credentials only in Render's server-side environment variable UI; never in `NEXT_PUBLIC_` variables.

First-run bootstrap command:

```bash
BOOTSTRAP_ENABLED=true \
BOOTSTRAP_TEACHER_USERNAME=<teacher-user-id> \
BOOTSTRAP_TEACHER_PASSWORD=<teacher-password> \
BOOTSTRAP_CLASSROOM_ID=<classroom-id> \
BOOTSTRAP_CLASSROOM_NAME=<classroom-name> \
BOOTSTRAP_STUDENT_COUNT=<number-of-students> \
BOOTSTRAP_DEFAULT_ASSESSMENT_ID=assessment_mvp_irt_theta_invariance \
npm run staging:bootstrap-pilot
```

Use `BOOTSTRAP_STUDENT_ROSTER_PATH=<csv>` instead of `BOOTSTRAP_STUDENT_COUNT` when the approved pilot roster is ready. The command writes newly generated student temporary credentials under ignored `.data/bootstrap/` and does not print them in terminal output.

If a staging database already has active temporary-credential student accounts that were created before the first-login password-change gate, repair the gate without rotating credentials:

```bash
MARK_STUDENT_PASSWORD_CHANGE_ENABLED=true npm run staging:mark-students-must-change-password
```

Use `MARK_STUDENT_USER_ID=<student-user-id>` for a single student or `MARK_STUDENT_CLASSROOM_ID=<classroom-id>` for a bootstrap classroom label. The repair command marks only active student accounts with temporary credentials and no permanent password, does not affect teachers, and does not print passwords or access codes.

Teacher-managed student account pages support manual `user_id` creation, optional display name, optional email, generated or teacher-set temporary password/access code, reset of forgotten student passwords, and deactivation/reactivation. Students must choose a new password after temporary-credential login. Current passwords and credential hashes are never viewable. Email is optional teacher/research-facing PII and is not used for login or reset.

Deactivation/reactivation is reversible and preserves assessment/research records. Irreversible student data deletion is available only from teacher account management after previewing associated record counts and typing the exact `student_id` plus `DELETE`. Use deletion carefully for approved staging/test cleanup or approved withdrawal workflows. Deletion removes system-held student account, session, activity, profile, evidence, and linked summative outcome rows; previously downloaded exports or external copies remain outside system control.

Assessment archive is the normal reversible way to remove a mini test from new
student starts. Permanent assessment deletion is separate and teacher/research
only. Delete unused assessment is available only for draft or archived mini
tests with no student/session evidence and requires previewed counts, the exact
assessment title or public ID, and `DELETE`. Delete all assessment data is a
danger-zone cleanup path that requires the exact phrase
`DELETE ALL ASSESSMENT DATA`, a second confirmation, and removes associated
assessment sessions, responses, turns, process events, agent summaries,
activity evidence, snapshots, items, and topics from this system. The retained
audit is aggregate-only and does not retain raw student responses, item content,
answer keys, provider payloads, or secrets.

Before pilot content changes, teachers may use the guided mini-test builder.
The teacher-facing mental model is Folder/Week/Module -> Mini test -> MCQ items
-> Publish. The system auto-maintains the internal topic/concept-unit record, so
teachers do not need to see or create a topic before adding items. The mini-test
detail page exposes a direct `Add MCQ item` action even when no items exist.
Workflow mode and response collection mode are fixed internally for this path
and are not normal teacher-facing page facts.
The item-authoring workflow is continuous: `Add MCQ item` can save and open a
fresh blank item form for the same mini test, save and return to the mini-test
detail page, or cancel back to the parent mini test with an unsaved-changes
warning. Item order is assigned automatically when left blank. The detail page
shows the current count against the three-item structural minimum and includes
top and bottom add-item actions plus separate item Edit, Teacher preview, and
Student preview links.

The mini-test detail page also supports `Import MCQ items` for bulk teacher
authoring. Supported sources are CSV, XLSX, Word `.docx`, pasted plain text,
and the existing project JSON item format. Import is draft-only and
preview-first: extraction does not silently change source wording, invent
missing options, infer an official key, or populate diagnostic notes. Missing
fields stay blank. Old `.doc` and macro-enabled `.docm` files are rejected with
safe guidance. DOCX embedded images, equations, external relationships, and
tracked-change ambiguity are flagged for teacher review rather than silently
imported. Imported keys are preserved separately and become official only after
explicit teacher confirmation or edit; publishing still requires exactly one
teacher-confirmed key per included item.

Teachers may optionally request formatting help for ambiguous imported
candidates. `Help resolve formatting` is explicit, teacher-triggered, and
bounded; it must not run during upload, parsing, page load, preview, or
automatic batch processing. Production-like formatting assistance requires
server-side live provider configuration and `OPENAI_MODEL_MCQ_FORMATTING`.
Formatting proposals preserve source wording, include source-span mappings,
keep missing fields blank, and require teacher acceptance or rejection before
import.

Teachers may optionally request diagnostic suggestions for missing authoring
information. The action is explicit, teacher-triggered, and bounded; it must
not run during upload, parsing, page load, preview, or automatic batch
processing. Production-like suggestions require server-side live provider
configuration and `OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING`. If unavailable, the
teacher continues manual review without a fake suggestion. Test-only mock
suggestions remain limited to smoke tests. Suggestions are teacher-facing
guidance only, not ground truth. They require field-level Accept, Edit and
accept, Reject, or Leave blank review, and non-empty teacher-authored fields are
not overwritten by default. Teachers are responsible for copyright, licensing,
and permission to use imported test-bank content before a classroom pilot.

Diagnostic focus, target reasoning notes, strong-reasoning notes, and the
single plain-language distractor diagnostic note box are teacher-only and may
support internal LLM interpretation. Teacher-authored MCQs are initial
administration items; later follow-up, diagnostic contrast, and transfer
activities are generated by the formative activity flow. A selected distractor
is indirect evidence only and must be interpreted with the student's reasoning,
confidence, process/timing evidence, revisions, and response patterns. Student
previews and student assessment pages must show only the item stem, visible
options, and safe media fields. They must not expose correct options, answer
keys, raw diagnostic notes, distractor notes, misconception IDs, storage keys,
media hashes, or internal metadata. JSON import remains available for prepared
item sets.

Phase 31N media authoring is optional and should be used only when the media
helps students apply, analyze, or evaluate the target concept. Each media asset
needs an accessible description; video links need a transcript or content
summary. Media URLs must use HTTPS, and browser uploads stay disabled unless
server-side storage is configured. LLM interpretation receives descriptions and
summaries through `llm_media_context`; it does not receive direct image/video
content in this phase and must not infer unseen media content from URLs.

## LLM Diagnostic Context Readiness

The pilot build now includes a shared internal
`assessment-interpretation-context-v1` for substantive LLM interpretation. The
context carries assessment diagnostic focus, administered item snapshot IDs,
teacher target/strong reasoning guidance, plain-language distractor diagnostic
guidance, interpretation cautions, observed student evidence, safe process
summaries, and the current phase. It is used to keep item administration,
profile integration, formative value selection, formative activity
generation/review, and post-activity response evaluation aligned to the same
authorized assessment design.

This is an engineering readiness control, not a classroom-validity claim. The
LLM must still treat teacher notes as guidance, not ground truth; it must
prioritize observed student reasoning and uncertainty; and it must preserve
alternative explanations. Agent-call audit metadata proves context presence with
schema version, snapshot IDs, hashes, and boolean flags only. Raw teacher notes,
answer keys, correct options, raw provider output, prompts, process payloads,
credentials, and secrets remain excluded from student-facing surfaces.

No-live check:

```bash
npm run student:llm-diagnostic-context-propagation-smoke
```
