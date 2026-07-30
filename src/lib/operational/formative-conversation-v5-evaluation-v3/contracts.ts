import { z } from "zod";
import { StudentProfileOutput } from "@/lib/agents/contracts";

export const FORMATIVE_CONVERSATION_V5_EXECUTABLE_REVISION =
  "formative-conversation-host-v5-executable-v3";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION =
  "formative-conversation-v5-protocol-runner-v2";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v3";
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
export const FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/compiled-execution-plan.json`;
export const FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/approval-evidence-placeholder.json`;
export const FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v3/plans";
export const FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v3/runs";
export const FORMATIVE_CONVERSATION_V5_V2_DISPATCH_PATH =
  ".data/operational-formative-conversation-v5-evaluation/runs/dispatch/7e69059ad46bd60cc0e3eccb22442a98027e93d93d329ea1724bd23948f6c85a.json";

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

export const FormativeConversationV5ExecutionSubjectIdSchema = z.enum([
  "correct_shallow",
  "help_seeking_confused",
  "strategic_answerer",
  "high_performing_extension",
  "sudden_improvement",
  "confident_misconception",
  "persistent_non_improvement",
  "fragmented_inconsistent"
]);

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const Sha40Schema = z.string().regex(/^[a-f0-9]{40}$/);

const OptionSchema = z
  .object({
    label: z.enum(["A", "B", "C"]),
    text: z.string().min(1)
  })
  .strict();

export const FormativeConversationV5ItemSnapshotSchema = z
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

export const FormativeConversationV5AssessmentResponseSchema = z
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

const FormativeConversationV5StudentIntentSchema = z.enum([
  "explanation_request",
  "clarification_request",
  "example_request",
  "direct_answer_request",
  "reflection",
  "extension_request"
]);

export const FormativeConversationV5StudentMessageSchema = z
  .object({
    sequence: z.number().int().positive(),
    intent: FormativeConversationV5StudentIntentSchema,
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

const FixtureCommonShape = {
  fixture_version: z.literal(
    "formative-conversation-v5-executable-fixture-v2"
  ),
  case_id: FormativeConversationV5CaseIdSchema,
  case_order: z.number().int().min(1).max(8),
  title: z.string().min(1),
  execution_subject_id:
    FormativeConversationV5ExecutionSubjectIdSchema,
  synthetic_only: z.literal(true),
  real_student_information_present: z.literal(false),
  expected_outcome_in_runtime_input: z.literal(false),
  opening_executed: z.literal(true),
  expected_student_message_count: z.number().int().nonnegative().max(10),
  expected_logical_call_count: z.number().int().positive().max(11),
  terminal_execution_point: z.enum([
    "opening_persisted_or_typed_failure",
    "ordered_student_messages_exhausted",
    "profile_transition_evaluated_after_messages"
  ]),
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
      administered_items: z
        .array(FormativeConversationV5ItemSnapshotSchema)
        .length(3)
    })
    .strict(),
  assessment_responses: z
    .array(FormativeConversationV5AssessmentResponseSchema)
    .length(3),
  observable_process_telemetry_policy: z
    .object({
      raw_observations_only: z.literal(true),
      inferred_behavior_fields_absent: z.literal(true),
      source: z.literal("frozen_synthetic_fixture")
    })
    .strict(),
  initial_profile_source: InitialProfileSourceSchema,
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
};

const OpeningOnlyFixtureSchema = z
  .object({
    ...FixtureCommonShape,
    execution_case_type: z.literal("opening_only"),
    expected_student_message_count: z.literal(0),
    expected_logical_call_count: z.literal(1),
    terminal_execution_point: z.literal(
      "opening_persisted_or_typed_failure"
    ),
    student_messages: z
      .array(FormativeConversationV5StudentMessageSchema)
      .length(0)
  })
  .strict();

const SingleMessageFixtureSchema = z
  .object({
    ...FixtureCommonShape,
    execution_case_type: z.literal("single_message_conversation"),
    expected_student_message_count: z.literal(1),
    expected_logical_call_count: z.literal(2),
    terminal_execution_point: z.literal(
      "ordered_student_messages_exhausted"
    ),
    student_messages: z
      .array(FormativeConversationV5StudentMessageSchema)
      .length(1)
  })
  .strict();

const MultiMessageAdaptiveFixtureSchema = z
  .object({
    ...FixtureCommonShape,
    execution_case_type: z.literal("multi_message_adaptive"),
    terminal_execution_point: z.literal(
      "ordered_student_messages_exhausted"
    ),
    student_messages: z
      .array(FormativeConversationV5StudentMessageSchema)
      .min(2)
      .max(10)
  })
  .strict();

