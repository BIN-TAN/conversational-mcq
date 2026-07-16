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
- Student self-registration, email delivery, SMS delivery, and email-based password reset are not implemented in v1.
- Students may change their own password after authenticating with a roster-issued temporary credential or current password.
- Access-code/password reset, student deactivation, and student reactivation increment `users.auth_version` and invalidate old student cookies.
- Inactive students cannot log in, start assessments, resume sessions, participate in follow-up, or complete assessments. Existing research records remain preserved.

## Student Account Management

- `users.user_id` is the canonical classroom and research ID and is immutable through normal teacher UI/API routes.
- `users.user_id_normalized` supports trim, Unicode normalization, and lowercase matching. Case-only duplicates such as `Student001` and `student001` are forbidden.
- Canonical `users.user_id` remains unchanged for display, routes, summative outcome linkage, and master CSV export.
- `users.display_name` is optional and may be updated by the teacher_researcher without changing research linkage.
- `users.email` is optional teacher/research-facing PII. It is not required, not a login identifier, and not used for email-based reset.
- `users.account_status` is `active` or `inactive`.
- Plaintext temporary passwords/access codes must never be stored in the database, process events, account audit records, import history, exports, or Git fixtures.
- Plaintext temporary passwords/access codes may be shown only immediately after manual student creation, roster commit for newly created students, or password/access-code reset.
- Teacher_researcher users may reset a student password but must never view the current password.
- `must_change_password=true` means the student must choose a new password before assessment access.
- Deactivation/reactivation is the reversible student account-control path and preserves longitudinal classroom/research linkage.
- Irreversible student account deletion is teacher/research only. It must preview associated record counts, require exact typed `student_id` plus `DELETE`, delete associated system session/activity/evidence/profile/agent/summative rows in a transaction where possible, write only a safe deletion audit summary, and never expose passwords, access-code hashes, raw responses, raw process payloads, raw provider output, answer keys, or correctness labels.
- Deleted accounts and their associated system records must not appear in future student lists or research exports. Previously downloaded exports, screenshots, or external copies are outside system control and cannot be removed by the app.
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

## Chat-Native Runtime Item Administration

- The current student MVP is a web-based, chat-native formative assessment flow. The app owns state transitions, persistence, validation, answer-key protection, and process-data logging.
- Browser/runtime item administration uses the live Item Administration Tutor only when `ITEM_ADMIN_TUTOR_MODE=auto`, `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, a valid authenticated server-side OpenAI credential is available through `OPENAI_API_KEY` or `OPENAI_API_KEY_FILE`, and `OPENAI_MODEL_ITEM_ADMIN` or `OPENAI_MODEL_FOLLOWUP` is configured.
- `npm run llm:readiness` is the safe readiness check for this runtime path. When live config is otherwise present, it may perform a lightweight authenticated OpenAI model-metadata check; it must not generate model output. It may report key presence, source class, fingerprint prefix, auth status, auth check time, cache status, reason codes, model names, env-file names, and conflict status, but never raw credential values.
- If live readiness is missing, invalid, unknown, public, or conflicting in normal browser/runtime auto mode, student start/resume is blocked and open-text item-administration turns fail closed with a saved-progress unavailable message. The runtime must not silently substitute deterministic mock output as valid student evidence.
- Deterministic/mock item administration is allowed only in `NODE_ENV=test`, smoke tests that explicitly force mock behavior, or intentional local mock walkthroughs with `ITEM_ADMIN_TUTOR_MODE=mock` and `ALLOW_LOCAL_MOCK_RUNTIME=true`.
- `ALLOW_LOCAL_MOCK_RUNTIME` is optional and defaults to `false` when unset.
  Live runtime must not require it. If explicitly set, it must be exactly
  `true` or `false`; invalid values fail closed with a safe variable-name
  diagnostic.
- Failed live item-administration provider output must keep the current assessment step, preserve progress, log `item_admin_tutor_source=safe_block_after_live_failure`, and avoid recording the failed response as valid evidence.
- Student-facing prompts must not advertise specific language choices by default. Backend validation may still accept meaningful non-English or mixed-language responses.
- Live response-package profiling and targeted-feedback calls are successful only when the provider call completes, structured output validates, student-facing safety checks pass, provider metadata is stored, and token usage is stored.
- Invalid or unsafe live formative profile or targeted-feedback output must fail closed: preserve student progress, log a sanitized `llm_runtime_blocked` event, show the temporary unavailable message, and avoid creating or showing formative activity or targeted feedback from invalid live output.
- Live formative student-facing validation failures must store safe diagnostic details, including `field_path`, `rule_code`, optional `blocked_pattern_label`, and `issue_count`. Diagnostics and artifacts must not store or print raw blocked student-facing text, raw provider output, raw prompts, answer keys, distractor metadata, API keys, headers, or secrets.
- Opt-in paid live formative smoke failures must remain diagnosable. A failed `student:live-llm-smoke` run must not delete the failed synthetic session or `agent_calls` row before diagnostics are written. It must write a sanitized artifact under `.data/student-live-llm-smoke/failures/` containing session state, agent-call status, validation issue paths, output payload keys, presence flags, and process/conversation summaries only. The artifact and diagnostic command must not print raw prompts, raw provider output values, raw student response text, answer keys, distractor metadata, API keys, headers, or secrets.
- Live formative smoke developer-facing failures must distinguish readiness, profile validation, targeted-feedback validation, runtime block, and smoke-flow mismatch using precise codes such as `llm_profile_validation_failed` and `llm_targeted_feedback_validation_failed`; the student-facing message remains the neutral saved-progress unavailable message.
- Deterministic formative fallback remains valid for mock, test, disabled, or explicit fallback paths, but it must not be counted as a successful live formative profile or targeted-feedback result.
- Live formative output validation may canonicalize clearly equivalent labels or known field aliases before strict schema validation, but it must not accept unsafe, ambiguous, or student-visible internal labels. Harmless rigid visible heading prefixes such as "What you did well:", "Reasoning detail:", "Earlier:", "Current focus:", or "Still developing:" may be removed before validation while preserving the content. These headings must not appear in student-facing formative feedback after validation.

## Phase 30a Distractor-Informed Misconception Diagnosis Lock

Phase 30a narrows the dissertation and system framing to **distractor-informed misconception diagnosis in AI-assisted MCQ assessment**. The system should be represented as an evidence-centered, distractor-informed conversational assessment system for misconception diagnosis. Distractors are diagnostic representations of plausible but non-target reasoning paths.

The system should be represented as:

- a system that uses distractors to anchor, reactivate, and update misconception evidence;
- a system that uses selected options, tempting options, reasoning, confidence, and dialogue responses to form, test, weaken, or reject distractor-linked misconception hypotheses;
- a system that uses engagement/process data only as evidence-quality context.

The system must not be represented as:

- a general ability profiling system;
- a broad adaptive tutoring system;
- a complete learning gain intervention;
- a cheating detection system;
- an all-purpose feedback taxonomy;
- a system where all activity families are equally central;
- a system that proves the absence of all misconceptions when no actionable evidence is found.

Internal diagnosis-state language for the new framing:

- `strong_distractor_linked_misconception`
- `suspected_distractor_linked_misconception`
- `conceptual_entry_gap`
- `insufficient_or_low_reliability_evidence`
- `misconception_weakened_after_activity`
- `no_actionable_misconception_evidence`

Conceptual entry gap means the student lacks enough conceptual model to diagnose a specific misconception. It is not itself a distractor-linked misconception. No actionable misconception evidence is not proof that no misconception exists.

The four central distractor-informed diagnostic purposes are:

- `conceptual_entry_grounding`
- `distractor_misconception_probe`
- `reasoning_boundary_repair`
- `independent_misconception_verification`

Confidence calibration is a confidence-alignment modifier, not a central diagnostic purpose. Consolidation and transfer are exit or extension paths, not the central dissertation construct. Existing code enums and schema names remain unchanged in Phase 30a for compatibility.

Terminology crosswalk:

| Previous term | New dissertation framing | Notes |
|---|---|---|
| ability profile | misconception diagnosis profile | Do not claim general ability. |
| engagement profile | evidence-quality context | Supports confidence in diagnosis. |
| profile integration | misconception diagnostic integration | Integrates distractor, reasoning, confidence, and process context. |
| formative value | distractor-informed diagnostic purpose | Four-purpose taxonomy. |
| formative activity | misconception/distractor-aware dialogue | Collects new diagnostic evidence. |
| AI assistance signal | evidence reliability context | Not cheating detection. |
| confidence calibration | confidence alignment modifier | Not core taxonomy. |
| consolidation and transfer | exit/extension path | Not central dissertation construct. |

The diagnostic loop policy is: loop until no actionable distractor-linked misconception evidence remains, until the current misconception hypothesis is weakened or unsupported, until evidence becomes insufficient, until the student chooses to move on, or until a runtime guard stops the loop. Do not describe the system as looping until all misconceptions are eliminated.

## Phase 30b Post-Activity Misconception Evidence Update Lock

- Phase 30b adds `student-activity-misconception-evidence-v1`, an internal
  post-activity evidence packet for future misconception evidence updates.
- The activity output does not update diagnosis. The student's response to the
  activity is the evidence source.
- Activity dialogue must be evidence-eliciting: it should ask for explanation,
  contrast, hidden-assumption identification, boundary explanation, reasoning
  repair, independent reconstruction, or generated-distractor explanation.
- Substantive production misconception updates must be evaluated by the future
  LLM evaluator `formative_activity_response_evaluator_agent` using schema
  `formative-activity-response-evaluation-v1`.
- Deterministic code may enforce schema, required fields, safety, privacy,
  redaction, audit, and fail-closed behavior only. It must not make the final
  production decision about misconception status, hidden-assumption
  interpretation, conceptual-boundary judgment, or response-substance
  diagnosis.
- No deterministic production misconception update decision is allowed.
  No-live fixtures must be marked `evaluation_source=no_live_fixture`,
  `runtime_servable_to_student=false`, and `review_only=true`, and production
  update guards must reject them.
- A high-quality single activity response can support a meaningful update when
  it explains why a distractor is tempting, identifies the hidden assumption,
  contrasts the target idea, and uses the student's own words.
- The system must not claim absence of all misconceptions. Use
  `no_actionable_misconception_evidence` when the current targeted hypothesis
  is unsupported by the available response evidence.
- `student:activity-misconception-evidence-smoke` and
  `student:activity-misconception-evidence-review` are no-live commands. They
  must not create `agent_calls`, call OpenAI, mutate operational classroom
  records, or make deterministic review output student-facing.

## Phase 30c Live Post-Activity Evidence Evaluator Smoke Lock

- Phase 30c adds an opt-in live smoke path for
  `formative_activity_response_evaluator_agent` with schema
  `formative-activity-response-evaluation-v1`.
- The default command `student:activity-misconception-evidence-live-smoke`
  must skip safely unless `RUN_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_SMOKE=1`
  and live provider configuration are explicitly set.
- Successful live evaluator packets must use
  `evaluation_source=live_llm`, `runtime_servable_to_student=false`, and
  `review_only=false`.
- Deterministic fixtures, deterministic fallbacks, and `no_live_fixture`
  packets must never count as live evaluator success.
- The live smoke is synthetic only. It must not use real student data,
  deidentified classroom data, summative outcomes, answer keys, raw distractor
  metadata, raw process payloads, raw provider output, or secrets in artifacts.
- One repair attempt may be made only for repairable schema or safe wording
  issues. Protected leakage, wrong source, deterministic final diagnostic
  decisions, missing provider metadata, missing token usage, and missing audit
  metadata must fail closed.
- Free-text evaluator fields must not repeat protected category labels such as
  answer-key terms, correctness terms, raw metadata terms, raw model-output
  terms, or secret/header terms. Use generic wording such as "protected
  assessment details" when a boundary must be referenced.
- Phase 30c conceptual-entry smoke cases must distinguish no usable distinction,
  partial improvement, and ready-for-distractor-probe evidence. Weak
  conceptual-entry evidence may remain a gap or show early improvement when an
  emerging distinction is present. Stronger entry evidence may still be
  conservatively labeled `conceptual_entry_improved` instead of
  `ready_for_distractor_probe` when the evaluator separates improvement from
  next-step readiness.
- For `conceptual_entry_grounding`, the evaluator must stay in the conceptual
  entry status family: `conceptual_entry_gap_remains`,
  `conceptual_entry_improved`, or `ready_for_distractor_probe`. It must not use
  distractor-update statuses such as `misconception_weakened` for
  conceptual-entry grounding evidence.
- Strong distractor-boundary evidence may be classified as
  `misconception_weakened`, `misconception_unsupported`, or
  `no_actionable_misconception_evidence`, but it must not preserve the targeted
  misconception hypothesis.
- For `distractor_misconception_probe`, partial evidence that names some
  tempting-assumption evidence but leaves the target boundary incomplete should
  remain in the distractor-update family, normally `misconception_weakened`.
  `boundary_understanding_improved` is reserved for
  `reasoning_boundary_repair`.
- Process-context-only limitation wording must not be combined with a
  substantive response-evidence update such as `misconception_persisted`.
- A response that restates the targeted tempting assumption is still elicited
  response evidence, even when the reasoning remains problematic. It may
  support `misconception_persisted`; it must not be marked as `none` evidence
  solely because the misconception appears to persist.
- Move-on and choose-other-activity responses are student-choice states. The
  evaluator must preserve them as `student_chose_move_on` or
  `student_requested_alternative_activity` rather than converting them into
  concept-evidence states such as `insufficient_new_evidence`.

## Phase 30f Backend Activity Runtime Loop Lock

- Phase 30f adds a backend-only runtime loop skeleton for distractor-informed
  formative activity response handling.
- The loop persists `activity_runtime_attempts` records and references
  validated `activity_misconception_evidence_records` and
  `post_activity_diagnostic_snapshots`.
- No browser UI is added in Phase 30f.
- No operational student profile, original response package, item content,
  correct answer, scoring rule, or broad ability profile is changed.
- A production runtime attempt must start from a source formative activity
  packet with `generation_source=live_llm`,
  `runtime_servable_to_student=true`, and `review_only=false`.
- Deterministic review activity packets, no-live fixtures, review-only packets,
  missing source activity agent calls, and unsafe student-safe feedback must
  fail closed.
- The `formative_activity_response_evaluator_agent` remains the substantive
  source of post-activity misconception evidence. Deterministic runtime code
  may validate, persist, and route already-evaluated fields, but it must not
  decide the misconception update itself.
- Runtime next-action policy must respect student choice. `student_chose_move_on`
  recommends move-on, and `student_requested_alternative_activity` recommends
  choosing another activity.
- `no_actionable_misconception_evidence` applies only to the current targeted
  hypothesis. It is not a claim that the student has no misconceptions.
- `student:activity-runtime-loop-smoke` and
  `student:activity-runtime-loop-review` are no-live commands and must not call
  OpenAI.
- `student:activity-runtime-loop-live-smoke` must skip by default unless
  `RUN_LIVE_ACTIVITY_RUNTIME_LOOP_SMOKE=1` and live provider configuration are
  explicitly set.
- Low-information agreement may remain `insufficient_new_evidence` or
  `conceptual_entry_gap_remains`; it must not become conceptual improvement,
  independent support, or no-actionable evidence by itself.
- Provider/schema-valid outputs whose update status is outside the case's
  allowed outcome set must be classified as `outcome_mismatch`; top-level
  `status` and `overall_status` must agree.
- Phase 30c does not implement browser activity execution, runtime
  multi-turn dialogue, production profile updates, or diagnosis updates.

## Phase 30g Minimal Student Activity Runtime UI Lock

- Phase 30g adds a minimal student-facing UI/API surface for the Phase 30f
  activity runtime loop.
- The UI must use a student-safe projection, not raw activity packets or raw
  evaluator packets.
- Student-visible activity runtime fields may include a safe focus label, live
  first-turn message, expected response prompt, safe feedback, response limit,
  and allowed actions.
- Student-visible activity runtime fields must not include internal activity
  family enum values, diagnostic-purpose enum values, misconception status,
  evidence-quality labels, engagement or AI labels, provider/debug metadata,
  raw process payloads, raw distractor metadata, answer keys, correct options,
  correctness labels, raw LLM output, or secret-like data.
- Runtime start must still require a source formative activity packet with
  `generation_source=live_llm`, `runtime_servable_to_student=true`, and
  `review_only=false`.
- Deterministic review activity packets and no-live evaluator fixtures remain
  review/test artifacts and must fail closed if used as runtime student-facing
  content or production misconception evidence.
- Student responses may create activity misconception evidence and
  post-activity diagnostic snapshots only after live-shaped evaluator output
  passes production persistence guards.
- The runtime UI must not replace operational student profiles, mutate original
  response packages, alter item content, change answer keys, or change scoring.
- Choosing another activity or moving on records safe runtime state and must
  not force diagnostic improvement.
- `student:activity-runtime-ui-smoke` is no-live and must not call OpenAI.

## Phase 30d Post-Activity Evidence Persistence Lock

- Phase 30d persists validated post-activity misconception evidence in
  `activity_misconception_evidence_records` and stores a derived review-layer
  snapshot in `post_activity_diagnostic_snapshots`.
- These records are immutable review/audit artifacts. They do not mutate the
  original response package, overwrite the pre-activity diagnostic state, or
  replace the operational student profile.
- Production diagnosis persistence requires `evaluation_source=live_llm`,
  `review_only=false`, `runtime_servable_to_student=false`, a source evaluator
  `agent_call`, provider request or response metadata, token usage, successful
  output validation, and a passing student-facing safety scan.
- `no_live_fixture`, `review_only`, deterministic final diagnostic decisions,
  missing evaluator audit, missing provider metadata, missing token usage, and
  unsafe student-safe feedback must fail closed for production persistence.
- `no_live_fixture` packets may be persisted only under explicit
  `review_artifact` mode for no-live review artifacts and tests.
- The post-activity snapshot may summarize before/after diagnostic state,
  update strength, evidence quality, next diagnostic purpose, student-safe
  feedback, and limitations. It must mark `no_actionable_misconception_evidence`
  as current-hypothesis evidence, not global absence of misconceptions.
- Move-on and choose-other states are student-choice states and must not be
  converted into diagnostic improvement.
- Process, timing, and engagement context may only affect evidence sufficiency
  or reliability context. They are not direct misconception evidence and are not
  misconduct evidence.
- `student:activity-misconception-update-smoke` and
  `student:activity-misconception-update-review` are no-live commands. The
  review command writes redacted artifacts under
  `.data/activity-misconception-update-review/`.

## Phase 30e Live Persistence Smoke Lock

- Phase 30e adds the opt-in command
  `student:activity-misconception-live-persistence-smoke`.
- The command must skip safely unless
  `RUN_LIVE_ACTIVITY_MISCONCEPTION_PERSISTENCE_SMOKE=1` and live provider
  configuration are explicitly set.
- When enabled, it uses a minimal synthetic set covering conceptual-entry
  partial distinction, strong distractor-probe response, and student move-on.
- Successful cases must call the live
  `formative_activity_response_evaluator_agent`, validate the
  `student-activity-misconception-evidence-v1` packet, pass the Phase 30d
  production persistence guard, persist an evidence record, create a
  post-activity diagnostic snapshot, and generate a redacted review artifact.
- Live persistence must not mutate response packages, operational profiles,
  scores, item content, or classroom workflow state.
- Outcome-mismatched live evaluator statuses must fail before persistence.
- The live persistence artifact must not include raw provider output, raw
  prompts, raw student text, answer keys, correct options, correctness labels,
  raw distractor metadata, raw misconception IDs, raw process payloads, API
  keys, headers, cookies, or secrets.
- This phase is backend-only. It does not implement browser UI, runtime
  multi-turn activity execution, broad profile updates, or classroom validity
  claims.

## Ability Evidence Packet V1

- `ability-evidence-packet-v1` is an internal evidence foundation for future ability profiling. It does not create a final student profile, does not implement engagement profiling, and does not change student-facing UI.
- Ability evidence v1 is formative and provisional. It must not be described as calibrated theta, IRT precision, a stable ability score, or classroom validity evidence.
- Main v1 evidence sources are response packages, item responses, conversation turns, process events, item metadata, distractor rationales, expected reasoning patterns, possible misconception indicators, confidence ratings, and tempting-option evidence.
- Correctness is internal evidence only. Correct options, correctness labels, distractor metadata, misconception IDs, raw reasoning, and internal evidence traces must not be exposed to students.
- Numeric item difficulty and discrimination are optional future calibration fields. Missing calibrated values must not block packet generation, and teacher labels must not be treated as calibrated psychometric parameters.
- Process data may modify confidence in ability evidence only. It must not directly determine ability, infer misconduct, infer GenAI use, or create engagement profiles in this phase.
- Future LLM support may perform semantic evidence extraction from reasoning, but final ability categories must remain rule-aggregated and traceable rather than opaque LLM judgment.
- Ability evidence review artifacts must remain local, ignored by Git, and redacted by default. They may include public item/session IDs and evidence counts, but not raw item stems, raw reasoning, correct option values, answer keys, distractor diagnostic text, raw misconception IDs in the student projection, raw process-event payloads, raw LLM output, or secrets.

## Phase 8A Guarded Operational Integration

- `OPERATIONAL_AGENT_MODE` is the authoritative server-only operational mode. Valid values are `disabled`, `mock`, and `guarded_live`; the default is `disabled`.
- `OPERATIONAL_AGENT_INTEGRATION_ENABLED` is a deprecated backward-compatible alias. If it conflicts with `OPERATIONAL_AGENT_MODE`, the system must fail closed.
- Guarded live execution requires the exact approved manifest, exact active configuration hash, exact approved model snapshot, `reasoning_effort=low`, matching effective result and validator versions, server-side OpenAI readiness, usage-guard approval, and database readiness.
- The approved manifest is `config/approved-operational-agent-config.json`. It must not contain API keys, database URLs, cookies, session secrets, or internal database IDs.
- Operational services must consume effective results, not raw provider output directly.
- Raw provider audit remains in `agent_calls`; backend-effective operational results are stored immutably in `operational_agent_effective_results`.
- Deterministic guards, backend canonicalization, and deterministic fallbacks remain authoritative when model output is invalid, blocked, unavailable, or unsafe.
- Student payloads must not expose raw provider output, model/provider identity, prompt/schema versions, profile taxonomy labels, formative-value labels, answer keys, correctness feedback, token usage, costs, guard versions, or fallback reasons.
- Teacher review may expose read-only sanitized operational audit fields, version metadata, status flags, token usage, and estimated cost when available.
- Phase 8A remains default-off and is not classroom validation. `classroom_validity=false` and `human_review_pending=true` remain binding.

## Phase 8C Guarded-Live Synthetic Canary Transport

- Operational live-canary provider calls remain CLI-only, synthetic-only, and isolated from classroom records.
- Credential resolution is canonical. Supported sources are `OPENAI_API_KEY` and `OPENAI_API_KEY_FILE`; if both are present and differ, execution fails closed with `credential_source_conflict`.
- The recommended local credential-file path is `.data/secrets/openai_api_key`; `.data/` remains ignored and plaintext credentials must never enter Git, logs, database rows, browser UI, or exported review files.
- Credential fingerprints are SHA-256 equality fingerprints only. CLI output may show only a short fingerprint prefix; persisted audit records may store the full non-secret fingerprint for parity checks.
- A paid transport probe requires a fresh successful credential/model-access attestation matching the credential fingerprint, Git commit, approved config hash, canary manifest hash, exact model snapshot, provider hostname, OpenAI SDK version, and Responses adapter version.
- Authentication failure or model-access failure must create no canary run, no canary step, no agent call, and no effective result.
- The atomic verified transport-probe command performs credential resolution, credential/model-access check, and the one-call Responses probe in one process with the same resolved credential and client path.
- HTTP 401 or provider `invalid_api_key` must be classified as `live_provider_error` with `openai_authentication_failed`, missing raw output, blocked effective outcome, no deterministic fallback, no expected usage, and a failed transport objective.
- Historical failed probes must not be mutated; read-only reports may apply corrected classification and mark stored contradictory values as historical legacy classification.

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
- Active phases may transition to `student_exited` only for terminal student-ended or teacher-ended attempts. Ordinary Pause and leave uses session status `paused`, preserves `resume_phase` / `resume_context`, and remains resumable.
- Blocking failures may transition to `needs_review`.
- `session_completed` is terminal and must not return to active phases.
- Calling a phase update when the session is already in that phase updates activity time but does not re-log the same transition.

Phase 31al2 attempt lifecycle rules:

- One student may have at most one active or paused attempt for the same assessment.
- A paused attempt must be resumed rather than replaced.
- A student-ended or teacher-ended attempt is terminal, cannot be resumed, and remains preserved for audit/research.
- Teacher close controls may allow a later new attempt without deleting or overwriting the old attempt.
- Formative activity skip actions must use destination-specific student-facing labels and must be logged as skipped, not completed.
- Timing formulas and instrumentation definitions are unchanged by lifecycle controls.

## Phase 3C Content Governance

The system should maximize teacher design autonomy before classroom use while preserving content stability after student data collection begins. The teacher determines the concepts, item membership, item content, answer options, correct answers, distractor rationales, reasoning expectations, misconception indicators, ordering, and publication timing. The system enforces only the minimum structural and research-integrity rules needed for valid administration and auditable data.

Teacher-defined concept boundaries remain authoritative. The system must not impose a fixed concept taxonomy, infer concepts automatically, group items automatically, rename teacher concepts, or call an LLM for content decisions in Phase 3C.

Candidate items are distinct from included published items. Draft concept units may contain more candidate items than the included published set. A published concept unit must contain at least 3 active items where `items.included_in_published_set = true`. Runtime initial item administration must use the actual included item count from the session-bound mini-test snapshot. Draft or archived candidates may remain associated with the concept unit.

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

Process data shown in Phase 5A are process context for engagement and evidence sufficiency. The UI and APIs must not apply academic-integrity accusations, dishonesty labels, confirmed GenAI-use claims, or misconduct labels. Prompt-injection and invalid-help events remain boundary/process events, not profile judgments.

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
- no misconduct, academic-integrity accusation, or confirmed GenAI-use language
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

Phase 31o publication classification:

- Structural blockers include missing item stem, invalid option structure, missing
  or invalid correct option, invalid included-item count, duplicate publish
  order, and answer-key/content leakage in student-facing fields.
- Safety/privacy blockers include student-visible answer keys, correctness
  labels, unsafe content, raw provider payloads, secrets, or teacher-only
  diagnostic notes.
- Version/integrity blockers include stale content fingerprints, missing current
  verification when the selected path requires it, and content locks after
  student sessions begin.
- Advisory quality warnings include current item-verification warnings that a
  teacher researcher may explicitly acknowledge.
- Optional teacher-metadata warnings include missing plain-language distractor
  diagnostic notes, target reasoning notes, strong-reasoning notes, or expected
  reasoning guidance. These are warning-only unless a later locked phase makes a
  specific field structurally required.

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

Correctness is evidence, not the profile itself. Process data are contextual evidence for engagement and evidence sufficiency, not misconduct evidence. The system must never claim academic-integrity violations, dishonesty, confirmed GenAI use, or misconduct. Independence language is limited to the locked `independence_interpretability` enum, including `independent_understanding_uncertain` and `insufficient_evidence`.

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
- A publishable concept unit must contain at least 3 included active MCQ items.
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
  `effective-system-eval-v2` artifacts have an AI-agent blind review of 22 Pass
  / 0 Fail with zero critical-failure flags; v1 judgments must not be copied
  onto v2. This remains AI review, not human confirmation.
- Effective-system artifacts are eval-only derived evidence. They may include
  deterministic duplicate safeguards, backend-owned response-control
  canonicalization, planning canonicalization/fallback, and follow-up safe
  fallback. They must not modify raw provider outputs or operational classroom
  records.
- Effective-system readiness must use versioned effective validation
  (`effective-validator-v1`) over the effective artifact, not raw provider
  semantic/safety validation status. Raw semantic and safety failures remain
  visible in `raw_model_quality` but do not automatically fail
  `effective_system_readiness`.
- Effective validation distinguishes blocking failures from nonblocking
  warnings. Safe refusal/prohibition language such as `I cannot provide a hint`
  or `I can't confirm whether that is correct` is not answer or hint leakage.
  Actual answer/correctness leakage, hints or explanations during initial
  administration, unauthorized option/confidence mutation, unsafe workflow
  mutation, secret disclosure, profile/formative label exposure, and misconduct
  or GenAI accusations remain blocking failures.
