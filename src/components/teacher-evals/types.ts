export type EvalSuiteRow = {
  suite_public_id: string;
  title: string;
  description: string | null;
  agent_name: string;
  status: string;
  case_count: number | null;
  run_count: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type EvalRunRow = {
  run_public_id: string;
  suite_public_id: string | null;
  suite_title: string | null;
  agent_name: string;
  provider: string | null;
  model_name: string | null;
  prompt_version: string;
  schema_version: string;
  prompt_hash: string;
  run_mode: string;
  repetition_count: number;
  status: string;
  run_item_count: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type EvalRunItemRow = {
  run_item_public_id: string;
  run_public_id: string | null;
  suite_public_id: string | null;
  suite_title: string | null;
  case_public_id: string | null;
  case_id: string | null;
  case_title: string | null;
  case_description: string | null;
  agent_name: string | null;
  run_mode: string | null;
  provider: string | null;
  model_name: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  prompt_hash: string | null;
  repetition_index: number;
  input_payload: unknown;
  raw_output: unknown;
  parsed_output: unknown;
  output_validated: boolean;
  schema_validation_error: string | null;
  semantic_validation_result: unknown;
  safety_validation_result: unknown;
  execution_status: string;
  latency_ms: number | null;
  token_usage: unknown;
  expected_output: unknown;
  gold_labels: unknown;
  rubric_expectations: unknown;
  safety_expectations: unknown;
  case_source: string | null;
  annotations: EvalAnnotationRow[];
  created_at: string | null;
  updated_at: string | null;
};

export type EvalAnnotationRow = {
  annotation_public_id: string;
  annotated_by_user_id: string | null;
  annotated_by_display_name: string | null;
  blind_review: boolean;
  overall_rating: number | null;
  pass_fail: string | null;
  rubric_scores: unknown;
  safety_flags: unknown;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type EvalSummary = {
  label: string;
  classroom_validation: boolean;
  case_count: number;
  completed_count: number;
  schema_pass_rate: number | null;
  semantic_pass_rate: number | null;
  safety_pass_rate: number | null;
  annotation_pass_rate: number | null;
  critical_failure_count: number;
  mean_overall_rating: number | null;
  mean_rubric_scores_by_agent: Record<string, Record<string, number | null>>;
  failures_by_agent: Record<string, number>;
  failures_by_critical_flag: Record<string, number>;
};

export type Paginated<T> = {
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
} & T;
