# Master Export Data Dictionary

This dictionary documents `MASTER_EXPORT_SCHEMA_VERSION=1.2.0`.

All timestamps are UTC ISO strings unless noted. Blank cells mean the source value is null, not applicable to the row grain, or intentionally suppressed by export options. JSON columns use stable JSON serialization and omit internal UUID keys and secret/auth fields.

## Export Metadata

- `export_generated_at`: UTC generation timestamp.
- `export_schema_version`: master export schema version.
- `row_type`: `item_response`, `concept_unit_without_item_response`, or `session_without_item_response`.
- `record_key`: deterministic public composite row key.
- `spreadsheet_formula_sanitization_applied`: `true` if any protected text cell in the row received the reversible spreadsheet-safety apostrophe prefix.

## Student Account And Identity

- `user_id`: canonical classroom/research ID from `users.user_id`.
- `student_display_name`: optional teacher-managed display label.
- `student_account_status`: `active` or `inactive`.
- `student_created_at`: account creation timestamp.
- `student_last_login_at`: most recent successful login timestamp.

## Assessment And Session

- `session_id`: public session ID.
- `assessment_id`: public assessment ID.
- `assessment_title`: assessment title.
- `assessment_status`: current assessment status.
- `assessment_workflow_mode`: current assessment workflow mode.
- `session_workflow_mode_snapshot`: workflow mode copied to the session when it started.
- `assessment_response_collection_mode`: current assessment response collection mode: `deterministic` or `llm_assisted`.
- `session_response_collection_mode_snapshot`: response collection mode copied to the session when it started.
- `assessment_release_at_utc`: assessment release timestamp if configured.
- `assessment_close_at_utc`: assessment close timestamp if configured.
- `course_timezone`: configured course timezone for schedule display/parsing.
- `attempt_number`: session attempt number.
- `session_status`: current session status.
- `current_phase`: current assessment phase.
- `automation_state`: derived session automation state such as `active`, `paused`, `exception`, or `manual_review`.
- `automation_paused`: whether the session has an automation pause marker.
- `automation_exception_reason`: sanitized automation exception reason.
- `needs_review`: session review flag.
- `needs_review_reason`: sanitized review reason.
- `session_started_at`: session start timestamp.
- `session_last_activity_at`: last session activity timestamp.
- `session_completed_at`: session completion timestamp.
- `assessment_completed`: derived completion boolean.
- `assessment_completed_at`: completion timestamp repeated for completion analysis.
- `assessment_completed_with_unresolved_evidence`: final completion unresolved-evidence flag when available.
- `final_concept_unit_id`: public ID of the final concept unit in the session.
- `final_concept_resolution_status`: final progression resolution status when available.
- `student_chose_exit`: whether the session status/phase indicates student exit.

## Concept Unit

- `concept_unit_id`: public concept-unit ID.
- `concept_unit_title`: concept-unit title.
- `concept_unit_order`: concept-unit order within the assessment.
- `concept_unit_status`: concept-unit session status for this student/session.
- `concept_unit_version`: current concept-unit version number.
- `initial_started_at`: initial concept-unit administration start timestamp.
- `initial_completed_at`: initial concept-unit administration completion timestamp.
- `followup_started_at`: follow-up start timestamp.
- `followup_completed_at`: follow-up completion timestamp.
- `followup_status`: follow-up status.
- `followup_round_count`: persisted follow-up round count for the concept-unit session.
- `completed_initial_item_set`: derived initial completion boolean.
- `completed_followup`: derived follow-up completion boolean.

## Item Response

- `item_id`: public item ID.
- `item_order`: item order within the concept unit.
- `item_stem`: administered item stem snapshot.
- `item_version_snapshot`: administered item version.
- `options_snapshot_json`: administered option snapshot JSON.
- `selected_option`: selected option label.
- `correct_option`: correct option snapshot.
- `correctness`: persisted correctness state.
- `reasoning_text`: student-provided reasoning text.
- `confidence_rating`: student confidence rating.
- `item_response_time_ms`: item response duration in milliseconds.
- `item_started_at`: item start timestamp.
- `item_submitted_at`: item submission timestamp.
- `skipped_item`: explicit item-skip flag.
- `skipped_reasoning`: reasoning-skip flag.
- `skipped_confidence`: confidence-skip flag.
- `revision_count`: item response revision count.
- `missing_evidence_repair_offered`: whether a missing-evidence repair opportunity was offered.
- `response_finalized`: derived finalization boolean.

## Process Aggregates

These are neutral event counts. They are not misconduct labels.

- `page_switch_count`
- `long_pause_count`
- `inactivity_count`
- `navigation_event_count`
- `invalid_help_request_count`
- `prompt_injection_attempt_count`
- `procedural_clarification_count`
- `emotional_response_count`
- `reasoning_revision_count`
- `option_revision_count`
- `validation_failure_count`
- `agent_retry_count`
- `followup_turn_count`
- `followup_update_trigger_count`
- `followup_update_failure_count`
- `concept_progression_request_count`
- `unresolved_progression_confirmation_count`
- `initial_free_text_student_message_count`
- `response_collection_agent_call_count`
- `response_collection_fallback_count`
- `response_collection_reasoning_extraction_count`
- `response_collection_reasoning_extraction_failure_count`

