import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  readApprovedOperationalAgentConfig,
} from "@/lib/agents/operational/approved-config";
import {
  modelUpgradeCandidateRuntimeHash,
  modelUpgradeCandidateRuntimeSnapshot
} from "@/lib/operational/model-upgrade-candidate-identity";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  liveModelRoles,
  modelConfigCompatibilityIssues,
  type LiveModelRole,
  type ReasoningEffort
} from "@/lib/llm/config";

export const GPT56_CANDIDATE_CONFIG_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.gpt-5.6.json"
);

export const MINIMAL_LIVE_STUDENT_DIALOGUE_CANDIDATE_CONFIG_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.minimal-live-student-dialogue.json"
);

export const FULL_GPT56_V2_CANDIDATE_CONFIG_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.gpt-5.6-full-v2.json"
);

const CandidateRoleConfigSchema = z.object({
  model_name: z.string().min(1),
  reasoning_effort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
  max_output_tokens: z.number().int().positive()
}).strict();

const CandidateRoleVersionMetadataSchema = z.object({
  prompt_version: z.string().min(1).optional(),
  prompt_hash: z.string().min(1).optional(),
  prompt_hash_semantics: z.enum(["prompt_text", "deterministic_config_not_applicable"]).optional(),
  input_schema_version: z.string().min(1).optional(),
  output_schema_version: z.string().min(1).optional(),
  schema_version: z.string().min(1).optional(),
  validator_version: z.string().min(1).optional(),
  safety_validator_version: z.string().min(1).optional(),
  fallback_version: z.string().min(1).optional(),
  canonicalization_version: z.string().min(1).optional(),
  deterministic_guard_version: z.string().min(1).optional()
}).strict();

const CandidateRuntimePolicySchema = z.object({
  provider_timeout_ms: z.number().int().positive(),
  provider_max_retries: z.number().int().nonnegative().optional(),
  role_live_toggles: z.object({
    student_communication_agent: z.literal(true),
    topic_dialogue_agent: z.literal(true)
  }).strict(),
  topic_dialogue_policy: z.object({
    maximum_student_turns: z.number().int().positive(),
    recent_raw_turn_window: z.number().int().positive(),
    maximum_student_message_characters: z.number().int().positive(),
    assessment_system_questions_allowed: z.boolean()
  }).strict()
}).strict();

const CandidateConfigurationFingerprintSchema = z.object({
  approved_baseline_manifest_path: z.string().min(1),
  approved_baseline_config_hash: z.string().min(1),
  approved_baseline_active_configuration_hash: z.string().min(1),
  semantic_validator_version: z.string().min(1),
  safety_validator_version: z.string().min(1),
  effective_result_version: z.string().min(1),
  effective_validator_version: z.string().min(1),
  deterministic_guard_versions: z.record(z.string(), z.string().min(1)),
  canonicalization_versions: z.record(z.string(), z.string().min(1)),
  fallback_versions: z.record(z.string(), z.string().min(1)),
  role_version_metadata: z.record(z.string(), CandidateRoleVersionMetadataSchema)
}).strict();

const CandidateConfigSchema = z.object({
  manifest_version: z.string().min(1),
  approval_state: z.literal("candidate_not_approved"),
  baseline_manifest_path: z.string().min(1),
  candidate_profile_name: z.string().min(1),
  evaluation_required: z.literal(true),
  human_review_required: z.literal(true),
  student_facing_output_human_review_required: z.boolean().optional(),
  student_facing_operational_use_approved: z.literal(false),
  teacher_tool_use_approved: z.literal(false),
  roles: z.record(z.enum(liveModelRoles), CandidateRoleConfigSchema),
  runtime_policy: CandidateRuntimePolicySchema.optional(),
  configuration_fingerprint: CandidateConfigurationFingerprintSchema.optional(),
  evaluation_cases: z.array(z.string().min(1)).optional(),
  acceptance_criteria: z.record(z.string(), z.union([z.boolean(), z.number()]))
}).strict();

export type CandidateOperationalModelConfig = z.infer<typeof CandidateConfigSchema>;

export type ModelUpgradeComparison = ReturnType<typeof buildOperationalModelUpgradeComparison>;

export type ModelUpgradeComparisonOptions = {
  manifestPath?: string;
};