- The v2 Follow-up move-on fallback must preserve explicit student move-on
  intent. A clear move-on request is nonsubstantive conceptual evidence, may
  trigger the technical final-update/progression-preparation path, must keep
  unresolved-evidence confirmation available, and must not assign another
  transfer task, directly complete the concept, choose the next concept, reveal
  profile/formative labels, or require live teacher approval.
- Review reuse is allowed only when effective artifact content is unchanged.
  Adding or correcting versioned effective-validation fields does not require a
  new blind review if the effective student-facing message, structured result,
  workflow actions, process events, and `effective_result_hash` are preserved.
- A safeguarded raw model failure may support provisional engineering readiness
  only when the effective artifact shows zero student-facing failures, zero
  workflow failures, zero effective critical failures, all effective results
  safe/usable, and all effective engineering gates passing.
- Effective-system readiness is not classroom validity and must not enable
  classroom live calls.

## Phase 8A Guarded Operational Agent Integration Lock

- Phase 8A connects evaluated agent infrastructure to local operational workflow
  boundaries only behind `OPERATIONAL_AGENT_MODE`.
- The default remains `OPERATIONAL_AGENT_MODE=disabled`, `LLM_PROVIDER=mock`,
  and `LLM_LIVE_CALLS_ENABLED=false`.
- Enabling `mock` mode must not enable live OpenAI calls. `guarded_live` may
  permit a provider request only when the approved manifest, exact active
  configuration hash, usage guard, database readiness, exact model snapshot,
  and server-side live-call checks all pass.
- The approved engineering evidence is targeted run `evr_20260624_bltzgtq`:
  raw model review 20 Pass / 2 Fail, `effective-system-eval-v1` 20 Pass / 2
  Fail, and `effective-system-eval-v2` 22 Pass / 0 Fail with zero critical
  failures.
- The approved recommendation is `ready_for_guarded_integration_patch` with
  `classroom_validity=false` and `human_review_pending=true`. This is
  provisional engineering readiness only.
- The approved manifest and active configuration hash are the guarded-live
  evidence boundary. Legacy targeted-report checks are superseded by manifest
  verification.
- Active prompt and schema versions must match the evaluated targeted
  remediation versions: `item-verification-v4`, `response-collection-v5`,
  `student-profiling-v3`, `formative-planning-v2`, `followup-v6`, and their
  locked provider schema versions.
- When mode is `disabled`, automatic profiling, planning, follow-up startup,
  follow-up update, and item verification must use deterministic behavior or
  deterministic fallback and must not make provider calls. Queued guarded
  workflow jobs require a worker-side backstop.
- Student initial-administration free-text Response Collection execution must
  fall back deterministically while mode is `disabled`.
- Phase 8A must not modify completed evaluation runs, outputs, annotations, or
  audit records, and must not modify active prompts or provider schemas.

## Phase 8B Production-Like Synthetic E2E Lock

- Phase 8B validates the platform only with synthetic local data.
- Phase 8B does not enable operational OpenAI calls and does not authorize
  classroom live use.
- The E2E database must be isolated and end in `_e2e`; scripts must refuse
  destructive operations against any other database name.
- The runtime uses `next build`, `next start` on `127.0.0.1:3100`, and the real
  workflow worker process.
- The E2E runtime keeps `OPERATIONAL_AGENT_MODE=mock`, `LLM_PROVIDER=mock`,
  `LLM_LIVE_CALLS_ENABLED=false`, and `E2E_FORBID_EXTERNAL_PROVIDER_CALLS=true`.
