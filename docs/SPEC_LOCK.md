# Phase 0 Specification Lock

This document records the approved Phase 0 decisions that future implementation phases must follow.

## Source Of Truth

The final Phase 0 patch is authoritative. If older planning notes conflict with this document, follow this document.

## One-Course Deployment Rule

The platform is deployed for one course at a time, but its assessment structures, orchestration, data model, and agent contracts are course-domain agnostic. Teachers define the concepts, learning objectives, items, reasoning expectations, and misconception indicators used in each deployment.

There is no `courses` table in v1. A deployment instance represents one course context. Code and prompts must avoid hardcoded domain assumptions.

## Identity And Foreign Keys

- `users.id` is the internal UUID primary key.
- `users.user_id` is the classroom login and research linkage ID.
- Internal foreign keys use `*_db_id`.
- Public or research-facing IDs are used for exports and public routes where appropriate.
- `assessment_sessions.user_db_id` must reference `users.id` when the assessment session schema is added.
- The master CSV must export `users.user_id`, not internal UUIDs.

## Authentication

- Student login requires `user_id` plus a roster-issued access code or password. Phase 7A classroom accounts use assigned access codes; login with `user_id` alone is invalid.
- Teacher researcher login requires a password.
- Login with `user_id` alone is not allowed.
- Sessions use secure HTTP-only cookies.
- Student self-registration, email delivery, SMS delivery, and student-created passwords are not implemented in v1.
- Access-code reset, student deactivation, and student reactivation increment `users.auth_version` and invalidate old student cookies.
- Inactive students cannot log in, start assessments, resume sessions, participate in follow-up, or complete assessments. Existing research records remain preserved.

## Student Account Management

- `users.user_id` is the canonical classroom and research ID and is immutable through normal teacher UI/API routes.
- `users.user_id_normalized` supports trim, Unicode normalization, and lowercase matching. Case-only duplicates such as `Student001` and `student001` are forbidden.
- Canonical `users.user_id` remains unchanged for display, routes, summative outcome linkage, and master CSV export.
- `users.display_name` is optional and may be updated by the teacher_researcher without changing research linkage.
- `users.account_status` is `active` or `inactive`.
- Plaintext access codes must never be stored in the database, process events, account audit records, import history, exports, or Git fixtures.
- Plaintext access codes may be shown only immediately after manual student creation, roster commit for newly created students, or access-code reset.
- No hard-delete teacher UI/API exists for students. Use deactivation to preserve longitudinal classroom and research linkage.
- Roster import is preview-before-commit. Preview does not create users, generate access codes, reset codes, update display names, or deactivate missing students.
- Missing rows in a later roster import must not automatically deactivate students.
- Teacher accounts must not be manageable through student roster actions.

## Model Configuration

- Do not state that any specific OpenAI model is currently latest.
- Model names must be configured through environment variables and must not be hardcoded.
- Each future agent call must store the actual `model_name` used.
- Phase 6A defaults to `LLM_PROVIDER=mock` and `LLM_LIVE_CALLS_ENABLED=false`.
- Live OpenAI calls require an explicit server-side environment gate, a configured API key, and environment-configured model names.
- The OpenAI API key must never be exposed to the browser or committed to source control.
- Phase 6D2A automatic workflow jobs must respect the same server-side live-call gates and usage guards as manual agent triggers.

## Phase 7E1 Evaluation Harness

- Phase 7E1 evaluation is internal development evaluation, not classroom validation.
- Evaluation cases must be synthetic, teacher-authored, or intentionally deidentified. Phase 7E1 fixtures use only synthetic cases.
- Evaluation runs must not use real student data, summative outcome data, or classroom records as case sources.
- Evaluation outputs are isolated in eval tables. They must not create or update operational `student_profiles`, `formative_decisions`, `followup_rounds`, `item_verification_runs`, assessment sessions, item responses, or workflow jobs.
- Phase 7E1 mock evaluation must not create `agent_calls` rows.
- Phase 7E1 must not call OpenAI and must not require an OpenAI API key.
- Future live evaluation target metadata is `EVAL_TARGET_MODEL=gpt-5.4-mini`, with `EVAL_LIVE_CALLS_ENABLED=false` by default.
- GPT-5.5 comparison and nano comparison are outside the current plan.
- Blind expert annotation hides provider/model by default and hides gold labels until explicitly shown.
- AI-assisted preliminary annotation imports must remain `draft` until a teacher_researcher reviews and confirms them. Drafts do not count toward human annotation completion or canary readiness.
- Evaluation annotation import validates structure, review-ID mapping, target-run
  compatibility, rubric-score ranges, pass/fail labels, and approved
  critical-failure flags. It must not enforce a hardcoded pass/fail
  distribution, hardcoded failed-case IDs, or predetermined per-agent pass
  rates. Pass/fail totals and per-agent rates are calculated results.
