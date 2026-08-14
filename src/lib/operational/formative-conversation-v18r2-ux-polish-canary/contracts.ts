import { z } from "zod";
import { FormativeConversationV18R2AgentInputSchema } from "@/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";

export const V18R2_UX_CANARY_REVISION =
  "formative-conversation-v18r2-ux-polish-targeted-canary-v1" as const;
export const V18R2_UX_CANARY_ROOT =
  "config/operational-candidates/formative-conversation-v18r2-ux-polish-targeted-canary";
export const V18R2_UX_CANARY_FIXTURE_ROOT = `${V18R2_UX_CANARY_ROOT}/fixtures`;
export const V18R2_UX_CANARY_DATA_ROOT =
  ".data/operational-formative-conversation-v18r2-ux-polish-targeted-canary";
export const V18R2_UX_CANARY_PLAN_ROOT = `${V18R2_UX_CANARY_DATA_ROOT}/plans`;
export const V18R2_UX_CANARY_DISPATCH_ROOT = `${V18R2_UX_CANARY_DATA_ROOT}/checkpoints`;

export const V18R2_UX_CANARY_CASE_ORDER = [
  "uxc_01_direct_answer",
  "uxc_02_explain_differently",
  "uxc_03_persistent_misconception",
  "uxc_04_natural_opening"
] as const;

export const V18R2_UX_CANARY_MACHINE_CRITERIA = [
  "structured_response_valid",
  "privacy_and_assessment_truth_boundary_valid",
  "legacy_activity_contamination_absent",
  "nonterminal_or_transition_contract_valid",
  "formative_lifecycle_valid",
  "opening_acceptance_valid_when_applicable"
] as const;

export const V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS = [
  "conversational_naturalness",
  "unnecessary_appended_question",
  "alternate_explanation_genuinely_different",
  "immediate_student_intent_followed",
  "persistent_misconception_handling_responsive_not_scripted",
  "detail_level_appropriate"
] as const;

export const V18R2_UX_CANARY_BUDGET = {
  base_profiling_call_count: 0,
  base_formative_call_count: 4,
  expected_logical_call_count: 4,
  maximum_semantic_regeneration_count: 4,
  maximum_logical_call_count: 8,
  expected_provider_attempt_count: 4,
  maximum_provider_attempt_count: 24,
  maximum_transport_retries_per_logical_call: 2,
  maximum_input_token_count: 400_000,
  maximum_output_token_count: 56_000,
  maximum_total_token_count: 456_000,
  maximum_wall_clock_duration_ms: 1_800_000,
  maximum_concurrency: 1,
  maximum_cost_usd: 15,
  pricing_metadata_status: "unavailable",
  cost_enforcement:
    "operator_ceiling_required_actual_estimate_recorded_when_available",
  maximum_semantic_regenerations_per_agent_call: 1
} as const;

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const CaseIdSchema = z.enum(V18R2_UX_CANARY_CASE_ORDER);

export const V18R2UxCanaryBudgetSchema = z
  .object({
    base_profiling_call_count: z.literal(0),
    base_formative_call_count: z.literal(4),
    expected_logical_call_count: z.literal(4),
    maximum_semantic_regeneration_count: z.literal(4),
    maximum_logical_call_count: z.literal(8),
    expected_provider_attempt_count: z.literal(4),
    maximum_provider_attempt_count: z.literal(24),
    maximum_transport_retries_per_logical_call: z.literal(2),
    maximum_input_token_count: z.literal(400_000),
    maximum_output_token_count: z.literal(56_000),
    maximum_total_token_count: z.literal(456_000),
    maximum_wall_clock_duration_ms: z.literal(1_800_000),
    maximum_concurrency: z.literal(1),
    maximum_cost_usd: z.literal(15),
    pricing_metadata_status: z.literal("unavailable"),
    cost_enforcement: z.literal(
      "operator_ceiling_required_actual_estimate_recorded_when_available"
    ),
    maximum_semantic_regenerations_per_agent_call: z.literal(1)
  })
  .strict();

