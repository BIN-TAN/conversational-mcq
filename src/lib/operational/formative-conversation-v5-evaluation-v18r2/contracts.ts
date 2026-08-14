import { z } from "zod";
import { ProductionStudentProfilingInput } from "@/lib/agents/contracts";
import {
  FormativeConversationV5AssessmentResponseSchema,
  FormativeConversationV5CompiledCaseSchema as HistoricalFormativeCompiledCaseSchema,
  FormativeConversationV5FixtureSchema as HistoricalFormativeFixtureSchema,
  FormativeConversationV5ItemSnapshotSchema,
  FormativeConversationV5StudentMessageSchema
} from "../formative-conversation-v5-evaluation-v14/contracts";
import {
  FORMATIVE_CONVERSATION_V18R2_CONTROL_SCHEMA_VERSION as FORMATIVE_CONVERSATION_V18_CONTROL_SCHEMA_VERSION,
  FORMATIVE_CONVERSATION_V18R2_PREVENTIVE_SCANNER_VERSION as FORMATIVE_CONVERSATION_V18_PREVENTIVE_SCANNER_VERSION,
  FORMATIVE_CONVERSATION_V18R2_RELEASE_POLICY_VERSION as FORMATIVE_CONVERSATION_V18_RELEASE_POLICY_VERSION,
  FORMATIVE_CONVERSATION_V18R2_SCAN_ATTESTATION_SCHEMA_FINGERPRINT as FORMATIVE_CONVERSATION_V18_SCAN_ATTESTATION_SCHEMA_FINGERPRINT,
  FORMATIVE_CONVERSATION_V18R2_SCAN_ATTESTATION_VERSION as FORMATIVE_CONVERSATION_V18_SCAN_ATTESTATION_VERSION,
  FORMATIVE_CONVERSATION_V18R2_SECURITY_WRAPPER_VERSION as FORMATIVE_CONVERSATION_V18_SECURITY_WRAPPER_VERSION
} from "./security-release";

export const FORMATIVE_CONVERSATION_V5_EXECUTABLE_REVISION =
  "formative-conversation-host-v5-executable-v18r2";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION =
  "formative-conversation-v5-protocol-runner-v18r2";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v18r2";
export const FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/candidate-manifest.json`;
export const FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/candidate-identity.json`;
export const FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/executable-evaluation-protocol.json`;
export const FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/source-configuration.json`;
export const FORMATIVE_CONVERSATION_V5_RUNTIME_MANIFEST_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/runtime-candidate-manifest.json`;
export const FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/fixture-manifest.json`;
export const FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/compiled-execution-plan.json`;
export const FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/approval-evidence-placeholder.json`;
export const FORMATIVE_CONVERSATION_V5_LIVE_ENVIRONMENT_CONTRACT_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/live-environment-contract.json`;
export const FORMATIVE_CONVERSATION_V5_DISPATCH_CHECKPOINT_CONTRACT_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/dispatch-checkpoint-contract.json`;
export const FORMATIVE_CONVERSATION_V5_AUTHORIZATION_PACKAGE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/live-execution-authorization.json`;
export const FORMATIVE_CONVERSATION_V5_IMMUTABLE_V18_REFERENCE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/immutable-v18r1-reference.json`;
export const FORMATIVE_CONVERSATION_V5_PROVENANCE_CONTRACT_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/provenance-contract.json`;
export const FORMATIVE_CONVERSATION_V5_SECURITY_WRAPPER_MANIFEST_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/security-wrapper-manifest.json`;
export const FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/fixtures`;
export const FORMATIVE_CONVERSATION_V18_OFFLINE_REPLAY_ROOT =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/offline-replay-fixtures`;
export const FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v18r2/plans";
export const FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v18r2/runs";