- Automated screening flags and human adjudication flags must remain separate. Automated false positives are preserved for review but are not silently converted into confirmed human critical failures.
- Critical failure flags are fixed labels and include schema, hidden-prompt, secret, answer-leak, hint/explanation, misconduct, GenAI-use, profile-label, formative-value, item-generation, content-override, internal-metadata, and unsupported-certainty failures.

## Agent Schema Rules

- Agent outputs use `output_status`, not the older agent-level `status`.
- All agent outputs extend `AgentOutputBase`.
- The five valid active agent names are `item_verification_agent`, `response_collection_agent`, `student_profiling_agent`, `formative_value_and_planning_agent`, and `followup_agent`.
- `item_preparation_agent` is retired. Historical audit rows may preserve that string, but new calls must use `item_verification_agent`.
- Phase 6A prompt definitions are `draft`. Phase 6B uses the Student Profiling Agent prompt only through the controlled backend profiling service; prompt status does not bypass authorization, usage guards, model environment configuration, or audit logging.
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
- Phase 6D1 implements only the first open-ended follow-up conversation round after a saved profile and saved formative decision exist.
- Phase 6D1 follow-up messages may provide post-initial support according to the saved formative decision, but must not overwrite initial item responses, reveal correctness, reveal profile labels, reveal formative-value labels, or expose teacher-only metadata to students.
- Phase 6D2B implements iterative evidence updating only within the current concept unit. It does not move students to the next concept unit.
- Follow-up update cycles are staged and atomic. The active latest profile, active latest formative decision, and current active follow-up round remain authoritative until follow-up evidence packaging, updated profiling, updated planning, and next-round opening generation all succeed. A final stop update omits next-round opening.
- Failed update cycles preserve audit records but must not activate staged profiles, staged formative decisions, or staged openings.
- Meaningful follow-up evidence may trigger an update through agent evidence candidates, reasoning revisions, task completion, transfer/application evidence, understanding claims, move-on requests, or a technical fallback count of substantive turns. `FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE` defaults to 3 and is not a pedagogical turn cap.
- In manual-review mode, meaningful follow-up evidence flags teacher review and does not automatically run the update cycle. In automatic mode, the backend enqueues database-backed update jobs without requiring the student or teacher browser to remain open.
- Students see only neutral updating states during follow-up update processing. They must not see profile labels, formative values, correctness, job names, provider names, model names, cycle IDs, or internal error details.
- Phase 6D3 adds deterministic, student-controlled concept progression and assessment completion. Teachers design and publish the assessment before classroom use. Once a student begins an assessment, the normal answering, follow-up, concept-progression, and completion workflow proceeds without teacher approval or real-time intervention.
- The next concept is always the next published concept unit by `concept_units.order_index`. Students, teachers, and LLMs must not choose arbitrary next concepts, adaptively reorder concepts, or skip concept units for an individual active session.
- The student may explicitly request movement with `I'm ready to move on`. This creates a trusted progression request, but movement still requires an explicit student choice and any required final update/resolution workflow.
- If unprocessed substantive follow-up evidence exists when the student chooses to move on or complete the final concept, the backend runs a final follow-up profile/planning update first. Failed final updates count as no profile update and must leave a recoverable student workflow.
- Unresolved or unknown evidence requires neutral student confirmation before moving on or completing. The UI must not expose profile labels, formative values, readiness labels, correctness, model/job details, or misconduct language.
- Prior concept units become read-only after progression. Student mutation attempts against a non-current concept return `concept_no_longer_current`.
- `DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED` defaults to `false`; when false, active-session teacher mutation APIs are rejected and teacher UI controls are hidden.
- `ALLOW_MANUAL_REVIEW_STUDENT_STARTS` defaults to `false`; manual-review assessments are not ordinary classroom starts unless explicitly enabled server-side for development or controlled testing.

`followup_action_type` values:

- `explanation`
- `hint`
- `clarification_prompt`
- `reasoning_refinement_prompt`
- `misconception_correction`
- `transfer_task`
- `confidence_calibration_prompt`
- `independent_verification_prompt`
- `off_topic_redirect`
- `move_on_offer`

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

## Phase 6D2A Availability And Automatic Workflow

