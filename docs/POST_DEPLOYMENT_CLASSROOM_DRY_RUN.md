# Post-Deployment Classroom Dry Run

Use this checklist after the Render staging deployment is live and before sharing the Canvas link with students.

Record only safe observations: pass/fail status, public IDs, timestamps, artifact paths, and limitations. Do not record secrets, database URLs, raw provider payloads, raw prompts, answer keys, correct options, distractor metadata, raw process payloads, or unapproved raw student text.

## Checklist

1. Visit the staging URL:
   - Expected: the public HTTPS EDPY 507: Measurement Theory landing page loads with a University of Alberta dark green top bar, gold accent, and the authorized official UAlberta logo/wordmark.
   - Expected: the page still presents itself as the EDPY 507 course activity, not a central University of Alberta login or Canvas integration.

2. Visit `/api/health`:
   - Expected: HTTP 200 with safe health fields only.

3. Teacher login:
   - Expected: approved teacher/research account can sign in, see the green/gold dashboard shell, use Log out, and return to the public landing page.

4. Student login:
   - Expected: approved test student can sign in with classroom ID and temporary password/access code or a student-changed password.

4a. Fresh database bootstrap:
    - Expected: if the Render database was fresh, `npm run staging:bootstrap-pilot` has been run once after migrations, temporary credentials were stored securely, and no raw passwords/access codes were left in Render logs or committed files.
    - If the database had older temporary-credential students from before the first-login gate, run `MARK_STUDENT_PASSWORD_CHANGE_ENABLED=true npm run staging:mark-students-must-change-password` once. Optional filters are `MARK_STUDENT_USER_ID=<student-user-id>` and `MARK_STUDENT_CLASSROOM_ID=<classroom-id>`.

4b. Teacher-managed account check:
    - Expected: teacher can create a student with `user_id`, optional display name, optional email, and a generated or set temporary password; student is prompted to choose a new password and cannot start or continue assessments until changing it; teacher can reset a forgotten password without seeing any current password.
    - Expected: deactivate/reactivate remains reversible. Irreversible deletion is available only after a preview and exact typed `student_id` plus `DELETE`; use it only for approved staging/test cleanup or approved withdrawal workflows. The deletion warning must state that previously downloaded exports are outside this system and cannot be removed here.

5. Complete a session:
   - Expected: the student can start the fixed IRT MVP, complete the three protected initial items, review the package, and enter the activity path.

6. Submit an activity response:
   - Expected: activity response is accepted or safely rejected with student-safe wording. The UI must not reveal internal provider, validator, schema, answer-key, or metadata details.

7. Move on:
   - Expected: the student can choose another activity or move on through the supported pathway without teacher intervention.

8. Teacher session detail:
   - Expected: teacher/research user sees session status, safe audit summaries, and no protected raw internal data.

9. Readable transcript:
   - Expected: transcript is readable and student-safe. It must not show answer keys, correctness labels, raw provider output, or hidden metadata.

10. Structured event log:
    - Expected: process-event rows and conversation turns are visible to teacher/research users in safe serialized form.

11. Session evidence audit:
    - Expected: evidence completeness, profile/formative/activity statuses, and known limitations are visible without exposing secrets.

12. Research download:
    - Expected: export downloads from the app and contains approved research fields.

12a. Simple CSV downloads:
    - Expected: `/teacher/data/explorer` downloads the assessment CSV, selected-student CSV, and student-assessment matrix CSV. They should contain safe count/status summaries only and must not include raw responses, answer keys, correct options, correctness labels, raw process payloads, provider output, diagnostic notes, credentials, or secrets.
    - If using media-enabled items, confirm exported/session-visible media fields are limited to safe display URLs, titles, descriptions, captions, transcripts/summaries, and attribution. They must not include storage keys, media hashes, answer keys, correct options, raw distractor notes, credentials, or secrets.

12b. Assessment lifecycle:
    - Expected: `/teacher/content/assessments` hides archived mini tests by default, can show archived/all mini tests with filters, and can restore archived mini tests. Permanent assessment deletion is only in the assessment detail danger zone after previewed aggregate counts and exact typed confirmations. Do not use delete-all on pilot data unless there is an approved withdrawal or staging cleanup reason.

13. Export integrity review:
    - Expected: if possible, bring the export ZIP back to the local protected environment and run the export integrity review. Do not commit the ZIP.

14. Add URL to Canvas:
    - Expected: Canvas assignment or module contains only the external HTTPS EDPY 507 landing-page link and approved login instructions.

15. Test Canvas link from student view:
    - Expected: student view opens the public EDPY 507 landing page in a browser, students authenticate in Conversational MCQ, and Canvas does not receive grade passback or research data.

## Stop Conditions

Stop the dry run and do not share the Canvas link if any of these occur:

- `/api/health` fails;
- teacher or student login fails;
- first-run bootstrap was not completed on a fresh database;
- teacher-managed student-account creation, password change, or reset fails;
- temporary-credential students can reach assessment start/continue before changing password;
- migrations did not run;
- student UI exposes answer keys, correctness, distractor metadata, internal labels, or provider/audit metadata;
- live provider failures show unsafe messages to students;
- research export is unavailable or includes unapproved protected data;
- Render logs or browser output expose credentials;
- the Canvas setup attempts LTI, OAuth, grade passback, roster sync, Developer Keys, or Canvas API integration.
