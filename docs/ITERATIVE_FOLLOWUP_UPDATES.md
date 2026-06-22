# Iterative Follow-Up Updates

Phase 6D2B implements iterative follow-up evidence updating within the current concept unit only.

The update loop is:

```text
follow-up conversation
-> meaningful evidence detected
-> follow-up evidence update package
-> updated Student Profiling Agent candidate
-> updated Formative Planning Agent candidate
-> optional next-round opening candidate
-> atomic activation
```

## Trigger Policy

Immediate trigger categories:

- `agent_evidence_candidate`
- `reasoning_revision`
- `task_completion`
- `transfer_application`
- `understanding_claim`
- `move_on_request`

Fallback trigger:

- `substantive_turn_threshold`

`FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE` defaults to `3`. This is a technical fallback for backend updating, not a pedagogical maximum number of turns.

Nonsubstantive messages such as brief acknowledgements, blank messages, and unrelated social turns should not trigger updating. Process events alone must not trigger updating.

## Evidence Packages

Each update cycle creates or reuses one `followup_evidence_update_package` with a stable cutoff. Retries use the same package and cutoff; later student messages belong to a future cycle.

The package may include follow-up turns, assistant turns needed for context, substantive-turn classifications, trigger reasons, advisory move-on flags, process events, process aggregates, source profile and decision references, and concept metadata. It must not include authentication secrets, provider secrets, unrelated summative outcomes, or raw environment values.

## Manual And Automatic Modes

Automatic sessions create the package, create the update cycle, and enqueue workflow jobs without requiring either browser to stay open.

Manual-review sessions flag teacher review and expose a teacher-only Run follow-up update action. The student conversation may continue until the teacher starts the update.

## Boundaries

Phase 6D2B does not start another concept unit, select a next concept, mark the assessment completed, implement Response Collection Agent LLM behavior, implement live Item Preparation behavior, alter initial responses, modify the master CSV export, or expose diagnostic/profile/planning labels to students.

See `docs/FOLLOWUP_EVIDENCE_UPDATES.md` and `docs/FOLLOWUP_UPDATE_ATOMICITY.md` for the detailed implementation rules.
