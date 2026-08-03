import { z } from "zod";
import { StudentProfileOutput } from "@/lib/agents/contracts";
import {
  FORMATIVE_CONVERSATION_V11_CONTROL_SCHEMA_VERSION,
  FORMATIVE_CONVERSATION_V11_PREVENTIVE_SCANNER_VERSION,
  FORMATIVE_CONVERSATION_V11_RELEASE_POLICY_VERSION,
  FORMATIVE_CONVERSATION_V11_SCAN_ATTESTATION_SCHEMA_FINGERPRINT,
  FORMATIVE_CONVERSATION_V11_SCAN_ATTESTATION_VERSION,
  FORMATIVE_CONVERSATION_V11_SECURITY_WRAPPER_VERSION
} from "./security-release";

export const FORMATIVE_CONVERSATION_V5_EXECUTABLE_REVISION =
  "formative-conversation-host-v5-executable-v11";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION =
  "formative-conversation-v5-protocol-runner-v11";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v11";
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
export const FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/live-environment-contract.json`;
export const FORMATIVE_CONVERSATION_V5_V4_FAILURE_EVIDENCE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/preserved-v4-pre-dispatch-failure.json`;
export const FORMATIVE_CONVERSATION_V5_V5_FAILURE_ANALYSIS_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v5-failure-analysis.json`;
export const FORMATIVE_CONVERSATION_V5_V5_HUMAN_REVIEW_ADVISORY_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v5-human-review-advisory.json`;
export const FORMATIVE_CONVERSATION_V5_V6_FAILURE_ANALYSIS_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v6-failure-analysis.json`;
export const FORMATIVE_CONVERSATION_V5_V6_HUMAN_REVIEW_ADVISORY_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v6-human-review-advisory.json`;
export const FORMATIVE_CONVERSATION_V5_CASE7_EXACT_REPLAY_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/case7-exact-v5-output-replay.json`;
export const FORMATIVE_CONVERSATION_V5_CASE8_EXACT_REPLAY_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/case8-exact-v5-output-replay.json`;
export const FORMATIVE_CONVERSATION_V5_V7_CASE5_TRANSCRIPT_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/immutable-v7-case5-transcript.json`;
export const FORMATIVE_CONVERSATION_V5_V7_CASE7_TRANSCRIPT_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/immutable-v7-case7-transcript.json`;
export const FORMATIVE_CONVERSATION_V5_V7_CASE8_TRANSCRIPT_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/immutable-v7-case8-transcript.json`;
export const FORMATIVE_CONVERSATION_V5_V7_AGGREGATE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/immutable-v7-aggregate-evaluation.json`;
export const FORMATIVE_CONVERSATION_V5_V7_HASH_MANIFEST_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/immutable-v7-artifact-hash-manifest.json`;
export const FORMATIVE_CONVERSATION_V5_V7_FAILURE_ANALYSIS_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v7-failure-analysis.json`;
export const FORMATIVE_CONVERSATION_V5_V7_HUMAN_REVIEW_ADJUDICATION_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v7-human-review-adjudication.json`;
export const FORMATIVE_CONVERSATION_V5_V8_EVALUATION_EVIDENCE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/immutable-v8-evaluation-evidence.json`;
export const FORMATIVE_CONVERSATION_V5_V8_FAILURE_ANALYSIS_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v8-failure-analysis.json`;
export const FORMATIVE_CONVERSATION_V5_V8_HUMAN_REVIEW_ADVISORY_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v8-human-review-advisory.json`;
export const FORMATIVE_CONVERSATION_V5_V9_FAILURE_ANALYSIS_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v9-failure-analysis.json`;
export const FORMATIVE_CONVERSATION_V5_V9_HUMAN_REVIEW_ADVISORY_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v9-human-review-advisory.json`;
export const FORMATIVE_CONVERSATION_V5_V9_CASE4_SAFE_FAILURE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/immutable-v9-case4-safe-failure-evidence.json`;
export const FORMATIVE_CONVERSATION_V5_V9_CASE6_SAFE_FAILURE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/immutable-v9-case6-safe-failure-evidence.json`;
export const FORMATIVE_CONVERSATION_V5_V9_CASE7_TRANSITION_AUDIT_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/regressions/immutable-v9-case7-transition-audit.json`;
export const FORMATIVE_CONVERSATION_V5_V11_REMOTE_CANARY_EVIDENCE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/remote-database-canary-evidence.json`;
export const FORMATIVE_CONVERSATION_V5_V10_SECURITY_FAILURE_ANALYSIS_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/v10-security-wrapper-failure-analysis.json`;
export const FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v11/plans";
export const FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v11/runs";
export const FORMATIVE_CONVERSATION_V5_V2_DISPATCH_PATH =
  ".data/operational-formative-conversation-v5-evaluation/runs/dispatch/7e69059ad46bd60cc0e3eccb22442a98027e93d93d329ea1724bd23948f6c85a.json";
export const FORMATIVE_CONVERSATION_V5_V3_DISPATCH_PATH =
  ".data/operational-formative-conversation-v5-evaluation-v3/runs/dispatch/13186b2e5dc54486864b216292afd02774c832340a548c77585886a53c7642b5.json";
export const FORMATIVE_CONVERSATION_V5_V3_RUN_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v3/runs/fcv5v3_provider_20260730082804_8bf128c4";
export const FORMATIVE_CONVERSATION_V5_V5_RUN_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v5/runs/fcv5v5_provider_20260730170219_4ac51142";
export const FORMATIVE_CONVERSATION_V5_V5_DISPATCH_PATH =
  ".data/operational-formative-conversation-v5-evaluation-v5/runs/dispatch/7b42d2b1ffd3c5cfa1bef52cf60759b6eea7e891327077144d81e7f09788aa4c.json";
export const FORMATIVE_CONVERSATION_V5_V6_RUN_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v6/runs/fcv5v6_provider_20260731032817_863a9cdd";
export const FORMATIVE_CONVERSATION_V5_V6_DISPATCH_PATH =
  ".data/operational-formative-conversation-v5-evaluation-v6/runs/dispatch/8dfc63e32166f9117b4cebef550d22bdc81e1b9f3377f5843d50c2dee679b625.json";

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
        expectedLogicalCalls + 1 &&
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
      "formative-conversation-v5-fixture-manifest-v11"
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
    maximum_logical_call_count: z.literal(29),
    expected_provider_attempt_count: z.literal(21),
    maximum_provider_attempt_count: z.literal(87),
    maximum_semantic_regenerations_per_agent_call: z.literal(1),
    maximum_semantic_regeneration_count: z.literal(8),
    maximum_transport_retries_per_logical_call: z.literal(2),
    maximum_input_token_count: z.literal(900_000),
    maximum_output_token_count: z.literal(101_500),
    maximum_total_token_count: z.literal(1_001_500),
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
    live_environment_contract_hash: HashSchema,
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
        maximum_logical_call_count: z.literal(29),
        maximum_provider_attempt_count: z.literal(87)
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

export const FormativeConversationV5FailedV4PreDispatchEvidenceSchema = z
  .object({
    artifact_version: z.literal(
      "formative-conversation-v5-v4-pre-dispatch-evidence-v1"
    ),
    source_commit_sha: Sha40Schema,
    runtime_candidate_hash: z.literal(
      "a408b08c39aa614d967552e1fd321fabf0b83c96a3d83c82a7bd381fa8e899b3"
    ),
    protocol_hash: z.literal(
      "662a9e2e9ec2929147bd7ec0150708186f07e32ff2029f606de6b0e9d502c84e"
    ),
    source_plan_artifacts: z
      .array(
        z
          .object({
            path: z.string().min(1),
            sha256: HashSchema
          })
          .strict()
      )
      .length(2),
    sandbox_launcher_failure: z.literal("tsx_ipc_socket_eperm"),
    approved_execution_failure: z.literal(
      "approved_config_hash_mismatch"
    ),
    dispatch_checkpoint_created: z.literal(false),
    provider_run_created: z.literal(false),
    generation_request_created: z.literal(false),
    provider_calls: z.literal(0),
    secrets_displayed: z.literal(false),
    secrets_persisted: z.literal(false),
    preserved_immutable: z.literal(true),
    rerunnable: z.literal(false)
  })
  .strict();

export const FormativeConversationV5ProtocolSchema = z
  .object({
    protocol_version: z.literal(
      "formative-conversation-host-v5-executable-evaluation-v11"
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
    live_environment_contract_path: z.literal(
      FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH
    ),
    live_environment_contract_hash: HashSchema,
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
    failed_v3_execution: z
      .object({
        protocol_hash: z.literal(
          "13186b2e5dc54486864b216292afd02774c832340a548c77585886a53c7642b5"
        ),
        provider_run_id: z.literal(
          "fcv5v3_provider_20260730082804_8bf128c4"
        ),
        derived_evaluation_id: z.literal(
          "fcv5v3_derived_20260730082804_abbbd408"
        ),
        dispatch_checkpoint_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V3_DISPATCH_PATH
        ),
        dispatch_checkpoint_sha256: z.literal(
          "e5ffbe30eb61ce28013eda37e74bcd3717f9f1f563b641b7eb0480b49d580b9e"
        ),
        source_provider_run_sha256: z.literal(
          "02f85dc620059e24cc45a13aa5064fbef6087bcd997a31af6d3d46e0c2fe1e7d"
        ),
        derived_evaluation_sha256: z.literal(
          "5198a16fe570d82c1b074f0fca93e87d930706dd94968778174ece922a2438de"
        ),
        execution_status: z.literal("completed_failed"),
        approval_eligible: z.literal(false),
        rerunnable: z.literal(false),
        preserved_immutable: z.literal(true)
      })
      .strict(),
    failed_v4_pre_dispatch: z
      .object({
        source_commit_sha: Sha40Schema,
        runtime_candidate_hash: z.literal(
          "a408b08c39aa614d967552e1fd321fabf0b83c96a3d83c82a7bd381fa8e899b3"
        ),
        protocol_hash: z.literal(
          "662a9e2e9ec2929147bd7ec0150708186f07e32ff2029f606de6b0e9d502c84e"
        ),
        sandbox_launcher_failure: z.literal(
          "tsx_ipc_socket_eperm"
        ),
        live_environment_failure: z.literal(
          "approved_config_hash_mismatch"
        ),
        dispatch_checkpoint_created: z.literal(false),
        provider_run_created: z.literal(false),
        generation_request_created: z.literal(false),
        provider_calls: z.literal(0),
        source_plan_artifacts: z
          .array(
            z
              .object({
                path: z.string().min(1),
                sha256: HashSchema
              })
              .strict()
          )
          .length(2),
        evidence_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V4_FAILURE_EVIDENCE_PATH
        ),
        evidence_sha256: HashSchema,
        preserved_immutable: z.literal(true),
        rerunnable: z.literal(false)
      })
      .strict(),
    failed_v5_execution: z
      .object({
        frozen_commit: z.literal(
          "3b55bed5ff20831070c5d5ef1b1902aa77527236"
        ),
        runtime_candidate_hash: z.literal(
          "a408b08c39aa614d967552e1fd321fabf0b83c96a3d83c82a7bd381fa8e899b3"
        ),
        protocol_hash: z.literal(
          "7b42d2b1ffd3c5cfa1bef52cf60759b6eea7e891327077144d81e7f09788aa4c"
        ),
        provider_run_id: z.literal(
          "fcv5v5_provider_20260730170219_4ac51142"
        ),
        derived_evaluation_id: z.literal(
          "fcv5v5_derived_20260730170219_0a1eb734"
        ),
        dispatch_checkpoint_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V5_DISPATCH_PATH
        ),
        dispatch_checkpoint_sha256: z.literal(
          "1aceb19602ca99e5b26733a59cc565d2552d0a9f8d243e7a0243fcbd1ccdba4a"
        ),
        source_provider_run_path: z.string().min(1),
        source_provider_run_sha256: z.literal(
          "646e65e590cd3cc8369261f5f7033c1e5d59a6205280b15664027ef6bfe3538e"
        ),
        derived_evaluation_path: z.string().min(1),
        derived_evaluation_sha256: z.literal(
          "022dfd8466894fdc191a8371f6b79af822ac8f0c308723391a994c570ec61562"
        ),
        failure_analysis_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V5_FAILURE_ANALYSIS_PATH
        ),
        failure_analysis_sha256: HashSchema,
        human_review_advisory_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V5_HUMAN_REVIEW_ADVISORY_PATH
        ),
        human_review_advisory_sha256: HashSchema,
        execution_status: z.literal("completed_failed"),
        approval_eligible: z.literal(false),
        activation_permitted: z.literal(false),
        rerunnable: z.literal(false),
        preserved_immutable: z.literal(true)
      })
      .strict(),
    failed_v6_execution: z
      .object({
        frozen_commit: z.literal(
          "c33cb7123b0411e8dbfca6ffd95355a70f3292d0"
        ),
        runtime_candidate_hash: z.literal(
          "494ed38226f655c19429e0f54dc78c78239a6492f39895cd5231fc5d22a87f59"
        ),
        protocol_hash: z.literal(
          "8dfc63e32166f9117b4cebef550d22bdc81e1b9f3377f5843d50c2dee679b625"
        ),
        provider_run_id: z.literal(
          "fcv5v6_provider_20260731032817_863a9cdd"
        ),
        derived_evaluation_id: z.literal(
          "fcv5v6_derived_20260731032817_0bd6f382"
        ),
        dispatch_checkpoint_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V6_DISPATCH_PATH
        ),
        dispatch_checkpoint_sha256: z.literal(
          "8eef8a8af1e336abaed0a307487ff5f51a6535fd7c0a0b44dde12a0586d6d5f1"
        ),
        source_provider_run_path: z.string().min(1),
        source_provider_run_sha256: z.literal(
          "5df093a9bd4d7639636e6e0facc8cb3c19649bcabbc44479bc532eaa9e15eb34"
        ),
        derived_evaluation_path: z.string().min(1),
        derived_evaluation_sha256: z.literal(
          "b09f885149478e8a0160ce2337f25f1623f56427715ddb29cae575f95f86cc80"
        ),
        human_review_package_path: z.string().min(1),
        human_review_package_sha256: z.literal(
          "3420c91ddf69d027e0d9815283193d40fc17cd056865c9d5d27b641d0efc3a6f"
        ),
        failure_analysis_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V6_FAILURE_ANALYSIS_PATH
        ),
        failure_analysis_sha256: HashSchema,
        human_review_advisory_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V6_HUMAN_REVIEW_ADVISORY_PATH
        ),
        human_review_advisory_sha256: HashSchema,
        execution_status: z.literal("completed_failed"),
        passed: z.literal(5),
        failed: z.literal(3),
        invalid: z.literal(0),
        not_exercised: z.literal(0),
        approval_eligible: z.literal(false),
        activation_permitted: z.literal(false),
        rerunnable: z.literal(false),
        preserved_immutable: z.literal(true)
      })
      .strict(),
    failed_v7_execution: z
      .object({
        frozen_commit: z.literal(
          "c0c05b60755ab1b9b293c8e12a2ac5645a952c17"
        ),
        runtime_candidate_hash: z.literal(
          "81a60273d33976409e7450bffa6156e89a62e17e36edb7059e30c44979892356"
        ),
        protocol_hash: z.literal(
          "620ee46412f8ae4389014905249d8ce8fc1004ff55025ec5255bbd005ab6c68d"
        ),
        provider_run_id: z.literal(
          "fcv5v7_provider_20260801013024_27f671a7"
        ),
        derived_evaluation_id: z.literal(
          "fcv5v7_derived_20260801013024_4da7a38f"
        ),
        execution_status: z.literal("completed_failed"),
        passed: z.literal(3),
        failed: z.literal(5),
        invalid: z.literal(0),
        not_exercised: z.literal(0),
        approval_eligible: z.literal(false),
        activation_permitted: z.literal(false),
        rerunnable: z.literal(false),
        preserved_immutable: z.literal(true),
        immutable_evidence: z
          .array(
            z
              .object({
                path: z.string().min(1),
                sha256: HashSchema
              })
              .strict()
          )
          .length(5),
        root_cause_classification: z
          .object({
            cases_3_and_6: z.literal(
              "initial_profile_conversation_creation_transaction_expired"
            ),
            cases_5_7_and_8: z.literal(
              "profile_transition_persistence_transaction_expired"
            ),
            case_5_oracle: z.literal(
              "fixture_overconstrained_sound_with_unresolved_sem"
            )
          })
          .strict()
      })
      .strict(),
    failed_v8_execution: z
      .object({
        frozen_commit: z.literal(
          "afd7422b9e88c324b0150475ccd2954ebad86f8e"
        ),
        runtime_candidate_hash: z.literal(
          "132d69caab27b6e94f8bfa416c89d843da97676f41dcefb11c0e03ec95d3af80"
        ),
        protocol_hash: z.literal(
          "6359d96e27ed727e0eb1797f621bb08b4e6877f8065f5d6d7be6492a1d8eac15"
        ),
        provider_run_id: z.literal(
          "fcv5v8_provider_20260801134821_4d583c17"
        ),
        derived_evaluation_id: z.literal(
          "fcv5v8_derived_20260801134821_7de783d0"
        ),
        execution_status: z.literal("completed_failed"),
        passed: z.literal(6),
        failed: z.literal(2),
        invalid: z.literal(0),
        not_exercised: z.literal(0),
        actual_logical_calls: z.literal(18),
        expected_logical_calls: z.literal(21),
        approval_eligible: z.literal(false),
        activation_permitted: z.literal(false),
        rerunnable: z.literal(false),
        preserved_immutable: z.literal(true),
        evidence_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V8_EVALUATION_EVIDENCE_PATH
        ),
        evidence_sha256: HashSchema,
        failure_analysis_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V8_FAILURE_ANALYSIS_PATH
        ),
        failure_analysis_sha256: HashSchema,
        human_review_advisory_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V8_HUMAN_REVIEW_ADVISORY_PATH
        ),
        human_review_advisory_sha256: HashSchema,
        root_cause_classification: z
          .object({
            cases_5_and_7: z.literal(
              "database_connection_lifecycle_interrupt_after_valid_provider_output"
            ),
            case_8: z.literal(
              "misconception_field_semantic_contract_defect"
            ),
            secret_scan: z.literal(
              "exact_value_scan_lifecycle_incomplete"
            )
          })
          .strict()
      })
      .strict(),
    failed_v9_execution: z
      .object({
        frozen_commit: z.literal(
          "9d9cf2e404bdae7a9a68c652ea776b81f385a5c5"
        ),
        runtime_candidate_hash: z.literal(
          "5c0347287fa10cb67b9e9677dff0fc679f99af78ea3b08fe086cf693af146198"
        ),
        protocol_hash: z.literal(
          "fcc7f5c3b7ffcbd10731fd27b626e431f1a012083702ea40ffbe388a1474aa13"
        ),
        provider_run_id: z.literal(
          "fcv5v9_provider_20260802030051_18dd2d4b"
        ),
        derived_evaluation_id: z.literal(
          "fcv5v9_derived_20260802030051_1118d823"
        ),
        execution_status: z.literal("completed_failed"),
        passed: z.literal(6),
        failed: z.literal(2),
        invalid: z.literal(0),
        not_exercised: z.literal(0),
        actual_logical_calls: z.literal(20),
        actual_provider_attempts: z.literal(20),
        approval_eligible: z.literal(false),
        activation_permitted: z.literal(false),
        rerunnable: z.literal(false),
        preserved_immutable: z.literal(true),
        immutable_evidence: z
          .array(
            z
              .object({
                role: z.string().min(1),
                path: z.string().min(1),
                sha256: HashSchema
              })
              .strict()
          )
          .length(13),
        failure_analysis_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V9_FAILURE_ANALYSIS_PATH
        ),
        failure_analysis_sha256: HashSchema,
        human_review_advisory_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V9_HUMAN_REVIEW_ADVISORY_PATH
        ),
        human_review_advisory_sha256: HashSchema,
        case4_safe_failure_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V9_CASE4_SAFE_FAILURE_PATH
        ),
        case4_safe_failure_sha256: HashSchema,
        case6_safe_failure_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V9_CASE6_SAFE_FAILURE_PATH
        ),
        case6_safe_failure_sha256: HashSchema,
        case7_transition_audit_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V9_CASE7_TRANSITION_AUDIT_PATH
        ),
        case7_transition_audit_sha256: HashSchema,
        root_cause_classification: z
          .object({
            case4: z.literal(
              "indeterminate_due_to_safe_output_evidence_omission"
            ),
            case6: z.literal(
              "semantic_regeneration_and_evidence_preservation_defect"
            ),
            case7: z.literal(
              "two_substantively_different_evidence_supported_versions"
            )
          })
          .strict()
      })
      .strict(),
    remote_database_canary: z
      .object({
        contract_hash: z.literal(
          "046beb25c1e3b66c18f54e196dbc73762aae3915ed34207e13063b41b7266423"
        ),
        evidence_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V11_REMOTE_CANARY_EVIDENCE_PATH
        ),
        evidence_sha256: HashSchema,
        status: z.literal("passed"),
        real_waits_completed: z.literal(true),
        provider_calls: z.literal(0),
        model_auth_requests: z.literal(0),
        dispatch_checkpoints: z.literal(0),
        retained_synthetic_records: z.literal(0),
        ordinary_classroom_records_used: z.literal(false),
        exact_secret_scan_passed: z.literal(true)
      })
      .strict(),
    target_identity: z
      .object({
        runtime_candidate_hash: HashSchema,
        model_snapshot: z.literal("gpt-5.6-sol"),
        reasoning_effort: z.literal("medium"),
        max_output_tokens: z.literal(3500),
        prompt_version: z.literal("formative-conversation-host-v5.3"),
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
          "formative-conversation-opening-v2"
        ),
        profile_transition_version: z.literal(
          "formative-conversation-profile-transition-v4"
        ),
        profile_transition_validator_version: z.literal(
          "formative-conversation-profile-transition-validator-v5"
        ),
        student_output_format_version: z.literal(
          "formative-conversation-student-output-format-v1"
        ),
        provider_failure_taxonomy_version: z.literal(
          "provider-failure-taxonomy-v3"
        ),
        provider_transport_retry_policy_version: z.literal(
          "bounded-provider-transport-retry-v2"
        ),
        provider_request_tracing_version: z.literal(
          "provider-request-tracing-policy-v3"
        ),
        provider_adapter_version: z.literal(
          "openai-responses-adapter-v4"
        ),
        persistence_contract_version: z.literal(
          "formative-conversation-persistence-contract-v2"
        ),
        provider_persistence_boundary_version: z.literal(
          "formative-conversation-provider-persistence-boundary-v1"
        ),
        evaluation_database_lifecycle_version: z.literal(
          "evaluation-database-lifecycle-v2"
        ),
        profile_field_semantics_version: z.literal(
          "formative-conversation-profile-field-semantics-v1"
        ),
        persistence_observability_version: z.literal(
          "formative-conversation-persistence-observability-v1"
        ),
        evaluation_database_connection_owner_version: z.literal(
          "evaluation-database-connection-owner-v1"
        ),
        evaluation_database_read_recovery_version: z.literal(
          "evaluation-database-read-recovery-v1"
        ),
        exact_secret_artifact_scanner_version: z.literal(
          FORMATIVE_CONVERSATION_V11_PREVENTIVE_SCANNER_VERSION
        ),
        artifact_control_channel_version: z.literal(
          FORMATIVE_CONVERSATION_V11_CONTROL_SCHEMA_VERSION
        ),
        artifact_release_policy_version: z.literal(
          FORMATIVE_CONVERSATION_V11_RELEASE_POLICY_VERSION
        ),
        scan_attestation_version: z.literal(
          FORMATIVE_CONVERSATION_V11_SCAN_ATTESTATION_VERSION
        ),
        scan_attestation_schema_fingerprint: z.literal(
          FORMATIVE_CONVERSATION_V11_SCAN_ATTESTATION_SCHEMA_FINGERPRINT
        ),
        security_wrapper_version: z.literal(
          FORMATIVE_CONVERSATION_V11_SECURITY_WRAPPER_VERSION
        ),
        security_wrapper_fingerprint: HashSchema,
        run_scoped_provenance_version: z.literal(
          "formative-conversation-v11-run-scoped-committed-source-provenance-v1"
        ),
        semantic_regeneration_policy_version: z.literal(
          "formative-conversation-semantic-regeneration-v1"
        ),
        semantic_regeneration_instruction_version: z.literal(
          "formative-conversation-semantic-regeneration-instruction-v1"
        ),
        semantic_regeneration_instruction_hash: HashSchema,
        semantic_regeneration_accounting_version: z.literal(
          "formative-conversation-semantic-regeneration-accounting-v1"
        ),
        safe_invalid_output_evidence_version: z.literal(
          "formative-conversation-safe-invalid-output-evidence-v1"
        ),
        remote_database_canary_version: z.literal(
          "formative-conversation-v9-remote-database-lifecycle-canary-v2"
        ),
        remote_database_canary_contract_hash: z.literal(
          "046beb25c1e3b66c18f54e196dbc73762aae3915ed34207e13063b41b7266423"
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
                  "secure_process_local_injector",
                  "launcher",
                  "cli",
                  "orchestration_service",
                  "environment_parity_validator",
                  "environment_contract",
                  "candidate_transport_runner",
                  "package_validator",
                  "contract_schemas",
                  "case_compiler",
                  "production_execution_harness",
                  "provider_retry_policy",
                  "semantic_regeneration_policy",
                  "provider_adapter",
                  "provider_adapter_identity",
                  "provider_transport_diagnostics",
                  "opening_validator",
                  "profile_transition_validator",
                  "profile_transition_persistence",
                  "student_output_format_validator",
                  "formative_runtime",
                  "formative_persistence_contract",
                  "provider_persistence_boundary",
                  "initial_profile_persistence",
                  "conversation_session_persistence",
                  "database_lifecycle",
                  "correction_evidence",
                  "human_review_advisory",
                  "regression_evidence",
                  "failed_pre_dispatch_evidence",
                  "immutable_case7_replay",
                  "immutable_case8_replay",
                  "failed_v5_analysis",
                  "failed_v5_human_review",
                  "failed_v6_analysis",
                  "failed_v6_human_review",
                  "immutable_v7_aggregate",
                  "immutable_v7_hash_manifest",
                  "immutable_v7_case5_replay",
                  "immutable_v7_case7_replay",
                  "immutable_v7_case8_replay",
                  "immutable_v7_failure_analysis",
                  "immutable_v7_human_review",
                  "profile_field_semantics",
                  "persistence_observability",
                  "database_connection_owner",
                  "exact_secret_scanner",
                  "preventive_artifact_release",
                  "run_scoped_provenance",
                  "remote_database_canary",
                  "canary_environment_broker",
                  "immutable_v8_evaluation",
                  "immutable_v8_failure_analysis",
                  "immutable_v8_human_review",
                  "immutable_v9_failure_analysis",
                  "immutable_v9_human_review",
                  "immutable_v9_case4_failure",
                  "immutable_v9_case6_failure",
                  "immutable_v9_case7_transition_audit",
                  "remote_database_canary_evidence",
                  "v10_security_wrapper_failure_analysis"
                ]),
                path: z.string().min(1),
                sha256: HashSchema
              })
              .strict()
          )
          .length(61)
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
      "FORMATIVE_CONVERSATION_V5_V11_LIVE_EVALUATION_ENABLED=true"
    ),
    intended_artifacts: z.array(z.string().min(1)).length(8),
    artifact_contract: z
      .object({
        contract_version: z.literal(
          "formative-conversation-v5-live-artifact-contract-v3"
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
        ),
        preventive_manifest_scan_required: z.literal(true),
        atomic_release_after_attestation_required: z.literal(true),
        ordinary_stdout_is_not_control_channel: z.literal(true),
        v10_security_wrapper_failure_analysis_path: z.literal(
          FORMATIVE_CONVERSATION_V5_V10_SECURITY_FAILURE_ANALYSIS_PATH
        ),
        v10_security_wrapper_failure_analysis_sha256: HashSchema
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
      "formative-conversation-host-v5-executable-candidate-revision-v11"
    ),
    approval_state: z.literal("candidate_not_approved"),
    activation_permitted: z.literal(false),
    runtime_behavior_changed: z.literal(false),
    instructional_behavior_changed: z.literal(false),
    evaluation_governance_changed: z.literal(true),
    source_candidate_manifest: z
      .object({
        path: z.literal(
          "config/operational-candidates/formative-conversation-host-v5-executable-v11/runtime-candidate-manifest.json"
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
    live_environment_contract_path: z.literal(
      FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH
    ),
    target_role: z.literal("formative_conversation_agent"),
    target_role_identity: z.record(z.string(), z.unknown()),
    preserved_active_runtime_hash: HashSchema,
    preserved_rollback_runtime_hash: HashSchema,
    prior_incomplete_protocol_hash: HashSchema,
    failed_v2_protocol_hash: z.literal(
      "7e69059ad46bd60cc0e3eccb22442a98027e93d93d329ea1724bd23948f6c85a"
    ),
    failed_v3_protocol_hash: z.literal(
      "13186b2e5dc54486864b216292afd02774c832340a548c77585886a53c7642b5"
    ),
    failed_v4_protocol_hash: z.literal(
      "662a9e2e9ec2929147bd7ec0150708186f07e32ff2029f606de6b0e9d502c84e"
    ),
    failed_v5_protocol_hash: z.literal(
      "7b42d2b1ffd3c5cfa1bef52cf60759b6eea7e891327077144d81e7f09788aa4c"
    ),
    failed_v6_protocol_hash: z.literal(
      "8dfc63e32166f9117b4cebef550d22bdc81e1b9f3377f5843d50c2dee679b625"
    ),
    failed_v7_protocol_hash: z.literal(
      "620ee46412f8ae4389014905249d8ce8fc1004ff55025ec5255bbd005ab6c68d"
    ),
    failed_v7_runtime_candidate_hash: z.literal(
      "81a60273d33976409e7450bffa6156e89a62e17e36edb7059e30c44979892356"
    ),
    failed_v7_execution_status: z.literal("completed_failed"),
    failed_v7_rerunnable: z.literal(false),
    failed_v8_protocol_hash: z.literal(
      "6359d96e27ed727e0eb1797f621bb08b4e6877f8065f5d6d7be6492a1d8eac15"
    ),
    failed_v8_runtime_candidate_hash: z.literal(
      "132d69caab27b6e94f8bfa416c89d843da97676f41dcefb11c0e03ec95d3af80"
    ),
    failed_v8_execution_status: z.literal("completed_failed"),
    failed_v8_rerunnable: z.literal(false),
    failed_v9_protocol_hash: z.literal(
      "fcc7f5c3b7ffcbd10731fd27b626e431f1a012083702ea40ffbe388a1474aa13"
    ),
    failed_v9_runtime_candidate_hash: z.literal(
      "5c0347287fa10cb67b9e9677dff0fc679f99af78ea3b08fe086cf693af146198"
    ),
    failed_v9_execution_status: z.literal("completed_failed"),
    failed_v9_rerunnable: z.literal(false),
    remote_database_canary_contract_hash: z.literal(
      "046beb25c1e3b66c18f54e196dbc73762aae3915ed34207e13063b41b7266423"
    ),
    remote_database_canary_status: z.literal("passed"),
    frozen_v10_runtime_candidate_hash: z.literal(
      "2e85c274e3c89d98ee5cbe60516f9cb91f33504ce2045eed63f762d329512b6c"
    ),
    frozen_v10_protocol_hash: z.literal(
      "932d7a8ccb21847f30fa8d6f340275733c129e4d2dc3688681998d8859bb1189"
    ),
    frozen_v10_execution_status: z.literal(
      "completed_pending_human_review"
    ),
    frozen_v10_approval_eligible: z.literal(false)
  })
  .strict();

export const FormativeConversationV5ApprovalPlaceholderSchema = z
  .object({
    artifact_version: z.literal(
      "formative-conversation-v5-executable-approval-placeholder-v11"
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
      "formative-conversation-v5-executable-candidate-identity-v11"
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
    live_environment_contract_hash: HashSchema,
    live_environment_contract_sha256: HashSchema,
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
    failed_v3_protocol_hash: HashSchema,
    failed_v3_checkpoint_sha256: HashSchema,
    failed_v3_source_provider_run_sha256: HashSchema,
    failed_v3_derived_evaluation_sha256: HashSchema,
    failed_v4_protocol_hash: HashSchema,
    failed_v4_pre_dispatch_evidence_sha256: HashSchema,
    failed_v5_protocol_hash: HashSchema,
    failed_v5_checkpoint_sha256: HashSchema,
    failed_v5_source_provider_run_sha256: HashSchema,
    failed_v5_derived_evaluation_sha256: HashSchema,
    failed_v5_failure_analysis_sha256: HashSchema,
    failed_v5_human_review_advisory_sha256: HashSchema,
    failed_v6_protocol_hash: HashSchema,
    failed_v6_checkpoint_sha256: HashSchema,
    failed_v6_source_provider_run_sha256: HashSchema,
    failed_v6_derived_evaluation_sha256: HashSchema,
    failed_v6_human_review_package_sha256: HashSchema,
    failed_v6_failure_analysis_sha256: HashSchema,
    failed_v6_human_review_advisory_sha256: HashSchema,
    failed_v7_runtime_candidate_hash: HashSchema,
    failed_v7_protocol_hash: HashSchema,
    failed_v7_immutable_evidence: z
      .array(
        z
          .object({
            path: z.string().min(1),
            sha256: HashSchema
          })
          .strict()
      )
      .length(5),
    failed_v8_runtime_candidate_hash: HashSchema,
    failed_v8_protocol_hash: HashSchema,
    failed_v8_evidence_sha256: HashSchema,
    failed_v8_failure_analysis_sha256: HashSchema,
    failed_v8_human_review_advisory_sha256: HashSchema,
    failed_v9_runtime_candidate_hash: HashSchema,
    failed_v9_protocol_hash: HashSchema,
    failed_v9_immutable_evidence: z
      .array(
        z
          .object({
            role: z.string().min(1),
            path: z.string().min(1),
            sha256: HashSchema
          })
          .strict()
      )
      .length(13),
    failed_v9_failure_analysis_sha256: HashSchema,
    failed_v9_human_review_advisory_sha256: HashSchema,
    failed_v9_case4_safe_failure_sha256: HashSchema,
    failed_v9_case6_safe_failure_sha256: HashSchema,
    failed_v9_case7_transition_audit_sha256: HashSchema,
    remote_database_canary_contract_hash: HashSchema,
    remote_database_canary_evidence_sha256: HashSchema,
    source_application_git_commit_location: z.literal(
      "run_scoped_derived_provenance"
    ),
    artifact_control_channel_version: z.literal(
      FORMATIVE_CONVERSATION_V11_CONTROL_SCHEMA_VERSION
    ),
    security_wrapper_fingerprint: HashSchema,
    scan_attestation_schema_fingerprint: z.literal(
      FORMATIVE_CONVERSATION_V11_SCAN_ATTESTATION_SCHEMA_FINGERPRINT
    ),
    v10_security_wrapper_failure_analysis_sha256: HashSchema
  })
  .strict();

export const FormativeConversationV5SourceConfigurationSchema = z
  .object({
    artifact_version: z.literal(
      "formative-conversation-v5-executable-source-configuration-v11"
    ),
    source_commit_capture: z.literal("run_scoped_derived_provenance"),
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
        failed_v2_dispatch_checkpoint_sha256: HashSchema,
        failed_v3_protocol_hash: HashSchema,
        failed_v3_provider_run_id: z.string().min(1),
        failed_v3_derived_evaluation_id: z.string().min(1),
        failed_v3_dispatch_checkpoint_path: z.string().min(1),
        failed_v3_dispatch_checkpoint_sha256: HashSchema,
        failed_v3_source_provider_run_path: z.string().min(1),
        failed_v3_source_provider_run_sha256: HashSchema,
        failed_v3_derived_evaluation_path: z.string().min(1),
        failed_v3_derived_evaluation_sha256: HashSchema,
        failed_v4_protocol_hash: HashSchema,
        failed_v4_source_commit_sha: Sha40Schema,
        failed_v4_pre_dispatch_evidence_path: z.string().min(1),
        failed_v4_pre_dispatch_evidence_sha256: HashSchema,
        failed_v4_dispatch_checkpoint_created: z.literal(false),
        failed_v4_provider_calls: z.literal(0),
        failed_v5_protocol_hash: HashSchema,
        failed_v5_source_commit_sha: Sha40Schema,
        failed_v5_provider_run_id: z.string().min(1),
        failed_v5_derived_evaluation_id: z.string().min(1),
        failed_v5_dispatch_checkpoint_path: z.string().min(1),
        failed_v5_dispatch_checkpoint_sha256: HashSchema,
        failed_v5_source_provider_run_path: z.string().min(1),
        failed_v5_source_provider_run_sha256: HashSchema,
        failed_v5_derived_evaluation_path: z.string().min(1),
        failed_v5_derived_evaluation_sha256: HashSchema,
        failed_v5_failure_analysis_path: z.string().min(1),
        failed_v5_failure_analysis_sha256: HashSchema,
        failed_v5_human_review_advisory_path: z.string().min(1),
        failed_v5_human_review_advisory_sha256: HashSchema,
        failed_v5_execution_status: z.literal("completed_failed"),
        failed_v5_approval_eligible: z.literal(false),
        failed_v5_activation_permitted: z.literal(false),
        failed_v5_rerunnable: z.literal(false),
        failed_v6_protocol_hash: HashSchema,
        failed_v6_source_commit_sha: Sha40Schema,
        failed_v6_provider_run_id: z.string().min(1),
        failed_v6_derived_evaluation_id: z.string().min(1),
        failed_v6_dispatch_checkpoint_path: z.string().min(1),
        failed_v6_dispatch_checkpoint_sha256: HashSchema,
        failed_v6_source_provider_run_path: z.string().min(1),
        failed_v6_source_provider_run_sha256: HashSchema,
        failed_v6_derived_evaluation_path: z.string().min(1),
        failed_v6_derived_evaluation_sha256: HashSchema,
        failed_v6_human_review_package_path: z.string().min(1),
        failed_v6_human_review_package_sha256: HashSchema,
        failed_v6_failure_analysis_path: z.string().min(1),
        failed_v6_failure_analysis_sha256: HashSchema,
        failed_v6_human_review_advisory_path: z.string().min(1),
        failed_v6_human_review_advisory_sha256: HashSchema,
        failed_v6_execution_status: z.literal("completed_failed"),
        failed_v6_approval_eligible: z.literal(false),
        failed_v6_activation_permitted: z.literal(false),
        failed_v6_rerunnable: z.literal(false),
        failed_v7_runtime_candidate_hash: HashSchema,
        failed_v7_protocol_hash: HashSchema,
        failed_v7_source_commit_sha: Sha40Schema,
        failed_v7_provider_run_id: z.string().min(1),
        failed_v7_derived_evaluation_id: z.string().min(1),
        failed_v7_execution_status: z.literal("completed_failed"),
        failed_v7_approval_eligible: z.literal(false),
        failed_v7_activation_permitted: z.literal(false),
        failed_v7_rerunnable: z.literal(false),
        failed_v7_immutable_evidence: z
          .array(
            z
              .object({
                path: z.string().min(1),
                sha256: HashSchema
              })
              .strict()
          )
          .length(5),
        failed_v8_runtime_candidate_hash: HashSchema,
        failed_v8_protocol_hash: HashSchema,
        failed_v8_source_commit_sha: Sha40Schema,
        failed_v8_provider_run_id: z.string().min(1),
        failed_v8_derived_evaluation_id: z.string().min(1),
        failed_v8_execution_status: z.literal("completed_failed"),
        failed_v8_approval_eligible: z.literal(false),
        failed_v8_activation_permitted: z.literal(false),
        failed_v8_rerunnable: z.literal(false),
        failed_v8_evidence_path: z.string().min(1),
        failed_v8_evidence_sha256: HashSchema,
        failed_v8_failure_analysis_path: z.string().min(1),
        failed_v8_failure_analysis_sha256: HashSchema,
        failed_v8_human_review_advisory_path: z.string().min(1),
        failed_v8_human_review_advisory_sha256: HashSchema,
        failed_v9_runtime_candidate_hash: HashSchema,
        failed_v9_protocol_hash: HashSchema,
        failed_v9_source_commit_sha: Sha40Schema,
        failed_v9_provider_run_id: z.string().min(1),
        failed_v9_derived_evaluation_id: z.string().min(1),
        failed_v9_execution_status: z.literal("completed_failed"),
        failed_v9_approval_eligible: z.literal(false),
        failed_v9_activation_permitted: z.literal(false),
        failed_v9_rerunnable: z.literal(false),
        failed_v9_immutable_evidence: z
          .array(
            z
              .object({
                role: z.string().min(1),
                path: z.string().min(1),
                sha256: HashSchema
              })
              .strict()
          )
          .length(13),
        failed_v9_failure_analysis_path: z.string().min(1),
        failed_v9_failure_analysis_sha256: HashSchema,
        failed_v9_human_review_advisory_path: z.string().min(1),
        failed_v9_human_review_advisory_sha256: HashSchema,
        failed_v9_case4_safe_failure_path: z.string().min(1),
        failed_v9_case4_safe_failure_sha256: HashSchema,
        failed_v9_case6_safe_failure_path: z.string().min(1),
        failed_v9_case6_safe_failure_sha256: HashSchema,
        failed_v9_case7_transition_audit_path: z.string().min(1),
        failed_v9_case7_transition_audit_sha256: HashSchema,
        remote_database_canary_contract_hash: HashSchema,
        remote_database_canary_evidence_path: z.string().min(1),
        remote_database_canary_evidence_sha256: HashSchema,
        remote_database_canary_status: z.literal("passed")
      })
      .strict(),
    source_code_references: z.record(z.string(), z.string().min(1))
  })
  .strict();

export const FormativeConversationV5LiveEnvironmentContractSchema = z
  .object({
    contract_version: z.literal(
      "formative-conversation-v5-live-environment-parity-v1"
    ),
    launcher: z
      .object({
        version: z.literal(
          "formative-conversation-v5-node-import-tsx-launcher-v1"
        ),
        mechanism: z.literal("node --import tsx"),
        path: z.literal(
          "scripts/operational-formative-conversation-v5-v11-launcher.mjs"
        ),
        child_cli_path: z.literal(
          "prisma/operational-formative-conversation-v5-v11-evaluate.ts"
        ),
        plan_and_live_share_launcher: z.literal(true),
        tsx_cli_ipc_used: z.literal(false)
      })
      .strict(),
    environment_sources: z
      .array(
        z.enum([
          "render_process_local",
          "render_runtime",
          "deterministic_test"
        ])
      )
      .length(3),
    required_injected_environment: z.array(z.string().min(1)).min(1),
    secret_environment: z.array(z.string().min(1)).length(5),
    active_approval_and_candidate_separate: z.literal(true),
    active_approval_paths_must_be_explicit_and_readable:
      z.literal(true),
    local_path_projection_requires_render_source_paths:
      z.literal(true),
    database_probe_required: z.literal(true),
    research_export_probe_required: z.literal(true),
    provider_credential_shape_check_only: z.literal(true),
    provider_auth_network_requests: z.literal(0),
    provider_generation_requests: z.literal(0),
    checkpoint_created_during_preflight: z.literal(false),
    secrets_recorded: z.literal(false),
    secret_fingerprints_recorded: z.literal(false),
    artifact_control_channel: z
      .object({
        schema_version: z.literal(
          FORMATIVE_CONVERSATION_V11_CONTROL_SCHEMA_VERSION
        ),
        ordinary_stdout_used_for_control: z.literal(false),
        owner_only_control_file: z.literal(true),
        duplicate_missing_malformed_conflicting_fail_closed: z.literal(true)
      })
      .strict(),
    preventive_artifact_release: z
      .object({
        scanner_version: z.literal(
          FORMATIVE_CONVERSATION_V11_PREVENTIVE_SCANNER_VERSION
        ),
        release_policy_version: z.literal(
          FORMATIVE_CONVERSATION_V11_RELEASE_POLICY_VERSION
        ),
        attestation_version: z.literal(
          FORMATIVE_CONVERSATION_V11_SCAN_ATTESTATION_VERSION
        ),
        attestation_schema_fingerprint: z.literal(
          FORMATIVE_CONVERSATION_V11_SCAN_ATTESTATION_SCHEMA_FINGERPRINT
        ),
        exact_secrets_cleared_before_release: z.literal(true),
        atomic_promotion_required: z.literal(true)
      })
      .strict()
  })
  .strict();
