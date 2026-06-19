# Phase 0 Specification Lock

This document records the approved Phase 0 decisions that future implementation phases must follow.

## Source Of Truth

The final Phase 0 patch is authoritative. If older planning notes conflict with this document, follow this document.

## Identity And Foreign Keys

- `users.id` is the internal UUID primary key.
- `users.user_id` is the classroom login and research linkage ID.
- Internal foreign keys use `*_db_id`.
- Public or research-facing IDs are used for exports and public routes where appropriate.
- `assessment_sessions.user_db_id` must reference `users.id` when the assessment session schema is added.
- The master CSV must export `users.user_id`, not internal UUIDs.

## Authentication

- Student login requires `user_id` plus a roster-issued access code or password.
- Teacher researcher login requires a password.
- Login with `user_id` alone is not allowed.
- Sessions use secure HTTP-only cookies.

## Model Configuration

- Do not state that any specific OpenAI model is currently latest.
- Model names must be configured through environment variables and must not be hardcoded.
- Each future agent call must store the actual `model_name` used.
- Phase 1 and Phase 1.5 do not call the OpenAI API.

## Agent Schema Rules

- Agent outputs use `output_status`, not the older agent-level `status`.
- All agent outputs extend `AgentOutputBase`.
- Student profiling must keep three connected layers:
  - `ability_profile`
  - `engagement_profile`
  - `integrated_diagnostic_profile`

## Locked Profiling Enums

`ability_profile` values:

- `insufficient_evidence`
- `minimal_or_no_demonstrated_understanding`
- `fragmented_or_limited_understanding`
- `partial_understanding`
- `misconception_based_understanding`
- `fragile_correct_understanding`
- `procedural_or_application_error`
- `mostly_correct_understanding`
- `robust_transfer_ready_understanding`

`engagement_profile` values:

- `insufficient_process_evidence`
- `low_engagement`
- `variable_engagement`
- `adequate_engagement`
- `productive_engagement`
- `sustained_high_engagement`

`integrated_diagnostic_profile` values:

- `insufficient_evidence_for_formative_decision`
- `low_engagement_limits_interpretability`
- `conflicting_evidence_needs_clarification`
- `developing_understanding_with_productive_engagement`
- `misconception_with_sufficient_engagement`
- `correct_but_fragile_understanding`
- `correct_but_independence_uncertain`
- `underconfident_but_reasoning_supported`
- `robust_understanding_ready_for_transfer`

`evidence_sufficiency` values:

- `insufficient`
- `limited`
- `adequate`
- `strong`

`confidence_alignment` values:

- `insufficient_evidence`
- `underconfident`
- `well_calibrated`
- `overconfident`
- `mixed`

`independence_interpretability` values:

- `not_applicable`
- `independent_understanding_likely`
- `independent_understanding_uncertain`
- `insufficient_evidence`

`formative_value` values:

- `diagnostic_clarification`
- `reasoning_refinement`
- `confidence_calibration`
- `independent_understanding_verification`
- `consolidation_or_transfer`

`response_package.package_type` values:

- `initial_concept_unit_response_package`
- `followup_evidence_update_package`
- `combined_concept_unit_evidence_package`

## Student Profiling Rationale

The Student Profiling Agent produces ability, engagement, and integrated diagnostic profiles. Ability profile represents the quality of demonstrated understanding. Engagement profile represents how the student participated and how interpretable the evidence is. Integrated diagnostic profile combines ability and engagement evidence to support formative decision-making. Process data are used as contextual evidence for engagement and evidence sufficiency, not as misconduct evidence.

Correctness is evidence, not the profile itself. The same correct answer may indicate robust understanding, fragile understanding, guessing, or resource-mediated work depending on reasoning quality, confidence alignment, distractor rationale, transcript evidence, and process traces. Similarly, a confused or incomplete response may reflect limited understanding, low engagement, missing evidence, or low motivation. Therefore, the system should not rely on ability_profile alone. The Formative Value and Planning Agent should primarily use the integrated_diagnostic_profile, while also considering ability_profile, engagement_profile, evidence_sufficiency, confidence_alignment, independence_interpretability, and process interpretation cautions.

Process data may inform engagement and evidence sufficiency. It must never be treated as automatic misconduct evidence.

## Follow-Up

- Follow-up has no pedagogical maximum number of turns.
- Technical safeguards are required: idle timeout, resume support, API retry limits, daily usage logging, token and cost tracking, runaway loop detection, and dashboard flags for unusually long follow-up sessions.
- Safeguards support reliability, cost awareness, and teacher_researcher visibility. They should not automatically block the student unless there is a technical failure or policy-breaking behavior.