const ProfileTransitionFixtureSchema = z
  .object({
    ...FixtureCommonShape,
    execution_case_type: z.literal("profile_transition"),
    terminal_execution_point: z.literal(
      "profile_transition_evaluated_after_messages"
    ),
    student_messages: z
      .array(FormativeConversationV5StudentMessageSchema)
      .min(2)
      .max(10)
  })
  .strict();

const EXPECTED_CASE_SHAPES = {
  fcv5_01_assistant_first_opening: {
    execution_case_type: "opening_only",
    messages: 0
  },
  fcv5_02_first_principles_adaptation: {
    execution_case_type: "multi_message_adaptive",
    messages: 2
  },
  fcv5_03_direct_answer_handling: {
    execution_case_type: "single_message_conversation",
    messages: 1
  },
  fcv5_04_related_concept_discussion: {
    execution_case_type: "single_message_conversation",
    messages: 1
  },
  fcv5_05_sound_profile_transition: {
    execution_case_type: "profile_transition",
    messages: 2
  },
  fcv5_06_largely_improved_temporal: {
    execution_case_type: "profile_transition",
    messages: 2
  },
  fcv5_07_persistent_barrier_teacher_assistance: {
    execution_case_type: "profile_transition",
    messages: 3
  },
  fcv5_08_mixed_resolved_evidence: {
    execution_case_type: "profile_transition",
    messages: 2
  }
} as const;

export const FormativeConversationV5FixtureSchema = z
  .discriminatedUnion("execution_case_type", [
    OpeningOnlyFixtureSchema,
    SingleMessageFixtureSchema,
    MultiMessageAdaptiveFixtureSchema,
    ProfileTransitionFixtureSchema
  ])
  .superRefine((fixture, context) => {
    const expected = EXPECTED_CASE_SHAPES[fixture.case_id];
    const actualMessageCount = fixture.student_messages.length;
    const expectedLogicalCalls = 1 + actualMessageCount;
    const topLevelCountsMatch =
      fixture.expected_student_message_count === actualMessageCount &&
      fixture.expected_logical_call_count === expectedLogicalCalls;
    const callGraphCountsMatch =
      fixture.call_graph.student_message_count === actualMessageCount &&
      fixture.call_graph.expected_logical_calls ===
        expectedLogicalCalls &&
      fixture.call_graph.maximum_logical_calls ===
        expectedLogicalCalls &&
      fixture.call_graph.logical_calls.length === expectedLogicalCalls;
    if (
      fixture.execution_case_type !== expected.execution_case_type ||
      actualMessageCount !== expected.messages
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution_case_type"],
        message: `${fixture.case_id}:frozen_case_shape_mismatch`
      });
    }
    if (!topLevelCountsMatch || !callGraphCountsMatch) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expected_student_message_count"],
        message: `${fixture.case_id}:declared_actual_call_count_mismatch`
      });
    }
    if (
      !fixture.student_messages.every(
        (message, index) => message.sequence === index + 1
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["student_messages"],
        message: `${fixture.case_id}:student_message_order_invalid`
      });
    }
    if (
      fixture.student_messages.some(
        (message) =>
          (message.observable_input_telemetry.paste_event_count === 0) !==
          (message.observable_input_telemetry.paste_character_count === 0)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["student_messages"],
        message: `${fixture.case_id}:paste_telemetry_inconsistent`
      });
    }
    if (
      !fixture.assessment.administered_items.every(
        (item, index) => item.item_order === index + 1
      ) ||
      !fixture.assessment_responses.every(
        (response, index) => response.item_number === index + 1
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assessment"],
        message: `${fixture.case_id}:assessment_order_invalid`
      });
    }
    if (
      !fixture.call_graph.logical_calls.every(
        (call, index) =>
          call.sequence === index + 1 &&
          (index === 0
            ? call.call_type === "assistant_first_opening" &&
              call.student_message_sequence === null
            : call.call_type === "student_message_response" &&
              call.student_message_sequence === index)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["call_graph", "logical_calls"],
        message: `${fixture.case_id}:logical_call_order_invalid`
      });
    }
  });

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
      "formative-conversation-v5-fixture-manifest-v2"
    ),
    fixture_hash_semantics: z.literal(
      "stable_hash_of_fixture_with_fixture_hash_omitted"
    ),
    fixture_count: z.literal(8),
    fixed_case_order: z
      .array(FormativeConversationV5CaseIdSchema)
      .length(8),
    fixtures: z.array(FixtureReferenceSchema).length(8),
    aggregate_fixture_hash: HashSchema,
    execution_engine: z.literal(
      FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION
    ),
    frozen_case_schema: z.literal(
      "formative-conversation-v5-protocol-case-schema-v1"
    ),
    forbidden_runner_substitutions: z
      .array(
        z.enum([
          "operational_model_upgrade_legacy_21_case_runner",
          "synthetic_student_persona_cli",
          "synthetic_student_persona_schema"
        ])
      )
      .length(3)
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

