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

## Response Collection

Phase 7C Response Collection Agent handling does not create a teacher intervention channel. Teachers configure assessment response collection mode before student use. During active answering, the agent or deterministic fallback may respond to submitted student free-text within the no-feedback policy, but it cannot change option selection, confidence, phase, item order, concept progression, profile creation, planning, follow-up, or completion. Teacher review remains retrospective and read-only.

## Item Verification

Phase 7D Item Verification is pre-administration teacher content governance. It verifies teacher-authored concept-unit item sets before student use and is not a channel for intervention during an active student session.

Verification findings are teacher-only advisory warnings. They do not change item content, answer keys, concept assignment, publication state, student phases, profiles, formative decisions, follow-up rounds, or progression records. Once student data collection has locked an assessment, normal editing workflow does not rerun item verification to mutate or reopen administered content.

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