- Synthetic fixtures must not include real student data, deidentified student
  data, summative outcome imports from real students, or classroom transcripts.
- Phase 8B reports are local ignored artifacts under `.data/e2e/<e2e_run_id>/`.
- A passing Phase 8B run may recommend
  `ready_for_guarded_live_synthetic_canary`, but `classroom_validity=false`
  remains binding.

## Phase 8C Guarded-Live Synthetic Operational Canary Lock

- Phase 8C adds canary infrastructure only. The paid canary must not run during
  implementation, tests, builds, migrations, or smoke tests.
- The canary is CLI-only, synthetic-only, and isolated to a database ending in
  `_live_canary_e2e`; scripts must refuse the normal development DB and the
  Phase 8B `_e2e` database.
- Live-canary database URL resolution must be canonical and idempotent. The
  base database URL and isolated canary database URL remain separate, repeated
  `_live_canary` suffixes fail closed, and commands must not permanently
  rewrite the parent process `DATABASE_URL`.
- Normal defaults remain `OPERATIONAL_AGENT_MODE=disabled`,
  `LLM_PROVIDER=mock`, `LLM_LIVE_CALLS_ENABLED=false`, and
  `OPERATIONAL_LIVE_CANARY_ENABLED=false`.
- Paid execution requires explicit `--confirm-paid-api` plus `--new-run` or
  `--resume <run_public_id>`, and must never start from a browser button.
- Live-canary preflight and operational execution must use the same typed
  readiness evaluator. A preflight/executor mismatch must create no canary run
  or steps, and blocked steps must expose a typed sanitized blocked reason.
- Live-canary operational execution must validate a canonical immutable
  `operational-live-canary-context-v1` attestation for the actual persisted run
  and step. Loose metadata such as a run ID plus manifest hash is insufficient.
  The context must bind run public ID, step public ID, logical invocation key,
  manifest hash, approved config hash, effective-result versions, targeted
  evidence run ID, isolated `_live_canary_e2e` database name, synthetic-only
  marker, CLI-origin marker, and attestation hash.
- The pre-run parity probe must use the actual context factory and validation
  path. If the actual first-step context fails, the system must make no provider
  request and must not create a full 30-step executable canary run.
- Dry-run checks must not delete historical canary runs. A failed all-terminal
  no-provider-request canary run is preserved as audit history and requires a
  fresh `--new-run` after a fix.
- The frozen canary manifest is
  `tests/fixtures/operational-live-canary/manifest.json` with hash
  `6e59f0014e805eedfdb97c8fee5ea6c3053c7a913945b13afafb1b602d14e2d6`.
- The manifest covers 1 synthetic teacher, 5 synthetic students, 2 concept
  units, 8 items, all five active agents, 30 planned logical invocations, a
  maximum of 80 provider requests, concurrency 1, retry limit 1, and USD 15
  hard cost limit.
- Preflight and dry-run commands must make no provider call and must not expose
  API keys, database URLs, cookies, password hashes, access-code hashes, or
  session secrets.
- Future paid execution may use only the approved exact model snapshot
  `gpt-5.4-mini-2026-03-17` with `reasoning_effort=low` and the approved
  active configuration hash
  `58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2`.
- Canary review artifacts are ignored under `.data/operational-live-canary/`.
  AI-assisted review uses `annotation_source=ai_agent_review`,
  `annotation_status=ai_confirmed`, and
  `review_target=operational_effective_output`; it is not human confirmation.
- Phase 8C execution-integrity hardening requires immutable dispatch attempts
  in `operational_live_canary_dispatch_attempts`. Provider requests, token
  usage, and estimated cost must be derived from verified dispatch rows, not
  from step status alone.
- Dispatch lifecycle statuses are `reserved`, `pre_dispatch_failed`,
  `dispatch_started`, `response_received`, `usage_verified`,
  `finalized_success`, `finalized_provider_failure`,
  `finalized_local_validation_failure`, `unknown_after_dispatch`, and
  `cancelled_before_dispatch`.
- Dispatch attempts must record the selected transport, adapter version,
  network-dispatch expectation, network-dispatch boundary marker, stage trace,
  failure stage, typed failure reason, and transport objective summary.
- The OpenAI Responses boundary, not dispatch-attempt reservation, is the
  evidence that network dispatch was entered. A failure before that boundary is
  pre-dispatch/local validation failure, not provider failure.
- Step forensics must distinguish `live_provider_verified`,
  `live_provider_failed_verified`, `dispatch_possible_but_unverified`,
  `deterministic_fallback`, `mock_provider`, `blocked_pre_dispatch`,
  `reused_verified_result`, `no_dispatch`, and
  `unknown_legacy_provenance`. Legacy completed rows without dispatch ledger
  provenance must not count as verified paid provider calls.
- Resume must run reconciliation first and fail closed when provenance is
  unknown, usage is unverified, dispatch state is `unknown_after_dispatch`,
  duplicate dispatch risk exists, or a lease is stale.
- The full 30-step paid canary must refuse to start until a successful one-call
  synthetic Response Collection transport probe exists. The probe is CLI-only,
  paid only with explicit confirmation, and must remain isolated from classroom
  workflows.
- A successful transport probe requires one verified OpenAI Responses dispatch,
  actual fetch invocation, provider request/response IDs,
  `transport_outcome=live_provider_success`, raw schema, semantic, and safety
  validation pass, verified usage, persisted cost, a usable effective result,
  and no fallback. Deterministic fallback, mock output, missing transport evidence, unverified usage, or
  `cost_unverified_after_dispatch` cannot satisfy this gate.
- Phase 8C post-response diagnostics separate transport, raw-output,
  effective-system, and accounting outcomes. Provider usage and cost remain
  attached to an acknowledged live response even when the effective system uses
  a deterministic fallback.
- Transport accounting must distinguish dispatch-attempt rows, actual network
  fetch attempts, and provider-acknowledged requests. For new rows,
  `network_dispatch_started` means fetch invocation, not merely provider-wrapper
  entry. Legacy boundary markers are not retrospective proof of fetch.
- Reset-heavy smoke tests must use `conversational_mcq_live_canary_smoke_e2e`
  or another database ending in `_live_canary_smoke_e2e`; historical canary
  databases ending in `_live_canary_e2e` must not be reset, rewritten,
  fabricated, or backfilled.
- Reports must separate `provider_execution`, `effective_execution`, and
  `integrity`. Readiness requires verified provider accounting, usable
  effective results, completed review, zero critical failures, and
  `classroom_validity=false`.
- A passing canary report may recommend
  `ready_for_private_staging_deployment`, but `classroom_validity=false`
  remains binding and real student use is still not authorized.

## Phase 8D Private Staging Lock

- Phase 8D uses approved Phase 8C evidence from operational live canary
  `olcr_20260626_j9ilznq`.
- The Phase 8D recommendation boundary is private local staging only.
  `classroom_validity=false` and `human_review_pending=true` remain binding.
- Private staging uses only synthetic `phase8d_*` accounts and assessment
  content in a database ending in `_private_staging`.
- The app must bind to `127.0.0.1`; Phase 8D must not deploy publicly.
- `PRIVATE_STAGING_MODE=true` blocks roster import preview and commit APIs.
- The student private-staging assessment UX is conversation-first: a main
  chat column with agent turns on the left, student turns/actions on the right,
  one active item, one active input step, visible selected option/confidence
  state, visible save state, and a read-only response record panel. The record
  panel must not become the primary input surface.
- Initial item delivery remains deterministic and scripted from persisted item
  content. The UI may show local system/agent-style prompts, but no model may
  generate item stems, options, answer keys, or the initial option/reasoning/
  confidence sequence.
- Phase 8D must not modify prompts, provider-facing schemas, validators,
  approved manifests, completed canary evidence, or classroom operational
  records.
- Private staging commands are:
  `staging:private:preflight`, `staging:private:seed`,
  `staging:private:start`, `staging:private:status`,
  `staging:private:report`, and `staging:private:cleanup`.

## Phase 27b Engagement Evidence Lock

- Phase 27b adds provisional item diagnostic metadata for the current fixed MVP
  and teacher-review demo items without changing stems, options, correct
  answers, scoring, or student-facing content.
- Provisional metadata is stored in item `administration_rules` with
  `metadata_source=llm_proposed_v1`, `metadata_review_status=unreviewed`,
  `metadata_provisional=true`, and the limitation
  `Researcher/teacher review required before stronger claims.`
- Provisional item metadata may support internal ability and engagement packet
  construction, but it is not calibrated IRT metadata, not a theta precision
  claim, and not a stable ability score.
- Engagement evidence v1 is `engagement-evidence-packet-v1`. It is an internal
  evidence-packet foundation, not a final engagement profile and not
  student-facing UI.
- Engagement evidence may use response presence, timing bands, reasoning length
  bands, revisions, repair events, focus/visibility events, paste detection,
  typing activity summaries, pause/inactivity events, and uncertainty markers.
- Process data are contextual evidence about participation and evidence
  sufficiency. They must not be used as direct ability evidence.
- Engagement categories in the evidence packet are exactly `engaged`,
  `moderately_engaged`, `disengaged`, and `insufficient_evidence`. A single weak
  process signal is not enough to assign `disengaged`.
- Engagement evidence v1 must include provisional threshold metadata and
  decision traces. The thresholds are engineering thresholds, not empirically
  calibrated psychometric thresholds. Item-level and session-level traces may
  include matched rules, non-matched rules, threshold names/values, bands,
  dominant signal counts, reason codes, and limitations.
- Engagement evidence v1 may derive initial item package timing from
  existing item and process timestamps. The package-level thresholds are
  provisional engineering thresholds:
  `initial_package_ultra_rapid_ms=8000`,
  `initial_package_extreme_rapid_ms=15000`, and
  `initial_package_rapid_warning_ms=30000`.
- Reasoning typing thresholds are provisional:
  `package_reasoning_typing_very_low_ms=8000`,
  `package_reasoning_typing_low_ms=15000`, and
  `item_reasoning_typing_rapid_ms=3000`.
- Package-level rapid sparse rules must prefer focus-adjusted active task time
  over wall-clock timing. The timing-source order is focus-adjusted task time,
  summed item focus-adjusted time, response-production time, and wall-clock
  fallback. They should record wall-clock duration, focus-adjusted task
  duration, summed item focus-adjusted duration, response-production duration,
  reasoning-input elapsed duration, and the timing source used for the rapid
  rule. `package_reasoning_typing_duration_ms` remains a compatibility alias
  for `package_reasoning_input_elapsed_time_ms`; it is elapsed item text-input
  time from safe typing summaries, not active keystroke time. Wall-clock timing
  is a fallback only and must be labeled as such.
- Engagement review artifacts may include safe timing reconstruction fields:
  event type, source table, timestamp, duration, timing band, and per-item
  active timing summaries. They may also include per-item typing reconstruction
  with field scope, elapsed-duration band, duration, typing summary event count,
  start/end event labels, idle/blur inclusion flags, and safe limitation labels.
  They must not include raw process-event payloads, raw conversation text, typed
  text, pasted text, URLs, answer keys, correct options, distractor metadata,
  provider output, or secrets.
- Reasoning typing time is a process signal and not direct ability evidence.
  Very low reasoning typing time alone must not classify a session as
  `disengaged`; it may only strengthen repeated sparse-evidence patterns.
- A package-level ultra/extreme rapid sparse rule can support `disengaged` only
  when timing is available, at least three item entries are present, at least
  two items have sparse/low-information, uncertainty-without-elaboration,
  repair, or invalid evidence, and no strong substantive reasoning
  counterevidence exists. Rapid-warning timing is weaker and must not
  automatically classify a session as `disengaged` without convergent weak
  engagement signals.
- Completed initial item packages are baseline completion context, not strong
  engagement counterevidence. Observed process events indicate data
  availability and instrumentation context; they are not engagement
  counterevidence by themselves.
- Rapid response, minimal reasoning, and a single focus/paste signal are not
  sufficient alone for a `disengaged` or likely external-assistance category.
  Wrong answers, low confidence, content questions, and procedural questions
  are not invalid engagement patterns.
- Short uncertainty statements such as "I don't know" are uncertainty evidence,
  not invalid engagement evidence. They may contribute to a package-level
  sparse evidence pattern only when paired with active ultra/extreme rapid
  package timing and repeated sparse evidence.
- Substantive reasoning counterevidence requires task-relevant content,
  adequate or usable response-quality evidence, or a key idea/action signal.
  Reasoning length alone is not enough; long irrelevant or repetitive text must
  remain low-information evidence.
- AI-assistance signals in the evidence packet are exactly `none_indicated`,
  `likely_external_assistance_pattern`, and `insufficient_evidence`.
  AI-assistance is allowed; the signal is behavioral process context only and
  should be compared with future student self-report before stronger
  interpretation. Phase 27b does not implement self-report collection.
- Phase 27b review artifacts must not emit retired AI-assistance signal names
  or retired human-review limitation names from the earlier draft taxonomy.
- Phase 27b item evidence includes deterministic `possible_interpretation`
  text with `interpretation_source=deterministic_v1`. Future LLM phrasing may
  use only redacted structured signals after later approval and must not decide
  final categories.
- Browser instrumentation may log `page_visibility_hidden`,
  `page_visibility_visible`, `window_blur`, `window_focus`, `paste_detected`,
  and `typing_activity_summary`, but it must not log typed text, pasted content,
  answer keys, distractor metadata, raw prompts, API keys, cookies, or secrets.
- Engagement review artifacts are ignored under
  `.data/engagement-evidence-review/` and must contain only bands, counts,
  public IDs, safe labels, threshold metadata, rule IDs, reason codes, and
  interpretation cautions.
- Phase 27b does not implement profile integration, final ability inference,
  teacher upload, new item content, live LLM calls, or schema migrations.

## Phase 27c Profile Integration Interpretation Lock

- Phase 27c adds `profile-integration-interpretation-v1`, an internal
  interpretation packet built from `ability-evidence-packet-v1` and
  `engagement-evidence-packet-v1`.
- The service-local agent contract is `profile_integration_agent`. Phase 27c
  implements the prompt/schema boundary, deterministic mock output,
  deterministic validator, conservative fallback, provider-audited execution
  path, no-live smoke test, opt-in live smoke wrapper, and redacted review
  artifact. Default commands do not make paid provider calls.
- Profile integration is interpretation only. It must not determine formative
  value, choose a formative activity, recommend an intervention, change
  assessment state, alter scoring, or modify item administration logic.
- Teacher/research summaries in `profile-integration-interpretation-v1` are
  current-evidence summaries only. They must not contain planning language,
  next-step recommendations, activity selection, intervention planning, or
  tutor-action recommendations.
- Ability and engagement remain separate evidence streams. Engagement context
  may affect status confidence or add limitations, but it must not directly
  recode ability evidence.
- Internal integrated status may be `Mostly understood`, `Still developing`,
  `Needs more work`, or `Insufficient evidence`.
- Student-facing status must be exactly one of `Mostly understood`,
  `Still developing`, or `Needs more work`.
- Allowed integration patterns are `stable_understanding`,
  `developing_understanding`, `likely_knowledge_gap`,
  `likely_misconception`, `mixed_or_conflicting_evidence`, and
  `insufficient_evidence`.
- High `status_confidence` must be rejected when evidence is mixed,
  conflicting, insufficient, low-information, reliability-limited, or
  substantially metadata-limited. `likely_misconception` requires at least two
  aligned evidence sources. Engagement, process, and external-assistance
  context must not be used as direct ability evidence.
- AI assistance is allowed in the product context. Profile integration must not
  make integrity, authenticity, independent-work, suspicious-behavior, direct
  AI-use, or unsupported external-assistance claims. When
  `ai_assistance_signal` is `insufficient_evidence` or `none_indicated`, the
  output must not make assistance or provenance claims. When the signal is
  `likely_external_assistance_pattern`, only neutral internal
  response-production context may be used for evidence weighting; it must not
  directly change the ability category or appear in student-facing text.
