# Assessment Completion

Phase 6D3 completes an assessment only after the student explicitly chooses completion from the final concept unit.

## Final Concept

The backend determines the final concept from the published concept-unit order. No client-provided concept order, LLM output, or teacher intervention can mark a concept as final.

## Completion Flow

When the final concept follow-up is active, the student may request movement and choose:

- stay and continue follow-up
- complete assessment
- save and exit

If unprocessed substantive evidence exists, the same final profile/planning update workflow runs before completion. If evidence remains unresolved or unknown, the student receives neutral confirmation before completion.

## Terminal State

Successful completion sets:

- `assessment_sessions.status = completed`
- `assessment_sessions.current_phase = session_completed`
- `assessment_sessions.completed_at`
- the source `concept_unit_sessions.status = completed`

`session_completed` is terminal.

## Verification

Run:

```bash
npm run assessment:completion-smoke
```