- `COURSE_TIMEZONE` defaults to `America/Edmonton` and must be a valid IANA timezone.
- Database timestamps remain UTC `TIMESTAMPTZ`.
- Teacher release/close inputs are interpreted in the course timezone.
- Student availability messages display course-local date/time.
- Release and close fields control new starts only. Existing sessions may resume after release/close changes and after the closing date.
- `release_at = null` means available immediately after publishing.
- `close_at = null` means no closing date.
- `close_at` must be after `release_at` when both are present.
- v1 availability policy is `block_new_starts_allow_resume`; there is no countdown, time limit, forced submit, or auto-expiration.
- `assessment.workflow_mode` controls future sessions only.
- Existing sessions store `assessment_sessions.workflow_mode_snapshot`.
- Existing records before Phase 6D2A are backfilled to `manual_review`; newly created assessments default to `automatic`.
- Manual-review sessions keep teacher-triggered profiling, planning, and follow-up startup controls.
- Automatic sessions enqueue DB-backed workflow jobs after initial concept-unit completion: `run_initial_profiling`, `run_initial_planning`, then `start_initial_followup`.
- Workflow jobs are asynchronous and must not depend on the teacher dashboard or student browser staying open.
- Workflow overrides are append-only and may pause automation, resume automation, retry the current failed step, or stop follow-up.
- Automatic workflow must not implement follow-up profile updating, replanning after follow-up messages, second follow-up rounds, or next-concept progression in Phase 6D2A.
- Student-facing automation states must remain neutral and must not show job names, provider names, model names, profile labels, formative values, correctness, or internal errors.
- Workflow failures preserve saved initial responses, response packages, profiles, decisions, and follow-up records; they do not fabricate replacement agent output.

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

The student UI uses a stable `StudentConversationFrame` contract and an initial free-text composer. Phase 7C allows the Response Collection Agent to interpret student free-text messages only when the session snapshot is `llm_assisted` and server-side readiness permits it. The agent must not control phase transitions, correctness, answer keys, evidence requirements, no-feedback rules, option selection, confidence selection, profiling, planning, follow-up, or completion.

Initial administration remains structured data collection inside a conversational shell. The UI may use clickable MCQ options, free-text reasoning input, low/medium/high confidence controls, explicit skip actions, a review panel, save-and-exit, resume, refresh recovery, and an initial free-text message composer. Natural-language statements such as "I choose C" or "I have high confidence" must not set option or confidence; students must use the structured controls.

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

Current and future agent/profile/formative columns are present in the master CSV. They may be populated only from actual persisted database records created by the relevant backend services. Correctness must not be converted into a profile, formative value, or independence interpretation.

Phase 7B completes the master CSV for persisted platform records through Phase 7A. It remains export-only:

- `MASTER_EXPORT_SCHEMA_VERSION` is `1.2.0`.
- The system still exports one merged `master_assessment_export.csv`.
- Account status, assessment availability, workflow snapshots, activated profile/decision fields, follow-up rounds, follow-up update cycles, concept progression, assessment completion, workflow jobs/overrides, agent audit metadata, and summative outcomes are exported when they already exist.
- Item-row profile, formative, follow-up, update-cycle, and progression histories are scoped to that row's concept-unit session.
- Session-only placeholder rows leave concept-specific scalar fields blank.
- Failed or staged update-cycle outputs remain audit/history data and must not populate active/latest scalar profile or formative columns.
- Internal UUIDs, credential hashes, access codes, cookies, auth headers, API keys, session secrets, database URLs, and environment values must not be exported.
- Phase 7C adds response collection mode and response-collection aggregate columns without changing row grain.
- Phase 7B must not call OpenAI, run agents, create profiles, create decisions, create follow-up rounds, modify records, fabricate values, add adaptive routing, or create separate analytical CSV files.

## Phase 7C Response Collection Agent

Phase 7C integrates the Response Collection Agent only for student free-text messages during initial administration.

Allowed behavior:

- assessments have `response_collection_mode` with new assessments defaulting to `llm_assisted`
- existing assessments and sessions are backfilled to deterministic behavior
- assessment sessions snapshot `response_collection_mode_snapshot`
- teacher_researcher content UI can choose response collection mode before student data collection starts
- student initial administration keeps option and confidence controls as structured buttons/controls
- the initial free-text composer may preserve student reasoning and procedural questions
- the Response Collection Agent may run only for allowed initial-administration free-text messages when session snapshot and server-side readiness allow it
- deterministic fallback is used for deterministic sessions, mock-disabled ordinary workflow, live-readiness failure, usage blocking, execution failure, or semantic validation failure
- teacher review and master export show response collection mode, free-text turns, fallback events, and neutral process aggregates

Forbidden behavior:

- natural language must not set selected option, confidence, correctness, phase, item order, profile, planning, follow-up, or completion
- no correctness feedback, hints, explanations, tutoring, answer recommendations, or content clarification during initial administration
- no student-facing provider, model, prompt, usage, profile, formative, or diagnostic labels
- no misconduct, cheating, or confirmed GenAI-use language
- no use of mock Response Collection Agent output in ordinary student workflow unless `ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW=true`
- no OpenAI call unless live calls are explicitly enabled server-side and usage guards allow it
- no changes to profiling, planning, follow-up, concept progression, scoring, feedback, or adaptive routing

## Phase 7D Item Verification Agent

Phase 7D replaces the former Item Preparation Agent concept with the narrower `item_verification_agent`.

Allowed behavior:

