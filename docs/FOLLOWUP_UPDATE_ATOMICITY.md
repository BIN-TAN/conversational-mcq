# Follow-Up Update Atomicity

Phase 6D2B treats each follow-up evidence update as one atomic logical cycle.

## Authoritative State

Until the full cycle succeeds:

- `concept_unit_sessions.latest_student_profile_db_id` remains unchanged
- `concept_unit_sessions.latest_formative_decision_db_id` remains unchanged
- the current follow-up round remains authoritative
- the previous profile remains the active profile
- the previous formative decision remains the active decision

Staged outputs on `followup_update_cycles` are audit and retry data. They are not active profiles, active formative decisions, or student-facing output.

## Required Successful Stages

Normal iterative update:

1. create or reuse the follow-up evidence package
2. run updated profiling and stage the validated output
3. run updated planning and stage the validated output
4. generate and stage the next-round opening
5. commit the updated profile, updated decision, completed source round, new active round, opening turn, latest pointers, and completed update-cycle status in one transaction

Final stop update:

1. create or reuse the follow-up evidence package
2. run updated profiling and stage the validated output
3. run updated planning and stage the validated output
4. commit the final updated profile, final updated decision, completed source round, stopped session phase, latest pointers, and completed update-cycle status in one transaction

Final stop updates do not create a new follow-up round.

## Failure Rule

If profiling, planning, opening generation, or final activation fails, the cycle counts as no profile update.

For normal iterative failures:

- no active profile is created
- no active formative decision is created
- no new active follow-up round is created
- latest pointers do not change
- the previous round remains active
- the student composer can unlock under the old profile and old plan
- teacher review is flagged

For final stop failures:

- the previous profile remains active
- the previous decision remains active
- no new follow-up round is created
- the current round closes
- the session transitions to `followup_stopped`
- teacher review is flagged

All agent-call audit records and failed cycle records are preserved.

## Concurrency

Only one active update cycle may exist for a concept-unit session at a time. Worker retries must reuse the same evidence package and cutoff. Browser refreshes, repeated triggers, and stop requests during an active update must not duplicate packages, profiles, decisions, rounds, or opening messages.
