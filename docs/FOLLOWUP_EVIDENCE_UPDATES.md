# Follow-Up Evidence Updates

Phase 6D2B implements iterative evidence updating within the current concept unit.

## Scope

Implemented:

- meaningful follow-up evidence detection from Follow-up Agent output
- `followup_evidence_update_package`
- staged `followup_update_cycles`
- updated Student Profiling Agent execution
- updated Formative Value and Planning Agent execution
- new follow-up round after full success
- final profile/planning update when a student stops with unprocessed substantive evidence
- automatic and manual-review behavior
- async workflow jobs
- teacher exception visibility
- student-safe updating state

Not implemented:

- next-concept progression
- Response Collection Agent LLM behavior
- live Item Preparation Agent behavior
- formative follow-up beyond the current concept
- master CSV changes
- any student-facing diagnostic/profile/formative labels

## Atomic Activation

The active profile, active formative decision, and current active follow-up round remain authoritative until the entire cycle succeeds:

1. create follow-up evidence package
2. run updated profiling
3. run updated planning
4. generate next-round opening unless this is a final stop update
5. commit the updated profile, updated decision, source-round completion, and optional next round in one transaction

If any stage fails, staged outputs remain audit data only. Latest pointers do not change, no new active round is created, and teacher review is flagged.

## Trigger Policy

Immediate trigger reasons:

- `agent_evidence_candidate`
- `reasoning_revision`
- `task_completion`
- `transfer_application`
- `understanding_claim`
- `move_on_request`

Fallback trigger:

- `substantive_turn_threshold`

`FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE` defaults to `3`. It is a technical fallback, not a maximum number of follow-up turns.

Manual-review sessions flag teacher review and expose a teacher-only Run follow-up update action. Automatic sessions create a cycle and enqueue jobs without requiring a browser to stay open.

## Student Boundary

During update processing the student sees neutral saved-progress copy and a disabled composer. Students may save/exit or request stop. The student payload must not expose:

- profile labels
- formative values
- correctness or answer keys
- cycle IDs
- workflow job names
- model/provider names
- prompt or schema internals
- internal errors

## Teacher Review

Teacher review shows cycle status, trigger type, evidence cutoff, staged-output presence, failure details, and whether active pointers changed. It must distinguish staged audit data from active saved profiles and decisions.

Process data remain contextual evidence for engagement and evidence sufficiency. They are not misconduct labels.

## Verification

```bash
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
npm run student:followup-update-ui-smoke
```

These scripts use the mock provider and do not call OpenAI.
