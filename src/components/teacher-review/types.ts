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
    content_state: {
      content_state: string;
      is_content_locked: boolean;
      content_lock_reason: string | null;
      has_student_sessions: boolean;
    };
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
    followup_rounds: TeacherFollowupRound[];
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

export type StartFollowupResponse = {
  session_public_id: string;
  concept_unit_public_id: string;
  result: {
    status: string;
    round: TeacherFollowupRound | null;
    student_state?: unknown;
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

export type TeacherReviewBundle = {
  detail: SessionDetailResponse;
  itemResponses: ItemResponsesResponse;
  transcript: TranscriptResponse;
  processEvents: ProcessEventsResponse;
  responsePackages: ResponsePackagesResponse;
};
