# Classroom Non-Intervention

Phase 6D3 enforces the standard classroom rule:

Teachers design and publish the assessment before classroom use. Once a student begins an assessment, the normal answering, follow-up, concept-progression, and completion workflow proceeds without teacher approval or real-time intervention.

## Teacher Review

Teacher review remains retrospective and read-only for active student records. The teacher may inspect:

- session status
- responses
- transcript
- process events
- response packages
- profiles and formative decisions already generated
- workflow jobs and exceptions
- progression history

The teacher must not approve, deny, force, skip, reopen, edit, or complete an individual active student workflow in normal classroom mode.

## Account Administration

Phase 7A account actions are administrative access controls, not assessment interventions. A teacher_researcher may create accounts, reset access codes, deactivate accounts, and reactivate accounts. These actions must not edit answers, alter correctness, change profiles, change formative decisions, complete sessions, cancel sessions, or move a student through concept progression.

Inactive accounts cannot log in or continue a session, but existing assessment records, transcripts, process events, profiles, decisions, and outcomes remain preserved.

## Development Controls

`DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED=false` by default.

When false:

- active-session intervention buttons are hidden
- active-session mutation APIs reject with `active_session_controls_disabled`
- automatic workflow continues through backend services

Development smoke tests may set this flag to true explicitly.

## Manual Review Starts

`ALLOW_MANUAL_REVIEW_STUDENT_STARTS=false` by default.

When false, manual-review assessments do not accept ordinary student starts. Existing sessions remain resumable.

## Verification

Run:

```bash
npm run classroom:nonintervention-smoke
```
