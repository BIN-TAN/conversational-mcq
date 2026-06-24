import { stripInternalKeys } from "@/lib/services/teacher-review/serializers";

export function serializeEvalDate(value?: Date | null) {
  return value ? value.toISOString() : null;
}

export function serializeEvalSuite(suite: {
  suite_public_id: string;
  title: string;
  description: string | null;
  agent_name: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  _count?: { cases?: number; runs?: number };
}) {
  return {
    suite_public_id: suite.suite_public_id,
    title: suite.title,
    description: suite.description,
    agent_name: suite.agent_name,
    status: suite.status,
    case_count: suite._count?.cases ?? null,
    run_count: suite._count?.runs ?? null,
    created_at: serializeEvalDate(suite.created_at),
    updated_at: serializeEvalDate(suite.updated_at)
  };
}

export function serializeEvalCase(evalCase: {
  case_public_id: string;
  case_id: string;
  agent_name: string;
  title: string;
  description: string | null;
  input_payload: unknown;
  expected_output: unknown;
  gold_labels: unknown;
  rubric_expectations: unknown;
  safety_expectations: unknown;
  case_source: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    case_public_id: evalCase.case_public_id,
    case_id: evalCase.case_id,
    agent_name: evalCase.agent_name,
    title: evalCase.title,
    description: evalCase.description,
    input_payload: stripInternalKeys(evalCase.input_payload),
    expected_output: stripInternalKeys(evalCase.expected_output),
    gold_labels: stripInternalKeys(evalCase.gold_labels),
    rubric_expectations: stripInternalKeys(evalCase.rubric_expectations),
    safety_expectations: stripInternalKeys(evalCase.safety_expectations),
    case_source: evalCase.case_source,
    status: evalCase.status,
    created_at: serializeEvalDate(evalCase.created_at),
    updated_at: serializeEvalDate(evalCase.updated_at)
  };
}

export function serializeEvalRun(run: {
  run_public_id: string;
  agent_name: string;
  provider: string;
  model_name: string;
  model_config: unknown;
  prompt_version: string;
  schema_version: string;
  prompt_hash: string;
  run_mode: string;
  repetition_count: number;
  status: string;
  planned_run_item_count?: number | null;
  provider_request_count?: number | null;
  model_snapshot?: string | null;
  reasoning_effort?: string | null;
  case_manifest_hash?: string | null;
  run_config_hash?: string | null;
  evaluation_phase?: string | null;
  approved_canary_run_public_id?: string | null;
  pilot_manifest_version?: string | null;
  pilot_manifest_hash?: string | null;
  agent_configuration_hash?: string | null;
  ordering_algorithm_version?: string | null;
  reproducibility_manifest?: unknown;
  pricing_registry_version?: string | null;
  budget_limit_usd?: unknown;
  estimated_cost_usd?: unknown;
  error_message?: string | null;
  canary_gate_status?: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  suite?: {
    suite_public_id: string;
    title: string;
  };
  _count?: { run_items?: number };
}) {
  return {
    run_public_id: run.run_public_id,
    suite_public_id: run.suite?.suite_public_id ?? null,
    suite_title: run.suite?.title ?? null,
    agent_name: run.agent_name,
    provider: run.provider,
    model_name: run.model_name,
    model_config: stripInternalKeys(run.model_config),
    prompt_version: run.prompt_version,
    schema_version: run.schema_version,
    prompt_hash: run.prompt_hash,
    run_mode: run.run_mode,
    repetition_count: run.repetition_count,
    status: run.status,
    planned_run_item_count: run.planned_run_item_count ?? null,
    provider_request_count: run.provider_request_count ?? null,
    model_snapshot: run.model_snapshot ?? null,
    reasoning_effort: run.reasoning_effort ?? null,
    case_manifest_hash: run.case_manifest_hash ?? null,
    run_config_hash: run.run_config_hash ?? null,
    evaluation_phase: run.evaluation_phase ?? null,
    approved_canary_run_public_id: run.approved_canary_run_public_id ?? null,
    pilot_manifest_version: run.pilot_manifest_version ?? null,
    pilot_manifest_hash: run.pilot_manifest_hash ?? null,
    agent_configuration_hash: run.agent_configuration_hash ?? null,
    ordering_algorithm_version: run.ordering_algorithm_version ?? null,
    reproducibility_manifest: stripInternalKeys(run.reproducibility_manifest),
    pricing_registry_version: run.pricing_registry_version ?? null,
    budget_limit_usd:
      run.budget_limit_usd === undefined || run.budget_limit_usd === null
        ? null
        : Number(run.budget_limit_usd),
    estimated_cost_usd:
      run.estimated_cost_usd === undefined || run.estimated_cost_usd === null
        ? null
        : Number(run.estimated_cost_usd),
    error_message: run.error_message ?? null,
    canary_gate_status: run.canary_gate_status ?? null,
    run_item_count: run._count?.run_items ?? null,
    started_at: serializeEvalDate(run.started_at),
    completed_at: serializeEvalDate(run.completed_at),
    created_at: serializeEvalDate(run.created_at),
    updated_at: serializeEvalDate(run.updated_at)
  };
}

