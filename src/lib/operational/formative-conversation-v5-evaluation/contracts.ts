import { z } from "zod";
import { StudentProfileOutput } from "@/lib/agents/contracts";
import {
  SyntheticStudentPersonaIdSchema
} from "@/lib/evaluation/synthetic-student-validation/contracts";

export const FORMATIVE_CONVERSATION_V5_EXECUTABLE_REVISION =
  "formative-conversation-host-v5-executable-v2";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION =
  "formative-conversation-v5-protocol-runner-v1";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v2";
export const FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/candidate-manifest.json`;
export const FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/candidate-identity.json`;
export const FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/executable-evaluation-protocol.json`;
export const FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/source-configuration.json`;
export const FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/fixture-manifest.json`;
export const FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/approval-evidence-placeholder.json`;
export const FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation/plans";
export const FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation/runs";

export const FORMATIVE_CONVERSATION_V5_CASE_ORDER = [
  "fcv5_01_assistant_first_opening",
  "fcv5_02_first_principles_adaptation",
  "fcv5_03_direct_answer_handling",
  "fcv5_04_related_concept_discussion",
  "fcv5_05_sound_profile_transition",
  "fcv5_06_largely_improved_temporal",
  "fcv5_07_persistent_barrier_teacher_assistance",
  "fcv5_08_mixed_resolved_evidence"
] as const;

export const FormativeConversationV5CaseIdSchema = z.enum(
  FORMATIVE_CONVERSATION_V5_CASE_ORDER
);
export type FormativeConversationV5CaseId = z.infer<
  typeof FormativeConversationV5CaseIdSchema
>;

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const OptionSchema = z
  .object({
    label: z.enum(["A", "B", "C"]),
    text: z.string().min(1)
  })
  .strict();

const ItemSnapshotSchema = z
  .object({
    item_alias: z.enum([
      "measurement_reliability",
      "standard_error_measurement",
      "validity_argument"
    ]),
    item_order: z.number().int().min(1).max(3),
    item_stem: z.string().min(1),
    options: z.array(OptionSchema).length(3),
    correct_option: z.enum(["A", "B", "C"]),
    answer_explanation: z.string().min(1),
    distractor_rationales: z.record(z.string(), z.string()),
    expected_reasoning_patterns: z.array(z.string().min(1)).min(1),
    item_version: z.literal(1)
  })
  .strict();

const NavigationObservationSchema = z
  .object({
    event_type: z.enum([
      "page_hidden",
      "page_visible",
      "window_blur",
      "window_focus",
      "navigation_event"
    ]),
    offset_ms: z.number().int().nonnegative(),
    observed_interval_duration_ms: z
      .number()
      .int()
      .nonnegative()
      .nullable()
  })
  .strict();

const AssessmentResponseSchema = z
  .object({
    item_number: z.number().int().min(1).max(3),
    selected_option: z.enum(["A", "B", "C"]),
    prior_option_selections: z.array(z.enum(["A", "B", "C"])).max(4),
    tempting_option: z.enum(["A", "B", "C"]).nullable(),
    tempting_option_reason: z.string().min(1).nullable(),
    reasoning_text: z.string().min(1).max(4_000),
    confidence_rating: z.enum(["low", "medium", "high"]),
    response_time_ms: z.number().int().positive(),
    time_to_first_action_ms: z.number().int().nonnegative(),
    reasoning_revision_count: z.number().int().nonnegative(),
    navigation_observations: z.array(NavigationObservationSchema).max(12)
  })
  .strict();