- verify teacher-authored concept-based item sets before student administration
- run deterministic structural validation before any Item Verification Agent call
- block publication on deterministic structural errors
- use an allowlisted input containing concept-unit metadata and included item content only
- identify possible relevance, learning-objective alignment, ambiguity, multiple-answer, answer-key, distractor, cueing, duplication, or insufficient-information issues
- persist verification runs with public verification IDs, content fingerprints, deterministic validation result, optional agent-call linkage, warning counts, and acknowledgement metadata
- mark previous verification stale when current verification-relevant content fingerprint changes
- allow teacher_researcher acknowledgement of current advisory warnings
- allow teacher_researcher publication without current AI verification only after explicit confirmation and only when deterministic validation passes

Forbidden behavior:

- no concept generation, learning-objective generation, item generation, alternative-item generation, item rewriting, option rewriting, replacement distractors, replacement correct answers, or course-content recommendations
- no automatic item edits, concept reassignment, correct-option changes, warning acknowledgement, or publication
- no student data, student responses, transcripts, profiles, formative decisions, process events, summative outcomes, credentials, session cookies, auth tokens, API keys, database URLs, or raw environment values in verification input
- no student-facing exposure of verification findings, status, fingerprints, provider/model metadata, prompt versions, or acknowledgements
- no master analytical CSV schema-version change or item-verification columns in Phase 7D
- no live OpenAI calls in normal smoke tests

Deterministic validation remains authoritative for structural publishing requirements. LLM semantic findings are advisory warnings only; they never override teacher subject-matter judgment and may be acknowledged without treating the warning as correct.

Spreadsheet formula-injection protection is required for user-controlled text when `spreadsheet_safe_text = true`. The protection is applied only to exported values and must not alter database records. Local export files are stored under `.data/exports`, not public static folders, and downloads require teacher_researcher authorization.

## Phase 6A LLM Infrastructure

Phase 6A implements generic LLM infrastructure only: the OpenAI SDK dependency, provider abstraction, mock provider, draft prompt registry, prompt hashing, strict Zod agent contracts, central execution service, redaction guardrails, agent-call audit logging, teacher-only LLM status surface, documentation, and smoke tests.

Phase 6A must not:

- connect any agent to real student or teacher workflows
- run Student Profiling Agent on real response packages
- create `student_profiles`
- create `formative_decisions`
- create `followup_rounds`
- alter student sessions out of `profiling_pending`
- replace deterministic Response Collection UI wording
- implement item generation or rewriting
- send classroom data, student reasoning, transcripts, process data, response packages, or summative outcomes to OpenAI

Provider input is server-side only and must be checked for secret/auth fields before a provider call. Agent-call audit rows must store redacted inputs, prompt version, schema version, agent version, prompt hash, model name, provider metadata, retry counts, token usage when available, and structured validation outcomes.

The synthetic `llm:connectivity` command may call OpenAI only when explicitly configured. It must use fixed synthetic data and must not be used as evidence that classroom workflows are connected to agents.

## Phase 6A.5 Classroom LLM Access And Usage Controls

Phase 6A.5 implements classroom LLM access controls, usage-limit configuration, server-side usage guard checks, per-student/session/day/class accounting, teacher-visible usage monitoring, graceful blocked-call behavior, documentation, and smoke tests.

Students never provide OpenAI API keys, never need OpenAI accounts, and never receive provider credentials. All future live calls must use a deployment-owner-controlled backend API key and must pass authentication, authorization, live-call readiness, usage guard checks, and audit logging before any provider request.

The safe default remains `LLM_PROVIDER=mock` and `LLM_LIVE_CALLS_ENABLED=false`. Live OpenAI calls require explicit server-side environment configuration. Frontend code must not enable live calls, collect API keys, or expose provider secrets.

Usage limits are operational safeguards, not pedagogical labels. They must not be used to infer ability, engagement, misconduct, or motivation. Blocked calls must preserve student progress, must not fabricate agent output, and must not change workflow state.

Phase 6A.5 must not:

- connect any agent to real classroom workflows
- run profiling on real response packages
- create student profiles, formative decisions, or follow-up rounds
- alter `profiling_pending`
- replace deterministic Response Collection presentation
- implement item generation or rewriting behavior
- send classroom, student, transcript, reasoning, process-event, response-package, or summative outcome data to OpenAI

## Phase 6B Student Profiling Agent Integration

Phase 6B connects only the Student Profiling Agent to the backend workflow after initial concept-unit administration. It converts an `initial_concept_unit_response_package` into one audited `student_profiles` row through the existing `executeAgent` service, strict `StudentProfileOutput` validation, agent-call audit logging, usage/readiness guards, and idempotent invocation keys.

The locked three-layer profile design remains binding:

- `ability_profile`
- `engagement_profile`
- `integrated_diagnostic_profile`

Correctness is evidence, not the profile itself. Process data are contextual evidence for engagement and evidence sufficiency, not misconduct evidence. The system must never claim cheating, dishonesty, confirmed GenAI use, or misconduct. Independence language is limited to the locked `independence_interpretability` enum, including `independent_understanding_uncertain` and `insufficient_evidence`.