const baselineDefaultMaxTokens: Partial<Record<LiveModelRole, number>> = {
  item_verification_agent: 3000,
  item_administration_tutor_agent: 1200,
  response_collection_agent: 1500,
  student_profiling_agent: 4000,
  profile_integration_agent: 3000,
  formative_value_and_planning_agent: 3000,
  formative_value_determination_agent: 2500,
  followup_agent: 2500,
  formative_activity_dialogue_agent: 3500,
  formative_activity_quality_reviewer_agent: 2500,
  formative_activity_response_evaluator_agent: 3000,
  post_activity_evidence_evaluator_agent: 3000,
  student_communication_agent: 2500,
  topic_dialogue_agent: 3500,
  mcq_diagnostic_authoring_assistant_agent: 2500,
  mcq_import_formatting_assistant_agent: 3000,
  connectivity_test: 200
};

const roleSurface: Record<LiveModelRole, "student_operational" | "teacher_tool" | "utility"> = {
  item_verification_agent: "student_operational",
  item_administration_tutor_agent: "student_operational",
  response_collection_agent: "student_operational",
  student_profiling_agent: "student_operational",
  profile_integration_agent: "student_operational",
  formative_value_and_planning_agent: "student_operational",
  formative_value_determination_agent: "student_operational",
  followup_agent: "student_operational",
  formative_activity_dialogue_agent: "student_operational",
  formative_activity_quality_reviewer_agent: "student_operational",
  formative_activity_response_evaluator_agent: "student_operational",
  post_activity_evidence_evaluator_agent: "student_operational",
  student_communication_agent: "student_operational",
  topic_dialogue_agent: "student_operational",
  mcq_diagnostic_authoring_assistant_agent: "teacher_tool",
  mcq_import_formatting_assistant_agent: "teacher_tool",
  connectivity_test: "utility"
};

const sharedSyntheticFixtures = [
  "fixed_irt_initial_package_clean_reasoning",
  "fixed_irt_initial_package_mixed_reasoning",
  "fixed_irt_content_question_deferred",
  "fixed_irt_low_information_reasoning",
  "profile_integration_conflicting_evidence",
  "formative_value_conceptual_entry",
  "formative_activity_distractor_probe",
  "post_activity_misconception_weakened",
  "followup_move_on_request",
  "teacher_mcq_import_diagnostic_authoring"
];

export const minimalLiveStudentDialogueEvaluationCases = [
  "what",
  "about_what",
  "which_item_do_you_mean",
  "request_for_an_example",
  "substantive_correct_answer",
  "partial_understanding",
  "specific_misconception",
  "assessment_system_question",
  "unrelated_question"
] as const;

export const fullGpt56V2EvaluationCases = [
  "item_verification_duplicate_advisory",
  "item_administration_what",
  "item_administration_about_what",
  "item_administration_which_item_do_you_mean",
  "item_administration_request_for_an_example",
  "response_collection_substantive_correct_answer",
  "response_collection_partial_understanding",
  "student_profiling_specific_misconception",
  "profile_integration_mixed_correctness",
  "formative_value_and_planning_distractor_first_selection",
  "formative_value_determination_conceptual_need",
  "followup_assessment_system_question",
  "formative_activity_distractor_probe",
  "formative_activity_quality_review",
  "formative_activity_response_evaluation",
  "post_activity_evidence_update",
  "student_communication_package_feedback",
  "topic_dialogue_unrelated_question",
  "teacher_mcq_diagnostic_authoring",
  "teacher_mcq_import_formatting",
  "connectivity_metadata_check"
] as const;

export function resolveCandidateManifestPath(manifestPath?: string) {
  if (!manifestPath) {
    return GPT56_CANDIDATE_CONFIG_PATH;
  }
  return path.isAbsolute(manifestPath) ? manifestPath : path.join(process.cwd(), manifestPath);
}

export function readCandidateOperationalModelConfig(manifestPath?: string) {
  return CandidateConfigSchema.parse(
    JSON.parse(readFileSync(resolveCandidateManifestPath(manifestPath), "utf8"))
  );
}

export function candidateOperationalModelHash(candidate = readCandidateOperationalModelConfig()) {
  return stableHash(candidate);
}