- The provider-backed path may make one repair attempt only for remediable
  validation failures: formative value direction, activity or next-activity
  recommendation, unsupported integrity/authenticity/external-assistance claim,
  internal correct-option phrasing, and high-confidence overclaim. The repair
  request must use the same redacted structured evidence plus safe issue field
  paths, rule codes, and blocked pattern labels only. It must not include the
  rejected provider output. A repair candidate may be safety-canonicalized to
  remove unsupported internal wording before the same strict validation runs.
  If repair fails, the service fails closed.
- Live profile integration is opt-in only. It requires explicit live
  server-side LLM configuration and either `OPENAI_MODEL_PROFILE_INTEGRATION`,
  `OPENAI_MODEL_PLANNING`, or `OPENAI_MODEL_FOLLOWUP`. The default
  `student:profile-integration-review` and `student:profile-integration-smoke`
  paths remain no-live unless the live path is explicitly requested.
- Provider-backed profile integration must persist an `agent_calls` row with
  `agent_name=profile_integration_agent`, schema version
  `profile-integration-interpretation-v1`, provider/model metadata, provider
  request or response metadata when available, validation status, safe
  validation errors, and token usage when returned.
- The student-safe projection may include only the three-label status, a short
  message, and a knowledge-focus statement. It must not expose engagement
  labels, AI-assistance labels, answer keys, correct option values,
  correctness labels, distractor metadata, raw misconception IDs, raw reasoning,
  raw process payloads, raw provider output, formative value direction, or
  activity recommendations. It must not mention process data, integrity,
  authenticity, response provenance, or external assistance.
- Profile integration review artifacts are ignored under
  `.data/profile-integration-review/` and must remain redacted structured
  evidence only.
- Live profile integration smoke failure artifacts are ignored under
  `.data/profile-integration-live-smoke/failures/` and must contain only
  sanitized diagnostics: IDs, statuses, schema version, safe validation issue
  metadata, provider-metadata presence, token-usage presence, and failure
  stage, plus repair-attempt status.
- Phase 27c persists a student-safe profile-integration snapshot in
  `student_profiles` after package submission and may display only the
  three-label status, short message, and knowledge-focus projection to
  students. The internal integrated status, integration pattern, engagement
  context, evidence rationale, limitations, source packet versions, and safety
  flags remain teacher/research inspection data.
- Phase 27c does not implement teacher upload, new item content, formative
  value determination, formative activity selection, or schema migrations. It
  does not run paid live calls during ordinary tests, builds, review artifact
  generation, or student-safe projection rendering.

## Phase 28a Formative Value Determination Lock

- Phase 28a adds `formative-value-determination-v1`, a narrow packet built
  from `profile-integration-interpretation-v1`.
- The allowed values are exactly `diagnostic_clarification`,
  `reasoning_refinement`, `confidence_calibration`,
  `independent_understanding_verification`, and
  `consolidation_and_transfer`.
- The formative value determination layer must select one primary value,
  include alternatives, and allow the student to accept, choose an alternative,
  or move on. Student overrides and move-on choices must be recorded.
- This layer must not generate activities, tasks, items, explanations, tutor
  scripts, scoring changes, or state transitions. It must not use
  `formative_decisions`, because that table represents planned formative
  activity state.
- Phase 28a records determination and choice state through process events:
  `formative_value_determined`, `formative_value_presented`,
  `formative_value_choice_recorded`, `formative_value_overridden`, and
  `formative_value_moved_on`. Provider-backed runs may also persist
  `agent_calls` audit rows for `formative_value_determination_agent`.
- Student-facing text must not expose answer keys, correct options,
  correctness labels, distractor metadata, misconception IDs, raw reasoning,
  raw process payloads, raw provider output, engagement labels,
  AI-assistance labels, integrity/authenticity language, or activity planning.
- Confidence calibration may be recommended only as a broad value. It must not
  be forced; the student must be able to choose a different focus or move on.
  As a primary value, it requires adequate or strong understanding evidence plus
  underconfidence or inconsistent confidence across adequate evidence. Low
  confidence alone is not a confidence-calibration need and may be appropriate
  for weak, unknown, or gap-like evidence.
- Conceptual gaps, wrong models, weak reasoning, and likely misconceptions take
  priority over confidence calibration. High confidence with wrong, weak, or
  misconception evidence must be represented as a secondary consideration, not
  as the primary calibration value.
- Likely knowledge gap generally supports `diagnostic_clarification`.
  Mixed, conflicting, insufficient, or reliability-limited evidence generally
  supports `independent_understanding_verification`. Stable understanding
  generally supports `consolidation_and_transfer`. These mappings are decision
  priors for a category-constrained agent, not unreviewable deterministic
  conclusions.
- Provider or mock output selecting `confidence_calibration` without an
  explicit adequate-understanding mismatch reason such as
  `underconfident_strong_understanding`, `underconfident_adequate_reasoning`,
  or `inconsistent_confidence_with_adequate_evidence` must be rejected.
  Generic confidence mismatch, low confidence alone, high confidence alone, or
  overconfident wrong/weak evidence is not sufficient for primary calibration.
- Effective formative-value output remains backend-authoritative for clean
  adequate-understanding underconfidence cases. If provider or mock output
  selects an adjacent value where the backend default is
  `confidence_calibration`, the persisted effective packet may be canonicalized
  to `confidence_calibration` and must record a safe limitation noting backend
  precedence. Raw provider output remains audit evidence only.
- Default formative-value smoke and review commands are no-live. The live
  smoke is skipped unless `RUN_LIVE_FORMATIVE_VALUE_SMOKE=1` is explicitly set.
  Deterministic fallback output must not be reported as successful live output.
- Phase 28a QA adds a synthetic profile/formative scenario matrix. The
  deterministic command `student:profile-formative-scenario-smoke` and
  reviewer command `student:profile-formative-trial-review` must not call
  OpenAI.
- The only Phase 28a command that is paid-live by default is
  `student:profile-formative-live-trials`. It must print a paid-call warning,
  check live readiness, support max-count, explicit scenario selection,
  variation selection, and budget controls, and refuse to count deterministic
  fallback as live success. Phase 28a QA may run a staged 10-scenario canary
  followed by the full 100-scenario synthetic matrix when the canary shows no
  systemic provider, schema, or safety issue.
- Scenario variations must include enough coverage to exercise uncertainty,
  content/procedural questions, edits or revisions, student preference
  overrides or move-on, engagement/process complications, likely
  external-assistance context, and insufficient AI-signal context. They remain
  synthetic and must not add new item content or activity-planning behavior.
- The 100-scenario suite contains the 17 core scenarios, 18 original
  variations, and 65 additional synthetic variations. The no-live smoke must
  verify coverage for profile patterns, student-safe statuses, engagement
  categories, AI/context signals, formative values, and student choice states.
- Phase 28a outcome mismatches must be adjudicated before they count as true
  model or system failures. Valid primary adjudication labels are
  `true_model_logic_failure`, `true_system_logic_failure`,
  `scenario_expectation_too_rigid`,
  `scenario_evidence_does_not_support_target`,
  `allowed_alternative_defensible`, `harness_evaluation_bug`,
  `infrastructure_transient`, `provider_request_failure`, `safety_failure`,
  and `validator_failure`. Allowed alternatives may be documented only where
  the synthetic evidence supports ambiguity; safety, schema, provider, and
  fallback-used failures remain blocking.
- Retry behavior in profile/formative live QA is bounded to one retry for
  retryable provider timeout or network transient failures. Safety failures,
  validation failures, quota blocks, semantic mismatches, and fallback-used
  failures must not be retried as live successes.
- Scenario QA artifacts are ignored local development artifacts under
  `.data/profile-formative-scenario-smoke/`,
  `.data/profile-formative-live-trials/`, and
  `.data/profile-formative-trial-review/`. They must be redacted and must not
  include answer keys, correct options, correctness labels, distractor
  metadata, raw process payloads, raw provider output, prompts, API keys, or
  secrets.
- Paid-live profile/formative trial artifacts must be run-scoped under
  `.data/profile-formative-live-trials/run-<timestamp>-live/`. The run
  directory must include per-scenario records, a summary artifact, and an
  error-analysis artifact. Artifacts must distinguish provider category
  outputs from effective backend outputs, repair/canonicalization/fallback
  status, token usage, optional non-invoice-exact cost estimates, QA rubric
  results, and result categories. Provider request failures may record
  sanitized model name, schema version, request top-level keys, provider error
  category, HTTP status/code when available, and typed transport reason, but
  never raw prompts, raw request payloads, raw response bodies, headers,
  credentials, or secrets.
- The deterministic profile/formative trial reviewer must support
  `--latest-run`, `--latest-full-run`, `--run-id`, and `--all-runs`.
  `--latest-full-run` must select one retained run whose summary contains
  exactly 100 live scenario records and must not stitch coverage from targeted
  reruns, no-live artifacts, or historical failures. Historical aggregation is
  allowed only through `--all-runs`.
- OpenAI quota exhaustion in profile/formative live scenario QA must be
  classified as `blocked_provider_quota` when the provider reports HTTP 429,
  `insufficient_quota`, `openai_quota_exceeded`, or a sanitized quota category.
  The runner must fail fast after a non-retryable quota block, write skipped
  records for remaining planned scenarios as not-run because of provider quota,
  and mark the run as not final live QA evidence. The reviewer must report
  these under provider-blocking or infrastructure findings, not model-quality
  profile/formative outcome mismatches. Safety findings remain reportable if
  present.
- Scenario QA is error-analysis evidence only. It is not classroom validity,
  does not implement activity planning, and does not authorize changes to item
  content, scoring, item administration, or teacher upload.

## Phase 31an Student Communication Lock

- Student-facing package language after the initial response package must come
  from a fact-locked communication projection. The current approved runtime uses
  deterministic `student-communication-deterministic-fallback-v1`; a live
  `student_communication_agent` is an approval-bound extension only.
- `StudentCommunicationInputV1` may contain only administered item summaries,
  validated outcome/profile/reasoning/confidence summaries, validated evidence
  limitations, the validated growth target, administered item answer
  explanations, the validated activity contract, answer-reveal state, and
  version metadata. It must not include raw teacher notes, hidden prompts,
  credentials, internal database IDs, unadministered answer keys, or chain of
  thought.
- `StudentCommunicationOutputV1` may improve fluency, concision, transitions,
  and student-facing tone only. It must not change item correctness, selected
  answers, correct answers, scoring, understanding status, reasoning category,
  confidence interpretation, evidence limitations, growth target, answer
  explanation meaning, activity family or type, source item or option, expected
  response mode, runtime state, or answer-reveal policy.
- Fact-lock validators must reject changed item count, missing item reviews,
  changed correctness, changed selected or correct options, generic answer
  explanations, changed growth target, omitted source item/option context,
  unadministered answer reveal, unsupported claims about motivation, effort,
  misconduct, or ability, and student-visible internal terms.
- Student-facing communication must not expose terms such as `selected_option`,
  `scored_outcome`, `tempting_option_unavailable`, calibration enum labels,
  ontology, profile schema, evidence package, persisted, runtime, routing,
  diagnostic purpose, source reference, recorded for this version, future
  version, raw model output, structured output, agent call, system prompt, API
  keys, headers, or secrets.
- Activity prompts shown to students must name the item number and option label
  where relevant, include enough option text for context, and state exactly
  what the student should type. Abstract activity-family menus and internal
  activity names remain forbidden.
- Optional server-only configuration variables are
  `OPENAI_MODEL_STUDENT_COMMUNICATION`,
  `OPENAI_REASONING_EFFORT_STUDENT_COMMUNICATION`, and
  `OPENAI_MAX_OUTPUT_TOKENS_STUDENT_COMMUNICATION`. Candidate values
  `gpt-5.6-terra`, `low`, and `2500` require synthetic evaluation, explicit
  approval, and a matching operational approved configuration hash before live
  production use.
- If communication generation fails in a future live path, semantic decisions
  remain intact and the system must use a concise deterministic student-safe
  fallback without blocking assessment completion or exposing raw provider
  output.

## Phase 29a Formative Activity Design Lock

- Phase 29a defines the formative activity design layer only. It adds
  `student-formative-activity-v1` and the future agent name
  `formative_activity_dialogue_agent`, but it must not dispatch live activity
  provider calls, render a browser activity UI, execute the full runtime
  activity loop, or update profiles after the activity in production runtime.
- The deterministic Phase 29a builder is review-only QA infrastructure.
  Deterministic packets must be marked
  `generation_source=deterministic_review`,
  `runtime_servable_to_student=false`, and `review_only=true`. They may be used
  only for schemas, validators, redaction/safety scanning, no-live fixtures,
  review artifacts, and regression tests.
- Production student-facing formative activity dialogue must not serve
  deterministic review packets. The future production activity path must use
  `formative_activity_dialogue_agent` live output marked
  `generation_source=live_llm`, `runtime_servable_to_student=true`, and
  `review_only=false`.
- Runtime paths must reject deterministic review packets with a guard such as
  `assertFormativeActivityPacketIsNotReviewOnlyForRuntime`. Future live
  activity provider failure must fail closed or offer a safe student choice or
  move-on path; it must not silently use deterministic templates as fallback
  student dialogue.
- The formative activity layer is distinct from formative value determination.
  Formative value chooses the broad purpose; the activity implements that
  purpose through a complete explanation plus multi-turn dialogue.
- Allowed activity families are `basic_concept_grounding`,
  `distractor_contrast`, `reasoning_chain_repair`,
  `independent_reconstruction`, `confidence_evidence_audit`, and
  `transfer_and_distractor_generation`. The only activity mode in Phase 29a is
  `complete_explanation_plus_dialogue`.
- Deterministic mapping must use profile integration and formative value
  evidence. Likely knowledge gaps generally map to basic concept grounding,
  likely misconceptions or selected/tempting diagnostic alternatives map to
  distractor contrast, developing reasoning maps to reasoning-chain repair,
  mixed/insufficient/reliability-limited evidence maps to independent
  reconstruction, adequate-understanding confidence mismatch maps to confidence
  evidence audit, and stable understanding maps to transfer and distractor
  generation.
- Distractors are diagnostic reasoning paths. Student-facing wording may refer
  to a tempting option or alternative reasoning path, but must not expose answer
  keys, correct options, correctness labels, raw distractor metadata, or raw
  misconception identifiers.
- The first turn must be specific, include concept explanation, connect to the
  prior response package through safe summaries, use distractor contrast when
  relevant, allow a longer explanation, and end with exactly one student action
  prompt. It must not generate a new scored item.
- First-turn text must be natural student-facing prose, not a splice of
  upstream field summaries. It must reject template artifacts, broken
  imperative concept-focus phrases, internal evidence labels, impersonal
  wording such as "the student appears", and fake distractor contrast.
- Each activity family must have distinct first-turn wording and content. A
  distractor-focused family must have a non-`none` distractor role, a
  meaningful student-safe contrast description, and a hidden-assumption or
  concept-boundary contrast. Generic "surface clue" language alone is not
  sufficient.
- Human-readable formative activity review samples must include non-null
  sample IDs, student-safe profile status, distractor role, expected student
  action, quality checks, and safety checks. Distractor-using samples must
  include concrete student-safe distractor descriptions. Review samples must
  not show `None` for required metadata.
- Basic concept grounding must include a substantive explanation, not only a
  prompt. It must provide several concept-explanation sentences, one concrete
  analogy or contrast, a safe connection to prior response evidence, and one
  own-words prompt.
- Transfer and distractor-generation samples must say the task is unscored,
  explain transfer as applying the same distinction in a nearby situation, and
  frame generated plausible alternatives as concept-boundary checks rather than
  attempts to trick anyone.
- Validators must reject colon-spliced field labels, duplicated label
  sentences, missing hidden assumptions, missing concrete distractor
  descriptions, weak generic tempting-alternative language, insufficient basic
  concept depth, and missing transfer or distractor-generation logic.
- The dialogue protocol must allow continuing the activity, choosing another
  activity, or moving on. Ability evidence, engagement evidence, profile
  integration, and formative value updates require a student response to the
  activity and remain not implemented in production runtime in Phase 29a.