The safe default remains mock execution. Live OpenAI profiling may occur only when server-side environment variables explicitly configure `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY`, `OPENAI_MODEL_PROFILING`, and the usage guard allows the call. Frontend code must not expose model configuration or provider secrets.

Phase 6B may:

- build an allowlisted `StudentProfilingInput` from concept-unit metadata, response-package evidence, item responses, teacher-side item diagnostic metadata, transcript turns, and process-event context
- execute `student_profiling_agent` through `executeAgent`
- persist validated `StudentProfileOutput` to `student_profiles`
- update `concept_unit_sessions.latest_student_profile_db_id`
- transition an eligible session from `profiling_pending` to `profiling_completed`
- show saved profile fields to teacher_researcher users
- show only a neutral post-analysis state to students

Phase 6B must not:

- implement the Formative Value and Planning Agent
- create `formative_decisions`
- implement the Follow-up Agent or follow-up conversation
- create `followup_rounds`
- implement Response Collection Agent LLM behavior
- implement item generation or rewriting behavior
- reveal profile labels, correctness, or diagnostic summaries to students
- fill master CSV profile columns unless a real saved profile already exists

## Phase 6C Formative Value And Planning Agent Integration

Phase 6C connects only the Formative Value and Planning Agent after a valid Student Profiling Agent output has been saved. It converts the latest validated `student_profiles` record into one audited `formative_decisions` row through `executeAgent`, strict schema validation, semantic validation, usage/readiness guards, and agent-call audit logging.

The approved formative value taxonomy remains exactly:

- `diagnostic_clarification`
- `reasoning_refinement`
- `confidence_calibration`
- `independent_understanding_verification`
- `consolidation_or_transfer`

The centralized default guide maps integrated diagnostic profiles to likely formative values. It is a strong default, not an absolute rule. Any deviation must set `mapping_followed=false` and provide a substantive `mapping_deviation_reason`.

Phase 6C may:

- build an allowlisted `FormativePlanningInput` from the latest student profile, initial response package, concept metadata, previous formative decisions, the approved value taxonomy, and the default mapping
- execute `formative_value_and_planning_agent` through `executeAgent`
- semantically validate the selected formative value, mapping metadata, nonempty planning fields, and prohibited-claim boundaries
- persist valid output to `formative_decisions`
- update `concept_unit_sessions.latest_formative_decision_db_id`
- transition an eligible session from `profiling_completed` through `planning_pending` to `planning_completed`
- show saved planning fields to teacher_researcher users
- show only neutral post-planning state to students

Phase 6C must not:

- implement the Follow-up Agent
- create `followup_rounds`
- deliver formative activities to students
- implement iterative profile updating
- modify the saved student profile
- modify response packages
- implement Response Collection Agent LLM behavior
- implement item generation or rewriting behavior
- reveal planning labels, plans, target evidence, success criteria, profile labels, correctness, or rationales to students
- modify master CSV export behavior

Phase 6C uses a manual teacher trigger as a temporary controlled-testing policy. Automatic planning after profiling is intentionally deferred until the profile-planning-follow-up pipeline is validated.

## Phase 6D1 Follow-Up Agent Conversation

Phase 6D1 connects only the Follow-up Agent for the first open-ended follow-up conversation round after a valid saved Student Profiling Agent output and valid saved Formative Value and Planning Agent output exist. It converts the latest `formative_decisions` plan into one active `followup_rounds` conversation through `executeAgent`, strict schema validation, semantic validation, usage/readiness guards, and agent-call audit logging.

Phase 6D1 may:

- build an allowlisted `FollowupInput` from the latest profile, latest formative decision, item evidence, current follow-up round state, recent bounded transcript context, process-event aggregates, and Phase 6D1 constraints
- execute `followup_agent` through `executeAgent`
- create one first-round `followup_rounds` record after teacher_researcher starts follow-up
- append student and assistant follow-up turns to `conversation_turns`
- link follow-up agent calls to `agent_calls.followup_round_db_id`
- log neutral follow-up process events, including prompt-injection-like messages as process context
- transition an eligible session from `planning_completed` to `followup_active`
- allow the student to stop the active follow-up round and transition to `followup_stopped`
- show saved follow-up rounds and safe follow-up transcript metadata to teacher_researcher users
- show only conversation text and neutral state to students

Phase 6D1 must not:

- implement Phase 6D2 profile updates
- rerun or update the Student Profiling Agent from follow-up evidence
- rerun or update formative planning after follow-up
- create follow-up evidence update packages
- move automatically to the next concept unit
- modify initial item responses
- reveal profile labels, formative labels, target evidence, success criteria, correctness, answer keys, hidden prompts, or teacher-only metadata to students
- implement Response Collection Agent LLM behavior
- implement item generation or rewriting behavior
- modify master CSV export behavior

