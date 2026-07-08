export type StructuredApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type SessionListRow = {
  session_public_id: string;
  student_user_id: string;
  student_display_name: string | null;
  assessment_public_id: string;
  assessment_title: string;
  attempt_number: number;
  session_status: string;
  current_phase: string;
  workflow_mode_snapshot: string;
  response_collection_mode_snapshot: string;
  assessment_response_collection_mode: string;
  automation_state: string;
  failed_workflow_job_count: number;
  pending_workflow_job_count: number;
  needs_review: boolean;
  needs_review_reason: string | null;
  started_at: string | null;
  last_activity_at: string | null;
  completed_at: string | null;
  concept_unit_count: number;
  completed_concept_unit_count: number;
  current_concept_unit_title: string | null;
  item_response_count: number;
};

export type SessionListResponse = {
  sessions: SessionListRow[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  filters: {
    assessments: Array<{
      assessment_public_id: string;
      title: string;
    }>;
  };
};

export type SessionDetailResponse = {
  session: {
    session_public_id: string;
    attempt_number: number;
    status: string;
    current_phase: string;
    workflow_mode_snapshot: string;
    response_collection_mode_snapshot: string;
    automation_state: string;
    automation_paused_at: string | null;
    automation_exception_reason: string | null;
    needs_review: boolean;
    needs_review_reason: string | null;
    started_at: string | null;
    last_activity_at: string | null;
    completed_at: string | null;
  };
  student: {
    user_id: string;
    display_name: string | null;
  };
  assessment: {
    assessment_public_id: string;
    title: string;
    description: string | null;
    response_collection_mode: string;
    content_state: {
      content_state: string;
      is_content_locked: boolean;
      content_lock_reason: string | null;
      has_student_sessions: boolean;
    };
  };
  automation: {
    workflow_mode_snapshot: string;
    automation_state: string;
    automation_paused_at: string | null;
    automation_exception_reason: string | null;
    workflow_jobs: Array<{
      job_public_id: string;
      job_type: string;
      status: string;
      attempt_count: number;
      max_attempts: number;
      run_after: string;
      last_error_category: string | null;
      last_error_message: string | null;
      created_at: string;
      completed_at: string | null;
    }>;
    workflow_overrides: Array<{
      override_public_id: string;
      action_type: string;
      reason: string | null;
      created_at: string | null;
    }>;
    can_pause: boolean;
    can_resume: boolean;
    can_retry_current_step: boolean;
    can_stop_followup: boolean;
  };
  current_concept_unit: {
    concept_unit_public_id: string;
    title: string;
  } | null;
  concept_unit_sessions: Array<{
    concept_unit_public_id: string;
    title: string;
    order_index: number;
    status: string;
    initial_started_at: string | null;
    initial_completed_at: string | null;
    followup_started_at: string | null;
    followup_completed_at: string | null;
    followup_status: string;
    followup_round_count: number;
    item_response_count: number;
    response_package_count: number;
    can_run_profiling: boolean;
    latest_student_profile: TeacherStudentProfile | null;
    can_run_planning: boolean;
    latest_formative_decision: TeacherFormativeDecision | null;
    can_start_followup: boolean;
    can_run_followup_update: boolean;
    followup_rounds: TeacherFollowupRound[];
    followup_update_cycles: TeacherFollowupUpdateCycle[];
    concept_progression_records: TeacherConceptProgressionRecord[];
  }>;
  summary: {
    concept_unit_count: number;
    completed_concept_unit_count: number;
    item_response_count: number;
    response_package_count: number;
    assessment_content_locked: boolean;
  };
  future_agent_data: {
    student_profile_count: number;
    formative_decision_count: number;
    followup_round_count: number;
    agent_call_count: number;
    message: string;
  };
  operational_agent_audit: {
    operational_mode: string;
    approved_manifest_status: string;
    active_configuration_hash: string;
    approved_configuration_hash: string;
    live_call_permitted: boolean;
    blocking_reasons: string[];
    sanitized_warnings: string[];
    effective_results: Array<{
      public_id: string;
      agent_name: string;
      operational_context_type: string;
      operational_context_public_id: string;
      invocation_key: string;
      effective_result_version: string;
      effective_validator_version: string;
      deterministic_guard_version: string | null;
      canonicalization_version: string | null;
      fallback_version: string | null;
      raw_call_status: string;
      raw_output_status: string;
      raw_semantic_status: string;
      raw_safety_status: string;
      effective_semantic_status: string;
      effective_safety_status: string;
      effective_overall_status: string;
      effective_student_facing_usable: boolean;
      effective_workflow_usable: boolean;
      deterministic_guard_applied: boolean;
      canonicalization_applied: boolean;
      fallback_applied: boolean;
      sanitized_warnings: unknown;
      effective_result_hash: string;
      created_at: string | null;
      agent_call: {
        agent_name: string;
        provider: string;
        model_name: string;
        prompt_version: string;
        schema_version: string;
        prompt_hash: string | null;
        call_status: string;
        output_validated: boolean;
        live_call_allowed: boolean;
        blocked_reason: string | null;
        retry_count: number;
        latency_ms: number | null;
        input_tokens: number | null;
        output_tokens: number | null;
        total_tokens: number | null;
        estimated_cost: string | null;
        created_at: string | null;
        completed_at: string | null;
      } | null;
    }>;
  };
};

export type TeacherStudentProfile = {
  profile_type: string;
  ability_profile: string;
  ability_pattern_flags: unknown;
  engagement_profile: string;
  engagement_pattern_flags: unknown;
  integrated_diagnostic_profile: string;
  integrated_profile_confidence: string;
  integrated_profile_rationale: string;
  evidence_sufficiency: string;
  confidence_alignment: string;
  independence_interpretability: string;
  misconception_indicators: unknown;
  item_level_evidence: unknown;
  reasoning_quality_summary: string;
  engagement_summary: string;
  process_interpretation_cautions: unknown;
  profile_confidence: string;
  rationale: string;
  recommended_next_evidence: unknown;
  created_at: string | null;
  based_on_agent_call: {
    agent_name: string;
    provider: string;
    model_name: string;
    agent_version: string;
    prompt_version: string;
    schema_version: string;
    prompt_hash: string | null;
    retry_count: number;
    call_status: string;
    output_validated: boolean;
    live_call_allowed: boolean;
    blocked_reason: string | null;
    created_at: string | null;
    completed_at: string | null;
  } | null;
};

export type TeacherFormativeDecision = {
  formative_value: string;
  formative_action_plan: string;
  target_evidence: unknown;
  success_criteria: unknown;
  followup_prompt_constraints: unknown;
  profile_update_triggers: unknown;
  rationale: string;
  mapping_followed: boolean;
  mapping_deviation_reason: string | null;
  created_at: string | null;
  based_on_agent_call: {
    agent_name: string;
    provider: string;
    model_name: string;
    agent_version: string;
    prompt_version: string;
    schema_version: string;
    prompt_hash: string | null;
    retry_count: number;
    call_status: string;
    output_validated: boolean;
    live_call_allowed: boolean;
    blocked_reason: string | null;
    created_at: string | null;
    completed_at: string | null;
    mock_or_live: string;
  } | null;
  mock_output_notice: string | null;
};

export type RunProfilingResponse = {
  session_public_id: string;
  concept_unit_public_id: string;
  result: {
    status: string;
    profile: TeacherStudentProfile | null;
  };
};

export type RunPlanningResponse = {
  session_public_id: string;
  concept_unit_public_id: string;
  result: {
    status: string;
    decision: TeacherFormativeDecision | null;
    default_formative_value: string;
  };
};

export type TeacherFollowupRound = {
  round_index: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  updated_student_profile_present: boolean;
  formative_decision: {
    formative_value: string;
    created_at: string | null;
  };
  transcript: Array<{
    actor_type: string;
    agent_name: string | null;
    message_text: string | null;
    created_at: string | null;
    structured_payload: unknown;
  }>;
  agent_calls: Array<{
    agent_name: string;
    provider: string;
    model_name: string;
    agent_version: string;
    prompt_version: string;
    schema_version: string;
    prompt_hash: string | null;
    retry_count: number;
    call_status: string;
    output_validated: boolean;
    live_call_allowed: boolean;
    blocked_reason: string | null;
    latency_ms: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
    created_at: string | null;
    completed_at: string | null;
    mock_or_live: string;
  }>;
  mock_output_notice: string | null;
};

export type TeacherFollowupUpdateCycle = {
  cycle_public_id: string;
  trigger_type: string;
  trigger_details: unknown;
  status: string;
  final_update: boolean;
  create_next_round: boolean;
  stop_after_cycle: boolean;
  evidence_cutoff_at: string | null;
  stage: string;
  profile_agent_call_present: boolean;
  planning_agent_call_present: boolean;
  opening_agent_call_present: boolean;
  staged_profile_present: boolean;
  staged_planning_present: boolean;
  staged_opening_present: boolean;
  active_pointers_changed: boolean;
  failure_stage: string | null;
  failure_category: string | null;
  failure_message: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  interpretation_boundary: string;
};

export type TeacherConceptProgressionRecord = {
  progression_public_id: string;
  progression_type: string;
  trigger_type: string;
  student_choice: string | null;
  status: string;
  resolution_status: string;
  moved_on_with_unresolved_evidence: boolean;
  completed_with_unresolved_evidence: boolean;
  requested_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  destination_concept_unit: {
    concept_unit_public_id: string;
    title: string;
    order_index: number;
  } | null;
  final_update_cycle: {
    cycle_public_id: string;
    status: string;
    completed_at: string | null;
  } | null;
  interpretation_boundary: string;
};

export type StartFollowupResponse = {
  session_public_id: string;
  concept_unit_public_id: string;
  result: {
    status: string;
    round: TeacherFollowupRound | null;
    student_state?: unknown;
  };
};

export type RunFollowupUpdateResponse = {
  session_public_id: string;
  concept_unit_public_id: string;
  result: {
    status: string;
    cycle_public_id: string;
  };
};

export type ItemResponsesResponse = {
  session_public_id: string;
  concept_units: Array<{
    concept_unit_public_id: string;
    title: string;
    order_index: number;
    item_responses: Array<{
      item_public_id: string;
      item_order: number;
      response_state: string;
      item_stem_snapshot: unknown;
      options_snapshot: unknown;
      selected_option: string | null;
      correct_option_snapshot: string;
      correctness: string;
      reasoning_text: string | null;
      confidence_rating: string | null;
      skipped_item: boolean;
      skipped_reasoning: boolean;
      skipped_confidence: boolean;
      revision_count: number;
      missing_evidence_repair_offered: boolean;
      item_response_time_ms: number | null;
      item_started_at: string | null;
      item_submitted_at: string | null;
      item_version_snapshot: number | null;
      administered_snapshot: unknown;
      current_content_version: number;
    }>;
  }>;
};

export type TranscriptResponse = {
  session_public_id: string;
  turns: Array<{
    actor_type: string;
    agent_name: string | null;
    phase: string;
    message_text: string | null;
    created_at: string | null;
    concept_unit_public_id: string | null;
    concept_unit_title: string | null;
    item_public_id: string | null;
    item_order: number | null;
    followup_round_index: number | null;
    structured_payload: unknown;
  }>;
};

export type ReadableTranscriptResponse = {
  session_public_id: string;
  student_display_label: string;
  assessment_label: string;
  turns: Array<{
    turn_index: number;
    speaker: "agent" | "student" | "system";
    timestamp: string | null;
    phase_label: string;
    safe_context_label: string | null;
    message_text: string;
    has_structured_payload_available_elsewhere: boolean;
    next_student_response_latency_ms: number | null;
    next_student_response_latency_seconds: number | null;
    next_student_response_latency_source: string | null;
  }>;
  limitations: string[];
};

export type ProcessEventsResponse = {
  session_public_id: string;
  aggregates: Record<string, unknown> & {
    event_count_by_type: Record<string, number>;
  };
  events: Array<{
    event_type: string;
    event_category: string;
    event_source: string;
    occurred_at: string | null;
    created_at: string | null;
    visibility_duration_ms: number | null;
    pause_duration_ms: number | null;
    concept_unit_public_id: string | null;
    concept_unit_title: string | null;
    item_public_id: string | null;
    item_order: number | null;
    payload: unknown;
  }>;
  concept_units: Array<{
    concept_unit_public_id: string;
    title: string;
  }>;
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  interpretation_boundary: string;
};

export type ResponsePackagesResponse = {
  session_public_id: string;
  response_packages: Array<{
    package_type: string;
    created_at: string | null;
    concept_unit_public_id: string;
    concept_unit_title: string;
    concept_unit_order_index: number;
    sequence: number;
    package_version: string | null;
    payload_summary: unknown;
    payload: unknown;
  }>;
};

export type SessionDataAuditResponse = {
  artifact_version: string;
  generated_at: string;
  no_live_provider_call_made: boolean;
  interpretation_boundary: string;
  session_public_id: string;
  artifact_path: string | null;
  data_completeness: {
    session: {
      session_public_id: string;
      status: string;
      current_phase: string;
      started_at: string | null;
      last_activity_at: string | null;
      completed_at: string | null;
    };
    assessment: {
      assessment_public_id: string;
      title: string;
    };
    student: {
      user_id: string;
      display_name_present: boolean;
    };
    response_package: {
      concept_unit_session_count: number;
      item_attempt_count: number;
      submitted_answer_count: number;
      reasoning_response_count: number;
      confidence_response_count: number;
      tempting_option_response_count: number;
      revisions_count: number;
      conversation_turns_count: number;
      package_count: number;
      initial_package_count: number;
      latest_initial_package_created_at: string | null;
      package_completion_state: string;
    };
  };
  process_data_summary: {
    process_event_count: number;
    observed_event_type_count: number;
    observed_event_counts: Record<string, number>;
    expected_initial_administration_event_types: string[];
    missing_expected_initial_event_types: string[];
    supported_process_event_type_count: number;
    item_scoped_event_count: number;
    session_scoped_event_count: number;
    concept_unit_scoped_counts: Record<string, number>;
    event_source_counts: Record<string, number>;
    first_event_at: string | null;
    last_event_at: string | null;
    availability: {
      focus_visibility_events_available: boolean;
      paste_events_available: boolean;
      typing_summary_events_available: boolean;
      pause_or_inactivity_events_available: boolean;
    };
    inventory_summary: {
      observed_event_types: string[];
      unobserved_supported_event_types: string[];
    };
  };
  response_evidence_summary: {
    latest_initial_package_available: boolean;
    latest_initial_package_summary: unknown;
    response_package_evidence_complete_for_initial_three: boolean;
    answer_choices_present: boolean;
    reasoning_present: boolean;
    confidence_present: boolean;
    tempting_option_evidence_present: boolean;
    fixed_item_metadata_present: Record<string, boolean>;
  };
  engagement_evidence_summary: {
    engagement_packet_available: boolean;
    internal_only_engagement_category: string | null;
    category_confidence: string | null;
    ai_assistance_signal: string | null;
    evidence_item_count: number;
    process_data_limitation_flags: string[];
    threshold_policy: string | null;
  };
  correctness_inflation_summary: {
    ability_packet_available: boolean;
    unsupported_correct_response_count: number;
    estimated_guessing_risk_counts: Record<string, number>;
    correctness_support_level_counts: Record<string, number>;
    answer_selection_evidence_weight_distribution: Record<string, number>;
    uncertainty_marker_count: number;
    uncertainty_marker_type_counts: Record<string, number>;
    interpretation_boundary: string;
    limitations: string[];
  };
  activity_runtime_summary: {
    attempt_count: number;
    status_counts: Record<string, number>;
    activity_family_counts: Record<string, number>;
    generation_source_counts: Record<string, number>;
    latest_state: string | null;
    latest_activity_response_reference_count: number;
    student_choice_state_counts: Record<string, number>;
    failed_closed_count: number;
    limitations: string[];
  };
  misconception_evidence_summary: {
    record_count: number;
    evaluation_source_counts: Record<string, number>;
    production_mode_counts: Record<string, number>;
    live_record_count: number;
    no_live_record_count: number;
    safety_flag_key_counts: Record<string, number>;
    update_status_counts: Record<string, number>;
    evidence_quality_counts: Record<string, number>;
    recommended_next_purpose_counts: Record<string, number>;
  };
  diagnostic_snapshot_summary: {
    snapshot_count: number;
    before_state_available_count: number;
    after_state_available_count: number;
    update_status_counts: Record<string, number>;
    recommended_next_purpose_counts: Record<string, number>;
  };
  agent_audit_summary: {
    call_count: number;
    agent_name_counts: Record<string, number>;
    provider_counts: Record<string, number>;
    call_status_counts: Record<string, number>;
    provider_metadata_present_count: number;
    token_usage_present_count: number;
    failed_call_count: number;
    failed_call_summaries: Array<{
      agent_name: string;
      call_status: string;
      output_validated: boolean;
      created_at: string | null;
      completed_at: string | null;
    }>;
    repair_call_count: number;
    unique_prompt_hash_count: number;
  };
  limitations: string[];
};

export type TeacherReviewBundle = {
  detail: SessionDetailResponse;
  itemResponses: ItemResponsesResponse;
  transcript: TranscriptResponse;
  processEvents: ProcessEventsResponse;
  responsePackages: ResponsePackagesResponse;
  dataAudit?: SessionDataAuditResponse;
};
