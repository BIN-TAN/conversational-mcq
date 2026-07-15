# Assessment Lifecycle and Timing Boundaries

This document defines attempt lifecycle semantics for the chat-native assessment workflow. It is a navigation and lifecycle specification only; it does not change timing formulas, browser instrumentation, scoring, item order, item content, profile ontology, or feedback-generation requirements.

## Attempt States

The runtime uses existing session status and phase fields to represent the attempt lifecycle:

- `active`: the attempt is currently usable.
- `paused`: the student chose Pause and leave; the same attempt can be resumed.
- `completed`: the assessment reached `session_completed`.
- `ended_by_student`: the student explicitly ended the attempt; it is terminal and cannot be resumed.
- `ended_by_teacher`: the teacher closed a stuck or test attempt; it is terminal and cannot be resumed.
- `expired`: reserved for future policy. No automatic expiry policy is implemented in this phase.

`student_exited` remains the stored terminal phase/status for ended attempts. It is not used for ordinary pause/resume.

## Student Controls

Student controls are intentionally separate:

- **Pause and leave** preserves the current state and records `attempt_paused` and `session_paused`.
- **End attempt** requires confirmation, preserves all records, records `attempt_end_requested` and `attempt_ended_by_student`, and makes the attempt terminal.

When a resumable attempt exists, the assessment list shows Resume attempt and End current attempt. It must not show a new Start button for the same assessment until the resumable attempt is completed or terminally ended.

## Teacher Controls

Teacher session review may show **Close attempt and allow another** for non-terminal attempts. This action:

- preserves the old attempt and all associated records;
- records `attempt_ended_by_teacher` and `new_attempt_available`;
- does not delete, reset, or overwrite prior attempt data;
- permits a future new attempt only when the assessment policy permits it.

## Attempt Policy Payload

Student availability payloads include an explicit `attempt_policy` object. The current policy is versioned as `assessment-attempt-policy-v1` and reports:

- attempts used;
- whether a resumable attempt exists;
- whether the student may end the current attempt;
- whether completed or terminal attempts permit a later new attempt;
- release/close window state.

There is no general maximum-attempts field in the current schema. When no configured maximum exists, `maximum_attempts` and `remaining_attempts` are `null`.

## Formative Navigation Labels

Student-facing formative activity controls use destination-specific labels. Generic **Move on** wording should not appear as a primary action label. Internal stored compatibility values such as `move_on` may remain in audit fields, evaluator schemas, or old records, but the formative-stage terminal UI label is **End assessment**.

The End assessment confirmation says: "This will end the assessment now. You will not complete another activity or transfer item in this attempt." It does not mention database persistence, research records, or system versions.

Ending from a formative activity records `formative_activity_skipped`, `finish_assessment_selected`, and `session_completed` with a terminal reason such as `ended_during_formative_activity`; it is not treated as a completed activity response.

## Timing Boundary

This phase does not alter timing capture or timing formulas. Lifecycle events add context for interpretation:

- `pause_count` and `resume_count` describe explicit navigation choices.
- `attempt_lifecycle_status` describes whether an attempt is active, paused, completed, or ended.
- timing variables such as active interaction time, page-hidden duration, idle ratio, response latency, and item response duration retain their existing definitions.

Do not infer understanding, effort, motivation, cheating, or misconduct from lifecycle events or timing values alone.

## Phase 31am Timing Contract

Future timing work should treat these lifecycle boundaries as authoritative:

- Active interval begins at `attempt_started` or `attempt_resumed`.
- Active interval ends at `attempt_paused`, `attempt_ended_by_student`, `attempt_ended_by_teacher`, `attempt_expired`, `assessment_completed`, or `assessment_completed_with_unresolved_evidence`.
- Offline duration between pause and resume is not active time.
- Skipped activity timing ends at `formative_activity_skipped`.
- Completion timing ends at the persisted completion transition and `assessment_completion_summary_shown`.
- Ended attempts remain distinct from completed attempts.

This phase does not implement those future calculations.

## Manual Verification Checklist

Use a test student only:

1. Start an assessment.
2. Pause from the first item.
3. Confirm Resume attempt appears on the assessment list.
4. Resume and confirm the same prompt/state returns.
5. End the attempt.
6. Confirm it cannot resume.
7. Confirm Start new attempt appears when policy allows it.
8. Start the next attempt and verify the attempt number increments.
9. Complete the three-item package.
10. Reach the formative activity.
11. Select the destination-specific skip/continue action.
12. Confirm transfer, next concept, or completion appears.
13. Confirm no blank page and no silent stop.
14. Confirm completion summary appears for completed attempts.
15. Confirm ended attempts show as ended, not completed.
16. Confirm old attempts remain in Teacher sessions and research exports.
