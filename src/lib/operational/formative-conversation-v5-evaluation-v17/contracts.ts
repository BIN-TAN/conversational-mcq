import { z } from "zod";
import { StudentProfilingInput } from "@/lib/agents/contracts";
import {
  FormativeConversationV5CompiledCaseSchema as V16FormativeCompiledCaseSchema,
  FormativeConversationV5FixtureSchema as V16FormativeFixtureSchema
} from "../formative-conversation-v5-evaluation-v14/contracts";
import {
  FORMATIVE_CONVERSATION_V17_CONTROL_SCHEMA_VERSION,
  FORMATIVE_CONVERSATION_V17_PREVENTIVE_SCANNER_VERSION,
  FORMATIVE_CONVERSATION_V17_RELEASE_POLICY_VERSION,
  FORMATIVE_CONVERSATION_V17_SCAN_ATTESTATION_SCHEMA_FINGERPRINT,
  FORMATIVE_CONVERSATION_V17_SCAN_ATTESTATION_VERSION,
  FORMATIVE_CONVERSATION_V17_SECURITY_WRAPPER_VERSION
} from "./security-release";

export const FORMATIVE_CONVERSATION_V5_EXECUTABLE_REVISION =
  "formative-conversation-host-v5-executable-v17";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_RUNNER_VERSION =
  "formative-conversation-v5-protocol-runner-v17";
export const FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT =
  "config/operational-candidates/formative-conversation-host-v5-executable-v17";
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
export const FORMATIVE_CONVERSATION_V5_IMMUTABLE_V16_REFERENCE_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/immutable-v16-reference.json`;
export const FORMATIVE_CONVERSATION_V5_PROVENANCE_CONTRACT_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/provenance-contract.json`;
export const FORMATIVE_CONVERSATION_V5_SECURITY_WRAPPER_MANIFEST_PATH =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/security-wrapper-manifest.json`;
export const FORMATIVE_CONVERSATION_V5_FIXTURE_ROOT =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/fixtures`;
export const FORMATIVE_CONVERSATION_V17_OFFLINE_REPLAY_ROOT =
  `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/offline-replay-fixtures`;
export const FORMATIVE_CONVERSATION_V5_PLAN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v17/plans";
export const FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT =
  ".data/operational-formative-conversation-v5-evaluation-v17/runs";