export function candidateRuntimeConfigurationSnapshot(candidate = readCandidateOperationalModelConfig()) {
  return modelUpgradeCandidateRuntimeSnapshot(candidate, liveModelRoles);
}

export function candidateActiveOperationalConfigSnapshot(candidate = readCandidateOperationalModelConfig()) {
  const baseline = readApprovedOperationalAgentConfig();
  const snapshot = {
    baseline_manifest_path: candidate.baseline_manifest_path,
    baseline_model_snapshot: baseline.model_snapshot,
    baseline_reasoning_effort: baseline.reasoning_effort,
    roles: Object.fromEntries(liveModelRoles.map((role) => [role, candidate.roles[role]])),
    runtime_policy: candidate.runtime_policy ?? null,
    evaluation_cases: candidate.evaluation_cases ?? sharedSyntheticFixtures,
    acceptance_criteria: candidate.acceptance_criteria,
    student_facing_output_human_review_required:
      candidate.student_facing_output_human_review_required ?? candidate.human_review_required
  };
  return candidate.configuration_fingerprint
    ? { ...snapshot, configuration_fingerprint: candidate.configuration_fingerprint }
    : snapshot;
}

export function candidateRuntimeConfigurationHash(candidate = readCandidateOperationalModelConfig()) {
  return modelUpgradeCandidateRuntimeHash(candidate, liveModelRoles);
}

export function candidateActiveOperationalConfigHash(candidate = readCandidateOperationalModelConfig()) {
  return stableHash(candidateActiveOperationalConfigSnapshot(candidate));
}

function baselineRoleConfig(role: LiveModelRole) {
  const approved = readApprovedOperationalAgentConfig();
  const approvedAgent = role in approved.agents
    ? approved.agents[role as keyof typeof approved.agents]
    : null;
  return {
    model_name: approved.model_snapshot,
    reasoning_effort: approved.reasoning_effort as ReasoningEffort,
    max_output_tokens: approvedAgent?.max_output_tokens ?? baselineDefaultMaxTokens[role] ?? 2500
  };
}

function changedFields(
  baseline: ReturnType<typeof baselineRoleConfig>,
  candidate: z.infer<typeof CandidateRoleConfigSchema>
) {
  return (["model_name", "reasoning_effort", "max_output_tokens"] as const)
    .filter((field) => baseline[field] !== candidate[field]);
}