export function serializeEvalAnnotation(annotation: {
  annotation_public_id: string;
  blind_review: boolean;
  annotation_source: string;
  annotation_status: string;
  review_target?: string | null;
  reviewer_model?: string | null;
  review_method?: string | null;
  reviewed_at?: Date | null;
  annotation_file_hash?: string | null;
  reference_file_hash?: string | null;
  source_run_public_id?: string | null;
  import_command_version?: string | null;
  overall_rating: number | null;
  pass_fail: string | null;
  rubric_scores: unknown;
  safety_flags: unknown;
  notes: string | null;
  confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  annotated_by?: { user_id: string; display_name: string | null };
  confirmed_by?: { user_id: string; display_name: string | null } | null;
}) {
  return {
    annotation_public_id: annotation.annotation_public_id,
    annotated_by_user_id: annotation.annotated_by?.user_id ?? null,
    annotated_by_display_name: annotation.annotated_by?.display_name ?? null,
    confirmed_by_user_id: annotation.confirmed_by?.user_id ?? null,
    confirmed_by_display_name: annotation.confirmed_by?.display_name ?? null,
    blind_review: annotation.blind_review,
    annotation_source: annotation.annotation_source,
    annotation_status: annotation.annotation_status,
    review_target: annotation.review_target ?? "raw_model_output",
    reviewer_model: annotation.reviewer_model ?? null,
    review_method: annotation.review_method ?? null,
    reviewed_at: serializeEvalDate(annotation.reviewed_at ?? null),
    annotation_file_hash: annotation.annotation_file_hash ?? null,
    reference_file_hash: annotation.reference_file_hash ?? null,
    source_run_public_id: annotation.source_run_public_id ?? null,
    import_command_version: annotation.import_command_version ?? null,
    overall_rating: annotation.overall_rating,
    pass_fail: annotation.pass_fail,
    rubric_scores: stripInternalKeys(annotation.rubric_scores),
    safety_flags: stripInternalKeys(annotation.safety_flags),
    notes: annotation.notes,
    confirmed_at: serializeEvalDate(annotation.confirmed_at),
    created_at: serializeEvalDate(annotation.created_at),
    updated_at: serializeEvalDate(annotation.updated_at)
  };
}