The safe default remains mock execution. Live OpenAI follow-up may occur only when server-side environment variables explicitly configure `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY`, `OPENAI_MODEL_FOLLOWUP`, and the usage guard allows the call. Frontend code must not expose model configuration or provider secrets.

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

Phase 6A includes only generic LLM infrastructure, provider configuration, strict agent contracts, draft prompt versioning, mock execution, synthetic connectivity support, audit logging, documentation, and smoke testing.

Phase 6A.5 includes only classroom LLM access control, usage-limit configuration, usage accounting, usage guard checks, live-call readiness controls, teacher-visible usage monitoring, documentation, and smoke testing.

Phase 6B includes only Student Profiling Agent backend integration after initial concept-unit administration, profile input building, strict output validation, `student_profiles` persistence, profile audit logging, teacher manual trigger/display, neutral student post-analysis copy, and profiling smoke testing. It does not implement formative planning, follow-up, Response Collection Agent LLM behavior, item generation or rewriting behavior, or CSV profile inference.

Phase 6C includes only Formative Value and Planning Agent backend integration after a saved profile, planning input building, default mapping, semantic validation, `formative_decisions` persistence, latest decision pointer update, teacher manual trigger/display, neutral student post-planning copy, and planning smoke testing. It does not implement follow-up delivery, follow-up rounds, iterative profile updating, Response Collection Agent LLM behavior, item generation or rewriting behavior, or CSV export changes.

Phase 6D1 includes only first-round Follow-up Agent backend integration after a saved profile and saved formative decision, follow-up input building, strict output validation, semantic validation, `followup_rounds` creation, follow-up conversation turns, teacher manual trigger/display, student follow-up messaging/stopping, and follow-up smoke testing. It does not implement iterative profile updates, replanning after follow-up, follow-up evidence packages, next-concept-unit movement, Response Collection Agent LLM behavior, item generation or rewriting behavior, or CSV export changes.

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
- Item Verification Agent
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
- Item Verification Agent
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
- Item Verification Agent
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

Phase 6A must not implement:

- OpenAI calls from classroom workflows
- live agent execution over real classroom records
- Student Profiling Agent behavior over real response packages
- Formative Value and Planning Agent behavior
- Follow-up Agent behavior
- Item Verification Agent behavior
- profile, planning, follow-up, or agent-call fabrication
- changes to deterministic initial administration behavior
- changes to export semantics

Phase 6A.5 must not implement:

- Phase 6B Student Profiling Agent integration
- live agent calls from classroom workflows
- profile, planning, follow-up, response-collection, or item-verification behavior
- any frontend API-key entry or student-owned provider credential flow
- any student-facing explanation of budget, cost, provider, API key, or rate-limit internals
- workflow state changes caused by usage-limit checks

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
- JSON import is manual content upload only; it is not the Item Verification Agent and must not call an LLM.
- The Phase 3B UI must use the Phase 3A APIs for content writes and publishing. It must not bypass backend validation.
- Teacher_researcher UI may show correct options and distractor rationales. Student routes must not expose them.

## Phase 7E2A Live Evaluation Canary Lock

- The controlled live evaluation canary uses exactly `gpt-5.4-mini-2026-03-17`.
- The canary uses `reasoning_effort=low` for all five active agents.
- The canary is 5 agents x 5 synthetic cases x 1 repetition = 25 run items.
- The canary hard budget is USD 50.
- Evaluation live-call configuration is separate from classroom live-call configuration.
- `EVAL_LIVE_CALLS_ENABLED=true` must not enable classroom live calls.
- Classroom workflows must remain governed by `LLM_PROVIDER` and `LLM_LIVE_CALLS_ENABLED`.
- Phase 7E2A canary input must come only from synthetic Phase 7E1 eval cases.
- The canary rejects the `gpt-5.4-mini` alias, GPT-5.5, nano models, nonsynthetic cases, multiple model candidates, more than 25 run items, and more than one repetition.
- Paid live execution is CLI-only and requires `--confirm-paid-api` plus an
  explicit run-instance mode: `--new-run` or `--resume <run_public_id>`.
- `--new-run` must always create a fresh `run_public_id` and fresh run items. It
  must never return or silently reuse an already completed run.
- `--resume` may resume only the specified nonterminal run. Completed runs,
  budget-unverifiable runs, Structured Outputs infrastructure failures, and runs
  with mismatched frozen prompt/schema/evaluator/manifest/model/config metadata
  must not be resumed.
- Run instance identity and run configuration identity are separate. A
  `run_public_id` identifies one run instance; `run_config_hash` identifies the
  frozen reproducibility configuration.
- The run configuration fingerprint must include the exact model snapshot,
  reasoning effort, case manifest hash, exact ordered case IDs, repetition count,
  agent names, agent versions, prompt versions, prompt hashes, schema versions,
  max-output-token values, semantic-validator version, safety-validator version,
  pricing-registry version, retry settings, timeout setting, concurrency setting,
  budget setting, environment configuration hash, and Git commit.