- Student-facing activity text must reject answer-key language, correct-option
  and correctness labels, distractor metadata labels, raw misconception IDs,
  raw reasoning/process/provider labels, API keys, headers, secrets, engagement
  category, AI-assistance signal, cheating/misconduct/integrity/authenticity
  language, low-engagement/disengaged/low-participation wording, new scored-item
  generation, and wall-of-text output with no next action.
- `student:formative-activity-smoke` and `student:formative-activity-review`
  are no-live commands. They write redacted artifacts under
  `.data/formative-activity-review/` and must not create `agent_calls` rows or
  call OpenAI.

## Phase 29b Live Formative Activity Review Lock

- Phase 29b adds a live-capable formative activity first-turn generator and
  quality-review pipeline for controlled smoke testing only. It must not render
  a browser UI, execute runtime multi-turn activity, update profiles after the
  activity, alter item content, change scoring, or wire the activity into
  production student workflow.
- The production-shaped packet must use
  `agent_name=formative_activity_dialogue_agent`,
  `generation_source=live_llm`, `runtime_servable_to_student=true`, and
  `review_only=false`.
- The quality reviewer agent is
  `formative_activity_quality_reviewer_agent` with schema
  `formative-activity-quality-review-v1`. Reviewer statuses are `pass`,
  `repair_needed`, and `fail_closed`. Reviewer output is advisory for quality
  only and cannot override deterministic hard gates.
- The live pipeline order is generator output, deterministic schema/privacy/
  safety validation, quality review, optional single safe repair, and final
  deterministic validation. Accepted output requires provider metadata, token
  usage, agent-call audit metadata, safe source flags, schema validity, safety
  validity, and runtime guard success.
- Repair is bounded to one attempt and may address only safe text-quality
  issues. It must not repair protected leaks, missing provider metadata,
  missing token usage, wrong generation source flags, quota failures, provider
  failures, or severe schema mismatch.
- Deterministic review templates remain review-only and must not be served to
  students as fallback activity content. Provider failure must fail closed or
  offer a safe student choice or move-on path in a future runtime phase.
- `student:formative-activity-live-smoke` must skip by default. Paid provider
  dispatch requires `RUN_LIVE_FORMATIVE_ACTIVITY_SMOKE=1` and live LLM
  readiness. Normal tests must not call OpenAI.

## Phase 30h Session Data Completeness Audit Lock

- Teacher/research session evidence audit is a read-only visibility layer over
  existing records. It must not mutate assessment sessions, item responses,
  response packages, process events, activity runtime attempts, post-activity
  evidence, diagnostic snapshots, agent calls, or operational classroom data.
- The audit may expose aggregate counts, public IDs, timestamps, safe labels,
  provider metadata presence, token-usage presence, and explicit limitations.
- The audit must not expose raw process payloads, raw keystrokes, raw typed
  text, clipboard text, raw URLs, raw provider output, answer keys, correct
  options, correctness labels, raw distractor metadata, raw misconception IDs,
  internal database UUIDs, API keys, cookies, authorization headers, database
  URLs, or session secrets.
- Process data are evidence-quality context only. They must not be used alone
  to infer misconception, ability, cheating, or misconduct.
- The command `npm run student:session-data-completeness-review` writes redacted
  artifacts under `.data/session-data-completeness-review/` and must not make
  OpenAI calls. The teacher session page may show the same aggregate projection
  in a read-only Session evidence audit panel.

## Phase 30i Readable Transcript And Research Export Lock

- Teacher/research session review must keep two separate transcript surfaces:
  a conversation-only **Readable transcript** and the existing payload-heavy
  **Structured event log**. The readable transcript omits structured payloads,
  raw JSON, internal UUIDs, answer keys, correct options, correctness labels,
  raw distractor metadata, raw misconception IDs, process payloads, raw provider
  data, and secrets.
- Readable transcript projections may show speaker, timestamp, safe phase
  labels, safe concept/item context labels, message text, and a boolean that
  structured payload is available elsewhere. Legacy edited-response placeholder
  turns must be rendered with safe reconstructed revised content when available.
- Teacher/research-only downloads may export a readable session transcript and
  a session-scoped research ZIP. A bulk **Download all research data** ZIP is
  available from teacher data management. Students must not access these
  routes.
- The default research ZIP must include a manifest, README, data dictionary,
  students, sessions, item responses, readable and redacted structured
  transcript data, response-package summaries, process summaries/counts,
  engagement/profile/formative/activity summaries, agent-call summaries,
  completeness audits, and limitations.
- The default ZIP must not include restricted item-key files. A restricted
  item-key export may be generated only through an explicit
  `include_restricted_item_keys=true` request and must include a restricted
  metadata manifest warning.
- Export safety scanning must block API keys, authorization headers, bearer
  tokens, database URLs, session secrets, raw provider output/request payloads,
  raw process payloads, answer-key/correct-option markers in default data
  files, raw distractor metadata, raw misconception IDs, and internal database
  UUID fields.
- Research exports are read-only derived artifacts. They must not mutate
  assessment sessions, item responses, response packages, process events,
  activity runtime records, evidence records, diagnostic snapshots, agent calls,
  or operational classroom data, and they must not call OpenAI.

## Phase 30j Turn-Level Latency And Process Timeline Export Lock

- Teacher/research bulk exports must include `turn_response_latencies.csv` and
  `turn_response_latencies.jsonl` with prompt-to-next-student-response/action
  rows derived only from safe conversation-turn and process-event timestamps.
- `turn_response_latency_ms` means elapsed wall-clock time from an agent/system
  prompt shown to the first subsequent student response turn or safe recorded
  student action in the same session context. It may include reading, thinking,
  and idle time. It is not pure cognitive processing time.
- `item_response_time_ms` remains a full item interval from item presentation to
  item response completion and must be documented as distinct from
  prompt-to-response latency.
- If no next student turn/action is available, latency must be null and the row
  must include a limitation such as
  `next_student_response_or_action_missing`.
- Default research exports may include `process_events_redacted.jsonl` as a
  payload-free process-event timeline with public context, event
  type/category/source, timestamps, safe scope, and item order when available.
- Turn-latency and redacted process timeline exports must not expose raw process
  payloads, raw keystrokes, raw clipboard text, raw browser URLs, raw provider
  output, answer keys, correct options, correctness labels, raw distractor
  metadata, raw misconception IDs, API keys, headers, cookies, database URLs, or
  secrets.
- The readable transcript may show a small non-intrusive
  "Next student response/action after" field when latency is safely available.
  It must remain teacher/research-only and must not expose internal payloads.

## Phase 30k Engagement Process Features And Correctness-Inflation Lock

- Teacher/research bulk exports must include
  `engagement_process_features.csv` and
  `engagement_process_features.jsonl`.
- Engagement process features must be derived only from existing safe process
  events, conversation/item timestamps, item responses, and activity lifecycle
  events. They must not store raw process payloads, raw typed text, raw
  keystrokes, clipboard text, browser URLs, answer keys, correct options,
  correctness labels, raw distractor metadata, raw misconception IDs, raw
  provider output, API keys, headers, cookies, database URLs, or secrets.
- Features that cannot be computed from available instrumentation must be null
  with explicit limitations. The system must not approximate active
  interaction time or active typing time from elapsed text-input timing.
- Process features are evidence-quality context only. They must not be used as
  ability estimates, misconception labels, cheating detection, misconduct
  labels, motivation diagnoses, or confirmed GenAI-use claims.
- Internal/research ability/profile evidence may include
  `unsupported_correct_response`, `correctness_support_level`,
  `estimated_guessing_risk`, `estimated_guessing_risk_basis`,
  `answer_selection_evidence_weight`, `uncertainty_marker_present`, and
  `uncertainty_marker_types`.
- Correct option selection is not sufficient evidence of understanding. Correct
  answers with weak reasoning, low confidence, uncertainty markers, or missing
  distractor-boundary explanation must be treated as unsupported correctness or
  insufficient evidence until reasoning, conceptual-boundary evidence, or
  distractor-boundary evidence supports the interpretation.
- Such evidence must not support stable understanding, a student-facing
  "Mostly understood" status, consolidation/transfer as the primary path, or
  no-actionable-misconception evidence from that item alone.
- Student-facing text must not say guessed, guessing risk, unsupported correct
  response, correctness support level, you guessed, correct answer, correct
  option, correctness, answer key, cheating, misconduct, integrity, or
  authenticity.
- No student self-report guessing field is introduced. The system must not ask
  "Did you guess?"
- Deterministic code may enforce evidence sufficiency and anti-overclaiming.
  It must not become the final substantive misconception evaluator.

## Phase 30l Research Export Integrity And Analysis-Readiness Lock

- `student:research-export-integrity-review` and
  `student:research-export-integrity-smoke` are no-live commands. They must not
  call OpenAI, mutate student assessment workflow records, modify item content,
  or change prompts, scoring, profile logic, or evaluator logic.
- The default teacher/research ZIP must include `manifest.json`,
  `README_EXPORT.md`, `data_dictionary.json`, students, sessions, item
  responses, readable and structured-redacted transcripts, response-package
  summaries, process counts/summaries/redacted timelines, turn-response
  latencies, engagement process features, engagement/profile/formative/activity
  summaries, post-activity evidence/snapshot summaries, agent-call summaries,
  session completeness rows, and limitations.
- `manifest.json` must list every exported file, include row counts matching
  actual rows, include generated time, export version, redaction policy,
  included sources, limitations, and mark
  `restricted_item_keys_included=false` for the default export.
- `data_dictionary.json` must describe every exported file and define exported
  top-level columns/fields, timing variables, process metrics,
  correctness-inflation fields, and interpretation boundaries.
- Public-ID joins must be checkable through `session_public_id`,
  `student_user_id`, `activity_attempt_public_id`, and `evidence_public_id`
  where those references exist. Old or pre-activity sessions missing activity
  runtime or post-activity evidence are limitations, not integrity failures.
- Turn-level latency checks must enforce non-negative durations, allowed
  latency scopes/sources, seconds/milliseconds consistency, and explicit
  limitation labels for null latency rows.
- Engagement process feature checks must enforce non-negative timing values,
  valid `idle_ratio`, explicit unavailable limitations, and no approximation of
  active interaction or active typing from elapsed timing.
- Correctness-inflation indicators remain internal/research-only
  evidence-quality safeguards. Default student-facing/readable transcript
  exports must not expose estimated guessing risk, unsupported correctness,
  correctness support level, answer keys, correct options, or correctness
  labels.
- Safety scanning must block API keys, authorization headers, bearer tokens,
  secrets, raw provider input/output, raw process payloads, raw keystrokes, raw
  clipboard text, raw browser URLs, answer keys, correct options, raw
  distractor metadata, raw misconception IDs, and internal database UUID fields
  in default export files where prohibited.
- The analysis-readiness summary under
  `.data/research-export-integrity-review/` is a local ignored
  teacher/research artifact. It may describe available datasets, join keys,
  timing caveats, missingness, and dissertation limitations, but it must not
  claim classroom validity.

## Phase 31a Classroom Pilot Readiness Audit Lock

- `student:classroom-pilot-readiness-smoke` and
  `student:classroom-pilot-workflow-review` are no-live commands. They must not
  call OpenAI, change item content, change scoring, modify core misconception
  logic, edit prompts or provider schemas, or mutate completed evaluation
  evidence.
- The readiness smoke may create synthetic sessions and injected live-shaped
  activity/evaluator records for local verification, then clean them up. It
  must not use real student data or deidentified classroom data.
- The workflow review is a redacted status artifact over latest completed and
  incomplete sessions when available. It may report counts, safe public IDs,
  safe availability flags, and limitations. It must not include raw student
  text, raw provider payloads, answer keys, correct options, raw distractor
  metadata, raw misconception IDs, raw process payloads, internal database
  UUIDs, API keys, cookies, authorization headers, database URLs, or session
  secrets.
- Readiness criteria cover synthetic teacher/student account availability,
  protected initial package completion, student-safe activity runtime
  projection, injected evaluator response handling, move-on and choose-another
  paths, teacher review, session evidence audit, readable transcript,
  structured event log, bulk research export, export-integrity review,
  student projection safety, teacher/research export safety, and preservation
  of operational profiles and response packages.
- Missing activity runtime attempts, post-activity evidence, or diagnostic
  snapshots in old or incomplete sessions are limitations, not automatic
  validity failures.
- Phase 31a readiness is an engineering and workflow audit only. It must not be
  described as classroom validity, psychometric validity, learning-gain
  evidence, deployment approval, or public-launch readiness.

## Phase 31b Production Web Deployment Readiness Lock

- `student:production-deployment-readiness-smoke` and `production:readiness`
  are no-live deployment-readiness commands. They must not call OpenAI, change
  item content, change scoring, edit diagnosis/evaluator prompts, change
  classroom assessment logic, mutate classroom operational records, or deploy
  the application.
- Phase 31b may add deployment documentation, safe health/readiness checks,
  package scripts, Docker packaging, and production migration guidance. It must
  not implement Canvas LTI, public self-registration, email/SMS delivery, cloud
  provisioning, or public deployment.
- Canvas access for the first classroom web pilot is external-link only:
  Canvas may host the public HTTPS Conversational MCQ URL, students leave
  Canvas and authenticate in Conversational MCQ with classroom ID and access
  code/password, and teacher/research review plus exports remain in
  Conversational MCQ.
- Phase 31b must not implement Canvas LTI, Canvas OAuth, Canvas grade passback,
  Canvas roster sync, Canvas Developer Key configuration, or Canvas API
  integration. Canvas gradebook must not be described as automatically
  receiving completion, scores, or research data.
- Production readiness checks must report `canvas_access_mode=external_link`,
  `canvas_lti_required=false`, `canvas_grade_passback_supported=false`, and
  `public_https_required_for_classroom=true`.
- In production mode, `APP_BASE_URL` must be a public HTTPS URL and must not be
  `localhost`, `127.0.0.1`, `::1`, or another local-only origin. Localhost is
  acceptable only for local development.
- Production readiness checks may report missing environment-variable names,
  safe booleans, safe status labels, counts, and hashes. They must not print
  `DATABASE_URL`, OpenAI API keys, credential-file contents, session secrets,
  cookies, authorization headers, raw provider payloads, raw prompts, answer
  keys, correct options, correctness labels, raw distractor metadata, raw
  misconception IDs, or internal database UUIDs.
- `/api/health` may expose only safe status fields such as app status,
  database-reachable boolean, readiness indicators, server time, and environment
  name. It must not expose secrets, raw env values, provider metadata, user data,
  answer keys, or raw diagnostic payloads.
- Production database changes must use `prisma migrate deploy` after backup.
  Production must not use `prisma migrate dev`, database reset, or local seed
  commands unless a later reviewed production procedure explicitly permits it.
- Phase 31b readiness remains an engineering deployment-preparation check. It
  must not be described as classroom validity, psychometric validity,
  learning-gain evidence, public-launch approval, or authorization to use real
  student data.

## Phase 31c Render Staging Deployment Package Lock

- The recommended first public HTTPS staging path is Render Web Service plus
  Render Postgres using the root `render.yaml` Blueprint.
- `student:render-staging-readiness-smoke` is a no-live, no-Render-API,
  no-deployment readiness command. It must not call OpenAI, contact Render,
  mutate classroom records, change item content, change scoring, edit prompts,
  or modify deployment databases.
- The Render Blueprint must define one native Node Web Service, one Render
  Postgres database, `DATABASE_URL` sourced from the Render database connection
  string, `npm run prisma:migrate:deploy` before deploy, and `npm run start` as
  the app start command.
- Secret and deployment-specific values must be marked `sync: false` or entered
  manually in the Render Dashboard. `OPENAI_API_KEY`, `DATABASE_URL`,
  `SESSION_SECRET`, cookies, access-code hashes, bearer tokens, and credential
  files must never be committed or exposed through `NEXT_PUBLIC_` variables.
- `APP_ENV=staging`, `APP_BASE_URL`, and `NEXT_PUBLIC_APP_BASE_URL` are required
  for Render staging. `NEXT_PUBLIC_APP_BASE_URL` may contain only the public
  HTTPS origin.