export function serializeEvalRunItem(runItem: {
  run_item_public_id: string;
  repetition_index: number;
  run_order?: number | null;
  evaluation_phase?: string | null;
  evaluation_stratum?: string | null;
  paired_case_key?: string | null;
  case_hash?: string | null;
  input_payload: unknown;
  raw_output: unknown;
  parsed_output: unknown;
  output_validated: boolean;
  schema_validation_error: string | null;
  semantic_validation_result: unknown;
  safety_validation_result: unknown;
  execution_status: string;
  model_snapshot?: string | null;
  reasoning_effort?: string | null;
  max_output_tokens?: number | null;
  provider_response_id?: string | null;
  provider_request_id?: string | null;
  client_request_id?: string | null;
  prompt_version?: string | null;
  schema_version?: string | null;
  prompt_hash?: string | null;
  error_category?: string | null;
  retry_count?: number | null;
  latency_ms: number | null;
  token_usage: unknown;
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
  reasoning_tokens?: number | null;
  total_tokens?: number | null;
  estimated_cost_usd?: unknown;
  started_at?: Date | null;
  completed_at?: Date | null;
  created_at: Date;
  updated_at: Date;
  eval_case?: {
    case_public_id: string;
    case_id: string;
    agent_name: string;
    title: string;
    description: string | null;
    expected_output: unknown;
    gold_labels: unknown;
    rubric_expectations: unknown;
    safety_expectations: unknown;
    case_source: string;
  };
  run?: {
    run_public_id: string;
    agent_name: string;
    provider: string;
    model_name: string;
    run_mode: string;
    prompt_version: string;
    schema_version: string;
    prompt_hash: string;
    suite?: { suite_public_id: string; title: string };
  };
  annotations?: Array<Parameters<typeof serializeEvalAnnotation>[0]>;
}, options: { blind?: boolean } = {}) {
  const blind = options.blind ?? false;

  return {
    run_item_public_id: runItem.run_item_public_id,
    run_public_id: runItem.run?.run_public_id ?? null,
    suite_public_id: runItem.run?.suite?.suite_public_id ?? null,
    suite_title: runItem.run?.suite?.title ?? null,
    case_public_id: runItem.eval_case?.case_public_id ?? null,
    case_id: runItem.eval_case?.case_id ?? null,
    case_title: runItem.eval_case?.title ?? null,
    case_description: runItem.eval_case?.description ?? null,
    agent_name: runItem.eval_case?.agent_name ?? runItem.run?.agent_name ?? null,
    run_mode: runItem.run?.run_mode ?? null,
    provider: blind ? null : (runItem.run?.provider ?? null),
    model_name: blind ? null : (runItem.run?.model_name ?? null),
    model_snapshot: blind ? null : (runItem.model_snapshot ?? runItem.run?.model_name ?? null),
    reasoning_effort: blind ? null : (runItem.reasoning_effort ?? null),
    max_output_tokens: runItem.max_output_tokens ?? null,
    prompt_version: runItem.prompt_version ?? runItem.run?.prompt_version ?? null,
    schema_version: runItem.schema_version ?? runItem.run?.schema_version ?? null,
    prompt_hash: runItem.prompt_hash ?? runItem.run?.prompt_hash ?? null,
    repetition_index: runItem.repetition_index,
    run_order: runItem.run_order ?? null,
    evaluation_phase: runItem.evaluation_phase ?? null,
    evaluation_stratum: runItem.evaluation_stratum ?? null,
    paired_case_key: runItem.paired_case_key ?? null,
    case_hash: runItem.case_hash ?? null,
    input_payload: stripInternalKeys(runItem.input_payload),
    raw_output: stripInternalKeys(runItem.raw_output),
    parsed_output: stripInternalKeys(runItem.parsed_output),
    output_validated: runItem.output_validated,
    schema_validation_error: runItem.schema_validation_error,
    semantic_validation_result: stripInternalKeys(runItem.semantic_validation_result),
    safety_validation_result: stripInternalKeys(runItem.safety_validation_result),
    execution_status: runItem.execution_status,
    provider_response_id: blind ? null : (runItem.provider_response_id ?? null),
    provider_request_id: blind ? null : (runItem.provider_request_id ?? null),
    client_request_id: runItem.client_request_id ?? null,
    error_category: runItem.error_category ?? null,
    retry_count: runItem.retry_count ?? 0,
    latency_ms: runItem.latency_ms,
    token_usage: stripInternalKeys(runItem.token_usage),
    input_tokens: runItem.input_tokens ?? null,
    cached_input_tokens: runItem.cached_input_tokens ?? null,
    output_tokens: runItem.output_tokens ?? null,
    reasoning_tokens: runItem.reasoning_tokens ?? null,
    total_tokens: runItem.total_tokens ?? null,
    estimated_cost_usd:
      runItem.estimated_cost_usd === undefined || runItem.estimated_cost_usd === null
        ? null
        : Number(runItem.estimated_cost_usd),
    expected_output: stripInternalKeys(runItem.eval_case?.expected_output),
    gold_labels: stripInternalKeys(runItem.eval_case?.gold_labels),
    rubric_expectations: stripInternalKeys(runItem.eval_case?.rubric_expectations),
    safety_expectations: stripInternalKeys(runItem.eval_case?.safety_expectations),
    case_source: runItem.eval_case?.case_source ?? null,
    annotations: runItem.annotations?.map(serializeEvalAnnotation) ?? [],
    started_at: serializeEvalDate(runItem.started_at ?? null),
    completed_at: serializeEvalDate(runItem.completed_at ?? null),
    created_at: serializeEvalDate(runItem.created_at),
    updated_at: serializeEvalDate(runItem.updated_at)
  };
}
