# Course Generalization

The platform is deployed for one course at a time, but its assessment structures, orchestration, data model, and agent contracts are course-domain agnostic. Teachers define the concepts, learning objectives, items, reasoning expectations, and misconception indicators used in each deployment.

Phase 6D2A does not add a `courses` table. One deployment instance represents one course context in v1.

Implementation rules:

- Do not hardcode a discipline, unit, curriculum, or concept taxonomy.
- Use teacher-defined assessment, concept-unit, item, rationale, reasoning, and misconception metadata.
- Keep `users.user_id` as the classroom/research-facing identifier.
- Keep internal relations on UUID `id` fields and `*_db_id` foreign keys.
- Use `COURSE_TIMEZONE` for course-local schedule display and parsing.
- Store database timestamps as UTC instants.

Future multi-course support should add explicit course ownership and enrollment tables rather than overloading assessment IDs or user IDs.