- Render staging for a classroom pilot must not silently use free or sleep-prone
  resources. The operator must confirm current non-free Render plan choices in
  the Render Dashboard.
- Canvas remains external-link only: no Canvas LTI, OAuth, grade passback,
  roster sync, Developer Key configuration, or Canvas API integration.
- Phase 31c does not create Render accounts, connect GitHub, deploy the app,
  provision cloud resources, run provider calls, or claim classroom validity.

## Phase 31d Fresh Staging Bootstrap Lock

- Fresh staging database bootstrap must be an explicit operator command after
  migrations, not an automatic Render pre-deploy step.
- Render Docker/Web Shell operator commands run from `/app`. Production
  operator TypeScript entrypoints must not depend on dev-only tooling being
  present after the Docker runner prunes dev dependencies.
- `staging:bootstrap-pilot` may create or reuse the first teacher/researcher
  account, create only missing pilot student accounts, ensure the fixed IRT MVP
  assessment is published, and write newly generated student access codes under
  ignored `.data/bootstrap/`.
- If a teacher account already exists and the configured bootstrap teacher
  username does not match it, the production bootstrap path must fail closed
  rather than creating a second teacher account. Operators must update
  `BOOTSTRAP_TEACHER_USERNAME` after a guarded teacher username rename or leave
  bootstrap disabled.
- The bootstrap command must require `BOOTSTRAP_ENABLED=true` and explicit
  `BOOTSTRAP_*` variables. It must not silently create accounts from defaults.
- The bootstrap command must not print raw passwords, access codes, database
  URLs, OpenAI keys, session secrets, cookies, or tokens. Terminal output may
  include counts, public user IDs, assessment public IDs, classroom label, and
  the ignored local credential-output path.
- The current schema has no dedicated classroom table. `BOOTSTRAP_CLASSROOM_ID`
  is a deployment/course access label stored in safe bootstrap metadata and
  access-code distribution materials; student login remains `user_id` plus
  roster-issued access code/password.
- `student:staging-bootstrap-smoke` is no-live and must not call OpenAI, deploy
  the app, contact Render, mutate item content, change scoring, edit prompts, or
  expose generated credentials in logs.

## Phase 31e Teacher-Managed Student Account Lock

- Teacher/research users may manually create student accounts with `user_id`,
  optional display name, optional email, and either a generated or teacher-set
  one-time temporary password/access code.
- `user_id` remains the primary student login identifier. Email remains
  optional teacher/research-facing PII and must not become the default username
  or a password-reset channel in this phase.
- New or reset temporary credentials set `must_change_password=true`. Students
  must choose a new password before accessing assessment routes.
- Student assessment pages and student assessment APIs must fail closed while
  `must_change_password=true`; only the student password-change route remains
  available.
- Existing staging accounts created before this flag existed may be repaired
  with `MARK_STUDENT_PASSWORD_CHANGE_ENABLED=true npm run
  staging:mark-students-must-change-password`. The repair may only mark active
  student accounts that still have temporary credentials and no permanent
  password; it must not print passwords/access codes or affect teacher accounts.
- Students may change their own password after login. Normal password changes
  require the current password; first-login temporary-password sessions may set a
  new password without re-entering the temporary credential.
- Teachers may reset forgotten student passwords and may deactivate/reactivate
  student accounts. Teachers must never view current passwords, password hashes,
  access-code hashes, or prior temporary credentials.
- Teachers may irreversibly delete a student account and associated system-held
  session/activity data only through the previewed deletion flow. The flow must
  require exact typed `student_id` and `DELETE`, must target only student
  accounts, must run dependency deletes in a transaction where possible, and
  must retain only a safe aggregate deletion audit event. Downloaded exports and
  external copies cannot be removed by the system.
- Safe account events are required for teacher-created accounts, teacher
  password resets, deactivation/reactivation, and student password changes. Event
  metadata must not contain raw passwords, temporary credentials, credential
  hashes, cookies, session tokens, database URLs, OpenAI keys, or session
  secrets.
- Roster import may include optional email but must not require email. Preview
  must not create accounts or credentials, and later imports must not
  automatically deactivate missing students.
- `student:teacher-student-account-smoke` is no-live and must not call OpenAI,
  mutate item content, change scoring, edit prompts, or print raw generated
  credentials.
- `student:teacher-student-deletion-smoke` is no-live and must use synthetic
  data only. It must verify preview counts, exact confirmation, teacher-only
  authorization, student-account targeting, associated-data deletion, preserved
  reversible deactivation/reactivation behavior, and absence of raw secrets,
  raw payloads, answer keys, correctness labels, and OpenAI calls.

## Phase 31g Course-Access Visual Identity Lock

- The EDPY 507 course landing page, student login page, first-login
  password-change page, and teacher dashboard may use the authorized official
  University of Alberta logo asset supplied by the operator for this deployment.
- The source operator asset under `_operator_assets/` remains local-only and
  must not be committed. The approved app copy is stored at
  `public/brand/ualberta-logo.png`.
- The UI must preserve dark green institutional headers, gold accent, clear
  EDPY 507: Measurement Theory course identity, Student Access and Instructor
  Dashboard entry points, teacher navigation, and teacher Log out.
- The logo must have useful alt text, must not be distorted or recolored, and
  must be placed with sufficient contrast and clear space.
- The course UI must not imply a central University of Alberta SSO page, Canvas
  LTI/OAuth integration, grade passback, classroom validity, or public launch
  approval.
- `student:course-landing-ui-smoke` is no-live and verifies the authorized logo
  asset, course-facing copy, teacher logout preservation, first-login
  password-change route, absence of scaffold/prototype wording, and absence of
  OpenAI calls.

## Phase 31i Teacher MCQ Item Builder Lock

- Teacher/research users author classroom content through the mini-test builder:
  Folder / Week / Module -> Assessment / Mini test -> MCQ items -> Publish.
- The standard teacher path must not require manual topic/concept-unit creation.
  The application may auto-create and maintain the internal topic/concept-unit
  record needed by the existing student workflow, but the normal mini-test page
  must not expose advanced topic settings or hidden/internal topic wording.
- The mini-test detail page must expose a visible `Add MCQ item` action while
  the mini test is draft-editable, including the zero-item state. The direct
  item-creation path must resolve or create the backing topic record server-side.
- The add/edit MCQ item workflow must preserve mini-test context with
  breadcrumbs and direct Back/Cancel navigation. Create mode must support
  `Save item and add another`, `Save item and return to mini test`, and
  `Cancel`; edit mode must support `Save changes`, `Save changes and return to
  mini test`, and `Cancel`.
- Save actions must disable while a request is in flight, failed saves must
  preserve entered values, and cancel/back actions must warn before discarding
  unsaved changes.
- Repeated item authoring should not require teachers to calculate item order.
  When `item_order` is omitted, the backend assigns the next available order
  within the mini test.
- The mini-test detail page should show current item count against the
  at-least-three-item structural minimum, a top `Add MCQ item` action, a bottom `Add
  another MCQ item` action, and separate item actions for Edit, Teacher preview,
  and Student preview. Structural item-count readiness must not be presented as
  evidence of pedagogical validity.
- Workflow mode and response collection mode are fixed internally for the
  standard mini-test builder: `workflow_mode=automatic` and
  `response_collection_mode=llm_assisted`. They must not appear as normal
  teacher-facing selectors or page facts.
- Folder/week/module labels and mini-test order metadata live on `assessments`.
  Assessment diagnostic focus lives on `assessments.diagnostic_focus`.
- Teacher-authored MCQ items in the normal mini-test builder are initial
  administration items. Follow-up, diagnostic contrast, and transfer activities
  are generated later by the formative activity flow rather than chosen from a
  normal item-purpose dropdown.
- Correct-option notes in the normal item editor are limited to target reasoning
  and strong-reasoning guidance.
- Distractor diagnostic notes in the normal item editor are captured as one
  plain-language teacher-only note box. The normal UI must not require separate
  per-distractor fields for why tempting, misconception pattern, strengthens
  hypothesis, weakens hypothesis, follow-up probe, or student-safe hint.
- Teacher-only notes may be included in internal `teacher_diagnostic_context`
  for validated LLM interpretation. They are guidance, not ground truth.
  Correct-option selection alone must never be treated as sufficient evidence of
  understanding, and distractor selection alone must never be treated as firm
  misconception evidence. LLM interpretation must consider written reasoning,
  confidence, timing/process features, revisions, and patterns across responses.
- Student-facing pages, student previews, activity text, feedback, and default
  exports must not expose correct options, answer keys, correctness labels, raw
  teacher diagnostic notes, raw distractor notes, misconception IDs, provider
  raw output, process payloads, credentials, or secrets.
- JSON import remains supported for prepared item sets. The guided UI must not
  break existing import validation or publishing governance.
- Teacher dashboard main cards must be actionable links. Static cards such as
  Agent Metadata, Flags, and Data Foundation must not appear as non-clickable
  dashboard clutter.
- `student:teacher-mcq-item-builder-smoke` is no-live and verifies direct Add
  MCQ item exposure, server-side topic resolution/creation, folder/week
  metadata, simplified MCQ item creation, absence of the item-purpose dropdown,
  simplified correct-option notes, one plain-language distractor note box,
  validation failures, safe student preview, teacher preview metadata, direct
  publish, dashboard card cleanup, internal diagnostic context availability and
  interpretation caution, publish warnings, JSON import compatibility, and
  absence of OpenAI calls.
- `student:teacher-mcq-authoring-navigation-smoke` is no-live and verifies
  continuous MCQ authoring navigation, save-and-add-another, save-and-return,
  duplicate-submission UI guards, automatic item ordering, safe student preview,
  item-list actions, and absence of OpenAI calls.

## Phase 31k Assessment Lifecycle And Deletion Lock

- Archive remains the normal reversible assessment lifecycle action. Archived
  assessments must be hidden by default in the teacher mini-test library and
  restorable without deleting historical records.
- The teacher mini-test library must support search by name, public ID,
  diagnostic focus, and folder; status filters for Active, Draft, Published,
  Closed, Archived, and All; folder filtering; collapsible folder/week/module
  groups; item and session counts; and sorting by folder order, updated time,
  title, or release date. `Unfiled` groups should sort after named folders.
- Permanent assessment deletion is teacher/research-only and must be separated
  from Archive in wording and UI. Normal student or browser runtime paths must
  not hard-delete assessments.
- `Delete unused assessment` is allowed only for draft or archived assessments
  with no associated student/session/activity evidence. It requires a preview,
  the exact assessment title or public ID, and the exact confirmation `DELETE`.
- `Delete all assessment data` is a danger-zone operation for approved cleanup
  or withdrawal workflows. It must preview aggregate counts, require the exact
  assessment title or public ID, the exact phrase
  `DELETE ALL ASSESSMENT DATA`, and a second confirmation. It must delete
  associated assessment sessions, concept-unit sessions, item responses,
  conversation turns, process events, response packages, profiles, decisions,
  follow-up records, workflow records, agent summaries, activity attempts,
  activity evidence, diagnostic snapshots, item verification records, items,
  concept units, and the assessment in one transaction where possible.
- Assessment deletion audits must retain only safe aggregate counts, safe
  identifiers, deletion mode, deleting teacher reference, timestamp, and
  limitations. They must not retain deleted item content, raw student
  responses, answer keys, correctness labels, raw process payloads, raw provider
  input/output, credentials, cookies, database URLs, or secrets.
- Default teacher/research exports and simple CSVs must exclude deleted
  assessment rows and deleted associated records. Previously downloaded exports,
  screenshots, LMS copies, or other external copies remain outside system
  control.
- `student:teacher-assessment-deletion-smoke` is no-live and verifies preview
  counts, confirmation failures, unused deletion, strong-confirmation all-data
  deletion, no-orphan linked records, unrelated data preservation,
  archive/restore behavior, safe audit content, and absence of OpenAI calls.

## Phase 31j Simple CSV Data Explorer Lock

- Teacher/research users may use `/teacher/data/explorer` to download simple
  CSV summaries and detailed analysis-ready CSV bundles for spreadsheet
  analysis. This is a read-only convenience layer over existing records, not a
  replacement for the full archival research ZIP.
- Assessment CSV uses one row per student-assessment session attempt for one
  selected assessment and is named `assessment_<assessment_public_id>_students.csv`.
- Student CSV uses one row per assessment session attempt for one selected
  student and is named `student_<student_id>_sessions.csv`.
- Student x Assessment Matrix CSV uses one row per current student and
  teacher-owned assessment pair and is named `student_assessment_matrix.csv`.
- Selected assessment downloads must not produce misleading header-only CSVs
  when no authorized student sessions exist. They must report
  `No student sessions are available for this assessment.` and block normal
  download unless an explicit empty-template export is added in a later phase.
- Selected-student exports must include authorized sessions for teacher-managed
  students even when the assessment record was created by another authorized
  teacher/research account.
- Detailed CSV ZIP bundles from `/teacher/data/explorer` contain exactly
  `analysis_rows.csv`, `process_events.csv`,
  `turn_response_latencies.csv`, and `conversation_turns.csv`.
- Simple CSVs may include public IDs, display name, assessment/session status,
  attempt number, timestamps, safe row/count aggregates, latest student-safe
  status when available, latest diagnostic purpose when available, aggregate
  unsupported-correct count, maximum aggregate estimated guessing risk, data
  completeness status, and limitations.
- Generated CSV rows must include safe export-source identity fields:
  export run public ID, generated time, schema version, app environment, app
  commit SHA, safe service base label, irreversible database-instance
  fingerprint, export scope, and selected assessment/student/session IDs.
- Simple CSVs must not include email by default, raw response text, raw
  conversation payloads, raw process payloads, raw provider input/output, answer
  keys, correct options, correctness labels, raw distractor metadata, raw
  diagnostic notes, passwords, access-code hashes, cookies, API keys, database
  URLs, or session secrets.
- Detailed bundles may include readable student response and conversation text
  for teacher/research analysis, but must not include raw process payloads,
  raw provider data, raw headers, credentials, password/access-code hashes,
  answer keys, correct options, raw distractor metadata, or secrets.
- Null means unavailable or not reconstructed; zero means the instrumentation
  path was present and no matching event was observed. Engagement/process
  indicators are evidence-quality context, not misconduct, cheating, ability,
  or diagnostic labels.
- Deleted student accounts and their deleted associated records must not appear
  in simple CSV exports. Existing previously downloaded files remain outside
  the app's control.
- `student:teacher-simple-csv-export-smoke` is no-live and must verify headers,
  row grain, selected assessment/student filters, matrix uniqueness, multiple
  session aggregation, deleted-student exclusion, protected-field absence, and
  absence of OpenAI calls.
- `student:teacher-detailed-csv-export-smoke` and
  `student:data-collection-completeness-smoke` are no-live and must verify the
  detailed bundle contract, selected-student scoping, no-session assessment
  handling, scalar process feature exposure, row-count consistency, protected
  field absence, read-only behavior, and absence of OpenAI calls.

## Phase 31ab Consolidated Research Export Lock

- The standard `Data and outcomes` landing page must show the routine choices
  `Research data and exports` and `Summative outcomes`. It must not show
  separate routine cards for Data Explorer, Master CSV export, or Download all
  research data.
- `/teacher/data/research` is the unified teacher-facing export center. It has
  exactly two normal sections: Research dataset and Data dictionary.
- Legacy UI routes `/teacher/data/explorer` and `/teacher/data/export` redirect
  to `/teacher/data/research?section=dataset`. Existing authorized APIs may
  remain for backward compatibility.
- The Research dataset ZIP contains normalized CSV tables at clear row grains:
  `sessions.csv`, `item_responses.csv`, `process_events.csv`,
  `conversation_turns.csv`, `agent_activity_records.csv`,
  `assessment_content.csv`, `assessment_summary.csv`, and
  `research_data_dictionary.csv`, and `process_event_codebook.csv`.
- `research_data_dictionary.csv` is the authoritative inventory for research
  dataset variables only. Process event codes, internal Prisma/source-schema
  fields, and platform administration/excluded fields must not be counted as
  ordinary variables.