## Prompt Injection Protection

Student messages are untrusted input. They must never change:

- system role
- assessment phase
- scoring rules
- hidden prompts
- answer keys
- orchestration rules
- teacher-only metadata
- agent instructions
- model settings
- schema requirements

Prompt injection attempts must be logged as `prompt_injection_attempt`. During initial administration, they also count as `invalid_help_request`.

## Phase Transition Rules

Assessment phase transitions are deterministic and service-validated. LLM judgment must not determine phase transitions.

- Arbitrary phase jumps are rejected and logged as `transition_rejected`.
- Valid phase changes log `phase_exited`, `transition_validated`, and `phase_entered`.
- Active phases may transition to `student_exited`.
- Blocking failures may transition to `needs_review`.
- `session_completed` is terminal and must not return to active phases.
- Calling a phase update when the session is already in that phase updates activity time but does not re-log the same transition.

## Phase 3C Content Governance

The system should maximize teacher design autonomy before classroom use while preserving content stability after student data collection begins. The teacher determines the concepts, item membership, item content, answer options, correct answers, distractor rationales, reasoning expectations, misconception indicators, ordering, and publication timing. The system enforces only the minimum structural and research-integrity rules needed for valid administration and auditable data.

Teacher-defined concept boundaries remain authoritative. The system must not impose a fixed concept taxonomy, infer concepts automatically, group items automatically, rename teacher concepts, or call an LLM for content decisions in Phase 3C.

Candidate items are distinct from included published items. Draft concept units may contain more than 4 candidate items. A published concept unit must contain exactly 3 to 4 active items where `items.included_in_published_set = true`. Draft or archived candidates may remain associated with the concept unit.

Content lifecycle:

- `draft`: editable by teacher_researcher.
- `published_unused`: published and available for future administration, but can explicitly return to draft because no student session has started.
- `locked_after_student_session`: computed when at least one `assessment_sessions` row exists for the assessment.
- `archived`: not accepting new sessions, with historical records preserved.

After the first student session exists, assessment metadata, concept-unit membership/order/content, item membership/order/content, correct answers, rationales, and version-relevant content are read-only. Individual item or concept-unit archive operations are rejected when they would mutate administered content. Whole-assessment archive remains allowed to prevent future new sessions while preserving research records.

Process data and session existence are used for content-lock state and engagement/evidence context. They are not misconduct labels.

Future Phase 4 session start must atomically verify that the assessment is published, not archived, has at least one valid published concept unit, and has structurally valid published concept units; then it must create the student session and establish the content lock without allowing a teacher edit race.

## Phase 4A Initial Administration Backend

Phase 4A implements backend foundations for student assessment availability, atomic session start/resume, initial concept-unit administration, safe item delivery, item response persistence, revision and skip handling, missing-evidence repair, process-event ingestion, initial response-package creation, API routes, documentation, and smoke testing.

Phase 4A remains backend-only. It must not implement the ChatGPT-style student assessment UI, OpenAI API calls, any LLM agents, profiling, planning, follow-up, teacher session-review dashboard details, or CSV export.

Student assessment routes use public IDs at route boundaries and internal UUIDs only inside trusted backend services. Student payloads must never expose answer keys, correctness, distractor rationales, expected reasoning patterns, misconception indicators, teacher-only administration rules, profile labels, formative decision labels, or internal UUID fields.

Published, non-archived assessments are available to authenticated students in the one-course v1 when they contain at least one structurally valid published concept unit. Each student gets one default attempt per assessment through `assessment_sessions.attempt_number = 1` and the uniqueness rule on `user_db_id + assessment_db_id + attempt_number`. Future teacher-authorized retakes remain possible through higher attempt numbers; Phase 4A does not implement retake authorization.

Repeated Start requests resume the existing non-completed attempt-1 session rather than creating duplicates. A completed attempt must not automatically create a new attempt. Session start must run inside a safe transaction, enforce Phase 3C governance checks, select concept units by teacher-defined `order_index`, and create or reuse the current concept-unit session.

Initial administration state is deterministic and derived from database state, not from a client-supplied next step. The approved Phase 4A next-step values are:

- `concept_unit_intro`
- `present_item`
- `request_reasoning`
- `request_confidence`
- `missing_evidence_repair`
- `item_complete`
- `initial_concept_unit_complete`
- `awaiting_profiling`