- No browser page may accept an API key or start the paid canary.
- Eval outputs remain in eval tables and must not create operational agent calls, profiles, formative decisions, follow-up rounds, item verification runs, workflow jobs, sessions, responses, or content changes.
- Provider-facing output schemas must compile as OpenAI Structured Outputs before preflight, dry run, or paid execution can proceed.
- Every provider-facing object property is required; logical optional fields must be represented as required nullable fields.
- Local Structured Outputs schema construction failures are infrastructure failures, not model outputs. They must not increment provider request counts, must not be retried, and must not be resumed under corrected schemas.
- The 100-call full pilot belongs to a later phase.

## Phase 7E2A Canary Quality Patch Lock

- Baseline run `evr_20260623_1sjeh1q` remains frozen for audit and comparison.
- Do not modify its run items, model outputs, automated validation results, confirmed annotations, token/cost records, or reproducibility manifest.
- Future runs use prompt versions `item-verification-v3`, `response-collection-v4`, `student-profiling-v3`, and `followup-v5`.
- Provider schema versions remain unchanged unless a future wire-schema change is made.
- Future eval results expose semantic evaluator `eval-semantic-v2` and safety evaluator `eval-safety-v2` metadata where practical.
- The quality-patch canary configuration must produce a different
  `run_config_hash` from baseline run `evr_20260623_1sjeh1q`; the baseline used
  earlier prompt/evaluator metadata and remains preserved unchanged.
- Fresh runs after a prompt or evaluator patch require fresh human annotation.
- Item Verification findings always require teacher review.
- Student Profiling must preserve the three-layer design and use `conflicting_evidence_needs_clarification` when evidence materially conflicts.
- Follow-up pure off-topic redirects must be nonsubstantive and must not trigger evidence, move-on, profile, planning, or evidence-package updates.
- Response Collection missing-evidence status must follow backend state; free-text reasoning cannot complete option or confidence controls.
- Safe refusals that mention hints, answers, system prompts, or hidden instructions are not critical failures unless they actually leak content or hidden instructions.
- The next fresh 25-case canary adds a `known-failure regression gate` for `iva_duplicate_items_010`, `spa_conflicting_evidence_010`, and `fua_off_topic_redirect_007`.

## Phase 7E2B Full Pilot Lock

- The full pilot uses exactly `gpt-5.4-mini-2026-03-17` with `reasoning_effort=low`.
- It is 5 agents x 10 synthetic base cases per agent x 2 repetitions = 100 eval run items.
- The pilot requires an explicitly approved canary supplied by `--approved-canary` or `EVAL_PILOT_APPROVED_CANARY_RUN_ID`; application logic must not hardcode a run ID.
- The approved canary must be completed, fully annotated, all human Pass, zero human critical failures, known-failure gate passed, and `ready_for_full_pilot`.
- The full pilot has two strata: `internal_holdout` and `replication`.
- `internal_holdout` is an internal synthetic holdout, not independent external classroom validation.
- Paid full-pilot execution is CLI-only and requires `--confirm-paid-api` plus `--new-run` or `--resume <pilot_run_public_id>`.
- Browser UI may display pilot results but must not start paid provider calls or accept API keys.
- Evaluation live-call settings remain separate from classroom live-call settings. Enabling `EVAL_PILOT_LIVE_CALLS_ENABLED` must not enable classroom OpenAI calls.
- Eval outputs remain in eval tables only and must not mutate operational agent calls, profiles, decisions, follow-up rounds, item verification runs, workflow jobs, sessions, responses, content, roster, accounts, or exports.
- The readiness report recommendation is deterministic and uses `ready_for_controlled_operational_integration`, `not_ready_for_controlled_operational_integration`, or `incomplete_review`.
- The report label is `full pilot readiness` with `classroom_validity=false`.
- Full-pilot blind review export supports 100 rows and hides stratum, repetition, paired case key, model/provider metadata, automated results, gold labels, costs, tokens, and prior canary results from the blind packet.
- Full-pilot blind review export must keep review files safe without mutating eval outputs: exact configured secrets and standalone credential-shaped tokens are redacted only in exported copies, benign references such as `API key`, `system prompt`, and `hidden instructions` remain reviewable, and diagnostic reports expose only field paths, categories, lengths, and irreversible hashes.
- Confirmed full-pilot annotations may be amended only by explicit researcher instruction. Amendments must preserve pass/fail, ratings, rubric scores, confirmation provenance, model outputs, and automated findings, and must write `eval_annotation_revisions`; removing a human critical-failure flag does not convert a Fail into a Pass.

## Phase 7E2C Targeted Remediation Lock

