# Research Data Dictionary Domain Review Checklist

Reviewer status: source-code verified by Codex on 2026-07-14; domain-owner review pending.

This checklist is for a domain owner or research lead to review substantive
interpretation. `source_verified` means the export source path and formula were
traced in code. It does not mean the variable wording has been approved for
publication, dissertation use, or final analysis.

## Timing Variables

All rows below are source verified and domain review pending:

- `agent_activity_records.completed_at`
- `agent_activity_records.started_at`
- `assessment_content.snapshot_created_at`
- `assessment_summary.active_interaction_time_ms`
- `assessment_summary.completed_at`
- `assessment_summary.elapsed_session_time_ms`
- `assessment_summary.started_at`
- `conversation_turns.created_at`
- `conversation_turns.response_or_action_latency_ms`
- `item_responses.confidence_prompt_to_selection_ms`
- `item_responses.confidence_prompted_at`
- `item_responses.confidence_selected_at`
- `item_responses.first_option_selected_at`
- `item_responses.first_student_action_at`
- `item_responses.item_presented_at`
- `item_responses.item_response_time_ms`
- `item_responses.item_submitted_at`
- `item_responses.last_action_to_submission_ms`
- `item_responses.last_student_action_at`
- `item_responses.page_hidden_count`
- `item_responses.reasoning_active_time_ms`
- `item_responses.reasoning_prompt_to_submission_ms`
- `item_responses.reasoning_prompted_at`
- `item_responses.reasoning_started_at`
- `item_responses.reasoning_submitted_at`
- `item_responses.revised_at`
- `item_responses.submitted_at`
- `item_responses.time_to_first_action_ms`
- `item_responses.time_to_first_option_selection_ms`
- `item_responses.typing_activity_event_count`
- `process_events.created_at`
- `process_events.duration_ms`
- `process_events.occurred_at`
- `process_events.pause_duration_ms`
- `process_events.visibility_duration_ms`
- `sessions.active_interaction_time_ms`
- `sessions.close_at`
- `sessions.completed_at`
- `sessions.elapsed_session_time_ms`
- `sessions.exited_at`
- `sessions.export_generated_at`
- `sessions.idle_ratio`
- `sessions.last_activity_at`
- `sessions.long_pause_count`
- `sessions.maximum_long_pause_ms`
- `sessions.release_at`
- `sessions.resumed_at`
- `sessions.started_at`
- `sessions.total_idle_time_ms`
- `sessions.total_long_pause_ms`
- `sessions.total_page_hidden_ms`

Review questions:

- Are wall-clock, active, idle, hidden, and prompt-to-response constructs named
  clearly enough for analysis?
- Should any timing variables be excluded from pilot-facing research exports
  until instrumentation is empirically calibrated?
- Are ratio and count variables documented with acceptable numerator,
  denominator, and threshold semantics?

## LLM-Derived And Interpretive Variables

All rows below are source verified and domain review pending:

- `agent_activity_records.diagnostic_purpose`
- `agent_activity_records.engagement_category`
- `agent_activity_records.evidence_sufficiency`
- `agent_activity_records.formative_value`
- `agent_activity_records.response_profile`
- `agent_activity_records.selected_strategy`
- `agent_activity_records.uncertainty`
- `agent_activity_records.understanding_category`
- `assessment_summary.assessment_specific_understanding_category`
- `assessment_summary.engagement_review_category`
- `assessment_summary.evidence_sufficiency`
- `assessment_summary.latest_student_safe_status`
- `item_responses.alternative_explanations`
- `item_responses.answer_selection_evidence_weight`
- `item_responses.correctness_support_level`
- `item_responses.diagnostic_snapshot_after`
- `item_responses.diagnostic_snapshot_before`
- `item_responses.estimated_guessing_risk`
- `item_responses.evidence_sufficiency`
- `item_responses.interpretation_limitations`
- `item_responses.misconception_hypothesis`
- `item_responses.observed_evidence_summary`
- `item_responses.reasoning_quality_signal`
- `sessions.assessment_specific_understanding_category`
- `sessions.engagement_review_category`
- `sessions.evidence_sufficiency`
- `sessions.interpretation_limitations`
- `sessions.latest_student_safe_status`

