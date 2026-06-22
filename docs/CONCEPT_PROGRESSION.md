# Concept Progression

Phase 6D3 implements deterministic, student-led movement from one concept unit to the next.

## Classroom Rule

Teachers design and publish the assessment before classroom use. Once a student begins an assessment, the normal answering, follow-up, concept-progression, and completion workflow proceeds without teacher approval or real-time intervention.

## Ordering

The next concept is the next published `concept_units.order_index` within the assessment. The student cannot choose an arbitrary concept, the teacher cannot choose a student-specific next concept after the session begins, and no LLM can reorder or skip concepts.

## Student Request

During active follow-up, the student can click `I'm ready to move on`. This creates a trusted `concept_progression_records` request and does not immediately move the student.

The student then chooses:

- non-final concept: continue current concept, next concept, or save and exit
- final concept: stay and continue follow-up, complete assessment, or save and exit

## Final Update And Resolution

If unprocessed substantive follow-up evidence exists when the student chooses next/complete, the backend runs a final follow-up update with `final_update=true`, `create_next_round=false`, and `post_cycle_action` set to `advance_to_next_concept` or `complete_assessment`.

Resolution is deterministic:

- `resolved`: latest active integrated diagnostic profile is `robust_understanding_ready_for_transfer` and evidence sufficiency is `adequate` or `strong`
- `unresolved`: latest active profile exists but does not meet the resolved rule
- `unknown`: no active profile is available

Unresolved or unknown evidence asks for neutral student confirmation. The UI does not expose profile labels or readiness labels.

## Read-Only Prior Concepts

After progression, previous concept units are read-only. Student mutation attempts against non-current concept items return `concept_no_longer_current`.

## Verification

Run:

```bash
npm run concept:progression-smoke
npm run student:progression-ui-smoke
```