- `process_event_codebook.csv` documents one row per process-event type with
  trigger, actor/source, scope, timestamp meaning, allow-listed payload fields,
  derived variables, and interpretation cautions.
- The Data dictionary UI must default to Research dataset variables
  (`entity_type=research_variable`, `documentation_tier=core_research`) and
  must not mix process-event groups, internal schema fields, or excluded/platform
  fields into the research-variable result count. Its four teacher-facing
  sections are Research dataset variables, Learning-process event definitions,
  Internal database schema — Technical, and Excluded platform and security
  fields — Not exported. The dictionary is documentation; Research dataset is
  the section that generates actual student/session data.
- Research variable browsing must show Search, one plain-language Category
  filter, and page size. Process-event, internal-schema, and excluded-field
  browsing must show Search and page size only. Measurement level, source
  nature, deprecated status, exclusion category, permitted audience, and export
  policy remain in registries/CSV/expanded details as applicable, but must not
  be normal visible browsing filters.
- Item-response timing is item-grain: one completed administered item response
  can have one `item_response_time_ms`, and a three-item mini-test can produce
  three item-response durations. Conversation-turn latency is turn-grain:
  answer, reasoning, confidence, tempting-option, package-review, activity, and
  follow-up turns may each carry separate prompt-to-student response/action
  latency values. Null timing means unavailable/not applicable, not zero.
- Research variables must include qualified name, dataset/table, documentation
  tier, stable research category ID/display name, measurement level, source
  nature, source-code reference, source service/function, semantic review
  status, missing/zero/false/not-applicable semantics, privacy level, export
  policy, timing formulas where applicable, duplicate/canonical relationship,
  applicable record types where needed, and interpretation cautions. Records
  must render collapsed by default and support teacher-controlled page sizes of
  25, 50, 100, 250, and 500 rows with no hardcoded 80-row limit.
- The shared research category registry must define category ID, display name,
  definition, inclusion/exclusion criteria, typical row grains, included
  datasets, examples, interpretation boundaries, and active core-variable
  counts. The UI Category guide and `research_category_dictionary.csv/json`
  must use the same registry.
- Process-event codebook rows must include a process-event tier. The default
  process-event browser view must show core learning-process events; operational
  workflow/provider/export/security events belong in advanced documentation.
- `source_verified` records source-code verification only. It must not be
  represented as domain-owner approval.
- Ordinary research dataset exports must use `research_student_id` as the
  pseudonymous student join key. New production exports must generate it with
  versioned keyed HMAC-SHA-256 over the canonical operational user identifier
  using server-only `RESEARCH_PSEUDONYMIZATION_KEY`. Login usernames, emails,
  internal database IDs, credentials, hashes, and secrets must not appear in
  default research exports.
- Research exports must include safe pseudonymization provenance fields where
  defined: `research_pseudonym_version`, `pseudonymization_method`,
  `pseudonymization_version`, and `pseudonymization_key_fingerprint`. The
  fingerprint is non-secret provenance only. Changing the key or version
  changes `research_student_id`; ordinary exports must not include an
  unrestricted linkage table.
- If production research pseudonymization is missing or invalid, research
  export generation must fail closed with a typed configuration error while
  authentication, logout, account management, and non-LLM/non-export teacher
  pages remain available.
- Research export readiness must be checked before production dataset
  generation. Missing or invalid pseudonymization configuration must be shown
  in-page on `/teacher/data/research`, must not navigate teachers to raw JSON,
  and must persist a failed export job with a safe typed reason and retryable
  status. Data dictionary access and previous completed downloads must remain
  available.
- Session detail must support a selected-session research export path for
  incident analysis. Selected-session bundles may include a safe diagnostic
  manifest with workflow counts, public join keys, timestamps, validation
  statuses, prompt/schema/model versions, and included-file metadata, but must
  not include login usernames, passwords, API keys, database credentials, raw
  provider payloads, or hidden system prompts.
- Default research dataset exports exclude credentials, hashes, session secrets,
  API keys, database URLs, raw provider requests, unrestricted raw provider
  output, internal database UUIDs, unrestricted answer keys, correctness fields,
  and teacher diagnostic notes. Restricted fields require explicit
  teacher/research export mode, explicit confirmation, and an export audit
  record; they remain unavailable to students.
- Null/empty CSV cells mean unavailable, not recorded, not generated, not
  instrumented, or not applicable. Zero is reserved for evaluated counts where
  the counted event did not occur. Missing LLM output must not be encoded as a
  lowest category.

## Phase 31M LLM Diagnostic Context Propagation Lock

- Substantive LLM interpretation paths must receive the shared
  `assessment-interpretation-context-v1` contract when assessment evidence is
  available. Covered paths include item administration tutor context, profile
  integration, formative value determination, formative activity
  generation/review, and post-activity response evaluation.
- The context must bind assessment diagnostic focus, assessment/item snapshot
  identifiers, administered item content, teacher target/strong reasoning
  guidance, teacher distractor diagnostic guidance, interpretation cautions,
  observed student evidence, safe process summaries, prior activity evidence
  where applicable, and the current interpretation phase.
- Teacher notes are guidance, not ground truth. Observed student evidence takes
  priority. Selected options and selected distractors are indirect evidence
  only. Correctness alone is not understanding. Timing/process features alone
  are not guessing, disengagement, cheating, or misconduct. Alternative
  explanations remain required.
- Agent-call audit metadata may store context schema version, snapshot IDs,
  context hash, and boolean presence flags only. It must not duplicate raw
  teacher notes, raw distractor notes, raw prompts, raw provider payloads,
  credentials, cookies, database URLs, API keys, session secrets, or
  student-visible answer keys.
- Student-facing UI, student previews, activity text, feedback, and default
  exports must not expose correct options, answer keys, correctness labels, raw
  teacher diagnostic notes, raw distractor notes, misconception IDs, internal
  metadata labels, provider raw output, or process payloads.
- `student:llm-diagnostic-context-propagation-smoke` is no-live and must verify
  context propagation, safe audit metadata, snapshot stability, and absence of
  OpenAI calls.

## Phase 31N Media-Enabled Higher-Order MCQ Authoring Lock

- Teacher-authored MCQ items may include media assets attached to the item stem
  or a specific option. Supported media authoring types are `image`, `video`,
  and `reference_link`.
- Image media may be represented by HTTPS URLs. Server-side uploaded images are
  permitted only through the provider-neutral storage interface after
  S3-compatible storage is configured. Uploaded images must be PNG, JPEG, or
  WebP, must pass MIME and file-signature validation, and must respect the
  configured size limit. SVG files and video binary uploads are not accepted.
- URL media must use HTTPS. `javascript:`, `data:`, `file:`, local, private,
  and link-local targets must be rejected for server-side handling. Video URLs
  must be on the approved host allow-list.
- Every media asset must include accessible description text. Video links must
  include a transcript or content summary when used for interpretation.
- Media records distinguish student-facing accessible alt text from
  teacher-only LLM media description. The legacy description field remains a
  compatibility fallback, but student payloads must use student-safe alt text
  and must not expose teacher-only LLM descriptions.
- Student-facing payloads may include only safe media fields: public media ID,
  placement, option label when applicable, media type, display URL, title,
  accessible description, caption, transcript/content summary, and attribution.
  They must not include storage keys, internal media hashes, answer keys,
  correct options, correctness labels, raw distractor metadata, raw teacher
  diagnostic notes, raw provider payloads, credentials, cookies, database URLs,
  or session secrets.
- LLM interpretation receives `llm_media_context` from teacher-only LLM media
  descriptions, captions, transcripts, summaries, and attribution. Direct
  multimodal media input is false in this phase; URLs do not authorize the LLM
  to infer unseen media content.
- Item response snapshots must freeze the media assets and LLM media context
  present at administration time. Later media edits must not rewrite historical
  response evidence.
- The initial MCQ builder should guide teachers toward apply, analyze, and
  evaluate tasks by default. Basic recall should be used only when it has clear
  diagnostic value. Creation is reserved for later constructed-response
  activity dialogue and should not appear as a cognitive-demand dropdown in the
  normal MCQ editor.
- `student:teacher-mcq-media-smoke` is no-live and must verify URL safety,
  uploaded-image validation through an injected storage provider, teacher and
  student safe serialization, media-context snapshot stability, response-package
  media context, and absence of OpenAI calls.

## Phase 31Q Teacher MCQ Import and Diagnostic Authoring Lock

- The normal mini-test detail page must expose both `Add MCQ item` and
  `Import MCQ items` for the selected assessment.
- Phase 31Q supported import sources are CSV, XLSX, pasted plain text, and the
  existing project JSON item format. DOCX, QTI/Canvas packages, PDF extraction,
  and embedded binary media extraction are not implemented in this lock.
- Import is preview-first and draft-only. Candidate extraction must preserve
  original wording, source type, source file name, source checksum, source
  location, source line range when available, original source text/hash, parsing
  confidence, issue flags, duplicate warnings, and normalized draft fields.
- Required draft-import fields are a non-empty stem and at least two non-empty
  options. Missing key, diagnostic notes, and media metadata stay blank.
  Missing diagnostic notes are warnings only.
- Key data remain separated as `imported_key`, `llm_suggested_key`, and
  `teacher_confirmed_key`. Imported or LLM-suggested keys must never become
  official automatically. Publishing must still require exactly one valid
  teacher-confirmed key.
- Duplicate detection should flag likely duplicates within the import batch, in
  the selected assessment, and in other teacher-owned assessments. It must not
  merge, delete, or rewrite items automatically.
- Media import accepts URL metadata only and must reuse existing media URL and
  accessible-description safety checks. Raw embedded binaries are not imported
  in Phase 31Q.
- The diagnostic authoring assistant uses schema
  `mcq-diagnostic-authoring-suggestion-v1` and prompt version
  `mcq-diagnostic-authoring-assistant-prompt-v1`. It runs only after the
  teacher explicitly selects `Suggest missing diagnostic information`; it must
  not run during upload, parsing, page load, preview, or automatic batch
  processing. Production-like suggestions require server-side live provider
  configuration and `OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING`. Missing provider
  configuration must fail closed with a manual-review message rather than a
  fake suggestion. Mock suggestions are test-only.
- The diagnostic authoring assistant has two modes. `suggest_key` is used when
  no teacher-confirmed key exists and may produce only an unofficial key
  suggestion with rationale, ambiguity/multiple-key warnings, confidence, and
  limitations. `diagnostic_information` requires a teacher-confirmed key and
  may suggest target reasoning, strong-reasoning criteria, one plain-language
  distractor note, ambiguity/distractor/recall warnings, optional revision,
  confidence, and limitations. It must not mutate the official key or item
  wording.
- Assistant suggestions are teacher-facing guidance, not ground truth. They may
  suggest target reasoning notes, strong-reasoning criteria, plain-language
  distractor notes, cognitive-demand warnings, ambiguity warnings, multiple-key
  warnings, recall-only warnings, optional revision guidance, concise rationale,
  confidence, and limitations. They must not include hidden chain of thought.
- Teachers must review suggestions field by field with Accept, Edit and accept,
  Reject, or Leave blank. Non-empty teacher-authored fields must not be
  overwritten by default.
- Provider-backed diagnostic authoring requests must persist safe audit
  metadata in `agent_calls` and import candidate payloads: agent name,
  prompt/schema versions, prompt hash, provider, model, request/response
  metadata presence, token usage presence, validation status, repair count, and
  teacher review status. Raw unrestricted provider output must not be exposed in
  teacher-safe projections.
- Import hardening must enforce file-size and row-count limits, safe filename
  storage, source checksums, formula-like values treated as text, hidden sheet
  warnings, macro workbook rejection, malformed workbook failure without
  partial silent import, and no external link fetching.
- Assessment deletion must include MCQ import batches and associated
  diagnostic-authoring agent calls in preview counts and deletion. Deletion
  audit rows must not retain raw imported source text.
- Teacher notes and assistant suggestions must preserve epistemic caution:
  selected distractors are indirect evidence only, teacher diagnostic notes are
  guidance rather than ground truth, and alternative explanations must remain
  possible.
- Student-facing payloads, student previews, student runtime, and default
  exports must not expose imported keys, answer keys, correct options, raw
  teacher notes, raw distractor notes, assistant suggestion payloads, source
  checksums, import provenance internals, raw provider output, credentials,
  cookies, database URLs, API keys, session secrets, or auth hashes.
- Teachers/operators are responsible for copyright, licensing, and permission to
  use imported item-bank content.
- `student:teacher-mcq-import-smoke` is no-live and must verify CSV, XLSX,
  pasted text, project JSON, column mapping, missing-field behavior, duplicate
  warnings, draft import, student-safe projection, and absence of OpenAI calls.
- `student:teacher-mcq-diagnostic-assistant-smoke` is no-live and must verify
  teacher-trigger dispatch, no preview dispatch, key suggestion separation,
  teacher-key recognition, tentative distractor notes, alternative explanations,
  prompt-injection resistance, suggestion decisions, provenance, metadata,
  bounded repair, no student leakage, and absence of OpenAI calls.
- `student:teacher-mcq-diagnostic-assistant-live-smoke` must skip by default
  unless explicitly opted in.

## Phase 31R DOCX MCQ Import and Formatting Assistance Lock

- Phase 31R adds direct `.docx` import to the Phase 31Q import workflow. CSV,
  XLSX, pasted plain text, and project JSON remain supported. Old binary `.doc`,
  macro-enabled `.docm`, malformed ZIP packages, password-protected DOCX files,
  and unsupported archive formats must fail closed with safe teacher-facing
  guidance.
- DOCX import is deterministic first. It may extract paragraphs, lists,
  headings, tables and table cells, item numbering, option labels, answer-key
  sections, captions, embedded-image references, equation/object markers,
  tracked-change markers, source paragraph/table/cell locations, source file
  name, and source checksum. Missing fields must remain blank.
- DOCX parsing must not execute macros, fetch external relationships or remote
  templates, send images to the LLM, treat bold/formatting as definitive key
  evidence, silently discard embedded images/equations, or retain raw DOCX
  binaries by default.
- Embedded images are flagged for manual reattachment unless secure object
  storage is configured. Equations, drawings, SmartArt, text boxes, and
  unresolved tracked changes are flagged for teacher review and may block
  publication if they affect item meaning.
- Phase 31R adds a production formatting assistant,
  `mcq_import_formatting_assistant_agent`, using schema
  `mcq-import-formatting-suggestion-v1`, prompt version
  `mcq-import-formatting-assistant-prompt-v1`, and dedicated model variable
  `OPENAI_MODEL_MCQ_FORMATTING`. It must run only after the teacher explicitly
  selects `Help resolve formatting`; it must not run during upload, parsing,
  page load, preview, candidate selection, or automatic batch processing.
- Formatting assistance may propose item boundaries, stem, options,
  source-supported imported key, source-supported diagnostic fields, source-span
  mappings, normalization summary, ambiguity flags, confidence, and limitations.
  It must preserve source wording, keep missing information blank, avoid
  paraphrasing, avoid inventing option text or diagnostic notes, and never make
  a key official.
- Formatting and diagnostic enrichment are separate calls and separate review
  states. Formatting may map an explicitly present source key only as
  `imported_key`; `Suggest key` remains unofficial; `teacher_confirmed_key`
  remains the only official key boundary.
- Teachers must review formatting proposals by accepting, editing and accepting,
  rejecting, or leaving unresolved. Teacher edits take precedence. No hidden
  one-click automatic acceptance is allowed.
- Provider-backed formatting success requires actual provider dispatch,
  provider/model metadata, token usage, persisted `agent_calls`, validated
  schema, prompt/schema versions, output hash/audit metadata, and no official
  item mutation before teacher acceptance. Missing provider configuration must
  show that formatting assistance is temporarily unavailable and allow manual
  review/import to continue. Mock formatting output is test-only.
- Formatting provider input must include only selected candidate source
  context, deterministic parse, issue flags, source locations, relevant
  document-level key context, and teacher edits. It must exclude student data,
  unrelated assessments/items, credentials, secrets, and keys from other items.