export const V18R2UxCanaryProtocolSchema = z
  .object({
    protocol_version: z.literal(
      "formative-conversation-v18r2-ux-canary-executable-v1"
    ),
    candidate_revision: z.literal(V18R2_UX_CANARY_REVISION),
    runtime_candidate_hash: HashSchema,
    formative_prompt_version: z.literal("formative-conversation-host-v7.2"),
    formative_prompt_hash: HashSchema,
    base_ux_candidate_identity_hash: HashSchema,
    base_ux_no_provider_protocol_hash: HashSchema,
    runner_implementation_hash: HashSchema,
    materializer_implementation_hash: HashSchema,
    fixture_manifest_hash: HashSchema,
    aggregate_fixture_hash: HashSchema,
    live_environment_contract_hash: HashSchema,
    dispatch_checkpoint_contract_hash: HashSchema,
    provenance_contract_hash: HashSchema,
    security_wrapper_hash: HashSchema,
    fixed_case_order: z.tuple([
      z.literal("uxc_01_direct_answer"),
      z.literal("uxc_02_explain_differently"),
      z.literal("uxc_03_persistent_misconception"),
      z.literal("uxc_04_natural_opening")
    ]),
    canary_count: z.literal(4),
    machine_validation_criteria: z
      .array(z.enum(V18R2_UX_CANARY_MACHINE_CRITERIA))
      .length(V18R2_UX_CANARY_MACHINE_CRITERIA.length),
    human_review_dimensions: z
      .array(z.enum(V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS))
      .length(V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS.length),
    human_judgment_first: z.literal(true),
    deterministic_ux_wording_assertions: z.literal(false),
    budget: V18R2UxCanaryBudgetSchema,
    no_selective_reruns: z.literal(true),
    full_v18r2_evaluation_permitted: z.literal(false),
    provider_calls_during_materialization: z.literal(0),
    model_auth_requests_during_materialization: z.literal(0),
    generation_network_requests_during_materialization: z.literal(0),
    real_dispatch_checkpoints_during_materialization: z.literal(0),
    live_execution_prepared: z.literal(true),
    approval_eligible: z.literal(false),
    activation_permitted: z.literal(false),
    protocol_hash: HashSchema
  })
  .strict();

export const V18R2UxCanaryFixtureSchema = z
  .object({
    fixture_version: z.literal(
      "formative-conversation-v18r2-ux-polish-live-canary-fixture-v1"
    ),
    case_id: CaseIdSchema,
    case_order: z.number().int().min(1).max(4),
    title: z.string().min(1),
    purpose: z.string().min(1),
    synthetic_only: z.literal(true),
    real_student_information_present: z.literal(false),
    opening_case: z.boolean(),
    context: FormativeConversationV18R2AgentInputSchema,
    historical_reference: z
      .object({
        reference_id: z.string().min(1),
        message: z.string().min(1),
        prior_issue_code: z.literal(
          "opening_assessment_acknowledgement_missing"
        ),
        revised_validator_accepts_reference: z.literal(true)
      })
      .strict()
      .nullable(),
    machine_validation_criteria: z
      .array(z.enum(V18R2_UX_CANARY_MACHINE_CRITERIA))
      .length(V18R2_UX_CANARY_MACHINE_CRITERIA.length),
    human_review_dimensions: z
      .array(z.enum(V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS))
      .length(V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS.length),
    deterministic_ux_wording_assertions: z.literal(false),
    call_graph: z
      .object({
        agent_name: z.literal("formative_conversation_agent"),
        base_logical_calls: z.literal(1),
        maximum_semantic_regenerations: z.literal(1),
        maximum_logical_calls: z.literal(2),
        maximum_provider_attempts_per_logical_call: z.literal(3),
        maximum_transport_retries_per_logical_call: z.literal(2)
      })
      .strict(),
    fixture_hash: HashSchema
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.case_order !== V18R2_UX_CANARY_CASE_ORDER.indexOf(fixture.case_id) + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["case_order"],
        message: "v18r2_ux_canary_case_order_mismatch"
      });
    }
    if (
      fixture.opening_case !== (fixture.case_id === "uxc_04_natural_opening") ||
      fixture.opening_case !== (fixture.context.latest_student_message === null) ||
      fixture.opening_case !== (fixture.historical_reference !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["opening_case"],
        message: "v18r2_ux_canary_opening_identity_mismatch"
      });
    }
  });