Initial item responses may be revised until the concept-unit initial administration is completed. Revision history is preserved through process events and conversation turns, while the current `item_responses` row stores the latest initial response baseline. After `concept_unit_sessions.initial_completed_at` is set, all initial response mutations must fail with `initial_response_locked_after_concept_completion`. Later follow-up evidence must be stored separately and must not overwrite the initial response baseline.

Correctness is calculated by backend logic only and is stored as research evidence. Correctness feedback is not returned to students during initial administration. Explicitly skipped items use the semantically accurate `unanswered` correctness value and skipped flags rather than inventing a response or storing a misleading incorrect answer.

Missing-evidence repair gives one repair opportunity before finalizing incomplete evidence. If the student deliberately confirms skipping missing answer, reasoning, or confidence evidence, the system records skipped flags and preserves lower evidence availability for later profiling. Missing evidence is not treated as incorrect reasoning.

Frontend process-event ingestion accepts only trusted browser-context event types from authenticated session owners, forces `event_source = frontend`, uses server receipt time as the canonical timestamp, validates duration and payload limits, and stores process data as engagement/evidence context only. Browser clients must not assert backend, system, agent, scoring, validation, invalid-help, or prompt-injection event labels.

Completing initial concept-unit administration requires every included active item to have a finalized response or explicit skip. Completion transitions through `initial_concept_unit_completed` to `profiling_pending`, creates exactly one `initial_concept_unit_response_package` for the concept-unit session, and does not call the Student Profiling Agent.

## Phase 4B Student Initial Administration UI

Phase 4B implements the student-facing platform and ChatGPT-style interface for initial concept-unit administration using the Phase 4A backend. It must not implement OpenAI integration, LLM agents, profiling, formative planning, follow-up, teacher session-review dashboard details, or CSV export.

Student routes:

- `/student/assessment`: protected assessment list using `GET /api/student/assessments/available`.
- `/student/assessment/[sessionPublicId]`: protected conversation-style session page using public session IDs.

The backend orchestrator remains authoritative for assessment state, allowed actions, item order, concept-unit order, correctness calculation, content locking, response locking, and missing-evidence requirements. The frontend must not independently calculate correctness, infer scores, override phase transitions, skip item order, or decide evidence sufficiency.

The student UI uses a stable `StudentConversationFrame` contract with deterministic Phase 4B wording. The future Response Collection Agent may later generate natural wording inside the same contract, but it must not control phase transitions, correctness, answer keys, evidence requirements, or no-feedback rules. Replacing deterministic wording with an LLM must not require rebuilding the student UI.

Initial administration remains structured data collection inside a conversational shell. The UI may use clickable MCQ options, free-text reasoning input, low/medium/high confidence controls, explicit skip actions, a review panel, save-and-exit, resume, and refresh recovery. It must not behave like an unrestricted chat system before the Response Collection Agent exists.

The student interface must not provide correctness feedback, hints, explanations, tutoring, content clarification, profile labels, formative labels, ability estimates, engagement estimates, process interpretation cautions, or agent rationale during initial administration.

Browser process-event logging is limited to approved frontend event types: `page_hidden`, `page_visible`, `long_pause`, `inactivity_detected`, `navigation_event`, and `refresh_recovery`. These events are technical/process context for engagement and evidence sufficiency; they are not misconduct labels and must not capture clipboard contents, keystrokes, external browsing history, or claims about GenAI use.

## Phase 5A Teacher Session Review

Phase 5A implements the read-only teacher_researcher session-review platform over existing assessment-session records. It supports session listing, filtering, session detail review, concept-unit progress, item responses, correctness, reasoning, confidence, skipped evidence, revisions, timing, conversation transcript, process-event timeline and aggregates, response-package viewing, administered content snapshots, documentation, development fixtures, and smoke testing.

Teacher-review routes and APIs must require `teacher_researcher`, reject unauthenticated users, reject students with 403 at the API boundary, use public IDs at route boundaries, and avoid leaking internal UUIDs, password hashes, access-code hashes, cookies, auth tokens, environment variables, or secret configuration.

Phase 5A is read-only for research records. It must not edit item responses, change correctness, edit reasoning, edit confidence, delete transcript turns, delete process events, modify response packages, create student profiles, create formative decisions, create follow-up rounds, call OpenAI, or invoke any LLM agent.

The teacher UI may show correctness and answer snapshots as research evidence. It must not label students as high or low ability, rank performance, fabricate diagnostic profiles, fabricate formative values, or infer independence. Correctness is evidence, not a student profile.

Process data shown in Phase 5A are process context for engagement and evidence sufficiency. The UI and APIs must not label cheating, dishonesty, confirmed GenAI use, or misconduct. Prompt-injection and invalid-help events remain boundary/process events, not profile judgments.