- One bounded formatting repair is allowed only for repairable schema/source
  mapping/formatting issues. Provider authentication failures, missing provider
  metadata, missing token usage, prompt-injection leakage, protected-content
  leakage, and official-key mutation attempts fail closed.
- Rate and cost controls must bound selected candidates per formatting request,
  formatting calls per batch, source excerpt size, and output tokens. Large
  documents must not trigger unbounded provider processing.
- Assessment deletion must include DOCX import batches, extracted source text in
  import payloads, deterministic normalized drafts, formatting suggestions,
  formatting-agent calls, diagnostic suggestions, key suggestions, and imported
  media metadata. Deletion audit rows must not retain raw source text or raw
  DOCX binaries.
- `student:teacher-mcq-docx-import-smoke` is no-live and verifies DOCX
  extraction, answer-key mapping, missing fields, table items, media/equation
  flags, tracked-change flags, `.doc`/`.docm` rejection, draft import,
  student-safe projection, and no OpenAI calls.
- `student:teacher-mcq-formatting-assistant-smoke` is no-live and verifies
  teacher-triggered dispatch, no preview dispatch, untrusted source input,
  prompt-injection resistance, source-span mappings, source wording
  preservation, separate proposal state, teacher acceptance/rejection,
  bounded repair, protected leakage fail-closed behavior, provider metadata
  requirements, and no OpenAI calls.
- `student:teacher-mcq-formatting-assistant-live-smoke` must skip by default
  unless `RUN_LIVE_TEACHER_MCQ_FORMATTING_ASSISTANT_SMOKE=1` is explicitly set.

## Phase 31Z-Reversal Teacher Account Lock

- Teacher/research users sign in with username plus password. Public
  forgot-password recovery, teacher email-change, and teacher email-verification
  flows are disabled for the classroom pilot. Email-based login is not part of
  the product.
- Students remain on the teacher-managed credential/reset workflow.
- The additive Phase 31Z database migration remains in history. Do not drop or
  rewrite the email/account-security columns and tables in a hotfix; instead,
  ensure migrations run before production traffic reaches the app.
- `/api/health` must safely report database reachability and required schema
  readiness. Missing required additive account-security schema returns
  `database_schema_ready=false` and `migration_readiness=migration_required`
  without printing database URLs or raw errors.
- Login and session auth queries must use explicit minimal Prisma selects and
  must not depend on teacher email/recovery columns.
- The teacher Account settings UI is a utility action for username display and
  password change only. It must not expose recovery email, pending email,
  public forgot-password links, or email-change controls.
- Renaming the deployed teacher account must use the guarded production-safe
  operator command `npm run operator:rename-teacher` from the deployed service
  directory, such as Render Shell `/app`. The command must require
  `TEACHER_USERNAME_RENAME_ENABLED=true` and
  `CONFIRM_TEACHER_USERNAME_RENAME=RENAME_TEACHER`.
- The rename operator must update the existing teacher row rather than creating
  a second teacher, preserve password hash, role, assessment ownership, student
  relationships, sessions, responses, and historical audit records, increment
  `auth_version` on real rename, invalidate outstanding account-security
  tokens, and write an account-security audit event. Idempotent reruns must not
  increment `auth_version` or duplicate the audit event. Output must contain
  safe status fields only.
- After a production rename, `BOOTSTRAP_TEACHER_USERNAME` must match the new
  username before any future bootstrap run, or bootstrap must not be rerun.
- Email-provider credentials must remain server-side if present, but they are
  deprecated for the classroom pilot and must not affect login, readiness, or
  the standard teacher UI.

## Phase 31AD Per-Agent Model Configuration Lock

- The current approved operational baseline remains
  `gpt-5.4-mini-2026-03-17` with `reasoning_effort=low` and the approved
  operational manifest/hash until a separate candidate evaluation and explicit
  approval completes.
- Server-side OpenAI reasoning-effort variables are available per live role:
  `OPENAI_REASONING_EFFORT_ITEM_VERIFICATION`,
  `OPENAI_REASONING_EFFORT_ITEM_ADMIN`,
  `OPENAI_REASONING_EFFORT_RESPONSE_COLLECTION`,
  `OPENAI_REASONING_EFFORT_PROFILING`,
  `OPENAI_REASONING_EFFORT_PROFILE_INTEGRATION`,
  `OPENAI_REASONING_EFFORT_PLANNING`, `OPENAI_REASONING_EFFORT_FOLLOWUP`,
  `OPENAI_REASONING_EFFORT_MCQ_DIAGNOSTIC_AUTHORING`,
  `OPENAI_REASONING_EFFORT_MCQ_FORMATTING`, and
  `OPENAI_REASONING_EFFORT_CONNECTIVITY_TEST`.
- Allowed effort values are `none`, `low`, `medium`, `high`, `xhigh`, and
  `max`. Invalid explicit values fail closed for LLM readiness/dispatch and
  must not break authentication, logout, account management, data exports, or
  ordinary non-LLM teacher pages.
- The full GPT-5.6 mixed-stack candidate profile remains a separate artifact at
  `config/candidate-operational-agent-config.gpt-5.6.json`. It is not the
  current rollout target and must not silently switch production.
- The previous minimal live student-dialogue candidate is
  `config/candidate-operational-agent-config.minimal-live-student-dialogue.json`.
  It keeps all existing operational and teacher roles on the approved
  `gpt-5.4-mini-2026-03-17`/`low` baseline and changes only
  `student_communication_agent` (`gpt-5.6-terra`, medium, 2500 tokens) and
  `topic_dialogue_agent` (`gpt-5.6-sol`, medium, 3500 tokens).
- The minimal candidate configuration fingerprint must include the two role
  live toggles, the 90000 ms provider timeout, and the topic-dialogue policy:
  maximum student turns 10, recent raw-turn window 12, maximum student-message
  characters 5000, and assessment-system questions allowed.
- Minimal student-dialogue evaluation cases are fixed to: `what`, `about_what`,
  `which_item_do_you_mean`, `request_for_an_example`,
  `substantive_correct_answer`, `partial_understanding`,
  `specific_misconception`, `assessment_system_question`, and
  `unrelated_question`. Student-facing output requires human review before
  approval.
- The current full GPT-5.6 v2 candidate is
  `config/candidate-operational-agent-config.gpt-5.6-full-v2.json`. It must
  move every covered OpenAI-backed operational, extension, teacher-tool, and
  connectivity role to a GPT-5.6 family model; no candidate role may remain on
  `gpt-5.4-mini`. Its active configuration fingerprint must include every role
  model, reasoning effort, max output token limit, prompt/schema/validator/
  fallback metadata, the student communication and topic-dialogue live toggles,
  topic-dialogue policy, provider timeout `90000`, and provider retry limit `2`.
  It remains `candidate_not_approved` until fixed synthetic live evaluation,
  explicit student-facing human review, and operator approval produce a new
  approved hash.
- Full-v2 fixed evaluation cases must cover at minimum: schema validity,
  repair/failure rate, diagnostic accuracy, evidence traceability, profile
  coherence, formative activity quality, distractor-first behavior, student
  communication naturalness, clarification handling (`what`, `about what`,
  `which item do you mean`, example requests), assessment-system questions,
  unrelated-question redirects, answer-key leakage, unsupported claims,
  latency, input/output/reasoning tokens, and projected cost.
- Candidate comparison must use identical synthetic fixtures, record model,
  reasoning effort, token limits, prompt/schema versions, validators, retries,
  usage, cost where pricing exists, and safety/quality metrics. Candidate
  acceptance requires no critical leakage, no schema/invalid-output regression,
  maintained or improved diagnostic/formative quality, cost within limits, no
  unsupported claims, and no move-on/fallback regression.
- Candidate live-evaluation provenance must use the shared application
  build-info resolver. The resolver priority is generated build artifact,
  documented deployment build metadata, then local Git fallback for development.
  Run, case, review, human-review, and approval evidence must record the same
  `application_git_commit`, `application_git_commit_source`, and optional
  `application_build_timestamp`. Missing, malformed, placeholder, or conflicting
  commit sources must block before provider dispatch.
- Candidate safety evaluation must be surface-aware, proposition-aware,
  evidence-grounded, pedagogical-quality-aware, and answer-reveal-policy-aware.
  The current full-v2 candidate uses `eval-safety-v5`,
  `eval-surface-policy-v1`, `eval-claim-polarity-v1`,
  `eval-answer-reveal-policy-v1`, `eval-topic-boundary-v2`,
  `evaluation-finding-provenance-v1`, `eval-proposition-analysis-v2`,
  `eval-evidence-grounding-v1`, `eval-pedagogical-quality-v2`,
  `eval-production-schema-fidelity-v1`, `eval-run-provenance-v2`, and
  `eval-artifact-persistence-warning-v1`. Automated findings must record
  evaluated surface, field, complete proposition, exact clause, speaker/source,
  assertion-versus-mention classification, claim type, polarity, fixture policy,
  reveal policy, blocking status, evaluator version, claim subject, predicate,
  object, modality, evidence references, support level, and
  production-schema fidelity. Teacher-tool answer-key text, internal safety
  notes, and utility metadata must not be classified as student-facing leakage.
  Reported misconceptions, quoted distractors, corrective statements, and
  negated/prohibitive/audit propositions must not count as affirmative
  misconduct, motivation, effort, or ability claims merely because they mention
  a protected concept. Unsupported affirmative or hedged claims about stable
  ability, motivation, effort, misconduct, cheating, or undefined engagement
  labels must block. Refusal plus redirect for unrelated student questions must
  not count as substantively answering the unrelated question.
- Student-facing operational extension roles outside the current five-agent
  manifest require explicit operational approval coverage before production
  use. Teacher authoring roles require teacher-tool review and do not approve
  student-facing runtime.
- Normal tests, dry runs, and reports must make no OpenAI call. Guarded live
  candidate evaluation must be skipped unless explicitly enabled with
  `RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL=1` and paid-call confirmation.
- The full-v2 live candidate evaluator is an isolated synthetic evaluation
  surface. It must use the explicit candidate manifest rather than the approved
  baseline, Render's current active hash, browser runtime resolution, or real
  assessment sessions. Evidence is stored under
  `.data/operational-model-upgrade/runs/<run_public_id>/` with one case record
  per fixed fixture, aggregate usage/latency/failure metrics, review status,
  application Git commit, evaluator versions, artifact-persistence status, and
  approval eligibility. It must not mutate student, teacher, assessment, or
  production workflow records.
- Candidate evaluation is resumable with `--resume-run <run_public_id>`. A
  resumed run must not repeat successful completed paid cases unless a future
  explicit force path is added and documented.
- The live-evaluation runner must enforce `RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL=1`,
  `--confirm-paid-api`, an explicit candidate manifest, OpenAI live runtime,
  configured server-side credential, fixed synthetic fixtures, and configured
  budget ceilings before dispatching provider requests.
- Candidate approval requires a completed candidate run, matching manifest hash,
  matching candidate active configuration hash, all required fixtures executed,
  a non-null application Git commit, durable artifact-persistence attestation,
  no critical automated failure, exported human-review artifacts, explicit
  human review confirmation, an approved human decision, and the exact approval
  phrase. Approval must preserve the GPT-5.4-mini baseline and output the exact
  `OPERATIONAL_APPROVED_CONFIG_HASH` value for manual Render rollout; it must
  not auto-update `.env`, `.env.local`, Render variables, or the approved
  baseline manifest.

## Phase 31AL Evidence-Integrated Profile And Routing Lock

- Post-initial-package interpretation must persist `EvidenceIntegratedProfileV2`,
  `PackageFeedbackV2`, and `NextInteractionV2` artifacts for new sessions.
- Outcome, assessment-specific understanding, reasoning quality, confidence
  calibration, evidence limitations, and growth target are separate dimensions.
  A concise reasoning-depth issue must not collapse an all-correct package below
  sound understanding solely because it is concise.
- Total and item-level correct/incorrect status, the correct option, and a
  concise student-facing explanation are shown immediately after the initial
  package for every administered initial item. This reveal is not delayed until
  after the formative activity. Unadministered item keys, raw teacher diagnostic
  notes, prompts, and hidden scoring metadata remain protected.
- Post-reveal formative activities must require new reasoning rather than
  rediscovery of the correct option. Valid post-reveal activity patterns include
  identifying a specific distractor flaw, evaluating why an option is inaccurate,
  correcting inaccurate parts, comparing or ranking distractors, transforming or
  generating distractors, and reverse-engineering what the stem was testing.
- Feedback must cite response-package evidence and must not contain the next
  actionable prompt. The single next prompt lives only in `NextInteractionV2`
  and must have a matching await-response state.
- Distractor-focused routing is preferred whenever the response package shows
  enough conceptual footing. Foundational and prerequisite support require
  explicit evidence and are not the default fallback.
- Timing and process signals may qualify evidence sufficiency but must not infer
  motivation, effort, cheating, or misconduct.
- The Phase 31al work does not change scoring, correct keys, item content,
  timing formulas, or historical records.

## Phase 31AM Timing Contract Lock

- Research timing exports use `timing-contract-v2` for new derived timing
  fields. Historical persisted fields remain available but must be labeled as
  legacy or ambiguous when their endpoint contract differs.
- Canonical item elapsed time is `item_elapsed_response_time_ms =
  item_submitted_at - item_presented_at`. The legacy `item_response_time_ms`
  field is retained only for backward compatibility and must not be treated as
  the corrected item-presented-to-submitted interval.
- First-action and first-option timing start at the item presentation event, not
  item-response row creation or backend transition acknowledgement.
- Reasoning elapsed time is prompt-to-submission. Active typing time is exported
  only when validated active typing instrumentation is available; null must not
  be converted to zero or replaced by elapsed input time.
- Page-hidden duration is derived from hidden-to-visible event pairs. Cumulative
  frontend visibility-duration payloads and window blur/focus events must not
  be double-counted as page-hidden intervals.
- Session timing separates wall-clock elapsed time, resumable active windows,
  visible windows, explicit idle time, and active interaction time. Active
  interaction time must not be manufactured by subtracting arbitrary idle
  estimates from elapsed time.
- Timing values are process context only and must not be interpreted alone as
  ability, effort, motivation, engagement, guessing, cheating, or misconduct.

## Phase 31AO Student Communication and Topic Dialogue Lock

- The student assessment page must remain single-column and chat-native. The
  post-package answer review appears once as a tutor-chat card titled
  "Review your answers"; a persistent right-side profile/results panel must not
  duplicate the same substantive feedback.
- Student-facing package feedback is a natural tutor-chat narrative generated
  from frozen facts. It must not expose backend headings such as "Your
  explanations", "How sure you were", "Next focus", "Confidence calibration",
  "Evidence limitations", "Growth target", or raw enum/internal labels.
- `student_communication_agent` is fact-locked. It may improve wording only; it
  must not change correctness, selected/correct options, item count, answer
  reveal state, profile facts, growth target, activity contract, expected
  response mode, or runtime destination.
- `topic_dialogue_agent` is bounded support after formative activities. It may
  discuss only the current topic, current concept, administered items,
  distractors, frozen growth target, and the student's activity response. It
  must redirect unrelated questions and must not become general chat.
- Default topic dialogue policy is eight student turns, a twelve-turn recent
  context window, and a 5000-character maximum student message. Short messages
  such as "what" or "about what" are valid clarification requests, not semantic
  validation failures.
- Phase 31ap adds default-off live provider paths for
  `student_communication_agent` and `topic_dialogue_agent`. When the role-level
  live toggle, global live configuration, credential/model readiness, and
  validation gates all pass, these roles may use server-side OpenAI Responses
  API calls with Structured Outputs and `store:false`. Otherwise they fail
  closed to deterministic fallback and record the fallback reason. Refresh,
  resume, and idempotent replay must reuse persisted records and must not create
  new live calls.
- Student-visible language must never contain raw public IDs or database UUIDs
  such as `item_...`, `sess_...`, `asmt_...`, or UUID strings. Student item
  references use ordinals such as "Item 1" plus option labels/text when needed.
- Timing-contract-v2 formulas and historical timing semantics are unchanged.