const CompiledStudentMessageInputSchema = z
  .object({
    service: z.literal("processFormativeConversationStudentMessage"),
    sequence: z.number().int().positive(),
    client_message_id_template: z.string().min(1),
    conversation_public_id_binding: z.literal(
      "persisted_formative_conversation_public_id"
    ),
    student_user_db_id_binding: z.literal(
      "persisted_synthetic_student_user_db_id"
    ),
    message_text: z.string().min(1),
    intent_fixture_metadata:
      FormativeConversationV5StudentIntentSchema,
    observable_input_telemetry: z
      .object({
        response_time_ms: z.number().int().positive(),
        typing_duration_ms: z.number().int().nonnegative(),
        edit_count: z.number().int().nonnegative(),
        backspace_count: z.number().int().nonnegative(),
        paste_event_count: z.number().int().nonnegative(),
        paste_character_count: z.number().int().nonnegative(),
        timestamp_binding: z.literal(
          "derive_turn_and_typing_timestamps_at_submission"
        )
      })
      .strict()
  })
  .strict();

export const FormativeConversationV5CompiledCaseSchema = z
  .object({
    compiled_case_version: z.literal(
      "formative-conversation-v5-compiled-case-v1"
    ),
    case_id: FormativeConversationV5CaseIdSchema,
    case_order: z.number().int().min(1).max(8),
    title: z.string().min(1),
    fixture_hash: HashSchema,
    fixture_file_sha256: HashSchema,
    execution_case_type: z.enum([
      "opening_only",
      "single_message_conversation",
      "multi_message_adaptive",
      "profile_transition"
    ]),
    execution_subject_id:
      FormativeConversationV5ExecutionSubjectIdSchema,
    source_contract: z
      .object({
        synthetic_only: z.literal(true),
        real_student_information_present: z.literal(false),
        expected_outcome_in_runtime_input: z.literal(false),
        raw_observations_only: z.literal(true),
        inferred_behavior_fields_absent: z.literal(true)
      })
      .strict(),
    namespace: z
      .object({
        run_namespace_template: z.string().min(1),
        case_namespace_template: z.string().min(1),
        assessment_identity_template: z.string().min(1),
        session_identity_template: z.string().min(1),
        student_identity_template: z.string().min(1),
        collision_check_key: HashSchema
      })
      .strict(),
    assessment_fixture_input: z
      .object({
        assessment: FixtureCommonShape.assessment,
        responses: z
          .array(FormativeConversationV5AssessmentResponseSchema)
          .length(3),
        telemetry_policy:
          FixtureCommonShape.observable_process_telemetry_policy
      })
      .strict(),
    initial_profile_persistence_input: z
      .object({
        production_schema_version: z.literal(
          "student-profile-output-v2"
        ),
        generated_by_provider: z.literal(false),
        evidence_consistency:
          InitialProfileSourceSchema.shape.evidence_consistency,
        profile: StudentProfileOutput
      })
      .strict(),
    opening_input_template: z
      .object({
        service: z.literal("processFormativeConversationOpening"),
        execute: z.literal(true),
        conversation_public_id_binding: z.literal(
          "persisted_formative_conversation_public_id"
        ),
        context_seed_service: z.literal(
          "buildFormativeConversationRuntimeContextSeed"
        ),
        student_user_db_id_binding: z.literal(
          "persisted_synthetic_student_user_db_id"
        )
      })
      .strict(),
    student_message_input_templates: z.array(
      CompiledStudentMessageInputSchema
    ),
    call_graph: z
      .object({
        opening_executed: z.literal(true),
        opening_call_count: z.literal(1),
        declared_student_message_count: z.number().int().nonnegative(),
        actual_student_message_count: z.number().int().nonnegative(),
        student_message_call_count: z.number().int().nonnegative(),
        profiling_call_count: z.literal(0),
        declared_expected_logical_call_count: z
          .number()
          .int()
          .positive(),
        expected_logical_call_count: z.number().int().positive(),
        maximum_logical_call_count: z.number().int().positive(),
        logical_calls: z.array(LogicalCallSchema).min(1),
        terminal_execution_point:
          FixtureCommonShape.terminal_execution_point,
        terminal_condition: z.string().min(1)
      })
      .strict(),
    evaluation_contract: z
      .object({
        case_assertions: z.array(AssertionSchema).min(1),
        permitted_terminal_outcomes:
          FixtureCommonShape.permitted_terminal_outcomes,
        required_provenance:
          FixtureCommonShape.required_provenance,
        persistence_requirements:
          FixtureCommonShape.call_graph.shape.persistence_requirements,
        evaluation_steps:
          FixtureCommonShape.call_graph.shape.evaluation_steps
      })
      .strict(),
    consumed_fixture_fields: z.array(z.string().min(1)).min(1),
    compilation_status: z.literal("compiled")
  })
  .strict();