export const FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER = [
  "pcv18_01_no_misconception",
  "pcv18_02_single_atomic_misconception",
  "pcv18_03_compound_conceptual_state"
] as const;
export const FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER = [
  "fcv5_01_assistant_first_opening",
  "fcv5_02_first_principles_adaptation",
  "fcv5_03_direct_answer_handling",
  "fcv5_04_related_concept_discussion",
  "fcv5_05_sound_profile_transition",
  "fcv5_06_largely_improved_temporal",
  "fcv5_07_persistent_barrier_teacher_assistance",
  "fcv5_08_mixed_resolved_evidence"
] as const;
export const FORMATIVE_CONVERSATION_V5_END_TO_END_CASE_ORDER = [
  "fcv18_09_dissertation_end_to_end"
] as const;
export const FORMATIVE_CONVERSATION_V5_CASE_ORDER = [
  ...FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER,
  ...FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER,
  ...FORMATIVE_CONVERSATION_V5_END_TO_END_CASE_ORDER
] as const;

export const FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS = [
  "source-provider-run.json",
  "derived-evaluation.json",
  "aggregate-evaluation.json",
  "human-review-package.json",
  "teacher-export-consistency.json",
  "research-export-integrity.json",
  "provider-retry-milestone-evidence.json",
  "persistence-observability.json",
  "provenance-manifest.json",
  "artifact-hash-manifest.json",
  "finalized-artifact-manifest.json",
  "artifact-scan-attestation.json"
] as const;

export function assertFormativeConversationV18IntendedArtifactCoverage(input: {
  generated_artifacts: readonly string[];
  deferred_artifacts: readonly string[];
}) {
  const covered = new Set([
    ...input.generated_artifacts,
    ...input.deferred_artifacts
  ]);
  const missing = FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS.filter(
    (artifact) => !covered.has(artifact)
  );
  if (missing.length > 0) {
    throw new Error(
      `formative_conversation_v18_intended_artifact_missing:${missing.join(",")}`
    );
  }
}

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const CaseIdSchema = z.enum(FORMATIVE_CONVERSATION_V5_CASE_ORDER);
const ProfilingCaseIdSchema = z.enum(FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER);
const FormativeCaseIdSchema = z.enum(FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER);
const EndToEndCaseIdSchema = z.enum(FORMATIVE_CONVERSATION_V5_END_TO_END_CASE_ORDER);

const AssertionSchema = z
  .object({
    assertion_id: z.string().regex(/^[a-z0-9_]+$/u),
    description: z.string().min(1),
    severity: z.enum(["blocking", "human_review"]),
    evaluation_method: z.enum([
      "deterministic_artifact_check",
      "human_review"
    ])
  })
  .strict();

const CatalogExpectationSchema = z
  .object({
    indicator_count: z.number().int().min(0).max(20).nullable(),
    claim_count: z.number().int().min(0).max(40).nullable(),
    minimum_claim_count: z.number().int().min(0).max(40),
    empty_catalog_required: z.boolean(),
    distinct_claim_ids_required: z.literal(true),
    partial_resolution_projection_required: z.boolean(),
    metadata_pseudo_claims_forbidden: z.literal(true),
    lexical_splitting_forbidden: z.literal(true)
  })
  .strict();

const CanonicalIdentityExpectationSchema = z
  .object({
    claim_text: z.string().min(1),
    source_item_aliases: z.array(z.string().min(1)).min(1),
    expected_disposition: z.enum(["not_evaluated", "resolved", "retained"])
  })
  .strict();

export const V18ProfilingCanaryFixtureSchema = z
  .object({
    fixture_version: z.literal("formative-conversation-v18-profiling-canary-v2"),
    case_type: z.literal("profiling_contract_canary"),
    case_id: ProfilingCaseIdSchema,
    case_order: z.number().int().min(1).max(3),
    title: z.string().min(1),
    synthetic_only: z.literal(true),
    real_student_information_present: z.literal(false),
    provider_input: ProductionStudentProfilingInput,
    catalog_identity_scope_template: z.string().min(1),
    expected_catalog: CatalogExpectationSchema,
    case_assertions: z.array(AssertionSchema).min(1),
    call_graph: z
      .object({
        agent_name: z.literal("student_profiling_agent"),
        prompt_version: z.literal("student-profiling-v5"),
        schema_version: z.literal("student-profile-output-v4"),
        base_logical_calls: z.literal(1),
        maximum_semantic_regenerations: z.literal(1),
        maximum_logical_calls: z.literal(2),
        maximum_provider_attempts_per_logical_call: z.literal(3),
        maximum_transport_retries_per_logical_call: z.literal(2)
      })
      .strict(),
    fixture_hash: HashSchema
  })
  .strict();