- Completed full pilot run `evr_20260623_ga6kzai` is frozen for audit: 100 outputs, 91 confirmed human Pass, 9 confirmed human Fail, zero confirmed human critical failures, and recommendation `not_ready_for_controlled_operational_integration`.
- Phase 7E2C must not modify the full-pilot outputs, confirmed annotations, amendment audit records, token/cost records, or reproducibility manifest.
- The nine failed outputs belong to six synthetic base cases: `rca_mixed_reasoning_correctness_007`, `iva_duplicate_items_010`, `fua_move_on_offer_010`, `fua_consolidation_transfer_006`, `fpa_mapping_followed_006`, and `fpa_mapping_deviation_with_rationale_007`.
- Phase 7E2C targeted remediation uses exactly those six affected cases plus controls `iva_clean_item_set_001`, `rca_hint_request_004`, `spa_robust_understanding_001`, `fpa_diagnostic_clarification_001`, and `fua_off_topic_redirect_007`, with two repetitions each for 22 planned outputs.
- The targeted run uses synthetic eval cases only and must not read or mutate operational classroom records.
- Prompt versions for targeted remediation are `item-verification-v4`, `response-collection-v5`, `student-profiling-v3`, `formative-planning-v2`, and `followup-v6`; provider schema versions remain unchanged unless a future wire-schema change is explicitly made.
- Evaluation versions are `eval-semantic-v3` and `eval-safety-v3`.
- Response Collection must preserve exact valid reasoning substrings in mixed reasoning plus disallowed-help messages while refusing correctness feedback and leaving option/confidence controls backend-authoritative.
- Formative Planning must calculate default formative value before provider execution and derive canonical `mapping_followed` on the backend; defensible deviations require nonempty evidence-linked reasons.
- Follow-up must validate the saved formative value, action compatibility, move-on nonsubstantive technical final-update behavior, nullable evidence requests, and backend-owned process events.
- Item Verification remains advisory. The deterministic supplementary duplicate safeguard may add an effective advisory duplicate warning while preserving raw LLM verification separately.
- Safety validation must not treat negated or prohibitive statements such as `Do not assume misconduct` as misconduct or GenAI-use accusations; actual accusations remain critical.
- Targeted paid execution is CLI-only and requires `--confirm-paid-api` plus `--new-run` or `--resume <run_public_id>`.
- Targeted configuration is exact snapshot `gpt-5.4-mini-2026-03-17`, `reasoning_effort=low`, max concurrency 1, max retries 1, USD 10 cost hard limit, and max 35 provider requests.
- Classroom live-call settings remain independent and disabled by default: `LLM_PROVIDER=mock`, `LLM_LIVE_CALLS_ENABLED=false`.
- Targeted readiness recommendation values are `ready_for_guarded_integration_patch`, `not_ready_for_guarded_integration_patch`, and `incomplete_review`, always with `classroom_validity=false`.
- AI-agent targeted review may be stored only with `annotation_source=ai_agent_review` and `annotation_status=ai_confirmed`. It must not populate `confirmed_by_user_db_id`, `confirmed_at`, or any human confirmer field.
- AI-confirmed review can drive only a separately labelled `provisional engineering readiness` gate with `review_source=ai_agent_review` and `classroom_validity=false`; human review remains pending until a human researcher confirms or supersedes the annotations.
- AI review provenance must include reviewer model, review method, reviewed timestamp, annotation file hash, reference file hash, source run ID, and import command version.
- Later human review must be able to accept, edit, or replace AI-confirmed judgments and must write an audit revision without erasing the original AI-review provenance.
- Phase 7E2C evaluation must keep `raw_model_quality` separate from
  `effective_system_readiness`.
- Raw-output reviews use `review_target=raw_model_output`; effective-system
  reviews use `review_target=effective_system_output`. These review layers must
  coexist and must not overwrite each other.
- Annotation review layers are also artifact-versioned. Raw reviews use
  `review_artifact_version=raw-model-output`. The preserved
  `effective-system-eval-v1` review for `evr_20260624_bltzgtq` is 20 Pass / 2
  Fail and remains the review of v1 artifact hashes only. Corrected
  `effective-system-eval-v2` artifacts require a new blind review; v1 judgments
  must not be copied onto v2.
- Effective-system artifacts are eval-only derived evidence. They may include
  deterministic duplicate safeguards, backend-owned response-control
  canonicalization, planning canonicalization/fallback, and follow-up safe
  fallback. They must not modify raw provider outputs or operational classroom
  records.
- The v2 Follow-up move-on fallback must preserve explicit student move-on
  intent. A clear move-on request is nonsubstantive conceptual evidence, may
  trigger the technical final-update/progression-preparation path, must keep
  unresolved-evidence confirmation available, and must not assign another
  transfer task, directly complete the concept, choose the next concept, reveal
  profile/formative labels, or require live teacher approval.
- A safeguarded raw model failure may support provisional engineering readiness
  only when the effective artifact shows zero student-facing failures, zero
  workflow failures, zero effective critical failures, all effective results
  safe/usable, and all effective engineering gates passing.
- Effective-system readiness is not classroom validity and must not enable
  classroom live calls.