Future agent sections may state that no student profile, formative decision, follow-up round, or LLM agent call exists. They must not show enum defaults as if they were generated agent output.

## Phase 5B Summative Outcomes And Master Export

Phase 5B implements teacher_researcher-only supervised summative outcome CSV import and one merged master assessment CSV export. It must not implement OpenAI integration, LLM agents, profiling, formative planning, follow-up conversation, or fabricated agent outputs.

Summative outcome import uses a preview-before-commit workflow:

- Input columns are `user_id`, `outcome_name`, `outcome_score`, `max_score`, `assessment_date`, and optional `notes`.
- `user_id` must resolve to an existing student user. Teacher_researcher accounts must not receive student outcomes.
- Preview records import-batch audit data but must not create outcome records.
- Commit uses the server-preserved normalized preview batch, not client-modified preview rows.
- Invalid rows, unmatched users, duplicate source rows, and conflicting active records are reported and block default commit.
- Exact duplicates of existing active outcomes may be treated as idempotent existing records.
- Explicit replacement supersedes the previous active record and creates a new active revision.

The internal database remains normalized. The exported `master_assessment_export.csv` is a derived research file, not the source of truth.

Master export row grain is one row per student, per assessment session, per concept unit, per item response. Placeholder rows are required for:

- `concept_unit_without_item_response`
- `session_without_item_response`

Incomplete and interrupted sessions must not disappear from export. Missing, skipped, incorrect, unanswered, and incomplete evidence must remain distinct.

Multiple summative outcomes must not multiply item-response rows. Export repeats the selected primary outcome columns across the relevant student's rows and stores all active outcomes in `summative_outcomes_json`.

Current and future agent/profile/formative columns are present in the master CSV, but they remain blank or empty arrays/counts until the relevant agents actually create database records. Correctness must not be converted into a profile, formative value, or independence interpretation.

Spreadsheet formula-injection protection is required for user-controlled text when `spreadsheet_safe_text = true`. The protection is applied only to exported values and must not alter database records. Local export files are stored under `.data/exports`, not public static folders, and downloads require teacher_researcher authorization.

## Foundational Logging Services

Process event logging validates `event_source` and the approved process-event taxonomy before writing. The database field remains a string to allow taxonomy expansion later. Process data remain engagement and evidence-sufficiency context, not misconduct labels.

Conversation turn logging validates phase and actor type and supports `student`, `agent`, `system`, `orchestrator`, and `teacher_researcher` turns. This is storage only; no LLM calls are implemented in Phase 2B.

Response packages are stored as JSON payloads and are future inputs to profiling. Phase 2B creates packages only; it does not call the Student Profiling Agent.

## Phase Boundaries

Phase 1 includes only project skeleton, basic routes, minimal auth, environment validation, Prisma setup, and the minimal `users` table.

Phase 1.5 includes only local environment stabilization, Docker PostgreSQL setup, migration verification, seed users, auth sanity checks, route protection foundations, and a health check.

Phase 2A includes only the normalized database schema, enum definitions, Prisma migration, database documentation, and database smoke testing.

Phase 2B includes only foundational backend services for process event logging, conversation turn logging, assessment session state persistence, deterministic phase transition validation, response package creation, and service-level smoke testing.

Phase 3A includes only teacher_researcher content management backend services, API routes, validation, JSON import, documentation, and smoke testing. It adds manual content management foundations for assessments, concept units, and items, but not the teacher item-management UI.

Phase 3B includes only the teacher_researcher manual content management UI integrated with the Phase 3A backend APIs. It adds pages for assessment listing/detail/create, concept-unit create/detail, item create/edit, and JSON import. It does not add unrelated dashboard sections.

Phase 3C includes only content governance, research-integrity lifecycle checks, candidate versus included item support, return-to-draft actions, documentation, and smoke testing. It must not implement Phase 4, student assessment conversation UI, LLM calls, agents, follow-up loop, session review dashboard details, or CSV export.

Phase 4A includes only the backend foundation for available assessments, atomic student session start/resume, deterministic initial concept-unit administration, student-safe item delivery, item response persistence/revisions/skips, missing-evidence repair, frontend process-event ingestion, initial response-package creation, API routes, documentation, and smoke tests. It must not implement Phase 4B, the student chat UI, OpenAI integration, LLM agents, profiling, formative planning, follow-up, the teacher session-review dashboard, or CSV export.