export type V18R2UxCanaryFixture = z.infer<
  typeof V18R2UxCanaryFixtureSchema
>;
export type V18R2UxCanaryBudget = z.infer<
  typeof V18R2UxCanaryBudgetSchema
>;
export type V18R2UxCanaryProtocol = z.infer<
  typeof V18R2UxCanaryProtocolSchema
>;

export const V18R2_UX_CANARY_ARTIFACT_PATHS = {
  runtime_manifest: `${V18R2_UX_CANARY_ROOT}/runtime-candidate-manifest.json`,
  base_candidate_reference: `${V18R2_UX_CANARY_ROOT}/base-ux-candidate-reference.json`,
  source_configuration: `${V18R2_UX_CANARY_ROOT}/source-configuration.json`,
  fixture_manifest: `${V18R2_UX_CANARY_ROOT}/fixture-manifest.json`,
  environment_contract: `${V18R2_UX_CANARY_ROOT}/live-environment-contract.json`,
  checkpoint_contract: `${V18R2_UX_CANARY_ROOT}/dispatch-checkpoint-contract.json`,
  security_manifest: `${V18R2_UX_CANARY_ROOT}/security-wrapper-manifest.json`,
  provenance_contract: `${V18R2_UX_CANARY_ROOT}/provenance-contract.json`,
  protocol: `${V18R2_UX_CANARY_ROOT}/executable-evaluation-protocol.json`,
  compiled_plan: `${V18R2_UX_CANARY_ROOT}/compiled-execution-plan.json`,
  candidate_manifest: `${V18R2_UX_CANARY_ROOT}/candidate-manifest.json`,
  candidate_identity: `${V18R2_UX_CANARY_ROOT}/candidate-identity.json`,
  approval_placeholder: `${V18R2_UX_CANARY_ROOT}/approval-evidence-placeholder.json`,
  authorization: `${V18R2_UX_CANARY_ROOT}/live-execution-authorization.json`,
  live_document: `${V18R2_UX_CANARY_ROOT}/LIVE_EXECUTION.md`
} as const;

export const V18R2_UX_CANARY_RUNNER_SOURCE_PATHS = [
  "scripts/operational-formative-conversation-v18r2-ux-polish-canary-launcher.mjs",
  "scripts/operational-formative-conversation-v18r2-ux-polish-canary-process-local-runner.mjs",
  "prisma/operational-formative-conversation-v18r2-ux-polish-canary-evaluate.ts",
  "src/lib/operational/formative-conversation-v18r2-ux-polish-canary/contracts.ts",
  "src/lib/operational/formative-conversation-v18r2-ux-polish-canary/package.ts",
  "src/lib/operational/formative-conversation-v18r2-ux-polish-canary/environment.ts",
  "src/lib/operational/formative-conversation-v18r2-ux-polish-canary/service.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/candidate-runner.ts",
  "src/lib/services/student-assessment/formative-conversation/execution-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/live-runner-v18r2.ts",
  "src/lib/llm/provider-transport-retry.ts"
] as const;

export const V18R2_UX_CANARY_SECURITY_SOURCE_PATHS = [
  "scripts/operational-formative-conversation-v18r2-ux-polish-canary-process-local-runner.mjs",
  "scripts/operational-formative-conversation-v18r2-ux-polish-canary-launcher.mjs",
  "prisma/operational-formative-conversation-v18r2-ux-polish-canary-evaluate.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v18r2/security-release.ts"
] as const;

export const V18R2_UX_CANARY_INTENDED_LIVE_ARTIFACTS = [
  "source-provider-run.json",
  "aggregate-evaluation.json",
  "human-review-package.json",
  "provenance-manifest.json",
  "artifact-hash-manifest.json"
] as const;