const StudentMessageSchema = z
  .object({
    sequence: z.number().int().positive(),
    intent: z.enum([
      "explanation_request",
      "clarification_request",
      "example_request",
      "direct_answer_request",
      "reflection",
      "extension_request"
    ]),
    message_text: z.string().min(1).max(5_000),
    observable_input_telemetry: z
      .object({
        response_time_ms: z.number().int().positive(),
        typing_duration_ms: z.number().int().nonnegative(),
        edit_count: z.number().int().nonnegative(),
        backspace_count: z.number().int().nonnegative(),
        paste_event_count: z.number().int().nonnegative(),
        paste_character_count: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();

const InitialProfileSourceSchema = z
  .object({
    mode: z.literal("frozen_validated_profile_context"),
    production_schema_version: z.literal("student-profile-output-v2"),
    generated_by_provider: z.literal(false),
    evidence_consistency: z
      .object({
        version: z.literal("student-profile-evidence-consistency-v1"),
        classification: z.enum([
          "coherent",
          "mixed_resolved",
          "mixed_unresolved",
          "insufficient"
        ]),
        supporting_references: z.array(z.string().min(1)).min(1)
      })
      .strict(),
    profile: StudentProfileOutput
  })
  .strict();

const LogicalCallSchema = z
  .object({
    sequence: z.number().int().positive(),
    call_type: z.enum([
      "assistant_first_opening",
      "student_message_response"
    ]),
    student_message_sequence: z.number().int().positive().nullable(),
    logical_call_issued_once: z.literal(true)
  })
  .strict();

const AssertionSchema = z
  .object({
    assertion_id: z.string().regex(/^[a-z0-9_]+$/),
    description: z.string().min(1),
    severity: z.enum(["blocking", "human_review"]),
    evaluation_method: z.enum([
      "deterministic_artifact_check",
      "human_review"
    ])
  })
  .strict();

export const FormativeConversationV5FixtureSchema = z
  .object({
    fixture_version: z.literal(
      "formative-conversation-v5-executable-fixture-v1"
    ),
    case_id: FormativeConversationV5CaseIdSchema,
    case_order: z.number().int().min(1).max(8),
    title: z.string().min(1),
    execution_persona_id: SyntheticStudentPersonaIdSchema,
    synthetic_only: z.literal(true),
    real_student_information_present: z.literal(false),
    expected_outcome_in_runtime_input: z.literal(false),
    synthetic_identity: z
      .object({
        namespace_template: z.string().min(1),
        assessment_identity_template: z.string().min(1),
        session_identity_template: z.string().min(1),
        student_identity_template: z.string().min(1)
      })
      .strict(),
    assessment: z
      .object({
        title: z.string().min(1),
        concept_title: z.string().min(1),
        learning_objective: z.string().min(1),
        assessment_boundary: z.string().min(1),
        administered_items: z.array(ItemSnapshotSchema).length(3)
      })
      .strict(),
    assessment_responses: z.array(AssessmentResponseSchema).length(3),
    observable_process_telemetry_policy: z
      .object({
        raw_observations_only: z.literal(true),
        inferred_behavior_fields_absent: z.literal(true),
        source: z.literal("frozen_synthetic_fixture")
      })
      .strict(),
    initial_profile_source: InitialProfileSourceSchema,
    student_messages: z.array(StudentMessageSchema).max(10),
    case_assertions: z.array(AssertionSchema).min(1),
    permitted_terminal_outcomes: z
      .array(
        z.enum([
          "continue_conversation",
          "sound_understanding",
          "largely_improved_understanding",
          "teacher_assistance_recommended"
        ])
      )
      .min(1),
    required_provenance: z.array(z.string().min(1)).min(1),
    call_graph: z
      .object({
        production_student_profiling_called: z.literal(false),
        frozen_initial_profile_context_persisted: z.literal(true),
        assistant_first_opening_called: z.literal(true),
        student_message_count: z.number().int().nonnegative(),
        logical_calls: z.array(LogicalCallSchema).min(1),
        expected_logical_calls: z.number().int().positive(),
        maximum_logical_calls: z.number().int().positive(),
        allowed_provider_attempts_per_logical_call: z.literal(3),
        maximum_transport_retries_per_logical_call: z.literal(2),
        terminal_condition: z.string().min(1),
        persistence_requirements: z.array(z.string().min(1)).min(1),
        evaluation_steps: z.array(z.string().min(1)).min(1)
      })
      .strict(),
    fixture_hash: HashSchema
  })
  .strict();

const FixtureReferenceSchema = z
  .object({
    case_id: FormativeConversationV5CaseIdSchema,
    order: z.number().int().min(1).max(8),
    path: z.string().min(1),
    fixture_hash: HashSchema,
    file_sha256: HashSchema
  })
  .strict();

export const FormativeConversationV5FixtureManifestSchema = z
  .object({
    manifest_version: z.literal(
      "formative-conversation-v5-fixture-manifest-v1"
    ),
    fixture_hash_semantics: z.literal(
      "stable_hash_of_fixture_with_fixture_hash_omitted"
    ),
    fixture_count: z.literal(8),
    fixed_case_order: z.array(FormativeConversationV5CaseIdSchema).length(8),
    fixtures: z.array(FixtureReferenceSchema).length(8),
    aggregate_fixture_hash: HashSchema,
    execution_engine: z.literal(
      FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION
    ),
    forbidden_runner_substitutions: z
      .array(
        z.enum([
          "operational_model_upgrade_legacy_21_case_runner",
          "synthetic_student_persona_cli"
        ])
      )
      .length(2)
  })
  .strict();

export const FormativeConversationV5BudgetSchema = z
  .object({
    expected_logical_call_count: z.literal(21),
    maximum_logical_call_count: z.literal(21),
    expected_provider_attempt_count: z.literal(21),
    maximum_provider_attempt_count: z.literal(63),
    maximum_transport_retries_per_logical_call: z.literal(2),
    maximum_input_token_count: z.literal(900_000),
    maximum_output_token_count: z.literal(73_500),
    maximum_total_token_count: z.literal(973_500),
    maximum_wall_clock_duration_ms: z.literal(7_200_000),
    maximum_concurrency: z.literal(1),
    maximum_cost_usd: z.literal(30),
    pricing_metadata_status: z.literal("unavailable"),
    cost_enforcement: z.literal(
      "operator_ceiling_required_actual_estimate_recorded_when_available"
    )
  })
  .strict();

export const FormativeConversationV5ProtocolSchema = z
  .object({
    protocol_version: z.literal(
      "formative-conversation-host-v5-executable-evaluation-v2"
    ),
    protocol_status: z.literal("frozen_executable_not_run"),
    no_provider_call_during_freeze: z.literal(true),
    candidate_manifest_path: z.literal(
      FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH
    ),
    fixture_manifest_path: z.literal(
      FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH
    ),
    target_role: z.literal("formative_conversation_agent"),
    prior_incomplete_protocol: z
      .object({
        path: z.literal(
          "config/operational-candidates/formative-conversation-host-v5/evaluation-protocol.json"
        ),
        protocol_hash: HashSchema,
        preserved: z.literal(true),
        executable: z.literal(false),
        approval_eligible: z.literal(false)
      })
      .strict(),
    target_identity: z
      .object({
        runtime_candidate_hash: HashSchema,
        model_snapshot: z.literal("gpt-5.6-sol"),
        reasoning_effort: z.literal("medium"),
        max_output_tokens: z.literal(3500),
        prompt_version: z.literal("formative-conversation-host-v5"),
        prompt_hash: HashSchema,
        schema_version: z.literal(
          "formative-conversation-agent-contract-v1"
        ),
        context_version: z.literal(
          "formative-conversation-context-v1"
        ),
        safety_version: z.literal(
          "formative-conversation-safety-boundary-v1"
        ),
        memory_version: z.literal(
          "formative-conversation-memory-v1"
        ),
        opening_validator_version: z.literal(
          "formative-conversation-opening-v1"
        )
      })
      .strict(),
    execution_policy: z
      .object({
        runner_version: z.literal(
          FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION
        ),
        fixed_case_order: z
          .array(FormativeConversationV5CaseIdSchema)
          .length(8),
        fresh_isolated_session_per_case: z.literal(true),
        frozen_student_messages_only: z.literal(true),
        second_llm_student_forbidden: z.literal(true),
        logical_call_issued_once: z.literal(true),
        manual_case_rerun_permitted: z.literal(false),
        selective_case_rerun_permitted: z.literal(false),
        continue_after_case_failure: z.literal(true),
        prior_evidence_immutable: z.literal(true),
        case_statuses: z
          .array(
            z.enum(["passed", "failed", "invalid", "not_exercised"])
          )
          .length(4)
      })
      .strict(),
    runner_implementation: z
      .object({
        aggregate_hash: HashSchema,
        files: z
          .array(
            z
              .object({
                role: z.enum([
                  "cli",
                  "orchestration_service",
                  "candidate_transport_runner",
                  "package_validator",
                  "contract_schemas"
                ]),
                path: z.string().min(1),
                sha256: HashSchema
              })
              .strict()
          )
          .length(5)
      })
      .strict(),
    budget: FormativeConversationV5BudgetSchema,
    isolation: z
      .object({
        mechanism: z.literal(
          "existing_synthetic_research_validation_namespace"
        ),
        provider_run_id_template: z.string().min(1),
        derived_evaluation_id_template: z.string().min(1),
        run_namespace_template: z.string().min(1),
        case_namespace_template: z.string().min(1),
        classroom_collision_forbidden: z.literal(true),
        ordinary_teacher_summary_inclusion_forbidden: z.literal(true),
        export_markers_required: z.literal(true),
        retention_policy: z.literal(
          "retain_by_default_cleanup_only_by_explicit_run_id"
        ),
        approval_activation_forbidden: z.literal(true)
      })
      .strict(),
    live_authorization_template: z.string().min(1),
    required_live_environment_flag: z.literal(
      "FORMATIVE_CONVERSATION_V5_LIVE_EVALUATION_ENABLED=true"
    ),
    intended_artifacts: z.array(z.string().min(1)).length(8),
    artifact_contract: z
      .object({
        contract_version: z.literal(
          "formative-conversation-v5-live-artifact-contract-v1"
        ),
        source_provider_run_required_fields: z
          .array(z.string().min(1))
          .min(1),
        per_case_required_fields: z.array(z.string().min(1)).min(1),
        human_review_required_fields: z
          .array(z.string().min(1))
          .min(1),
        prohibited_fields: z.array(z.string().min(1)).min(1),
        artifact_hash_manifest_required: z.literal(true),
        all_student_visible_tutor_outputs_in_human_review: z.literal(
          true
        )
      })
      .strict(),
    approval_boundaries: z
      .object({
        automatic_approval_permitted: z.literal(false),
        activation_permitted: z.literal(false),
        render_update_permitted: z.literal(false),
        human_review_required: z.literal(true),
        all_student_visible_outputs_require_review: z.literal(true)
      })
      .strict()
  })
  .strict();

export const FormativeConversationV5CandidateManifestSchema = z
  .object({
    manifest_version: z.literal(
      "formative-conversation-host-v5-executable-candidate-revision-v2"
    ),
    approval_state: z.literal("candidate_not_approved"),
    activation_permitted: z.literal(false),
    runtime_behavior_changed: z.literal(false),
    source_candidate_manifest: z
      .object({
        path: z.literal(
          "config/operational-candidates/formative-conversation-host-v5/candidate-manifest.json"
        ),
        canonical_hash: HashSchema,
        file_sha256: HashSchema
      })
      .strict(),
    runtime_candidate_hash: HashSchema,
    runtime_candidate_hash_unchanged: z.literal(true),
    executable_protocol_path: z.literal(
      FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH
    ),
    fixture_manifest_path: z.literal(
      FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH
    ),
    target_role: z.literal("formative_conversation_agent"),
    target_role_identity: z.record(z.string(), z.unknown()),
    preserved_active_runtime_hash: HashSchema,
    preserved_rollback_runtime_hash: HashSchema,
    prior_incomplete_protocol_hash: HashSchema
  })
  .strict();

export const FormativeConversationV5ApprovalPlaceholderSchema = z
  .object({
    artifact_version: z.literal(
      "formative-conversation-v5-executable-approval-placeholder-v1"
    ),
    artifact_state: z.literal("placeholder_not_approval_evidence"),
    runtime_candidate_hash: HashSchema,
    evaluation_protocol_hash: HashSchema,
    provider_evaluation: z
      .object({
        status: z.literal("not_run"),
        source_provider_run_id: z.null(),
        derived_evaluation_id: z.null()
      })
      .strict(),
    human_review: z
      .object({
        status: z.literal("not_started"),
        student_facing_outputs_reviewed: z.literal(false),
        decision: z.null()
      })
      .strict(),
    approval: z
      .object({
        eligible: z.literal(false),
        approved_at: z.null(),
        approval_evidence_hash: z.null()
      })
      .strict(),
    activation: z
      .object({
        permitted: z.literal(false),
        activated_at: z.null()
      })
      .strict()
  })
  .strict();

export type FormativeConversationV5Fixture = z.infer<
  typeof FormativeConversationV5FixtureSchema
>;
export type FormativeConversationV5Protocol = z.infer<
  typeof FormativeConversationV5ProtocolSchema
>;
export type FormativeConversationV5FixtureManifest = z.infer<
  typeof FormativeConversationV5FixtureManifestSchema
>;