Phase 4B includes only the student-facing assessment list, ChatGPT-style initial administration UI, deterministic conversation presenter, student-safe transcript/review display, option/reasoning/confidence controls, missing-evidence repair UI, explicit skip UI, review/revision UI, save/exit/resume/refresh behavior, approved browser process-event logging, demo fixture scripts, UI documentation, and UI smoke testing.

Phase 5A includes only the read-only teacher_researcher session-review platform, teacher-only read APIs, review UI, fixtures, documentation, and smoke testing.

Phase 5B includes only supervised summative outcome CSV upload, validation, audit batches, outcome revisions, one merged master CSV export, export jobs/downloads/local storage, data-management UI, fixtures, documentation, and smoke testing.

Phase 1, Phase 1.5, Phase 2A, and Phase 2B must not implement:

- LLM agent calls
- OpenAI API calls
- full student assessment flow
- full teacher dashboard
- iterative follow-up loop
- CSV export

Phase 3A must not implement:

- teacher item-management UI
- student assessment conversation UI
- LLM agent calls
- OpenAI API calls
- any of the five LLM agents
- Response Collection Agent
- Student Profiling Agent
- Formative Planning Agent
- Follow-up Agent
- Item Preparation Agent
- formative follow-up loop
- master CSV export

Phase 3B must not implement:

- Phase 4 student assessment conversation UI
- LLM agent calls
- OpenAI API calls
- any of the five LLM agents
- Response Collection Agent
- Student Profiling Agent
- Formative Planning Agent
- Follow-up Agent
- Item Preparation Agent
- formative follow-up loop
- full dashboard session review, transcripts, profiles, process logs, flags, or agent-call views
- master CSV export

Phase 3C must not implement:

- Phase 4 student assessment conversation UI
- LLM agent calls
- OpenAI API calls
- any of the five LLM agents
- formative follow-up loop
- full dashboard session review, transcripts, profiles, process logs, flags, or agent-call views
- master CSV export

Phase 4A must not implement:

- Phase 4B student chat UI
- OpenAI API integration
- any of the five LLM agents
- Response Collection Agent
- Student Profiling Agent
- Formative Value and Planning Agent
- Follow-up Agent
- Item Preparation Agent
- profiling, formative planning, or follow-up
- teacher session-review dashboard details
- master CSV export

Phase 4B must not implement:

- OpenAI API integration
- any of the five LLM agents
- simulated Student Profiling Agent output
- Formative Value and Planning Agent output
- Follow-up Agent behavior
- formative follow-up conversation
- teacher session-review dashboard details
- master CSV export

Phase 5A must not implement:

- Phase 5B CSV export
- summative outcome upload
- OpenAI API integration
- any of the five LLM agents
- simulated Student Profiling Agent output
- simulated Formative Value and Planning Agent output
- follow-up conversation
- fabricated profiles, formative values, or agent rationales
- manual teacher editing of student answers, process events, response packages, profiles, or formative decisions

Phase 5B must not implement:

- OpenAI API integration
- any of the five LLM agents
- Student Profiling Agent behavior
- Formative Value and Planning Agent behavior
- Follow-up Agent behavior
- formative follow-up conversation
- fabricated profile, planning, follow-up, or agent-call data
- summative outcome gradebook editing beyond audited replacement
- separate CSV exports instead of the one merged master CSV

## Phase 3A Content Management Rules

- A concept-based item set is represented as a `concept_unit`.
- A publishable concept unit must contain exactly 3 to 4 included active MCQ items.
- MCQ options are structured JSON with `label` and `text`; 2 to 6 options are allowed.
- `correct_option` must match one option label.
- Every incorrect publishable option must have a distractor rationale.
- Expected reasoning patterns and possible misconception indicators are required before publishing.
- Correctness is later calculated by backend logic from selected option and correct option.
- Student-facing routes must not expose answer keys or distractor rationales.
- Teacher content routes may expose teacher-only item metadata.
- Draft content can be edited; published unused content must be explicitly returned to draft before direct editing.
- Student data collection locks research-relevant content after the first `assessment_sessions` row exists.
- Published content and locked content can be archived only through allowed archive workflows.
- Updating concept-unit or item content increments version when content-relevant fields change.
- If an item already has student responses, destructive mutation of `item_stem`, `options`, `correct_option`, or `distractor_rationales` is rejected.
- Normal API routes must archive rather than hard-delete content.
- JSON import is manual content upload only; it is not the future Item Preparation Agent and must not call an LLM.
- The Phase 3B UI must use the Phase 3A APIs for content writes and publishing. It must not bypass backend validation.
- Teacher_researcher UI may show correct options and distractor rationales. Student routes must not expose them.