export const FormativeConversationV5CompiledPlanSchema = z
  .object({
    compiled_plan_version: z.literal(
      "formative-conversation-v5-compiled-execution-plan-v1"
    ),
    compilation_status: z.literal("ready_for_dispatch"),
    runtime_candidate_hash: HashSchema,
    evaluation_protocol_hash: HashSchema,
    runner_implementation_hash: HashSchema,
    fixture_manifest_hash: HashSchema,
    aggregate_fixture_hash: HashSchema,
    fixed_case_order: z
      .array(FormativeConversationV5CaseIdSchema)
      .length(8),
    cases: z
      .array(FormativeConversationV5CompiledCaseSchema)
      .length(8),
    aggregate_call_graph: z
      .object({
        opening_call_count: z.literal(8),
        student_message_call_count: z.literal(13),
        profiling_call_count: z.literal(0),
        expected_logical_call_count: z.literal(21),
        maximum_logical_call_count: z.literal(21),
        maximum_provider_attempt_count: z.literal(63)
      })
      .strict(),
    budget: FormativeConversationV5BudgetSchema,
    isolated_namespaces: z.array(z.string().min(1)).length(8),
    intended_output_artifact_locations: z
      .array(z.string().min(1))
      .min(1),
    approval_inactive: z.literal(true),
    activation_permitted: z.literal(false),
    provider_calls_during_compilation: z.literal(0),
    network_requests_to_provider_during_compilation: z.literal(0),
    compiled_plan_hash: HashSchema
  })
  .strict();