const V18FormativeFixtureObjectSchema = z
  .object({
    fixture_version: z.literal("formative-conversation-v18-formative-case-v2"),
    case_type: z.literal("formative_conversation"),
    case_id: FormativeCaseIdSchema,
    case_order: z.number().int().min(4).max(11),
    source_fixture_path: z.string().min(1),
    source_fixture_sha256: HashSchema,
    substantive_scenario_preserved: z.literal(true),
    canonical_identity_expectations: z.array(CanonicalIdentityExpectationSchema),
    formative_fixture: HistoricalFormativeFixtureSchema,
    fixture_hash: HashSchema
  })
  .strict();

export const V18FormativeFixtureSchema =
  V18FormativeFixtureObjectSchema.superRefine((value, context) => {
    const profile = value.formative_fixture.initial_profile_source.profile;
    if (value.formative_fixture.case_id !== value.case_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formative_fixture", "case_id"],
        message: "v18_formative_fixture_case_identity_mismatch"
      });
    }
    if (
      profile.prompt_version !== "student-profiling-v5" ||
      profile.schema_version !== "student-profile-output-v4" ||
      profile.misconception_indicators.some(
        (indicator) => !indicator.atomic_claims || indicator.atomic_claims.length === 0
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formative_fixture", "initial_profile_source"],
        message: "v18_formative_fixture_canonical_claim_source_invalid"
      });
    }
  });

const EndToEndAssessmentSchema = z
  .object({
    title: z.string().min(1),
    concept_title: z.string().min(1),
    learning_objective: z.string().min(1),
    assessment_boundary: z.string().min(1),
    administered_items: z.array(FormativeConversationV5ItemSnapshotSchema).length(3)
  })
  .strict();

const V18TerminalOutcomeSchema = z.enum([
  "continue_conversation",
  "sound_understanding",
  "largely_improved_understanding",
  "teacher_assistance_recommended"
]);

const V18EndToEndCallGraphSchema = z
  .object({
    production_student_profiling_base_calls: z.literal(1),
    assistant_first_opening_calls: z.literal(1),
    student_message_calls: z.literal(2),
    formative_base_calls: z.literal(3),
    total_base_calls: z.literal(4),
    maximum_semantic_regenerations: z.literal(4),
    maximum_provider_attempts_per_logical_call: z.literal(3),
    maximum_transport_retries_per_logical_call: z.literal(2)
  })
  .strict();

export const V18EndToEndFixtureSchema = z
  .object({
    fixture_version: z.literal("formative-conversation-v18-end-to-end-case-v1"),
    case_type: z.literal("dissertation_end_to_end"),
    case_id: EndToEndCaseIdSchema,
    case_order: z.literal(12),
    title: z.string().min(1),
    execution_subject_id: z.literal("overconfident_incorrect"),
    synthetic_only: z.literal(true),
    real_student_information_present: z.literal(false),
    assessment: EndToEndAssessmentSchema,
    assessment_responses: z.array(FormativeConversationV5AssessmentResponseSchema).length(3),
    student_messages: z.array(FormativeConversationV5StudentMessageSchema).length(2),
    initial_claim_expectations: z.array(CanonicalIdentityExpectationSchema).length(2),
    required_pipeline: z.array(z.string().min(1)).min(12),
    case_assertions: z.array(AssertionSchema).min(1),
    permitted_terminal_outcomes: z.array(V18TerminalOutcomeSchema).min(1),
    call_graph: V18EndToEndCallGraphSchema,
    fixture_hash: HashSchema
  })
  .strict()
  .superRefine((fixture, context) => {
    const dispositions = fixture.initial_claim_expectations.map(
      (entry) => entry.expected_disposition
    );
    if (!dispositions.includes("resolved") || !dispositions.includes("retained")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["initial_claim_expectations"],
        message: "v18_end_to_end_claim_lifecycle_incomplete"
      });
    }
  });