## Transcript And Raw Evidence

- `initial_conversation_transcript_text`: timestamped text transcript for non-follow-up phases.
- `followup_conversation_transcript_text`: timestamped text transcript for follow-up phases.
- `full_conversation_transcript_text`: full timestamped text transcript.
- `conversation_turns_json`: raw-safe conversation turns when raw JSON is included.
- `process_events_json`: raw-safe process events when raw JSON is included.
- `response_packages_json`: raw-safe response packages when raw JSON is included.

## Student Profile

These fields are concept-unit-session specific. They remain blank or `[]` when no activated saved profile exists for the row's concept unit.

- `initial_ability_profile`
- `latest_ability_profile`
- `ability_pattern_flags_latest`
- `initial_engagement_profile`
- `latest_engagement_profile`
- `engagement_pattern_flags_latest`
- `initial_integrated_diagnostic_profile`
- `latest_integrated_diagnostic_profile`
- `integrated_profile_confidence_latest`
- `integrated_profile_rationale_latest`
- `evidence_sufficiency_latest`
- `confidence_alignment_latest`
- `independence_interpretability_latest`
- `misconception_indicators_latest`
- `reasoning_quality_summary_latest`
- `engagement_summary_latest`
- `process_interpretation_cautions_latest`
- `profile_confidence_latest`
- `profile_rationale_latest`
- `recommended_next_evidence_latest`
- `initial_profile_created_at`
- `latest_profile_created_at`
- `profile_count`
- `profile_change_count`
- `profile_history_json`
- `integrated_profile_history_json`

## Formative Decision

These fields are concept-unit-session specific. They remain blank or `[]` when no activated saved formative decision exists for the row's concept unit.

- `initial_formative_value`
- `latest_formative_value`
- `latest_formative_decision_created_at`
- `formative_decision_count`
- `formative_action_plan_latest`
- `target_evidence_latest`
- `success_criteria_latest`
- `followup_prompt_constraints_latest`
- `profile_update_triggers_latest`
- `formative_rationale_latest`
- `mapping_followed_latest`
- `mapping_deviation_reason_latest`
- `formative_value_change_count`
- `formative_value_history_json`
- `formative_decision_history_json`

## Follow-Up Rounds

- `active_followup_round_index`
- `latest_followup_round_status`
- `latest_followup_round_started_at`
- `latest_followup_round_completed_at`
- `followup_student_turn_count`
- `followup_agent_turn_count`
- `followup_substantive_student_turn_count`
- `followup_evidence_trigger_candidate_count`
- `followup_move_on_offer_count`
- `followup_rounds_json`

## Follow-Up Update Cycles

Staged outputs in `followup_update_cycles_json` are audit data only. Failed/staged output does not populate active/latest scalar profile or formative columns.

- `followup_update_cycle_count`
- `followup_update_completed_count`
- `followup_update_failed_count`
- `latest_followup_update_cycle_status`
- `latest_followup_update_trigger_type`
- `latest_followup_update_final_update`
- `latest_followup_update_failure_stage`
- `latest_followup_update_failure_category`
- `followup_update_cycles_json`

## Concept Progression

- `progression_record_count`
- `latest_progression_status`
- `latest_progression_type`
- `latest_progression_trigger_type`
- `latest_progression_student_choice`
- `latest_progression_resolution_status`
- `moved_on_with_unresolved_evidence`
- `completed_with_unresolved_evidence`
- `progression_requested_at`
- `progression_confirmed_at`
- `progression_completed_at`
- `destination_concept_unit_id`
- `concept_progression_history_json`

## Workflow Jobs And Overrides

- `workflow_job_count`
- `workflow_job_completed_count`
- `workflow_job_failed_count`
- `workflow_job_retry_count`
- `latest_workflow_job_type`
- `latest_workflow_job_status`
- `latest_workflow_activity_at`
- `workflow_exception_count`
- `workflow_override_count`
- `workflow_jobs_json`
- `workflow_overrides_json`

## Agent Audit

These summarize actual recorded `agent_calls` only. Planned environment model names are not exported as actual calls.

- `agent_model_names`
- `agent_versions`
- `prompt_versions`
- `schema_versions`
- `prompt_hashes`
- `agent_providers`
- `agent_call_count`
- `agent_blocked_call_count`
- `agent_failed_call_count`
- `agent_validation_failure_count`
- `agent_calls_json`

## Summative Outcomes

- `primary_summative_outcome_name`
- `primary_summative_outcome_score`
- `primary_summative_outcome_max_score`
- `primary_summative_outcome_percent`
- `primary_summative_assessment_date`
- `summative_outcomes_json`