Review questions:

- Do the definitions avoid overclaiming stable ability, effort, motivation,
  cheating, or confirmed misconception status?
- Are source schema/version notes sufficient for reproducibility?
- Are student-facing and teacher/research-only interpretation boundaries clear?

## Understanding, Engagement, Misconception, And Evidence Fields

All rows below are source verified and domain review pending:

- `agent_activity_records.engagement_category`
- `agent_activity_records.evidence_sufficiency`
- `agent_activity_records.interpretation_caution_present`
- `agent_activity_records.misconception_changed`
- `agent_activity_records.misconception_persisted`
- `agent_activity_records.misconception_resolved`
- `agent_activity_records.misconception_weakened`
- `agent_activity_records.understanding_category`
- `assessment_summary.assessment_specific_understanding_category`
- `assessment_summary.engagement_review_category`
- `assessment_summary.estimated_guessing_risk_max`
- `assessment_summary.evidence_sufficiency`
- `item_responses.estimated_guessing_risk`
- `item_responses.evidence_sufficiency`
- `item_responses.interpretation_limitations`
- `item_responses.misconception_hypothesis`
- `item_responses.reasoning_quality_signal`
- `sessions.assessment_specific_understanding_category`
- `sessions.engagement_review_category`
- `sessions.estimated_guessing_risk_max`
- `sessions.evidence_sufficiency`
- `sessions.interpretation_limitations`

Review questions:

- Are the categories acceptable as assessment-specific diagnostic signals only?
- Should any field be renamed before research use to reduce trait-like wording?
- Are engagement/process variables clearly framed as evidence-quality context?

## Restricted Scoring And Teacher Diagnostic Fields

All rows below are source verified and domain review pending:

- `assessment_content.correct_option`
- `assessment_content.distractor_diagnostic_notes`
- `assessment_content.strong_reasoning_note`
- `assessment_content.target_reasoning_note`
- `assessment_content.teacher_llm_media_description`
- `item_responses.answer_selection_evidence_weight`
- `item_responses.correct_option`
- `item_responses.correctness`
- `item_responses.correctness_support_level`
- `item_responses.estimated_guessing_risk`
- `item_responses.unsupported_correct_response`

Review questions:

- Are restricted export conditions sufficient for classroom pilot data?
- Are answer-key and teacher-authored diagnostic notes clearly separated from
  student-facing payloads?
- Should restricted fields require a separate linkage/restricted export log in
  future work?

## Pseudonymous Identifiers

All rows below are source verified and domain review pending:

- `agent_activity_records.research_student_id`
- `agent_activity_records.student_id`
- `assessment_summary.research_student_id`
- `assessment_summary.student_id`
- `assessment_summary.student_public_id`
- `conversation_turns.research_student_id`
- `conversation_turns.student_id`
- `item_responses.research_student_id`
- `item_responses.student_id`
- `process_events.research_student_id`
- `process_events.student_id`
- `sessions.research_student_id`
- `sessions.student_id`
- `sessions.student_public_id`
- `sessions.research_pseudonym_version`
- `sessions.pseudonymization_method`
- `sessions.pseudonymization_version`
- `sessions.pseudonymization_key_fingerprint`

Review questions:

- Is versioned HMAC-SHA-256 pseudonymization acceptable for the current pilot
  export protocol?
- Are key management, rotation, and fingerprint documentation sufficient before
  broader deployment?
- Should a restricted linkage-file workflow be designed later for authorized
  identity reconciliation, with separate authorization and audit logging?
- Is the documented stability scope sufficient for longitudinal joins across
  exports and deployments?

## Unresolved Semantic Questions

- Whether `assessment_summary.csv` should remain in the default ZIP as a
  convenience view or move to an optional compatibility export.
- Whether `student_id` and `student_public_id` deprecated aliases should remain
  visible in the default active-variable view or only in an explicit deprecated
  filter after downstream analysis scripts are updated.
- Whether any LLM-derived fields should be renamed to misconception-diagnosis
  language before dissertation analysis.
- Whether process-event categories need domain-owner names rather than current
  engineering code groups.