export const FormativeConversationV18FixtureSchema = z.union([
  V18ProfilingCanaryFixtureSchema,
  V18FormativeFixtureSchema,
  V18EndToEndFixtureSchema
]);
export type FormativeConversationV18Fixture = z.infer<typeof FormativeConversationV18FixtureSchema>;
export type FormativeConversationV18ProfilingFixture = z.infer<typeof V18ProfilingCanaryFixtureSchema>;
export type FormativeConversationV18FormativeFixture = z.infer<typeof V18FormativeFixtureSchema>;
export type FormativeConversationV18EndToEndFixture = z.infer<typeof V18EndToEndFixtureSchema>;

const CompiledNamespaceSchema = z
  .object({
    run_namespace_template: z.literal("<provider_run_id>"),
    case_namespace_template: z.string().min(1),
    collision_check_key: HashSchema
  })
  .strict();

const CompiledProfilingCaseSchema = z
  .object({
    compiled_case_version: z.literal("formative-conversation-v18-compiled-case-v2"),
    case_type: z.literal("profiling_contract_canary"),
    case_id: ProfilingCaseIdSchema,
    case_order: z.number().int().min(1).max(3),
    title: z.string().min(1),
    fixture_hash: HashSchema,
    fixture_file_sha256: HashSchema,
    namespace: CompiledNamespaceSchema,
    provider_input: ProductionStudentProfilingInput,
    catalog_identity_scope_template: z.string().min(1),
    expected_catalog: CatalogExpectationSchema,
    case_assertions: z.array(AssertionSchema).min(1),
    call_graph: V18ProfilingCanaryFixtureSchema.shape.call_graph,
    compilation_status: z.literal("compiled")
  })
  .strict();

const CompiledFormativeCaseSchema = z
  .object({
    compiled_case_version: z.literal("formative-conversation-v18-compiled-case-v2"),
    case_type: z.literal("formative_conversation"),
    case_id: FormativeCaseIdSchema,
    case_order: z.number().int().min(4).max(11),
    title: z.string().min(1),
    fixture_hash: HashSchema,
    fixture_file_sha256: HashSchema,
    source_fixture_path: z.string().min(1),
    source_fixture_sha256: HashSchema,
    canonical_identity_expectations: z.array(CanonicalIdentityExpectationSchema),
    namespace: CompiledNamespaceSchema,
    formative_case: HistoricalFormativeCompiledCaseSchema,
    compilation_status: z.literal("compiled")
  })
  .strict();

const CompiledEndToEndCaseSchema = z
  .object({
    compiled_case_version: z.literal("formative-conversation-v18-compiled-case-v2"),
    case_type: z.literal("dissertation_end_to_end"),
    case_id: EndToEndCaseIdSchema,
    case_order: z.literal(12),
    title: z.string().min(1),
    fixture_hash: HashSchema,
    fixture_file_sha256: HashSchema,
    namespace: CompiledNamespaceSchema,
    execution_subject_id: z.literal("overconfident_incorrect"),
    assessment: EndToEndAssessmentSchema,
    assessment_responses: z.array(FormativeConversationV5AssessmentResponseSchema).length(3),
    student_messages: z.array(FormativeConversationV5StudentMessageSchema).length(2),
    initial_claim_expectations: z.array(CanonicalIdentityExpectationSchema).length(2),
    required_pipeline: z.array(z.string().min(1)).min(12),
    case_assertions: z.array(AssertionSchema).min(1),
    permitted_terminal_outcomes: z.array(V18TerminalOutcomeSchema).min(1),
    call_graph: V18EndToEndCallGraphSchema,
    compilation_status: z.literal("compiled")
  })
  .strict();

export const FormativeConversationV18CompiledCaseSchema = z.discriminatedUnion(
  "case_type",
  [CompiledProfilingCaseSchema, CompiledFormativeCaseSchema, CompiledEndToEndCaseSchema]
);
export type FormativeConversationV18CompiledCase = z.infer<typeof FormativeConversationV18CompiledCaseSchema>;