export function buildOperationalModelUpgradeComparison(options: ModelUpgradeComparisonOptions = {}) {
  const baseline = readApprovedOperationalAgentConfig();
  const manifestPath = resolveCandidateManifestPath(options.manifestPath);
  const candidate = readCandidateOperationalModelConfig(manifestPath);
  const candidateHash = candidateOperationalModelHash(candidate);
  const candidateActiveHash = candidateActiveOperationalConfigHash(candidate);
  const runtimeCandidateHash = candidateRuntimeConfigurationHash(candidate);
  const evaluationCases = candidate.evaluation_cases ?? sharedSyntheticFixtures;
  const roleComparisons = liveModelRoles.map((role) => {
    const baselineConfig = baselineRoleConfig(role);
    const candidateConfig = candidate.roles[role];
    if (!candidateConfig) {
      throw new Error(`Candidate operational model config is missing ${role}.`);
    }
    const compatibilityIssues = modelConfigCompatibilityIssues(role, candidateConfig);
    return {
      role,
      surface: roleSurface[role],
      baseline: baselineConfig,
      candidate: candidateConfig,
      changed_fields: changedFields(baselineConfig, candidateConfig),
      compatibility_status: compatibilityIssues.length === 0 ? "compatible" : "incompatible",
      compatibility_issues: compatibilityIssues,
      approval_boundary:
        roleSurface[role] === "student_operational"
          ? role in baseline.agents ? "current_operational_manifest" : "operational_extension_required"
          : roleSurface[role] === "teacher_tool" ? "teacher_tool_review_required" : "utility"
    };
  });

  return {
    generated_at: new Date().toISOString(),
    no_provider_call: true,
    baseline: {
      manifest_path: "config/approved-operational-agent-config.json",
      model_snapshot: baseline.model_snapshot,
      reasoning_effort: baseline.reasoning_effort,
      approved_active_configuration_hash: baseline.approved_active_configuration_hash,
      config_hash: baseline.config_hash,
      evaluation_evidence: baseline.evaluation_evidence
    },
    candidate: {
      manifest_path: path.relative(process.cwd(), manifestPath),
      profile_name: candidate.candidate_profile_name,
      manifest_version: candidate.manifest_version,
      approval_state: candidate.approval_state,
      candidate_configuration_hash: candidateHash,
      runtime_candidate_hash: runtimeCandidateHash,
      candidate_active_configuration_hash: candidateActiveHash,
      evaluation_required: candidate.evaluation_required,
      human_review_required: candidate.human_review_required,
      student_facing_output_human_review_required:
        candidate.student_facing_output_human_review_required ?? candidate.human_review_required,
      student_facing_operational_use_approved: candidate.student_facing_operational_use_approved,
      teacher_tool_use_approved: candidate.teacher_tool_use_approved,
      runtime_policy: candidate.runtime_policy ?? null,
      configuration_fingerprint: candidate.configuration_fingerprint ?? null,
      acceptance_criteria: candidate.acceptance_criteria
    },
    fixtures: {
      identical_fixture_set_required: true,
      fixture_count: evaluationCases.length,
      fixture_ids: evaluationCases
    },
    metrics: {
      structured_output: [
        "schema_validation_pass_rate",
        "first_pass_validation_rate",
        "repair_rate",
        "unrecoverable_invalid_output_rate"
      ],
      diagnostic_quality: [
        "evidence_traceability",
        "claim_to_evidence_support_level",
        "observable_vs_latent_inference_separation",
        "pedagogical_quality_finding_count",
        "unsupported_claim_rate",
        "distractor_use_quality",
        "uncertainty_calibration"
      ],
      safety: [
        "answer_key_leakage_count",
        "hidden_prompt_leakage_count",
        "teacher_note_leakage_count",
        "unsupported_misconduct_motivation_effort_or_ability_claim_count",
        "unsupported_engagement_construct_claim_count"
      ],
      operational: [
        "latency_ms",
        "input_tokens",
        "output_tokens",
        "reasoning_tokens",
        "estimated_cost",
        "provider_error_rate"
      ]
    },
    role_comparisons: roleComparisons,
    compatibility_ok: roleComparisons.every((entry) => entry.compatibility_status === "compatible"),
    auto_approval_permitted: false
  };
}

export function summarizeModelUpgradePreflight(options: ModelUpgradeComparisonOptions = {}) {
  const comparison = buildOperationalModelUpgradeComparison(options);
  return {
    status: comparison.compatibility_ok ? "ready_for_no_live_evaluation" : "blocked_by_configuration",
    no_provider_call: true,
    candidate_hash: comparison.candidate.candidate_configuration_hash,
    runtime_candidate_hash: comparison.candidate.runtime_candidate_hash,
    candidate_active_configuration_hash: comparison.candidate.candidate_active_configuration_hash,
    compatibility_ok: comparison.compatibility_ok,
    incompatible_roles: comparison.role_comparisons
      .filter((entry) => entry.compatibility_status !== "compatible")
      .map((entry) => ({
        role: entry.role,
        issues: entry.compatibility_issues
      })),
    student_operational_roles_not_in_current_manifest: comparison.role_comparisons
      .filter((entry) => entry.approval_boundary === "operational_extension_required")
      .map((entry) => entry.role),
    changed_student_operational_extension_roles_requiring_approval: comparison.role_comparisons
      .filter((entry) =>
        entry.approval_boundary === "operational_extension_required" &&
        entry.changed_fields.length > 0
      )
      .map((entry) => entry.role),
    live_evaluation_command:
      `RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL=1 npm run operational:model-upgrade:live-eval -- --manifest ${comparison.candidate.manifest_path} --expected-runtime-hash ${comparison.candidate.runtime_candidate_hash} --expected-evaluation-protocol-hash <evaluation_protocol_hash_from_dry_run> --confirm-paid-api`,
    approval_command:
      `npm run operational:model-upgrade:approve -- --manifest ${comparison.candidate.manifest_path} --candidate-run <run_public_id> --expected-runtime-hash ${comparison.candidate.runtime_candidate_hash} --expected-evaluation-protocol-hash <evaluation_protocol_hash_from_run> --confirm "approve ${comparison.candidate.profile_name}"`
  };
}