export const FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER = [
  "pcv17_01_no_misconception",
  "pcv17_02_single_atomic_misconception",
  "pcv17_03_compound_conceptual_state"
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
export const FORMATIVE_CONVERSATION_V5_CASE_ORDER = [
  ...FORMATIVE_CONVERSATION_V5_PROFILING_CASE_ORDER,
  ...FORMATIVE_CONVERSATION_V5_FORMATIVE_CASE_ORDER
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

export function assertFormativeConversationV17IntendedArtifactCoverage(input: {
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
      `formative_conversation_v17_intended_artifact_missing:${missing.join(",")}`
    );
  }
}

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const CaseIdSchema = z.enum(FORMATIVE_CONVERSATION_V5_CASE_ORDER);
const ProfilingCaseIdSchema = z.enum([
  "pcv17_01_no_misconception",
  "pcv17_02_single_atomic_misconception",
  "pcv17_03_compound_conceptual_state"
]);
const FormativeCaseIdSchema = z.enum([
  "fcv5_01_assistant_first_opening",
  "fcv5_02_first_principles_adaptation",
  "fcv5_03_direct_answer_handling",
  "fcv5_04_related_concept_discussion",
  "fcv5_05_sound_profile_transition",
  "fcv5_06_largely_improved_temporal",
  "fcv5_07_persistent_barrier_teacher_assistance",
  "fcv5_08_mixed_resolved_evidence"
]);

const ProfilingAssertionSchema = z
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

const ProfilingCatalogExpectationSchema = z
  .object({
    indicator_count: z.number().int().min(0).max(20).nullable(),
    claim_count: z.number().int().min(0).max(40).nullable(),
    minimum_claim_count: z.number().int().min(0).max(40),
    empty_catalog_required: z.boolean(),
    distinct_claim_ids_required: z.boolean(),
    partial_resolution_projection_required: z.boolean(),
    metadata_pseudo_claims_forbidden: z.literal(true),
    lexical_splitting_forbidden: z.literal(true)
  })
  .strict();

export const V17ProfilingCanaryFixtureSchema = z
  .object({
    fixture_version: z.literal("formative-conversation-v17-profiling-canary-v1"),
    case_type: z.literal("profiling_contract_canary"),
    case_id: ProfilingCaseIdSchema,
    case_order: z.number().int().min(1).max(3),
    title: z.string().min(1),
    synthetic_only: z.literal(true),
    real_student_information_present: z.literal(false),
    provider_input: StudentProfilingInput,
    catalog_identity_scope_template: z.string().min(1),
    expected_catalog: ProfilingCatalogExpectationSchema,
    case_assertions: z.array(ProfilingAssertionSchema).min(1),
    call_graph: z
      .object({
        agent_name: z.literal("student_profiling_agent"),
        prompt_version: z.literal("student-profiling-v4"),
        schema_version: z.literal("student-profile-output-v3"),
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

const V17FormativeFixtureObjectSchema = z
  .object({
    fixture_version: z.literal("formative-conversation-v17-formative-case-v1"),
    case_type: z.literal("formative_conversation"),
    case_id: FormativeCaseIdSchema,
    case_order: z.number().int().min(4).max(11),
    source_v16_fixture_sha256: HashSchema,
    formative_fixture: V16FormativeFixtureSchema,
    fixture_hash: HashSchema
  })
  .strict();

export const V17FormativeFixtureSchema =
  V17FormativeFixtureObjectSchema.superRefine((value, context) => {
    if (value.formative_fixture.case_id !== value.case_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formative_fixture", "case_id"],
        message: "v17_formative_fixture_case_identity_mismatch"
      });
    }
    const indicators = value.formative_fixture.initial_profile_source.profile
      .misconception_indicators;
    if (
      value.formative_fixture.initial_profile_source.profile.prompt_version !==
        "student-profiling-v4" ||
      value.formative_fixture.initial_profile_source.profile.schema_version !==
        "student-profile-output-v3" ||
      indicators.some(
        (indicator) =>
          !indicator.atomic_claims || indicator.atomic_claims.length === 0
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formative_fixture", "initial_profile_source"],
        message: "v17_formative_fixture_canonical_claim_catalog_source_invalid"
      });
    }
  });

export const FormativeConversationV17FixtureSchema = z.union([
  V17ProfilingCanaryFixtureSchema,
  V17FormativeFixtureSchema
]);
export type FormativeConversationV17Fixture = z.infer<
  typeof FormativeConversationV17FixtureSchema
>;
export type FormativeConversationV17ProfilingFixture = z.infer<
  typeof V17ProfilingCanaryFixtureSchema
>;
export type FormativeConversationV17FormativeFixture = z.infer<
  typeof V17FormativeFixtureSchema
>;

const CompiledNamespaceSchema = z
  .object({
    run_namespace_template: z.literal("<provider_run_id>"),
    case_namespace_template: z.string().min(1),
    collision_check_key: HashSchema
  })
  .strict();

const CompiledProfilingCaseSchema = z
  .object({
    compiled_case_version: z.literal("formative-conversation-v17-compiled-case-v1"),
    case_type: z.literal("profiling_contract_canary"),
    case_id: ProfilingCaseIdSchema,
    case_order: z.number().int().min(1).max(3),
    title: z.string().min(1),
    fixture_hash: HashSchema,
    fixture_file_sha256: HashSchema,
    namespace: CompiledNamespaceSchema,
    provider_input: StudentProfilingInput,
    catalog_identity_scope_template: z.string().min(1),
    expected_catalog: ProfilingCatalogExpectationSchema,
    case_assertions: z.array(ProfilingAssertionSchema).min(1),
    call_graph: V17ProfilingCanaryFixtureSchema.shape.call_graph,
    compilation_status: z.literal("compiled")
  })
  .strict();

const CompiledFormativeCaseSchema = z
  .object({
    compiled_case_version: z.literal("formative-conversation-v17-compiled-case-v1"),
    case_type: z.literal("formative_conversation"),
    case_id: FormativeCaseIdSchema,
    case_order: z.number().int().min(4).max(11),
    title: z.string().min(1),
    fixture_hash: HashSchema,
    fixture_file_sha256: HashSchema,
    source_v16_fixture_sha256: HashSchema,
    namespace: CompiledNamespaceSchema,
    formative_case: V16FormativeCompiledCaseSchema,
    compilation_status: z.literal("compiled")
  })
  .strict();

export const FormativeConversationV17CompiledCaseSchema = z.discriminatedUnion(
  "case_type",
  [CompiledProfilingCaseSchema, CompiledFormativeCaseSchema]
);
export type FormativeConversationV17CompiledCase = z.infer<
  typeof FormativeConversationV17CompiledCaseSchema
>;

export const FormativeConversationV17BudgetSchema = z
  .object({
    base_profiling_call_count: z.literal(3),
    base_formative_call_count: z.literal(21),
    expected_logical_call_count: z.literal(24),
    maximum_semantic_regeneration_count: z.literal(11),
    maximum_logical_call_count: z.literal(35),
    expected_provider_attempt_count: z.literal(24),
    maximum_provider_attempt_count: z.literal(105),
    maximum_transport_retries_per_logical_call: z.literal(2),
    maximum_input_token_count: z.literal(1_100_000),
    maximum_output_token_count: z.literal(125_500),
    maximum_total_token_count: z.literal(1_225_500),
    maximum_wall_clock_duration_ms: z.literal(7_200_000),
    maximum_concurrency: z.literal(1),
    maximum_cost_usd: z.literal(40),
    pricing_metadata_status: z.literal("unavailable"),
    cost_enforcement: z.literal(
      "operator_ceiling_required_actual_estimate_recorded_when_available"
    ),
    maximum_semantic_regenerations_per_agent_call: z.literal(1)
  })
  .strict();
export type FormativeConversationV17Budget = z.infer<
  typeof FormativeConversationV17BudgetSchema
>;

export const FormativeConversationV17CompiledPlanSchema = z
  .object({
    compiled_plan_version: z.literal("formative-conversation-v17-compiled-plan-v1"),
    compilation_status: z.literal("ready_for_dispatch"),
    runtime_candidate_hash: HashSchema,
    evaluation_protocol_hash: HashSchema,
    runner_implementation_hash: HashSchema,
    live_environment_contract_hash: HashSchema,
    fixture_manifest_hash: HashSchema,
    aggregate_fixture_hash: HashSchema,
    fixed_case_order: z.array(CaseIdSchema).length(11),
    cases: z.array(FormativeConversationV17CompiledCaseSchema).length(11),
    aggregate_call_graph: z
      .object({
        profiling_base_call_count: z.literal(3),
        formative_opening_call_count: z.literal(8),
        formative_student_message_call_count: z.literal(13),
        formative_base_call_count: z.literal(21),
        expected_base_call_count: z.literal(24),
        maximum_semantic_regeneration_count: z.literal(11),
        maximum_logical_call_count: z.literal(35),
        maximum_provider_attempt_count: z.literal(105)
      })
      .strict(),
    budget: FormativeConversationV17BudgetSchema,
    isolated_namespaces: z.array(z.string().min(1)).length(11),
    intended_output_artifact_locations: z.array(z.string().min(1)).min(1),
    approval_inactive: z.literal(true),
    activation_permitted: z.literal(false),
    provider_calls_during_compilation: z.literal(0),
    network_requests_to_provider_during_compilation: z.literal(0),
    compiled_plan_hash: HashSchema
  })
  .strict();
export type FormativeConversationV17CompiledPlan = z.infer<
  typeof FormativeConversationV17CompiledPlanSchema
>;

export const FORMATIVE_CONVERSATION_V17_SECURITY_CONTRACT_IDENTITY = {
  control_schema_version: FORMATIVE_CONVERSATION_V17_CONTROL_SCHEMA_VERSION,
  preventive_scanner_version:
    FORMATIVE_CONVERSATION_V17_PREVENTIVE_SCANNER_VERSION,
  release_policy_version: FORMATIVE_CONVERSATION_V17_RELEASE_POLICY_VERSION,
  scan_attestation_version:
    FORMATIVE_CONVERSATION_V17_SCAN_ATTESTATION_VERSION,
  scan_attestation_schema_fingerprint:
    FORMATIVE_CONVERSATION_V17_SCAN_ATTESTATION_SCHEMA_FINGERPRINT,
  security_wrapper_version: FORMATIVE_CONVERSATION_V17_SECURITY_WRAPPER_VERSION
} as const;