export const FormativeConversationV18BudgetSchema = z
  .object({
    profiling_contract_base_call_count: z.literal(3),
    formative_comparability_base_call_count: z.literal(21),
    end_to_end_profiling_base_call_count: z.literal(1),
    end_to_end_formative_base_call_count: z.literal(3),
    end_to_end_base_call_count: z.literal(4),
    base_profiling_call_count: z.literal(4),
    base_formative_call_count: z.literal(24),
    expected_logical_call_count: z.literal(28),
    maximum_semantic_regeneration_count: z.literal(28),
    maximum_logical_call_count: z.literal(56),
    expected_provider_attempt_count: z.literal(28),
    maximum_provider_attempt_count: z.literal(168),
    maximum_transport_retries_per_logical_call: z.literal(2),
    maximum_input_token_count: z.literal(1_800_000),
    maximum_output_token_count: z.literal(368_000),
    maximum_total_token_count: z.literal(2_168_000),
    maximum_wall_clock_duration_ms: z.literal(7_200_000),
    maximum_concurrency: z.literal(1),
    maximum_cost_usd: z.literal(60),
    pricing_metadata_status: z.literal("unavailable"),
    cost_enforcement: z.literal("operator_ceiling_required_actual_estimate_recorded_when_available"),
    maximum_semantic_regenerations_per_agent_call: z.literal(1)
  })
  .strict();
export type FormativeConversationV18Budget = z.infer<typeof FormativeConversationV18BudgetSchema>;

export const FormativeConversationV18CompiledPlanSchema = z
  .object({
    compiled_plan_version: z.literal("formative-conversation-v18-compiled-plan-v2"),
    compilation_status: z.literal("ready_for_dispatch"),
    runtime_candidate_hash: HashSchema,
    evaluation_protocol_hash: HashSchema,
    runner_implementation_hash: HashSchema,
    live_environment_contract_hash: HashSchema,
    fixture_manifest_hash: HashSchema,
    aggregate_fixture_hash: HashSchema,
    fixed_case_order: z.array(CaseIdSchema).length(12),
    cases: z.array(FormativeConversationV18CompiledCaseSchema).length(12),
    aggregate_call_graph: z
      .object({
        profiling_contract_base_call_count: z.literal(3),
        formative_comparability_opening_call_count: z.literal(8),
        formative_comparability_student_message_call_count: z.literal(13),
        formative_comparability_base_call_count: z.literal(21),
        end_to_end_profiling_base_call_count: z.literal(1),
        end_to_end_opening_call_count: z.literal(1),
        end_to_end_student_message_call_count: z.literal(2),
        end_to_end_formative_base_call_count: z.literal(3),
        end_to_end_base_call_count: z.literal(4),
        expected_base_call_count: z.literal(28),
        maximum_semantic_regeneration_count: z.literal(28),
        maximum_logical_call_count: z.literal(56),
        maximum_provider_attempt_count: z.literal(168)
      })
      .strict(),
    budget: FormativeConversationV18BudgetSchema,
    isolated_namespaces: z.array(z.string().min(1)).length(12),
    intended_output_artifact_locations: z.array(z.string().min(1)).min(1),
    approval_inactive: z.literal(true),
    activation_permitted: z.literal(false),
    provider_calls_during_compilation: z.literal(0),
    network_requests_to_provider_during_compilation: z.literal(0),
    compiled_plan_hash: HashSchema
  })
  .strict();
export type FormativeConversationV18CompiledPlan = z.infer<typeof FormativeConversationV18CompiledPlanSchema>;

export const FORMATIVE_CONVERSATION_V18_SECURITY_CONTRACT_IDENTITY = {
  control_schema_version: FORMATIVE_CONVERSATION_V18_CONTROL_SCHEMA_VERSION,
  preventive_scanner_version: FORMATIVE_CONVERSATION_V18_PREVENTIVE_SCANNER_VERSION,
  release_policy_version: FORMATIVE_CONVERSATION_V18_RELEASE_POLICY_VERSION,
  scan_attestation_version: FORMATIVE_CONVERSATION_V18_SCAN_ATTESTATION_VERSION,
  scan_attestation_schema_fingerprint: FORMATIVE_CONVERSATION_V18_SCAN_ATTESTATION_SCHEMA_FINGERPRINT,
  security_wrapper_version: FORMATIVE_CONVERSATION_V18_SECURITY_WRAPPER_VERSION
} as const;