export const FormativeConversationV5ProtocolSchema = z
  .object({
    protocol_version: z.literal(
      "formative-conversation-host-v5-executable-evaluation-v3"
    ),
    protocol_status: z.literal("frozen_executable_not_run"),
    no_provider_call_during_freeze: z.literal(true),
    candidate_manifest_path: z.literal(
      FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH
    ),
    fixture_manifest_path: z.literal(
      FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH
    ),
    compiled_execution_plan_path: z.literal(
      FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH
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
    failed_v2_execution: z
      .object({
        protocol_hash: z.literal(
          "7e69059ad46bd60cc0e3eccb22442a98027e93d93d329ea1724bd23948f6c85a"
        ),
        provider_run_id: z.literal(
          "fcv5_provider_20260730065909_a48dd06a"
        ),
        derived_evaluation_id: z.literal(
          "fcv5_derived_20260730065909_51ed25da"
        ),
        dispatch_checkpoint_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V2_DISPATCH_PATH
        ),
        dispatch_checkpoint_sha256: z.literal(
          "1ddbe8504f0a86205b5793e114bbf03dbe15c687c95aa523e633f3662a94f824"
        ),
        execution_status: z.literal("not_exercised"),
        approval_eligible: z.literal(false),
        rerunnable: z.literal(false),
        preserved_immutable: z.literal(true)
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
        protocol_specific_case_schema_required: z.literal(true),
        shared_persona_schema_forbidden: z.literal(true),
        full_compilation_before_dispatch_required: z.literal(true),
        plan_live_compilation_parity_required: z.literal(true),
        checkpoint_immediately_before_first_generation_request: z.literal(
          true
        ),
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
                  "contract_schemas",
                  "case_compiler",
                  "production_execution_harness"
                ]),
                path: z.string().min(1),
                sha256: HashSchema
              })
              .strict()
          )
          .length(7)
      })
      .strict(),
    budget: FormativeConversationV5BudgetSchema,
    isolation: z
      .object({
        mechanism: z.literal(
          "protocol_specific_synthetic_research_validation_namespace"
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
      "FORMATIVE_CONVERSATION_V5_V3_LIVE_EVALUATION_ENABLED=true"
    ),
    intended_artifacts: z.array(z.string().min(1)).length(8),
    artifact_contract: z
      .object({
        contract_version: z.literal(
          "formative-conversation-v5-live-artifact-contract-v2"
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
      "formative-conversation-host-v5-executable-candidate-revision-v3"
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
    compiled_execution_plan_path: z.literal(
      FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH
    ),
    target_role: z.literal("formative_conversation_agent"),
    target_role_identity: z.record(z.string(), z.unknown()),
    preserved_active_runtime_hash: HashSchema,
    preserved_rollback_runtime_hash: HashSchema,
    prior_incomplete_protocol_hash: HashSchema,
    failed_v2_protocol_hash: z.literal(
      "7e69059ad46bd60cc0e3eccb22442a98027e93d93d329ea1724bd23948f6c85a"
    )
  })
  .strict();

export const FormativeConversationV5ApprovalPlaceholderSchema = z
  .object({
    artifact_version: z.literal(
      "formative-conversation-v5-executable-approval-placeholder-v2"
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
export type FormativeConversationV5CompiledCase = z.infer<
  typeof FormativeConversationV5CompiledCaseSchema
>;
export type FormativeConversationV5CompiledPlan = z.infer<
  typeof FormativeConversationV5CompiledPlanSchema
>;
export type FormativeConversationV5ExecutionSubjectId = z.infer<
  typeof FormativeConversationV5ExecutionSubjectIdSchema
>;

export const FormativeConversationV5CandidateIdentitySchema = z
  .object({
    artifact_version: z.literal(
      "formative-conversation-v5-executable-candidate-identity-v2"
    ),
    approval_state: z.literal("candidate_not_approved"),
    activation_permitted: z.literal(false),
    no_provider_call_during_freeze: z.literal(true),
    runtime_candidate_hash: HashSchema,
    runtime_candidate_hash_unchanged: z.literal(true),
    source_candidate_manifest_hash: HashSchema,
    candidate_revision_manifest_hash: HashSchema,
    candidate_revision_manifest_sha256: HashSchema,
    executable_evaluation_protocol_hash: HashSchema,
    executable_evaluation_protocol_sha256: HashSchema,
    runner_implementation_hash: HashSchema,
    fixture_manifest_hash: HashSchema,
    fixture_manifest_sha256: HashSchema,
    aggregate_fixture_hash: HashSchema,
    compiled_execution_plan_hash: HashSchema,
    compiled_execution_plan_sha256: HashSchema,
    source_configuration_hash: HashSchema,
    source_configuration_sha256: HashSchema,
    approval_placeholder_sha256: HashSchema,
    preserved_incomplete_protocol_hash: HashSchema,
    preserved_active_runtime_hash: HashSchema,
    preserved_rollback_runtime_hash: HashSchema,
    candidate_active_configuration_hash: HashSchema,
    failed_v2_protocol_hash: HashSchema,
    failed_v2_checkpoint_sha256: HashSchema,
    source_application_git_commit: Sha40Schema
  })
  .strict();

export const FormativeConversationV5SourceConfigurationSchema = z
  .object({
    artifact_version: z.literal(
      "formative-conversation-v5-executable-source-configuration-v2"
    ),
    captured_from_application_git_commit: Sha40Schema,
    source_candidate_manifest: z
      .object({
        path: z.string().min(1),
        canonical_hash: HashSchema,
        file_sha256: HashSchema
      })
      .strict(),
    source_runtime_identity: z
      .object({
        runtime_candidate_hash: HashSchema,
        candidate_active_configuration_hash: HashSchema,
        role_count: z.literal(18)
      })
      .strict(),
    target_role_configuration: z.record(z.string(), z.unknown()),
    required_environment: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()])
    ),
    preserved_governance: z
      .object({
        active_runtime_hash: HashSchema,
        rollback_runtime_hash: HashSchema,
        rollback_manifest_sha256: HashSchema,
        prior_incomplete_protocol_path: z.string().min(1),
        prior_incomplete_protocol_hash: HashSchema,
        prior_incomplete_protocol_file_sha256: HashSchema,
        failed_v2_protocol_hash: HashSchema,
        failed_v2_provider_run_id: z.string().min(1),
        failed_v2_derived_evaluation_id: z.string().min(1),
        failed_v2_dispatch_checkpoint_path: z.string().min(1),
        failed_v2_dispatch_checkpoint_sha256: HashSchema
      })
      .strict(),
    source_code_references: z.record(z.string(), z.string().min(1))
  })
  .strict();
