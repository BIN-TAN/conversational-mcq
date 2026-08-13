export const FORMATIVE_CONVERSATION_V18_FORENSIC_VERSION =
  "formative-conversation-v18-v17-forensics-v1" as const;

export const FORMATIVE_CONVERSATION_V17_IMMUTABLE_SOURCE = {
  git_commit: "35dcd9b9de30060a85de3b2f5860e0696303f20c",
  provider_run_id: "fcv5v17_provider_20260812104724_6e45e95e",
  derived_evaluation_id: "fcv5v17_derived_20260812104724_47ac9964",
  runtime_candidate_hash:
    "b077ba062c37340eac2918a2578f118c36fa852006196d31ef4735598ed21e6e",
  evaluation_protocol_hash:
    "e8d76572f9fb11bf88069c3474c6f1a39469a68e2fe1fa1d2a827f42c2283d90",
  candidate_tree_sha256:
    "ee212a40935b46317727c7b0525f0e7d2982dc6c3a7461dd99c84c94f64caecc",
  run_tree_sha256:
    "7ded22b1edf77d0572168a545d759b1f89eed832f4b0f7a03ccc29b7223d9054"
} as const;

export const FORMATIVE_CONVERSATION_V17_PROFILING_FORENSICS = [
  {
    case_id: "pcv17_01_no_misconception",
    canonical_request_hash:
      "19f714fe544ca0107de250d5e1a2a59c258acd0a9a945130ed63649852613be7",
    immutable_artifact_sha256:
      "617133f902d4fadd1b1c02b779cc0f2ac52b9e700124d88001e3d091c406a150"
  },
  {
    case_id: "pcv17_02_single_atomic_misconception",
    canonical_request_hash:
      "5eeb274206db9b391e2b9a907568ab4f03683b4d494dc95585e6b7fbfd77ff03",
    immutable_artifact_sha256:
      "ab489be16ff6f3b6f12fffb295a444ace1fb82ce616687e98d8344c4b51873c5"
  },
  {
    case_id: "pcv17_03_compound_conceptual_state",
    canonical_request_hash:
      "270bc554a03b760cd79888ae3b9e442e3907b4ec063702d3f497ec019456b548",
    immutable_artifact_sha256:
      "c69f859fb0f96dfbb88b1c303c1f2c1d9f07ead82eb2103087b303731caf19fe"
  }
] as const;

export const FORMATIVE_CONVERSATION_V17_FAILURE_CLASSIFICATION = {
  profiling_canaries: {
    primary_failure_class: "pre_dispatch_request_schema_rejection",
    failing_schema_path:
      "#/definitions/student-profile-output-v3/properties/misconception_indicators/items/properties/atomic_claims",
    exact_rejection:
      "uses .optional() without .nullable() which is not supported by the API",
    adapter_entered: true,
    request_serialization_completed: false,
    fetch_invoked: false,
    offline_gap:
      "V17 tests parsed fixtures with Zod but did not invoke the production Responses strict-schema compiler."
  },
  case_5: {
    primary_failure_class: "max_output_token_truncation",
    classification_code: "A",
    provider_result_status: "incomplete",
    provider_incomplete_reason: "max_output_tokens",
    configured_max_output_tokens: 3_500,
    observed_output_tokens: 3_500,
    raw_candidate_preserved: true,
    raw_candidate_is_truncated_json: true,
    complete_provider_response_failed_parsing: false,
    semantic_regeneration_permitted: false,
    reason:
      "The provider result was incomplete and syntactically truncated, so it was not a parsed semantic-contract failure."
  },
  case_6: {
    primary_provider_result_status: "completed",
    legacy_field: "misconception_claim_closure",
    legacy_field_permitted_by_v17_json_schema: true,
    compatibility_parse_admitted_primary: true,
    primary_rejection:
      "profile_transition_legacy_misconception_closure_forbidden",
    semantic_regeneration_ran: true,
    semantic_regeneration_final_rejection:
      "profile_transition_evidence_closure_violation",
    canonical_sequence_indexes: [890, 892],
    leaking_field_sequence_indexes: [891, 892],
    reason:
      "The regenerated independence_interpretability field cited tutor turn 891 outside the canonical top-level evidence set."
  },
  controls: {
    case_7: "passed_teacher_assistance_control",
    case_8: "passed_changed_claim_control"
  }
} as const;

export const FORMATIVE_CONVERSATION_V17_LEGACY_CONTRACT_PATHS = [
  {
    path: "src/lib/services/student-assessment/formative-conversation/agent-contract.ts",
    role: "historical_v16_v17_schema_accepts_and_emits_sequence_and_closure_fields"
  },
  {
    path: "src/lib/services/student-assessment/formative-conversation/candidate-validation.ts",
    role: "historical_v17_candidate_compatibility_and_legacy_field_rejection"
  },
  {
    path: "src/lib/services/student-assessment/formative-conversation/profile-transition-validator.ts",
    role: "historical_sequence_index_transition_validation"
  },
  {
    path: "src/lib/services/student-assessment/formative-conversation/transition-evidence-closure.ts",
    role: "historical_sequence_index_evidence_closure"
  },
  {
    path: "src/lib/services/student-assessment/formative-conversation/misconception-evidence-closure.ts",
    role: "historical_v16_text_claim_closure"
  },
  {
    path: "src/lib/services/student-assessment/formative-conversation/misconception-claim-closure-v2.ts",
    role: "historical_v17_claim_disposition_sequence_validation"
  },
  {
    path: "src/lib/services/student-assessment/formative-conversation/profile-update.ts",
    role: "historical_snapshot_reader_and_writer_compatibility"
  },
  {
    path: "src/lib/services/student-assessment/formative-conversation/evidence-references.ts",
    role: "historical_sequence_index_evidence_projection"
  },
  {
    path: "src/lib/services/student-assessment/formative-conversation/semantic-regeneration.ts",
    role: "historical_v16_v17_semantic_regeneration_contract"
  },
  {
    path: "src/lib/services/student-assessment/formative-conversation/runtime.ts",
    role: "explicit_schema_version_dispatch_for_historical_persisted_records_and_test_replay"
  }
] as const;
