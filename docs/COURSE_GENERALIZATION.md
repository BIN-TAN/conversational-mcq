# Course Generalization

The platform is deployed for one course at a time, but its assessment structures, orchestration, data model, and agent contracts are course-domain agnostic. Teachers define the concepts, learning objectives, items, reasoning expectations, and misconception indicators used in each deployment.

Phase 6D2A does not add a `courses` table. One deployment instance represents one course context in v1.

Implementation rules:

- Do not hardcode a discipline, unit, curriculum, or concept taxonomy.
- Use teacher-defined assessment, concept-unit, item, rationale, reasoning, and misconception metadata.
- Keep `users.user_id` as the classroom/research-facing identifier.
- Use `users.user_id_normalized` only for matching and uniqueness. Preserve canonical `users.user_id` for display, routes, summative outcome linkage, and exports.
- Keep internal relations on UUID `id` fields and `*_db_id` foreign keys.
- Use `COURSE_TIMEZONE` for course-local schedule display and parsing.
- Store database timestamps as UTC instants.

Future multi-course support should add explicit course ownership and enrollment tables rather than overloading assessment IDs or user IDs.

Phase 7A remains one-course. Roster import does not add sections, courses, emails, or enrollment tables. Future multi-course support should add explicit course membership rather than changing the meaning of `users.user_id`.

## Phase 6D3 Progression

Concept progression remains course-domain agnostic. The backend uses teacher-defined `concept_units.order_index` and does not hardcode a subject-specific concept sequence, infer a taxonomy, or let an LLM choose the next concept. One deployment still represents one course context in v1.

## Phase 7B Export

The master CSV remains course-domain agnostic. It exports teacher-defined assessment, concept-unit, item, profile, decision, follow-up, progression, workflow, and summative outcome records without adding subject-specific columns or changing the canonical identity meaning of `users.user_id`.

## Phase 7C Response Collection

The Response Collection Agent remains course-domain agnostic. It receives student-safe current item wording, visible options, current response state, recent bounded transcript, and procedural policy. It does not receive a fixed subject ontology or hardcoded example answers. It must not receive answer keys, distractor rationales, expected reasoning patterns, misconception indicators, or teacher diagnostic metadata during initial administration.

## Phase 7D Item Verification

The Item Verification Agent remains course-domain agnostic. It verifies only the teacher-defined concept metadata and teacher-authored MCQ item set supplied for the current concept unit. It may flag possible relevance, alignment, ambiguity, answer-key, distractor, cueing, duplication, or insufficient-information issues, but it must not recommend a different concept taxonomy, generate course content, rewrite learning objectives, rewrite items, or suggest replacement options.

One deployment still represents one course context in v1. Item verification uses public content IDs and content fingerprints for auditability; it does not introduce a course table or change the meaning of `users.user_id`.
