import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  readApprovedOperationalAgentConfig,
  stableHash
} from "@/lib/agents/operational/approved-config";
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

const CandidateRoleConfigSchema = z.object({
  model_name: z.string().min(1),
  reasoning_effort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
  max_output_tokens: z.number().int().positive()
}).strict();

const CandidateConfigSchema = z.object({
  manifest_version: z.string().min(1),
  approval_state: z.literal("candidate_not_approved"),
  baseline_manifest_path: z.string().min(1),
  candidate_profile_name: z.string().min(1),
  evaluation_required: z.literal(true),
  human_review_required: z.literal(true),
  student_facing_operational_use_approved: z.literal(false),
  teacher_tool_use_approved: z.literal(false),
  roles: z.record(z.enum(liveModelRoles), CandidateRoleConfigSchema),
  acceptance_criteria: z.record(z.string(), z.union([z.boolean(), z.number()]))
}).strict();

export type CandidateOperationalModelConfig = z.infer<typeof CandidateConfigSchema>;

export type ModelUpgradeComparison = ReturnType<typeof buildOperationalModelUpgradeComparison>;

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

export function readCandidateOperationalModelConfig() {
  return CandidateConfigSchema.parse(
    JSON.parse(readFileSync(GPT56_CANDIDATE_CONFIG_PATH, "utf8"))
  );
}

export function candidateOperationalModelHash(candidate = readCandidateOperationalModelConfig()) {
  return stableHash(candidate);
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

export function buildOperationalModelUpgradeComparison() {
  const baseline = readApprovedOperationalAgentConfig();
  const candidate = readCandidateOperationalModelConfig();
  const candidateHash = candidateOperationalModelHash(candidate);
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
      manifest_path: "config/candidate-operational-agent-config.gpt-5.6.json",
      profile_name: candidate.candidate_profile_name,
      manifest_version: candidate.manifest_version,
      approval_state: candidate.approval_state,
      candidate_configuration_hash: candidateHash,
      evaluation_required: candidate.evaluation_required,
      human_review_required: candidate.human_review_required,
      student_facing_operational_use_approved: candidate.student_facing_operational_use_approved,
      teacher_tool_use_approved: candidate.teacher_tool_use_approved,
      acceptance_criteria: candidate.acceptance_criteria
    },
    fixtures: {
      identical_fixture_set_required: true,
      fixture_count: sharedSyntheticFixtures.length,
      fixture_ids: sharedSyntheticFixtures
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
        "unsupported_claim_rate",
        "distractor_use_quality",
        "uncertainty_calibration"
      ],
      safety: [
        "answer_key_leakage_count",
        "hidden_prompt_leakage_count",
        "teacher_note_leakage_count",
        "unsupported_misconduct_or_ability_claim_count"
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

export function summarizeModelUpgradePreflight() {
  const comparison = buildOperationalModelUpgradeComparison();
  return {
    status: comparison.compatibility_ok ? "ready_for_no_live_evaluation" : "blocked_by_configuration",
    no_provider_call: true,
    candidate_hash: comparison.candidate.candidate_configuration_hash,
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
    live_evaluation_command:
      "RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL=1 npm run operational:model-upgrade:live-eval -- --confirm-paid-api",
    approval_command:
      "npm run operational:model-upgrade:approve -- --candidate-run <run_public_id> --expected-hash <candidate_hash> --confirm \"approve GPT-5.6 operational candidate\""
  };
}
