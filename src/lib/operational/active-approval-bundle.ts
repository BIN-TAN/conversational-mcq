import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  modelUpgradeCandidateRuntimeHash,
  modelUpgradeCandidateRuntimeSnapshot
} from "./model-upgrade-candidate-identity";
import { stableHash } from "./stable-hash";
import { MIXED_TUTOR_MODEL, MIXED_TUTOR_CANDIDATE_VERSION, MIXED_TUTOR_AMENDMENT_VERSION,
  lunaCandidateModelForRole } from "./mixed-tutor-identity";
import { LUNA_CONVERSATION_REPAIR, LUNA_CONVERSATION_REPAIR_CANDIDATE_VERSION,
  LUNA_CONVERSATION_REPAIR_AMENDMENT_VERSION, applyLunaConversationRepair,
  LUNA_SOL_DELIVERY_REVIEW_MODEL, LUNA_SOL_DELIVERY_REVIEW_CANDIDATE_VERSION,
  LUNA_SOL_DELIVERY_REVIEW_AMENDMENT_VERSION, LUNA_SOL_DELIVERY_REVIEW_AMENDMENT_KEY,
  applyLunaSolDeliveryReviewPolicy } from "./luna-conversation-repair-identity";
import { ScopedFeedbackBudgetSchema, type ScopedFeedbackBudget } from "./scoped-feedback-budget";
import { CONNECTIVITY_MAX_OUTPUT_TOKENS } from "../llm/connectivity-budget";
import { verifyLunaValidation, type LunaCandidateReasoningEffort } from "./luna-low-validation-evidence";
import { applyLunaProfileFidelityCorrection, LUNA_PROFILE_FIDELITY_CORRECTION,
  LUNA_MEDIUM_PROFILE_FIDELITY_CANDIDATE_VERSION, LUNA_MEDIUM_PROFILE_FIDELITY_AMENDMENT_VERSION } from "./luna-profile-fidelity-identity";
export { LUNA_LOW_ALL_ROLES_VALIDATION_VERSION, LunaLowAllRolesValidationSchema,
  LUNA_MEDIUM_ALL_ROLES_VALIDATION_VERSION, LunaMediumAllRolesValidationSchema } from "./luna-low-validation-evidence";

export const ACTIVE_APPROVAL_BUNDLE_VERSION = "operational-active-approval-bundle-v1";
export const ACTIVE_APPROVAL_RESOLVER_VERSION = "operational-active-approval-resolver-v1";
export const OPERATIONAL_MODEL_UPGRADE_ACTIVATION_VERSION = "operational-model-upgrade-activation-v1";
export const PLANNING_BUDGET_AMENDMENT_VERSION = "operational-planning-budget-amendment-v1";
export const PROFILING_REPAIR_AMENDMENT_VERSION = "profiling-v6-scoped-budget-amendment-v1";
export const GLOBAL_FEEDBACK_BUDGET_AMENDMENT_VERSION = "global-initial-feedback-budget-amendment-v1";
export const CONNECTIVITY_BUDGET_AMENDMENT_VERSION = "synthetic-connectivity-budget-amendment-v1";
export const SOL_LOW_REASONING_AMENDMENT_VERSION = "sol-low-feedback-conversation-amendment-v1";
export const SOL_LOW_REASONING_ROLES = ["formative_value_and_planning_agent", "formative_conversation_agent"] as const;
export const LUNA_LOW_ALL_ROLES_AMENDMENT_VERSION = "luna-low-all-roles-amendment-v1";
export const LUNA_MEDIUM_ALL_ROLES_AMENDMENT_VERSION = "luna-medium-all-roles-amendment-v1";
const PROFILING_V5_HASH = "c6dcc59c6698b2c9eb8082080bde122b3f29be7e2c7632066b9acbbbbbdaf626";
export const PROFILING_V6_HASH = "d9778ba1809c54f84ceb0d91c9f36e22897e8f9a9113768f42a5c728ce1430e8";
export const LOCAL_APPROVED_RUNTIME_MATERIALIZATION_VERSION =
  "operational-approved-runtime-local-materialization-v1";
export const LEGACY_GPT54_APPROVED_RUNTIME_HASH =
  "58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2";
const LEGACY_TOPIC_DIALOGUE_APPROVAL_MANIFEST_VERSION =
  "phase31at-gpt-5.6-full-v2-candidate-v6";

export const APPROVED_OPERATIONAL_ROLE_NAMES = [
  "item_verification_agent",
  "item_administration_tutor_agent",
  "response_collection_agent",
  "student_profiling_agent",
  "profile_integration_agent",
  "formative_value_and_planning_agent",
  "formative_value_determination_agent",
  "followup_agent",
  "formative_activity_dialogue_agent",
  "formative_activity_quality_reviewer_agent",
  "formative_activity_response_evaluator_agent",
  "post_activity_evidence_evaluator_agent",
  "student_communication_agent",
  "topic_dialogue_agent",
  "formative_conversation_agent",
  "mcq_diagnostic_authoring_assistant_agent",
  "mcq_import_formatting_assistant_agent",
  "connectivity_test"
] as const;

export type ApprovedOperationalRoleName = (typeof APPROVED_OPERATIONAL_ROLE_NAMES)[number];

const RoleNameSchema = z.enum(APPROVED_OPERATIONAL_ROLE_NAMES);
const RoleConfigSchema = z.object({
  model_name: z.string().min(1),
  reasoning_effort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
  max_output_tokens: z.number().int().positive()
}).strict();

const RuntimePolicySchema = z.object({
  initial_feedback_max_output_tokens: z.literal(30000).optional(),
  initial_feedback_budget_grants: z.array(ScopedFeedbackBudgetSchema).max(100).optional(),
  provider_timeout_ms: z.number().int().positive(),
  provider_max_retries: z.number().int().nonnegative(),
  role_live_toggles: z.object({
    student_communication_agent: z.boolean(),
    topic_dialogue_agent: z.boolean(),
    formative_conversation_agent: z.boolean().optional()
  }).strict(),
  topic_dialogue_policy: z.object({
    maximum_student_turns: z.number().int().positive(),
    recent_raw_turn_window: z.number().int().positive(),
    maximum_student_message_characters: z.number().int().positive(),
    assessment_system_questions_allowed: z.boolean()
  }).strict()
}).strict();

const FingerprintSchema = z.object({
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
  role_version_metadata: z.record(z.string(), z.record(z.string(), z.unknown()))
}).strict();

export const ApprovedCandidateManifestSchema = z.object({
  manifest_version: z.string().min(1),
  approval_state: z.literal("candidate_not_approved"),
  baseline_manifest_path: z.string().min(1),
  candidate_profile_name: z.string().min(1),
  evaluation_required: z.literal(true),
  human_review_required: z.literal(true),
  student_facing_output_human_review_required: z.boolean().optional(),
  student_facing_operational_use_approved: z.literal(false),
  teacher_tool_use_approved: z.literal(false),
  roles: z.record(RoleNameSchema, RoleConfigSchema),
  runtime_policy: RuntimePolicySchema,
  configuration_fingerprint: FingerprintSchema,
  evaluation_cases: z.array(z.string().min(1)).optional(),
  acceptance_criteria: z.record(z.string(), z.union([z.boolean(), z.number()]))
}).strict().superRefine((manifest, context) => {
  if (manifest.runtime_policy.initial_feedback_max_output_tokens && manifest.runtime_policy.initial_feedback_budget_grants?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["runtime_policy"],
      message: "Global initial feedback approval must replace individual grants." });
  }
  if (
    manifest.roles.formative_conversation_agent &&
    typeof manifest.runtime_policy.role_live_toggles.formative_conversation_agent !== "boolean"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runtime_policy", "role_live_toggles", "formative_conversation_agent"],
      message: "formative_conversation_agent requires its dedicated live-call toggle."
    });
  }
});

export type ApprovedCandidateManifest = z.infer<typeof ApprovedCandidateManifestSchema>;

export function approvedOperationalRoleNamesForManifest(
  manifest: Pick<ApprovedCandidateManifest, "manifest_version" | "roles">
): ApprovedOperationalRoleName[] {
  const legacyTopicDialogueApproval =
    manifest.manifest_version === LEGACY_TOPIC_DIALOGUE_APPROVAL_MANIFEST_VERSION &&
    manifest.roles.topic_dialogue_agent !== undefined &&
    manifest.roles.formative_conversation_agent === undefined;
  return APPROVED_OPERATIONAL_ROLE_NAMES.filter(
    (role) => role !== "formative_conversation_agent" || !legacyTopicDialogueApproval
  );
}

export function approvedCandidateRoleConfigResolution(
  manifest: ApprovedCandidateManifest,
  role: ApprovedOperationalRoleName
) {
  const config = manifest.roles[role];
  if (config) {
    return {
      config,
      approved_role: role,
      compatibility_used: false
    } as const;
  }
  if (
    role === "formative_conversation_agent" &&
    approvedOperationalRoleNamesForManifest(manifest).length < APPROVED_OPERATIONAL_ROLE_NAMES.length
  ) {
    const legacyConfig = manifest.roles.topic_dialogue_agent;
    if (legacyConfig) {
      return {
        config: legacyConfig,
        approved_role: "topic_dialogue_agent",
        compatibility_used: true
      } as const;
    }
  }
  throw new OperationalApprovalBundleError(
    "approved_role_missing",
    `Approved candidate manifest is missing ${role}.`
  );
}

export function approvedCandidateRoleConfig(
  manifest: ApprovedCandidateManifest,
  role: ApprovedOperationalRoleName
) {
  return approvedCandidateRoleConfigResolution(manifest, role).config;
}

export function approvedCandidateRoleLiveCallsEnabled(
  manifest: ApprovedCandidateManifest,
  role:
    | "student_communication_agent"
    | "topic_dialogue_agent"
    | "formative_conversation_agent"
) {
  if (role !== "formative_conversation_agent") {
    return manifest.runtime_policy.role_live_toggles[role];
  }
  const configured = manifest.runtime_policy.role_live_toggles.formative_conversation_agent;
  if (typeof configured === "boolean") {
    return configured;
  }
  if (
    approvedOperationalRoleNamesForManifest(manifest).length < APPROVED_OPERATIONAL_ROLE_NAMES.length
  ) {
    return manifest.runtime_policy.role_live_toggles.topic_dialogue_agent;
  }
  throw new OperationalApprovalBundleError(
    "approved_role_live_toggle_missing",
    "Approved candidate manifest is missing the formative conversation live-call toggle."
  );
}

const ApprovalEvidenceSchema = z.object({
  approval_command_version: z.string().min(1),
  approved_at: z.string().datetime(),
  source_provider_run_id: z.string().min(1),
  derived_evaluation_id: z.string().min(1),
  source_evaluation_protocol_hash: z.string().min(1),
  evaluation_protocol_hash: z.string().min(1),
  runtime_candidate_hash: z.string().length(64),
  source_artifact_sha256: z.string().length(64),
  approval_evidence_hash: z.string().length(64),
  exact_operational_approved_config_hash: z.string().length(64),
  rollback_hash: z.string().length(64),
  approved_manifest_artifact_path: z.string().min(1),
  human_review: z.record(z.string(), z.unknown())
}).passthrough();

export type OperationalApprovalEvidence = z.infer<typeof ApprovalEvidenceSchema>;

const FileReferenceSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().length(64)
}).strict();

const DerivedBundleRecordSchema = z.object({
  bundle_version: z.literal(ACTIVE_APPROVAL_BUNDLE_VERSION),
  resolver_version: z.literal(ACTIVE_APPROVAL_RESOLVER_VERSION),
  activation_version: z.literal(OPERATIONAL_MODEL_UPGRADE_ACTIVATION_VERSION),
  active_kind: z.literal("derived_approval"),
  activated_at: z.string().datetime(),
  runtime_candidate_hash: z.string().length(64),
  evaluation_protocol_hash: z.string().length(64),
  approval_evidence_hash: z.string().length(64),
  source_provider_run_id: z.string().min(1),
  derived_evaluation_id: z.string().min(1),
  approval_timestamp: z.string().datetime(),
  human_review_evidence_hash: z.string().length(64),
  approved_manifest: FileReferenceSchema,
  approval_evidence: FileReferenceSchema,
  rollback: z.object({
    approved_runtime_hash: z.string().length(64),
    manifest: FileReferenceSchema
  }).strict(),
  materialization_context: z.enum([
    "production_activation",
    "local_runtime_materialization"
  ]).optional()
}).strict();

const LegacyBundleRecordSchema = z.object({
  bundle_version: z.literal(ACTIVE_APPROVAL_BUNDLE_VERSION),
  resolver_version: z.literal(ACTIVE_APPROVAL_RESOLVER_VERSION),
  activation_version: z.literal(OPERATIONAL_MODEL_UPGRADE_ACTIVATION_VERSION),
  active_kind: z.literal("legacy_gpt54_baseline"),
  activated_at: z.string().datetime(),
  approved_runtime_hash: z.literal(LEGACY_GPT54_APPROVED_RUNTIME_HASH),
  legacy_manifest: FileReferenceSchema,
  previous_derived_approval: z.object({
    runtime_candidate_hash: z.string().length(64),
    evaluation_protocol_hash: z.string().length(64),
    approval_evidence_hash: z.string().length(64),
    source_provider_run_id: z.string().min(1),
    derived_evaluation_id: z.string().min(1),
    approved_manifest: FileReferenceSchema,
    approval_evidence: FileReferenceSchema
  }).strict()
}).strict();

const LocalLunaLowCandidateRecordSchema = z.object({
  version: z.literal("luna-low-all-roles-candidate-v1"),
  active_kind: z.literal("local_candidate_evaluation"),
  validation_pending: z.literal(true),
  production_activation_permitted: z.literal(false),
  runtime_candidate_hash: z.string().length(64),
  candidate_manifest: FileReferenceSchema,
  parent_manifest: FileReferenceSchema,
  parent_runtime_hash: z.string().length(64),
  parent_approval_verification: z.enum(["verified_locally", "not_reverified_locally"]),
  operator_authorization_reference: z.string().trim().min(1)
}).strict();

const LocalLunaCandidateRecordSchema = z.union([
  LocalLunaLowCandidateRecordSchema,
  LocalLunaLowCandidateRecordSchema.extend({ version: z.literal("luna-medium-all-roles-candidate-v1") }).strict(),
  LocalLunaLowCandidateRecordSchema.extend({ version: z.literal(LUNA_MEDIUM_PROFILE_FIDELITY_CANDIDATE_VERSION) }).strict(),
  LocalLunaLowCandidateRecordSchema.extend({ version: z.literal(MIXED_TUTOR_CANDIDATE_VERSION) }).strict(),
  LocalLunaLowCandidateRecordSchema.extend({ version: z.literal(LUNA_CONVERSATION_REPAIR_CANDIDATE_VERSION) }).strict(),
  LocalLunaLowCandidateRecordSchema.extend({ version: z.literal(LUNA_SOL_DELIVERY_REVIEW_CANDIDATE_VERSION) }).strict()
]);

const ActiveBundleRecordSchema = z.union([
  DerivedBundleRecordSchema, LegacyBundleRecordSchema, LocalLunaCandidateRecordSchema
]);
export type ActiveOperationalApprovalRecord = z.infer<typeof ActiveBundleRecordSchema>;

export type ApprovedOperationalRuntimeResolution = {
  requested_hash: string;
  resolved_hash: string | null;
  resolution_source: "approved_derived_bundle" | "legacy_fallback" | "none";
  approved_bundle_complete: boolean;
  role_count: number;
  missing_roles: string[];
  duplicate_roles: string[];
  mismatch_reasons: string[];
  bundle_path: string | null;
};

export class OperationalApprovalBundleError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "OperationalApprovalBundleError";
    this.code = code;
    this.details = details;
  }
}

export function defaultActiveApprovalDirectory() {
  return path.join(process.cwd(), ".data", "operational-model-upgrade", "active-approval");
}

export function defaultActiveApprovalBundlePath() {
  return path.join(defaultActiveApprovalDirectory(), "active-approval-bundle.json");
}

function sha256File(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function resolveStoredPath(bundlePath: string, storedPath: string) {
  return path.isAbsolute(storedPath) ? storedPath : path.resolve(path.dirname(bundlePath), storedPath);
}

function writeJsonAtomically(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
}

function assertFileHash(reference: z.infer<typeof FileReferenceSchema>, bundlePath: string, code: string) {
  const resolved = resolveStoredPath(bundlePath, reference.path);
  if (!existsSync(resolved) || sha256File(resolved) !== reference.sha256) {
    throw new OperationalApprovalBundleError(code, "Active approval artifact integrity verification failed.", {
      artifact_path: resolved
    });
  }
  return resolved;
}

function assertExactRoleInventory(manifest: ApprovedCandidateManifest) {
  const actualRoles = Object.keys(manifest.roles).sort();
  const approvedRoles = approvedOperationalRoleNamesForManifest(manifest);
  const expectedRoles = [...approvedRoles].sort();
  if (actualRoles.length !== expectedRoles.length || actualRoles.some((role, index) => role !== expectedRoles[index])) {
    throw new OperationalApprovalBundleError(
      "approved_role_inventory_mismatch",
      "Approved candidate manifest does not contain the exact operational role inventory.",
      { expected_role_count: expectedRoles.length, actual_role_count: actualRoles.length }
    );
  }

  const metadataRoles = Object.keys(manifest.configuration_fingerprint.role_version_metadata).sort();
  if (metadataRoles.length !== expectedRoles.length || metadataRoles.some((role, index) => role !== expectedRoles[index])) {
    throw new OperationalApprovalBundleError(
      "approved_role_version_inventory_mismatch",
      "Approved candidate version metadata does not contain the exact operational role inventory."
    );
  }
  if (
    approvedRoles.includes("formative_conversation_agent") &&
    typeof manifest.runtime_policy.role_live_toggles.formative_conversation_agent !== "boolean"
  ) {
    throw new OperationalApprovalBundleError(
      "approved_role_live_toggle_missing",
      "Approved candidate manifest is missing the formative conversation live-call toggle."
    );
  }
}

function humanReviewApproved(humanReview: Record<string, unknown>) {
  return humanReview.decision === "approve" && humanReview.semantic_review_confirmed === true;
}

export function verifyApprovedCandidateArtifacts(input: {
  approvedManifestPath: string;
  approvalEvidencePath: string;
  expectedRuntimeHash: string;
  expectedEvaluationProtocolHash: string;
  expectedApprovalEvidenceHash: string;
  expectedSourceProviderRunId?: string;
  expectedDerivedEvaluationId?: string;
  requireEvidenceManifestPathMatch?: boolean;
  approvalDepth?: number;
}) {
  // Preserve the four historical amendments and permit one prospective model-only amendment.
  if ((input.approvalDepth ?? 0) > 5) {
    throw new Error("Approval amendment ancestry is too deep.");
  }
  const manifest = ApprovedCandidateManifestSchema.parse(
    JSON.parse(readFileSync(input.approvedManifestPath, "utf8"))
  );
  const evidence = ApprovalEvidenceSchema.parse(
    JSON.parse(readFileSync(input.approvalEvidencePath, "utf8"))
  );
  assertExactRoleInventory(manifest);

  const approvedRoles = approvedOperationalRoleNamesForManifest(manifest);
  const runtimeHash = modelUpgradeCandidateRuntimeHash(manifest, approvedRoles);
  const recomputedApprovalEvidenceHash = stableHash({
    source_provider_run_id: evidence.source_provider_run_id,
    derived_evaluation_id: evidence.derived_evaluation_id,
    runtime_candidate_hash: evidence.runtime_candidate_hash,
    source_evaluation_protocol_hash: evidence.source_evaluation_protocol_hash,
    evaluation_protocol_hash: evidence.evaluation_protocol_hash,
    human_review: evidence.human_review
  });
  const issues = [
    ...(runtimeHash !== input.expectedRuntimeHash ? ["runtime_candidate_hash_mismatch"] : []),
    ...(evidence.runtime_candidate_hash !== input.expectedRuntimeHash ? ["approval_runtime_hash_mismatch"] : []),
    ...(evidence.exact_operational_approved_config_hash !== input.expectedRuntimeHash
      ? ["exact_approved_config_hash_mismatch"] : []),
    ...(evidence.evaluation_protocol_hash !== input.expectedEvaluationProtocolHash
      ? ["evaluation_protocol_hash_mismatch"] : []),
    ...(evidence.approval_evidence_hash !== input.expectedApprovalEvidenceHash
      ? ["approval_evidence_hash_mismatch"] : []),
    ...(recomputedApprovalEvidenceHash !== input.expectedApprovalEvidenceHash
      ? ["approval_evidence_integrity_mismatch"] : []),
    ...(input.expectedSourceProviderRunId && evidence.source_provider_run_id !== input.expectedSourceProviderRunId
      ? ["source_provider_run_id_mismatch"] : []),
    ...(input.expectedDerivedEvaluationId && evidence.derived_evaluation_id !== input.expectedDerivedEvaluationId
      ? ["derived_evaluation_id_mismatch"] : []),
    ...(input.requireEvidenceManifestPathMatch &&
      path.resolve(evidence.approved_manifest_artifact_path) !== path.resolve(input.approvedManifestPath)
      ? ["approved_manifest_artifact_path_mismatch"] : []),
    ...(evidence.approval_command_version === PLANNING_BUDGET_AMENDMENT_VERSION
      ? planningBudgetAmendmentIssues(manifest, evidence, input.approvalDepth ?? 0)
      : evidence.approval_command_version === PROFILING_REPAIR_AMENDMENT_VERSION
        ? profilingRepairAmendmentIssues(manifest, evidence, input.approvalDepth ?? 0)
        : evidence.approval_command_version === GLOBAL_FEEDBACK_BUDGET_AMENDMENT_VERSION
          ? globalFeedbackBudgetAmendmentIssues(manifest, evidence, input.approvalDepth ?? 0)
          : evidence.approval_command_version === CONNECTIVITY_BUDGET_AMENDMENT_VERSION
            ? connectivityBudgetAmendmentIssues(manifest, evidence, input.approvalDepth ?? 0)
            : evidence.approval_command_version === SOL_LOW_REASONING_AMENDMENT_VERSION
              ? solLowReasoningAmendmentIssues(manifest, evidence, input.approvalDepth ?? 0)
              : [LUNA_LOW_ALL_ROLES_AMENDMENT_VERSION, LUNA_MEDIUM_ALL_ROLES_AMENDMENT_VERSION,
                LUNA_MEDIUM_PROFILE_FIDELITY_AMENDMENT_VERSION, MIXED_TUTOR_AMENDMENT_VERSION,
                LUNA_CONVERSATION_REPAIR_AMENDMENT_VERSION, LUNA_SOL_DELIVERY_REVIEW_AMENDMENT_VERSION].includes(evidence.approval_command_version)
                ? lunaLowAllRolesAmendmentIssues(manifest, evidence, input.approvalDepth ?? 0)
        : !humanReviewApproved(evidence.human_review) ? ["human_approval_missing"] : [])
  ];
  if (issues.length > 0) {
    throw new OperationalApprovalBundleError(
      "approval_artifact_verification_failed",
      "Approved operational artifacts failed activation verification.",
      { issues }
    );
  }

  return {
    manifest,
    evidence,
    runtime_candidate_hash: runtimeHash,
    manifest_sha256: sha256File(input.approvedManifestPath),
    evidence_sha256: sha256File(input.approvalEvidencePath)
  };
}

// A budget-only authorization inherits the verified semantic approval; it does not
// claim that the old full evaluation was run with the new output allowance.
function planningBudgetAmendmentIssues(
  manifest: ApprovedCandidateManifest,
  evidence: OperationalApprovalEvidence,
  depth: number
): string[] {
  const amendment = z.object({
    parent_manifest: FileReferenceSchema,
    parent_evidence: FileReferenceSchema,
    canary_evidence: FileReferenceSchema,
    parent_runtime_hash: z.string().length(64),
    parent_protocol_hash: z.string().length(64),
    parent_approval_hash: z.string().length(64)
  }).strict().parse(evidence.planning_budget_amendment);
  for (const file of [amendment.parent_manifest, amendment.parent_evidence, amendment.canary_evidence]) {
    if (!path.isAbsolute(file.path) || sha256File(file.path) !== file.sha256) {
      throw new Error("Planning budget amendment evidence integrity mismatch.");
    }
  }
  const parent = verifyApprovedCandidateArtifacts({
    approvedManifestPath: amendment.parent_manifest.path,
    approvalEvidencePath: amendment.parent_evidence.path,
    expectedRuntimeHash: amendment.parent_runtime_hash,
    expectedEvaluationProtocolHash: amendment.parent_protocol_hash,
    expectedApprovalEvidenceHash: amendment.parent_approval_hash,
    approvalDepth: depth + 1
  });
  const expected = structuredClone(parent.manifest);
  const role = approvedCandidateRoleConfig(expected, "formative_value_and_planning_agent");
  const oldBudget = role.max_output_tokens;
  role.max_output_tokens = 10000;
  const canary = z.object({
    version: z.literal("initial-profile-budget-probe-v1"),
    synthetic_only: z.literal(true),
    real_student_data_used: z.literal(false),
    model: z.string(), reasoning_effort: z.string(),
    calls: z.array(z.object({
      item_count: z.number(), max_output_tokens: z.number(), status: z.string(),
      semantic_checks_passed: z.boolean().nullable()
    }))
  }).parse(JSON.parse(readFileSync(amendment.canary_evidence.path, "utf8")));
  const review = evidence.human_review;
  return [
    ...(oldBudget !== 3000 ? ["planning_amendment_unexpected_parent_budget"] : []),
    ...(stableHash(expected) !== stableHash(manifest) ? ["planning_amendment_changed_other_settings"] : []),
    ...(review.decision !== "approve" || review.scope !== "initial_feedback_budget_only" ||
      review.operator_authorized !== true || review.semantic_review_confirmed !== false ||
      typeof review.authorization_reference !== "string" || !review.authorization_reference.trim()
      ? ["planning_amendment_operator_authorization_missing"] : []),
    ...(evidence.source_artifact_sha256 !== amendment.canary_evidence.sha256 ||
      evidence.source_evaluation_protocol_hash !== parent.evidence.evaluation_protocol_hash ||
      evidence.rollback_hash !== parent.evidence.rollback_hash ||
      evidence.evaluation_protocol_hash !== stableHash(amendment)
      ? ["planning_amendment_provenance_mismatch"] : []),
    ...(canary.model !== role.model_name || canary.reasoning_effort !== role.reasoning_effort ||
      ![3, 12].every((size) => canary.calls.some((call) => call.item_count === size &&
        call.max_output_tokens === 10000 && call.status === "completed" && call.semantic_checks_passed))
      ? ["planning_amendment_canary_not_passed"] : [])
  ];
}

export function preparePlanningBudgetAmendment(input: {
  parent: ActiveDerivedOperationalApproval;
  expectedParentHash: string;
  canaryEvidencePath: string;
  outputDirectory: string;
  authorizationReference: string;
}) {
  const { parent } = input;
  if (parent.record.runtime_candidate_hash !== input.expectedParentHash ||
      !input.authorizationReference.trim()) throw new Error("Expected approval or authorization is missing.");
  const directory = path.resolve(input.outputDirectory);
  mkdirSync(directory, { recursive: false });
  const manifest = structuredClone(parent.manifest);
  approvedCandidateRoleConfig(manifest, "formative_value_and_planning_agent").max_output_tokens = 10000;
  const manifestPath = path.join(directory, "approved-candidate-manifest.json");
  const canaryPath = path.join(directory, "budget-canary.json");
  copyFileSync(input.canaryEvidencePath, canaryPath);
  const amendment = {
    parent_manifest: { path: parent.manifest_path, sha256: sha256File(parent.manifest_path) },
    parent_evidence: { path: parent.approval_evidence_path, sha256: sha256File(parent.approval_evidence_path) },
    canary_evidence: { path: canaryPath, sha256: sha256File(canaryPath) },
    parent_runtime_hash: parent.record.runtime_candidate_hash,
    parent_protocol_hash: parent.record.evaluation_protocol_hash,
    parent_approval_hash: parent.record.approval_evidence_hash
  };
  const runtimeHash = modelUpgradeCandidateRuntimeHash(manifest, approvedOperationalRoleNamesForManifest(manifest));
  const identity = {
    source_provider_run_id: `budget-canary:${amendment.canary_evidence.sha256}`,
    derived_evaluation_id: `${PLANNING_BUDGET_AMENDMENT_VERSION}:${runtimeHash}`,
    runtime_candidate_hash: runtimeHash,
    source_evaluation_protocol_hash: parent.evidence.evaluation_protocol_hash,
    evaluation_protocol_hash: stableHash(amendment),
    human_review: {
      decision: "approve", scope: "initial_feedback_budget_only", operator_authorized: true,
      semantic_review_confirmed: false, authorization_reference: input.authorizationReference,
      limitations: "Budget canaries only; full parent evaluation was not repeated. Parent semantic approval remains separately verified."
    }
  };
  const evidence: OperationalApprovalEvidence = {
    ...identity, approval_command_version: PLANNING_BUDGET_AMENDMENT_VERSION,
    approved_at: new Date().toISOString(), source_artifact_sha256: amendment.canary_evidence.sha256,
    approval_evidence_hash: stableHash(identity), exact_operational_approved_config_hash: runtimeHash,
    rollback_hash: parent.evidence.rollback_hash, approved_manifest_artifact_path: manifestPath,
    planning_budget_amendment: amendment
  };
  const evidencePath = path.join(directory, "approval-evidence.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  verifyApprovedCandidateArtifacts({
    approvedManifestPath: manifestPath, approvalEvidencePath: evidencePath,
    expectedRuntimeHash: runtimeHash, expectedEvaluationProtocolHash: evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: evidence.approval_evidence_hash
  });
  return { manifestPath, evidencePath, evidence };
}

// This is a narrowly bounded operator amendment, not a claim of a new full human
// semantic evaluation. Only the reviewed prompt, consistency guard and one grant change.
function profilingRepairAmendmentIssues(manifest: ApprovedCandidateManifest, evidence: OperationalApprovalEvidence, depth: number) {
  const amendment = z.object({
    parent_manifest: FileReferenceSchema, parent_evidence: FileReferenceSchema,
    validation_evidence: FileReferenceSchema,
    parent_runtime_hash: z.string().length(64), parent_protocol_hash: z.string().length(64),
    parent_approval_hash: z.string().length(64), grant: ScopedFeedbackBudgetSchema
  }).strict().parse(evidence.profiling_repair_amendment);
  for (const file of [amendment.parent_manifest, amendment.parent_evidence, amendment.validation_evidence]) {
    if (!path.isAbsolute(file.path) || sha256File(file.path) !== file.sha256) throw new Error("Profiling amendment evidence integrity mismatch.");
  }
  const parent = verifyApprovedCandidateArtifacts({
    approvedManifestPath: amendment.parent_manifest.path, approvalEvidencePath: amendment.parent_evidence.path,
    expectedRuntimeHash: amendment.parent_runtime_hash, expectedEvaluationProtocolHash: amendment.parent_protocol_hash,
    expectedApprovalEvidenceHash: amendment.parent_approval_hash, approvalDepth: depth + 1
  });
  const expected = structuredClone(parent.manifest);
  const old = expected.configuration_fingerprint.role_version_metadata.student_profiling_agent;
  const parentMatches = old.prompt_version === "student-profiling-v5" && old.prompt_hash === PROFILING_V5_HASH &&
    old.schema_version === "student-profile-output-v4" && !expected.runtime_policy.initial_feedback_budget_grants;
  Object.assign(old, { prompt_version: "student-profiling-v6", prompt_hash: PROFILING_V6_HASH });
  expected.configuration_fingerprint.deterministic_guard_versions.student_profile_evidence_consistency = "student-profile-evidence-consistency-v2";
  expected.runtime_policy.initial_feedback_budget_grants = [amendment.grant];
  const validation = z.object({
    version: z.literal("profiling-v6-scoped-budget-validation-v1"), synthetic_only: z.literal(true),
    real_student_data_used: z.literal(false), profiling_prompt_hash: z.literal(PROFILING_V6_HASH),
    regression_passed: z.literal(true),
    calls: z.array(z.object({
      role: RoleNameSchema, model: z.string(), reasoning_effort: z.string(), max_output_tokens: z.number(),
      item_count: z.number(), status: z.literal("completed"), checks_passed: z.literal(true)
    }))
  }).parse(JSON.parse(readFileSync(amendment.validation_evidence.path, "utf8")));
  const planning = approvedCandidateRoleConfig(manifest, "formative_value_and_planning_agent");
  const profiling = approvedCandidateRoleConfig(manifest, "student_profiling_agent");
  const passedCall = (role: ApprovedOperationalRoleName, config: z.infer<typeof RoleConfigSchema>, tokens: number, size: number) =>
    validation.calls.some(call => call.role === role && call.model === config.model_name &&
      call.reasoning_effort === config.reasoning_effort && call.max_output_tokens === tokens && call.item_count === size);
  const review = evidence.human_review;
  return [
    ...(!parentMatches ? ["profiling_amendment_unexpected_parent"] : []),
    ...(stableHash(expected) !== stableHash(manifest) ? ["profiling_amendment_changed_other_settings"] : []),
    ...(review.decision !== "approve" || review.scope !== "profiling_v6_and_scoped_initial_feedback_budget" ||
      review.operator_authorized !== true || review.semantic_review_confirmed !== false ||
      typeof review.authorization_reference !== "string" || !review.authorization_reference.trim()
      ? ["profiling_amendment_authorization_missing"] : []),
    ...(evidence.source_artifact_sha256 !== amendment.validation_evidence.sha256 ||
      evidence.source_evaluation_protocol_hash !== parent.evidence.evaluation_protocol_hash ||
      evidence.rollback_hash !== parent.evidence.rollback_hash || evidence.evaluation_protocol_hash !== stableHash(amendment)
      ? ["profiling_amendment_provenance_mismatch"] : []),
    ...(![3, 12].every(size => passedCall("formative_value_and_planning_agent", planning, 30000, size)) ||
      !passedCall("student_profiling_agent", profiling, profiling.max_output_tokens, 3)
      ? ["profiling_amendment_validation_incomplete"] : [])
  ];
}

export function prepareProfilingRepairAmendment(input: {
  parent: ActiveDerivedOperationalApproval; expectedParentHash: string; validationEvidencePath: string;
  outputDirectory: string; authorizationReference: string; grant: ScopedFeedbackBudget;
}) {
  const { parent } = input;
  if (parent.record.runtime_candidate_hash !== input.expectedParentHash || !input.authorizationReference.trim()) {
    throw new Error("Expected parent and explicit authorization are required.");
  }
  const grant = ScopedFeedbackBudgetSchema.parse(input.grant);
  const directory = path.resolve(input.outputDirectory);
  mkdirSync(directory, { recursive: false });
  const manifest = structuredClone(parent.manifest);
  Object.assign(manifest.configuration_fingerprint.role_version_metadata.student_profiling_agent,
    { prompt_version: "student-profiling-v6", prompt_hash: PROFILING_V6_HASH });
  manifest.configuration_fingerprint.deterministic_guard_versions.student_profile_evidence_consistency = "student-profile-evidence-consistency-v2";
  manifest.runtime_policy.initial_feedback_budget_grants = [grant];
  const manifestPath = path.join(directory, "approved-candidate-manifest.json");
  const validationPath = path.join(directory, "validation.json");
  copyFileSync(input.validationEvidencePath, validationPath);
  const amendment = {
    parent_manifest: { path: parent.manifest_path, sha256: sha256File(parent.manifest_path) },
    parent_evidence: { path: parent.approval_evidence_path, sha256: sha256File(parent.approval_evidence_path) },
    validation_evidence: { path: validationPath, sha256: sha256File(validationPath) },
    parent_runtime_hash: parent.record.runtime_candidate_hash, parent_protocol_hash: parent.record.evaluation_protocol_hash,
    parent_approval_hash: parent.record.approval_evidence_hash, grant
  };
  const runtimeHash = modelUpgradeCandidateRuntimeHash(manifest, approvedOperationalRoleNamesForManifest(manifest));
  const identity = {
    source_provider_run_id: `profiling-repair:${amendment.validation_evidence.sha256}`,
    derived_evaluation_id: `${PROFILING_REPAIR_AMENDMENT_VERSION}:${runtimeHash}`,
    runtime_candidate_hash: runtimeHash, source_evaluation_protocol_hash: parent.evidence.evaluation_protocol_hash,
    evaluation_protocol_hash: stableHash(amendment), human_review: {
      decision: "approve", scope: "profiling_v6_and_scoped_initial_feedback_budget", operator_authorized: true,
      semantic_review_confirmed: false, authorization_reference: input.authorizationReference,
      limitations: "Operator-authorized narrow amendment with automated regression and synthetic live checks. Not an independent human semantic evaluation or evidence of classroom validity. Unchanged roles retain parent approval."
    }
  };
  const evidence: OperationalApprovalEvidence = {
    ...identity, approval_command_version: PROFILING_REPAIR_AMENDMENT_VERSION, approved_at: new Date().toISOString(),
    source_artifact_sha256: amendment.validation_evidence.sha256, approval_evidence_hash: stableHash(identity),
    exact_operational_approved_config_hash: runtimeHash, rollback_hash: parent.evidence.rollback_hash,
    approved_manifest_artifact_path: manifestPath, profiling_repair_amendment: amendment
  };
  const evidencePath = path.join(directory, "approval-evidence.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  verifyApprovedCandidateArtifacts({ approvedManifestPath: manifestPath, approvalEvidencePath: evidencePath,
    expectedRuntimeHash: runtimeHash, expectedEvaluationProtocolHash: evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: evidence.approval_evidence_hash });
  return { manifestPath, evidencePath, evidence };
}

function globalFeedbackBudgetAmendmentIssues(manifest: ApprovedCandidateManifest, evidence: OperationalApprovalEvidence, depth: number) {
  const amendment = z.object({
    parent_manifest: FileReferenceSchema, parent_evidence: FileReferenceSchema, validation_evidence: FileReferenceSchema,
    parent_runtime_hash: z.string().length(64), parent_protocol_hash: z.string().length(64), parent_approval_hash: z.string().length(64)
  }).strict().parse(evidence.global_feedback_budget_amendment);
  for (const file of [amendment.parent_manifest, amendment.parent_evidence, amendment.validation_evidence]) {
    if (!path.isAbsolute(file.path) || sha256File(file.path) !== file.sha256) throw new Error("Global budget amendment evidence integrity mismatch.");
  }
  const parent = verifyApprovedCandidateArtifacts({ approvedManifestPath: amendment.parent_manifest.path,
    approvalEvidencePath: amendment.parent_evidence.path, expectedRuntimeHash: amendment.parent_runtime_hash,
    expectedEvaluationProtocolHash: amendment.parent_protocol_hash, expectedApprovalEvidenceHash: amendment.parent_approval_hash,
    approvalDepth: depth + 1 });
  const expected = structuredClone(parent.manifest);
  delete expected.runtime_policy.initial_feedback_budget_grants;
  expected.runtime_policy.initial_feedback_max_output_tokens = 30000;
  const validation = z.object({ version: z.literal("profiling-v6-scoped-budget-validation-v1"), synthetic_only: z.literal(true),
    real_student_data_used: z.literal(false), regression_passed: z.literal(true),
    calls: z.array(z.object({ role: RoleNameSchema, model: z.string(), reasoning_effort: z.string(),
      max_output_tokens: z.number(), item_count: z.number(), status: z.literal("completed"), checks_passed: z.literal(true) }))
  }).parse(JSON.parse(readFileSync(amendment.validation_evidence.path, "utf8")));
  const role = approvedCandidateRoleConfig(manifest, "formative_value_and_planning_agent");
  const review = evidence.human_review;
  return [
    ...(parent.evidence.approval_command_version !== PROFILING_REPAIR_AMENDMENT_VERSION ? ["global_feedback_unexpected_parent"] : []),
    ...(stableHash(expected) !== stableHash(manifest) ? ["global_feedback_changed_other_settings"] : []),
    ...(review.decision !== "approve" || review.scope !== "all_students_initial_feedback_30000" ||
      review.operator_authorized !== true || review.semantic_review_confirmed !== false ||
      typeof review.authorization_reference !== "string" || !review.authorization_reference.trim()
      ? ["global_feedback_authorization_missing"] : []),
    ...(evidence.source_artifact_sha256 !== amendment.validation_evidence.sha256 ||
      evidence.source_evaluation_protocol_hash !== parent.evidence.evaluation_protocol_hash ||
      evidence.rollback_hash !== parent.evidence.rollback_hash || evidence.evaluation_protocol_hash !== stableHash(amendment)
      ? ["global_feedback_provenance_mismatch"] : []),
    ...(![3, 12].every(size => validation.calls.some(call => call.role === "formative_value_and_planning_agent" &&
      call.model === role.model_name && call.reasoning_effort === role.reasoning_effort &&
      call.max_output_tokens === 30000 && call.item_count === size)) ? ["global_feedback_validation_incomplete"] : [])
  ];
}

export function prepareGlobalFeedbackBudgetAmendment(input: {
  parent: ActiveDerivedOperationalApproval; expectedParentHash: string; validationEvidencePath: string;
  outputDirectory: string; authorizationReference: string;
}) {
  const { parent } = input;
  if (parent.record.runtime_candidate_hash !== input.expectedParentHash || !input.authorizationReference.trim()) {
    throw new Error("Expected parent and explicit authorization are required.");
  }
  const directory = path.resolve(input.outputDirectory);
  mkdirSync(directory, { recursive: false });
  const manifest = structuredClone(parent.manifest);
  delete manifest.runtime_policy.initial_feedback_budget_grants;
  manifest.runtime_policy.initial_feedback_max_output_tokens = 30000;
  const manifestPath = path.join(directory, "approved-candidate-manifest.json");
  const validationPath = path.join(directory, "validation.json");
  copyFileSync(input.validationEvidencePath, validationPath);
  const amendment = {
    parent_manifest: { path: parent.manifest_path, sha256: sha256File(parent.manifest_path) },
    parent_evidence: { path: parent.approval_evidence_path, sha256: sha256File(parent.approval_evidence_path) },
    validation_evidence: { path: validationPath, sha256: sha256File(validationPath) },
    parent_runtime_hash: parent.record.runtime_candidate_hash, parent_protocol_hash: parent.record.evaluation_protocol_hash,
    parent_approval_hash: parent.record.approval_evidence_hash
  };
  const runtimeHash = modelUpgradeCandidateRuntimeHash(manifest, approvedOperationalRoleNamesForManifest(manifest));
  const identity = { source_provider_run_id: `global-feedback-budget:${amendment.validation_evidence.sha256}`,
    derived_evaluation_id: `${GLOBAL_FEEDBACK_BUDGET_AMENDMENT_VERSION}:${runtimeHash}`, runtime_candidate_hash: runtimeHash,
    source_evaluation_protocol_hash: parent.evidence.evaluation_protocol_hash, evaluation_protocol_hash: stableHash(amendment),
    human_review: { decision: "approve", scope: "all_students_initial_feedback_30000", operator_authorized: true,
      semantic_review_confirmed: false, authorization_reference: input.authorizationReference,
      limitations: "Operator-authorized scope expansion; synthetic capacity checks only, not independent pedagogical validation. Models, prompts, other role budgets and spending controls unchanged." } };
  const evidence: OperationalApprovalEvidence = { ...identity, approval_command_version: GLOBAL_FEEDBACK_BUDGET_AMENDMENT_VERSION,
    approved_at: new Date().toISOString(), source_artifact_sha256: amendment.validation_evidence.sha256,
    approval_evidence_hash: stableHash(identity), exact_operational_approved_config_hash: runtimeHash,
    rollback_hash: parent.evidence.rollback_hash, approved_manifest_artifact_path: manifestPath, global_feedback_budget_amendment: amendment };
  const evidencePath = path.join(directory, "approval-evidence.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  verifyApprovedCandidateArtifacts({ approvedManifestPath: manifestPath, approvalEvidencePath: evidencePath,
    expectedRuntimeHash: runtimeHash, expectedEvaluationProtocolHash: evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: evidence.approval_evidence_hash });
  return { manifestPath, evidencePath, evidence };
}

function solLowReasoningAmendmentIssues(manifest: ApprovedCandidateManifest, evidence: OperationalApprovalEvidence, depth: number) {
  const amendment = z.object({
    parent_manifest: FileReferenceSchema, parent_evidence: FileReferenceSchema, validation_evidence: FileReferenceSchema,
    parent_runtime_hash: z.string().length(64), parent_protocol_hash: z.string().length(64), parent_approval_hash: z.string().length(64)
  }).strict().parse(evidence.sol_low_reasoning_amendment);
  for (const file of [amendment.parent_manifest, amendment.parent_evidence, amendment.validation_evidence]) {
    if (!path.isAbsolute(file.path) || sha256File(file.path) !== file.sha256) throw new Error("Sol-low amendment evidence integrity mismatch.");
  }
  const parent = verifyApprovedCandidateArtifacts({ approvedManifestPath: amendment.parent_manifest.path,
    approvalEvidencePath: amendment.parent_evidence.path, expectedRuntimeHash: amendment.parent_runtime_hash,
    expectedEvaluationProtocolHash: amendment.parent_protocol_hash, expectedApprovalEvidenceHash: amendment.parent_approval_hash,
    approvalDepth: depth + 1 });
  const expected = structuredClone(parent.manifest);
  const parentMatches = SOL_LOW_REASONING_ROLES.every(role =>
    expected.roles[role]?.model_name === "gpt-5.6-sol" && expected.roles[role]?.reasoning_effort === "medium");
  for (const role of SOL_LOW_REASONING_ROLES) expected.roles[role]!.reasoning_effort = "low";
  z.object({ version: z.literal("sol-low-input-dedup-validation-v1"), synthetic_only: z.literal(true),
    real_student_data_used: z.literal(false), lossless_roundtrip_passed: z.literal(true), regression_passed: z.literal(true),
    live_evaluation_required_before_deployment: z.literal(true)
  }).parse(JSON.parse(readFileSync(amendment.validation_evidence.path, "utf8")));
  const review = evidence.human_review;
  return [
    ...(!parentMatches ? ["sol_low_unexpected_parent"] : []),
    ...(stableHash(expected) !== stableHash(manifest) ? ["sol_low_changed_other_settings"] : []),
    ...(review.decision !== "approve" || review.scope !== "feedback_and_conversation_reasoning_only" ||
      review.operator_authorized !== true || review.semantic_review_confirmed !== false ||
      typeof review.authorization_reference !== "string" || !review.authorization_reference.trim()
      ? ["sol_low_authorization_missing"] : []),
    ...(evidence.source_artifact_sha256 !== amendment.validation_evidence.sha256 ||
      evidence.source_evaluation_protocol_hash !== parent.evidence.evaluation_protocol_hash ||
      evidence.rollback_hash !== parent.evidence.rollback_hash || evidence.evaluation_protocol_hash !== stableHash(amendment)
      ? ["sol_low_provenance_mismatch"] : [])
  ];
}

export function prepareSolLowReasoningAmendment(input: {
  parent: ActiveDerivedOperationalApproval; expectedParentHash: string; validationEvidencePath: string;
  outputDirectory: string; authorizationReference: string;
}) {
  const { parent } = input;
  if (parent.record.runtime_candidate_hash !== input.expectedParentHash || !input.authorizationReference.trim() ||
      !SOL_LOW_REASONING_ROLES.every(role => parent.manifest.roles[role]?.model_name === "gpt-5.6-sol" &&
        parent.manifest.roles[role]?.reasoning_effort === "medium")) {
    throw new Error("Verified Sol-medium parent and explicit authorization are required.");
  }
  const directory = path.resolve(input.outputDirectory);
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const manifest = structuredClone(parent.manifest);
  for (const role of SOL_LOW_REASONING_ROLES) manifest.roles[role]!.reasoning_effort = "low";
  const manifestPath = path.join(directory, "approved-candidate-manifest.json");
  const validationPath = path.resolve(input.validationEvidencePath);
  const amendment = {
    parent_manifest: { path: parent.manifest_path, sha256: sha256File(parent.manifest_path) },
    parent_evidence: { path: parent.approval_evidence_path, sha256: sha256File(parent.approval_evidence_path) },
    validation_evidence: { path: validationPath, sha256: sha256File(validationPath) },
    parent_runtime_hash: parent.record.runtime_candidate_hash, parent_protocol_hash: parent.record.evaluation_protocol_hash,
    parent_approval_hash: parent.record.approval_evidence_hash
  };
  const runtimeHash = modelUpgradeCandidateRuntimeHash(manifest, approvedOperationalRoleNamesForManifest(manifest));
  const identity = { source_provider_run_id: `sol-low:${amendment.validation_evidence.sha256}`,
    derived_evaluation_id: `${SOL_LOW_REASONING_AMENDMENT_VERSION}:${runtimeHash}`, runtime_candidate_hash: runtimeHash,
    source_evaluation_protocol_hash: parent.evidence.evaluation_protocol_hash, evaluation_protocol_hash: stableHash(amendment),
    human_review: { decision: "approve", scope: "feedback_and_conversation_reasoning_only", operator_authorized: true,
      semantic_review_confirmed: false, authorization_reference: input.authorizationReference,
      limitations: "Operator-authorized Sol medium-to-low change for initial feedback and ongoing conversation only. Local engineering checks are recorded. A first live synthetic round and review are required before deployment and recorded separately. This is not independent human validation of educational equivalence. All other roles and token limits retain parent approval." } };
  const evidence: OperationalApprovalEvidence = { ...identity, approval_command_version: SOL_LOW_REASONING_AMENDMENT_VERSION,
    approved_at: new Date().toISOString(), source_artifact_sha256: amendment.validation_evidence.sha256,
    approval_evidence_hash: stableHash(identity), exact_operational_approved_config_hash: runtimeHash,
    rollback_hash: parent.evidence.rollback_hash, approved_manifest_artifact_path: manifestPath, sol_low_reasoning_amendment: amendment };
  const evidencePath = path.join(directory, "approval-evidence.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  verifyApprovedCandidateArtifacts({ approvedManifestPath: manifestPath, approvalEvidencePath: evidencePath,
    expectedRuntimeHash: runtimeHash, expectedEvaluationProtocolHash: evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: evidence.approval_evidence_hash });
  return { manifestPath, evidencePath, evidence };
}

function connectivityBudgetAmendmentIssues(manifest: ApprovedCandidateManifest, evidence: OperationalApprovalEvidence, depth: number) {
  const amendment = z.object({
    parent_manifest: FileReferenceSchema, parent_evidence: FileReferenceSchema,
    parent_runtime_hash: z.string().length(64), parent_protocol_hash: z.string().length(64),
    parent_approval_hash: z.string().length(64)
  }).strict().parse(evidence.connectivity_budget_amendment);
  for (const file of [amendment.parent_manifest, amendment.parent_evidence]) {
    if (!path.isAbsolute(file.path) || sha256File(file.path) !== file.sha256) {
      throw new Error("Connectivity amendment evidence integrity mismatch.");
    }
  }
  const parent = verifyApprovedCandidateArtifacts({ approvedManifestPath: amendment.parent_manifest.path,
    approvalEvidencePath: amendment.parent_evidence.path, expectedRuntimeHash: amendment.parent_runtime_hash,
    expectedEvaluationProtocolHash: amendment.parent_protocol_hash, expectedApprovalEvidenceHash: amendment.parent_approval_hash,
    approvalDepth: depth + 1 });
  const expected = structuredClone(parent.manifest);
  const oldBudget = expected.roles.connectivity_test!.max_output_tokens;
  expected.roles.connectivity_test!.max_output_tokens = CONNECTIVITY_MAX_OUTPUT_TOKENS;
  const review = evidence.human_review;
  return [
    ...(oldBudget !== 200 ? ["connectivity_amendment_unexpected_parent_budget"] : []),
    ...(stableHash(expected) !== stableHash(manifest) ? ["connectivity_amendment_changed_other_settings"] : []),
    ...(review.decision !== "approve" || review.scope !== "synthetic_connectivity_budget_only" ||
      review.operator_authorized !== true || review.semantic_review_confirmed !== false ||
      typeof review.authorization_reference !== "string" || !review.authorization_reference.trim()
      ? ["connectivity_amendment_authorization_missing"] : []),
    ...(evidence.source_artifact_sha256 !== amendment.parent_manifest.sha256 ||
      evidence.source_evaluation_protocol_hash !== parent.evidence.evaluation_protocol_hash ||
      evidence.rollback_hash !== parent.evidence.rollback_hash || evidence.evaluation_protocol_hash !== stableHash(amendment)
      ? ["connectivity_amendment_provenance_mismatch"] : [])
  ];
}

export function prepareConnectivityBudgetAmendment(input: {
  parent: ActiveDerivedOperationalApproval; expectedParentHash: string;
  outputDirectory: string; authorizationReference: string;
}) {
  const { parent } = input;
  if (parent.record.runtime_candidate_hash !== input.expectedParentHash || !input.authorizationReference.trim() ||
      parent.manifest.roles.connectivity_test?.max_output_tokens !== 200) {
    throw new Error("Verified 200-token diagnostic parent and explicit authorization are required.");
  }
  const directory = path.resolve(input.outputDirectory);
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const manifest = structuredClone(parent.manifest);
  manifest.roles.connectivity_test!.max_output_tokens = CONNECTIVITY_MAX_OUTPUT_TOKENS;
  const manifestPath = path.join(directory, "approved-candidate-manifest.json");
  const amendment = {
    parent_manifest: { path: parent.manifest_path, sha256: sha256File(parent.manifest_path) },
    parent_evidence: { path: parent.approval_evidence_path, sha256: sha256File(parent.approval_evidence_path) },
    parent_runtime_hash: parent.record.runtime_candidate_hash, parent_protocol_hash: parent.record.evaluation_protocol_hash,
    parent_approval_hash: parent.record.approval_evidence_hash
  };
  const runtimeHash = modelUpgradeCandidateRuntimeHash(manifest, approvedOperationalRoleNamesForManifest(manifest));
  const identity = { source_provider_run_id: `connectivity-budget:${amendment.parent_manifest.sha256}`,
    derived_evaluation_id: `${CONNECTIVITY_BUDGET_AMENDMENT_VERSION}:${runtimeHash}`, runtime_candidate_hash: runtimeHash,
    source_evaluation_protocol_hash: parent.evidence.evaluation_protocol_hash, evaluation_protocol_hash: stableHash(amendment),
    human_review: { decision: "approve", scope: "synthetic_connectivity_budget_only", operator_authorized: true,
      semantic_review_confirmed: false, authorization_reference: input.authorizationReference,
      limitations: "Operator-authorized synthetic diagnostic capacity increase only. No student budgets, models, prompts, policies or data changed. Live verification is recorded separately; this amendment does not claim a new learning-conversation evaluation." } };
  const evidence: OperationalApprovalEvidence = { ...identity, approval_command_version: CONNECTIVITY_BUDGET_AMENDMENT_VERSION,
    approved_at: new Date().toISOString(), source_artifact_sha256: amendment.parent_manifest.sha256,
    approval_evidence_hash: stableHash(identity), exact_operational_approved_config_hash: runtimeHash,
    rollback_hash: parent.evidence.rollback_hash, approved_manifest_artifact_path: manifestPath, connectivity_budget_amendment: amendment };
  const evidencePath = path.join(directory, "approval-evidence.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  verifyApprovedCandidateArtifacts({ approvedManifestPath: manifestPath, approvalEvidencePath: evidencePath,
    expectedRuntimeHash: runtimeHash, expectedEvaluationProtocolHash: evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: evidence.approval_evidence_hash });
  return { manifestPath, evidencePath, evidence };
}

const LunaLowLineageSchema = z.object({
  parent_manifest: FileReferenceSchema,
  parent_evidence: FileReferenceSchema,
  parent_runtime_hash: z.string().length(64),
  parent_protocol_hash: z.string().length(64),
  parent_approval_hash: z.string().length(64)
}).strict();

function verifyLunaLowLineage(lineage: z.infer<typeof LunaLowLineageSchema>, depth = 0) {
  for (const reference of [lineage.parent_manifest, lineage.parent_evidence]) {
    if (!path.isAbsolute(reference.path) || sha256File(reference.path) !== reference.sha256) {
      throw new Error("Luna-low parent evidence integrity mismatch.");
    }
  }
  return verifyApprovedCandidateArtifacts({
    approvedManifestPath: lineage.parent_manifest.path,
    approvalEvidencePath: lineage.parent_evidence.path,
    expectedRuntimeHash: lineage.parent_runtime_hash,
    expectedEvaluationProtocolHash: lineage.parent_protocol_hash,
    expectedApprovalEvidenceHash: lineage.parent_approval_hash,
    approvalDepth: depth + 1
  });
}

// This pure projection is not approval or activation. Historical parents remain exact.
export function buildLunaLowAllRolesCandidateManifest(parent: ApprovedCandidateManifest) {
  return buildLunaAllRolesCandidateManifest(parent, "low");
}

export function buildLunaAllRolesCandidateManifest(parent: ApprovedCandidateManifest, reasoningEffort: LunaCandidateReasoningEffort,
  profileCorrection?: typeof LUNA_PROFILE_FIDELITY_CORRECTION, tutorModel?: typeof MIXED_TUTOR_MODEL,
  conversationRepair?: typeof LUNA_CONVERSATION_REPAIR, deliveryReviewModel?: typeof LUNA_SOL_DELIVERY_REVIEW_MODEL) {
  z.enum(["low", "medium"]).parse(reasoningEffort);
  if (profileCorrection !== undefined && (profileCorrection !== LUNA_PROFILE_FIDELITY_CORRECTION || reasoningEffort !== "medium")) {
    throw new Error("The exact profile-fidelity correction is authorized only for the separate medium candidate.");
  }
  if (tutorModel !== undefined && (tutorModel !== MIXED_TUTOR_MODEL || reasoningEffort !== "medium" ||
      profileCorrection !== LUNA_PROFILE_FIDELITY_CORRECTION)) {
    throw new Error("The mixed tutor candidate requires the exact GPT-6.1 Sol medium tutor and profile-fidelity correction.");
  }
  if (conversationRepair !== undefined && (conversationRepair !== LUNA_CONVERSATION_REPAIR || reasoningEffort !== "medium" ||
      profileCorrection !== LUNA_PROFILE_FIDELITY_CORRECTION || tutorModel !== undefined)) {
    throw new Error("The conversation-reliability candidate requires all-Luna medium and the exact profile-fidelity correction.");
  }
  const manifest = ApprovedCandidateManifestSchema.parse(structuredClone(parent));
  if (deliveryReviewModel !== undefined && (deliveryReviewModel !== LUNA_SOL_DELIVERY_REVIEW_MODEL ||
      conversationRepair !== LUNA_CONVERSATION_REPAIR || tutorModel !== undefined || reasoningEffort !== "medium")) {
    throw new Error("The mixed delivery-review candidate requires the exact all-Luna medium conversation repair and Sol reviewer.");
  }
  assertExactRoleInventory(manifest);
  if (APPROVED_OPERATIONAL_ROLE_NAMES.some(role => !manifest.roles[role])) {
    throw new Error("Luna-low requires all 18 explicit parent roles; historical aliases must not be promoted implicitly.");
  }
  for (const role of APPROVED_OPERATIONAL_ROLE_NAMES) {
    manifest.roles[role]!.model_name = lunaCandidateModelForRole(role, tutorModel);
    manifest.roles[role]!.reasoning_effort = reasoningEffort;
  }
  if (profileCorrection) applyLunaProfileFidelityCorrection(manifest);
  if (conversationRepair) applyLunaConversationRepair(manifest);
  if (deliveryReviewModel) applyLunaSolDeliveryReviewPolicy(manifest);
  return manifest;
}

function lunaLowLineage(parent: ActiveDerivedOperationalApproval, expectedParentHash: string) {
  if (parent.record.runtime_candidate_hash !== expectedParentHash) {
    throw new Error("Luna-low expected parent hash does not match.");
  }
  const lineage = {
    parent_manifest: { path: parent.manifest_path, sha256: sha256File(parent.manifest_path) },
    parent_evidence: { path: parent.approval_evidence_path, sha256: sha256File(parent.approval_evidence_path) },
    parent_runtime_hash: parent.record.runtime_candidate_hash,
    parent_protocol_hash: parent.record.evaluation_protocol_hash,
    parent_approval_hash: parent.record.approval_evidence_hash
  };
  const verified = verifyLunaLowLineage(lineage);
  if (stableHash(verified.manifest) !== stableHash(parent.manifest)) {
    throw new Error("Luna-low in-memory parent differs from verified artifacts.");
  }
  return { lineage, verified };
}

export function stageLunaAllRolesCandidate(input: {
  reasoningEffort: LunaCandidateReasoningEffort;
  profileCorrection?: typeof LUNA_PROFILE_FIDELITY_CORRECTION;
  tutorModel?: typeof MIXED_TUTOR_MODEL;
  conversationRepair?: typeof LUNA_CONVERSATION_REPAIR;
  deliveryReviewModel?: typeof LUNA_SOL_DELIVERY_REVIEW_MODEL;
  parent: ActiveDerivedOperationalApproval;
  expectedParentHash: string;
  outputDirectory: string;
  authorizationReference: string;
}) {
  if (!input.authorizationReference.trim()) throw new Error("Explicit operator authorization is required.");
  const { lineage, verified } = lunaLowLineage(input.parent, input.expectedParentHash);
  return writeLunaLowCandidate({
    parentManifest: verified.manifest, parentManifestReference: lineage.parent_manifest,
    parentRuntimeHash: lineage.parent_runtime_hash, parentApprovalVerification: "verified_locally",
    outputDirectory: input.outputDirectory, authorizationReference: input.authorizationReference,
    reasoningEffort: input.reasoningEffort, profileCorrection: input.profileCorrection, tutorModel: input.tutorModel,
    conversationRepair: input.conversationRepair, deliveryReviewModel: input.deliveryReviewModel
  });
}

// An exported manifest is sufficient for isolated testing, never for final approval.
// Final approval still recursively verifies the complete original evidence chain.
export function stageLunaAllRolesCandidateFromManifest(input: {
  reasoningEffort: LunaCandidateReasoningEffort;
  profileCorrection?: typeof LUNA_PROFILE_FIDELITY_CORRECTION;
  tutorModel?: typeof MIXED_TUTOR_MODEL;
  conversationRepair?: typeof LUNA_CONVERSATION_REPAIR;
  deliveryReviewModel?: typeof LUNA_SOL_DELIVERY_REVIEW_MODEL;
  parentManifestPath: string;
  expectedParentManifestSha256: string;
  expectedParentRuntimeHash: string;
  outputDirectory: string;
  authorizationReference: string;
}) {
  if (!input.authorizationReference.trim()) throw new Error("Explicit operator authorization is required.");
  const parentManifestPath = path.resolve(input.parentManifestPath);
  if (sha256File(parentManifestPath) !== input.expectedParentManifestSha256) {
    throw new Error("Exported Luna-low parent manifest integrity mismatch.");
  }
  const parentManifest = ApprovedCandidateManifestSchema.parse(JSON.parse(readFileSync(parentManifestPath, "utf8")));
  if (modelUpgradeCandidateRuntimeHash(parentManifest, approvedOperationalRoleNamesForManifest(parentManifest)) !== input.expectedParentRuntimeHash) {
    throw new Error("Exported Luna-low parent runtime hash mismatch.");
  }
  return writeLunaLowCandidate({
    parentManifest,
    parentManifestReference: { path: parentManifestPath, sha256: input.expectedParentManifestSha256 },
    parentRuntimeHash: input.expectedParentRuntimeHash, parentApprovalVerification: "not_reverified_locally",
    outputDirectory: input.outputDirectory, authorizationReference: input.authorizationReference,
    reasoningEffort: input.reasoningEffort, profileCorrection: input.profileCorrection, tutorModel: input.tutorModel,
    conversationRepair: input.conversationRepair, deliveryReviewModel: input.deliveryReviewModel
  });
}

function writeLunaLowCandidate(input: {
  reasoningEffort: LunaCandidateReasoningEffort;
  profileCorrection?: typeof LUNA_PROFILE_FIDELITY_CORRECTION;
  tutorModel?: typeof MIXED_TUTOR_MODEL;
  conversationRepair?: typeof LUNA_CONVERSATION_REPAIR;
  deliveryReviewModel?: typeof LUNA_SOL_DELIVERY_REVIEW_MODEL;
  parentManifest: ApprovedCandidateManifest;
  parentManifestReference: z.infer<typeof FileReferenceSchema>;
  parentRuntimeHash: string;
  parentApprovalVerification: "verified_locally" | "not_reverified_locally";
  outputDirectory: string;
  authorizationReference: string;
}) {
  const manifest = buildLunaAllRolesCandidateManifest(input.parentManifest, input.reasoningEffort, input.profileCorrection, input.tutorModel, input.conversationRepair, input.deliveryReviewModel);
  const runtimeHash = modelUpgradeCandidateRuntimeHash(manifest, APPROVED_OPERATIONAL_ROLE_NAMES);
  const directory = path.resolve(input.outputDirectory);
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const manifestPath = path.join(directory, "candidate-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  const candidatePath = path.join(directory, "candidate-evaluation.json");
  writeFileSync(candidatePath, JSON.stringify({
    version: input.deliveryReviewModel ? LUNA_SOL_DELIVERY_REVIEW_CANDIDATE_VERSION : input.conversationRepair ? LUNA_CONVERSATION_REPAIR_CANDIDATE_VERSION : input.tutorModel ? MIXED_TUTOR_CANDIDATE_VERSION : input.profileCorrection ? LUNA_MEDIUM_PROFILE_FIDELITY_CANDIDATE_VERSION : `luna-${input.reasoningEffort}-all-roles-candidate-v1`,
    active_kind: "local_candidate_evaluation",
    validation_pending: true,
    production_activation_permitted: false,
    runtime_candidate_hash: runtimeHash,
    candidate_manifest: { path: manifestPath, sha256: sha256File(manifestPath) },
    parent_manifest: input.parentManifestReference,
    parent_runtime_hash: input.parentRuntimeHash,
    parent_approval_verification: input.parentApprovalVerification,
    operator_authorization_reference: input.authorizationReference
  }, null, 2) + "\n", { flag: "wx" });
  return { status: "candidate_not_approved" as const, manifestPath, candidatePath, runtime_candidate_hash: runtimeHash };
}

function lunaLowAllRolesAmendmentIssues(
  manifest: ApprovedCandidateManifest,
  evidence: OperationalApprovalEvidence,
  depth: number
) {
  const deliveryReviewModel = evidence.approval_command_version === LUNA_SOL_DELIVERY_REVIEW_AMENDMENT_VERSION ? LUNA_SOL_DELIVERY_REVIEW_MODEL : undefined;
  const conversationRepair = deliveryReviewModel || evidence.approval_command_version === LUNA_CONVERSATION_REPAIR_AMENDMENT_VERSION ? LUNA_CONVERSATION_REPAIR : undefined;
  const tutorModel = evidence.approval_command_version === MIXED_TUTOR_AMENDMENT_VERSION ? MIXED_TUTOR_MODEL : undefined;
  const profileCorrection = conversationRepair || tutorModel || evidence.approval_command_version === LUNA_MEDIUM_PROFILE_FIDELITY_AMENDMENT_VERSION ? LUNA_PROFILE_FIDELITY_CORRECTION : undefined;
  const reasoningEffort = evidence.approval_command_version === LUNA_LOW_ALL_ROLES_AMENDMENT_VERSION ? "low" : "medium";
  const amendment = LunaLowLineageSchema.extend({ validation_evidence: FileReferenceSchema }).strict()
    .parse(evidence[deliveryReviewModel ? LUNA_SOL_DELIVERY_REVIEW_AMENDMENT_KEY : conversationRepair ? "luna_conversation_reliability_amendment" : tutorModel ? "mixed_tutor_profile_fidelity_amendment" : profileCorrection ? "luna_medium_profile_fidelity_amendment" : `luna_${reasoningEffort}_all_roles_amendment`]);
  const parent = verifyLunaLowLineage(amendment, depth);
  const expected = buildLunaAllRolesCandidateManifest(parent.manifest, reasoningEffort, profileCorrection, tutorModel, conversationRepair, deliveryReviewModel);
  verifyLunaValidation(amendment.validation_evidence, evidence.runtime_candidate_hash, reasoningEffort, profileCorrection, tutorModel, conversationRepair, deliveryReviewModel);
  const review = evidence.human_review;
  return [
    ...(stableHash(expected) !== stableHash(manifest) ? ["luna_low_changed_other_settings"] : []),
    ...(review.decision !== "approve" || review.scope !== (deliveryReviewModel ? "luna_medium_primary_roles_sol_delivery_review_and_conversation_reliability" : conversationRepair ? "luna_medium_exact_conversation_reliability_and_profile_fidelity" : tutorModel ? "mixed_sol_tutor_luna_medium_and_exact_profile_fidelity_correction" : profileCorrection ? "all_application_roles_medium_and_exact_profile_fidelity_correction" : "all_application_roles_model_and_reasoning_only") ||
      review.operator_authorized !== true || review.semantic_review_confirmed !== false ||
      review.synthetic_engineering_results_reviewed !== true ||
      typeof review.authorization_reference !== "string" || !review.authorization_reference.trim()
      ? ["luna_low_authorization_missing"] : []),
    ...(evidence.source_artifact_sha256 !== amendment.validation_evidence.sha256 ||
      evidence.source_evaluation_protocol_hash !== parent.evidence.evaluation_protocol_hash ||
      evidence.rollback_hash !== parent.evidence.rollback_hash ||
      evidence.evaluation_protocol_hash !== stableHash(amendment)
      ? ["luna_low_provenance_mismatch"] : [])
  ];
}

export function prepareLunaAllRolesAmendment(input: {
  reasoningEffort: LunaCandidateReasoningEffort;
  profileCorrection?: typeof LUNA_PROFILE_FIDELITY_CORRECTION;
  tutorModel?: typeof MIXED_TUTOR_MODEL;
  conversationRepair?: typeof LUNA_CONVERSATION_REPAIR;
  deliveryReviewModel?: typeof LUNA_SOL_DELIVERY_REVIEW_MODEL;
  parent: ActiveDerivedOperationalApproval;
  expectedParentHash: string;
  validationEvidencePath: string;
  outputDirectory: string;
  authorizationReference: string;
}) {
  if (!input.authorizationReference.trim()) throw new Error("Explicit operator authorization is required.");
  const { lineage, verified } = lunaLowLineage(input.parent, input.expectedParentHash);
  const manifest = buildLunaAllRolesCandidateManifest(verified.manifest, input.reasoningEffort, input.profileCorrection, input.tutorModel, input.conversationRepair, input.deliveryReviewModel);
  const amendmentVersion = input.deliveryReviewModel ? LUNA_SOL_DELIVERY_REVIEW_AMENDMENT_VERSION : input.conversationRepair ? LUNA_CONVERSATION_REPAIR_AMENDMENT_VERSION : input.tutorModel ? MIXED_TUTOR_AMENDMENT_VERSION : input.profileCorrection ? LUNA_MEDIUM_PROFILE_FIDELITY_AMENDMENT_VERSION :
    input.reasoningEffort === "low" ? LUNA_LOW_ALL_ROLES_AMENDMENT_VERSION : LUNA_MEDIUM_ALL_ROLES_AMENDMENT_VERSION;
  const runtimeHash = modelUpgradeCandidateRuntimeHash(manifest, APPROVED_OPERATIONAL_ROLE_NAMES);
  const sourceValidationPath = path.resolve(input.validationEvidencePath);
  verifyLunaValidation({ path: sourceValidationPath, sha256: sha256File(sourceValidationPath) }, runtimeHash, input.reasoningEffort, input.profileCorrection, input.tutorModel, input.conversationRepair, input.deliveryReviewModel);
  const directory = path.resolve(input.outputDirectory);
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const manifestPath = path.join(directory, "approved-candidate-manifest.json");
  const validationPath = path.join(directory, "synthetic-validation.json");
  copyFileSync(sourceValidationPath, validationPath);
  const amendment = { ...lineage,
    validation_evidence: { path: validationPath, sha256: sha256File(validationPath) } };
  const identity = {
    source_provider_run_id: `${input.deliveryReviewModel ? "luna-medium-sol-delivery-review" : input.conversationRepair ? "luna-medium-conversation-reliability" : input.tutorModel ? "mixed-gpt61-sol-tutor-luna-medium-profile-fidelity" : `luna-${input.reasoningEffort}${input.profileCorrection ? "-profile-fidelity" : ""}`}:${amendment.validation_evidence.sha256}`,
    derived_evaluation_id: `${amendmentVersion}:${runtimeHash}`,
    runtime_candidate_hash: runtimeHash,
    source_evaluation_protocol_hash: verified.evidence.evaluation_protocol_hash,
    evaluation_protocol_hash: stableHash(amendment),
    human_review: { decision: "approve", scope: input.deliveryReviewModel ? "luna_medium_primary_roles_sol_delivery_review_and_conversation_reliability" : input.conversationRepair ? "luna_medium_exact_conversation_reliability_and_profile_fidelity" : input.tutorModel ? "mixed_sol_tutor_luna_medium_and_exact_profile_fidelity_correction" : input.profileCorrection ? "all_application_roles_medium_and_exact_profile_fidelity_correction" : "all_application_roles_model_and_reasoning_only",
      operator_authorized: true, semantic_review_confirmed: false, synthetic_engineering_results_reviewed: true,
      authorization_reference: input.authorizationReference,
      limitations: input.deliveryReviewModel
        ? "Operator-authorized Luna medium for all 18 primary roles and GPT-6.1 Sol medium only for the exact purpose-bound V8 delivery and private-learning reviewer, capped at 4000 output tokens. Ten native scenarios, twelve repeated tutor replays and twenty-seven factual/conversation/private-learning controls require current-source engineering acceptance; ambiguous historical clarity and diagnostic comparisons remain explicitly ineligible. All paid drafts, repairs and reviews are retained. This is not independent human validation, diagnostic accuracy or classroom learning evidence."
        : input.conversationRepair
        ? "Operator-authorized all-Luna medium with the exact readable tutor input, changed-field profile proposal, continuity and grounded-completion contracts. All seven native synthetic scenarios require explicit overall engineering acceptance, including profile fidelity, question coverage, continuity and grounded closure. This is not independent human validation, diagnostic accuracy or classroom learning evidence. Output allowances and the 30-student-turn policy remain unchanged; no per-topic spending ceiling is added. Earlier failed, superseded and differently configured evaluations remain historical evidence, not approval for this candidate."
        : input.tutorModel
        ? "Operator-authorized GPT-6.1 Sol medium for the formative conversation tutor only; the other 17 application roles use Luna medium with the exact profile-fidelity correction. All seven native synthetic scenarios received explicit overall engineering acceptance, including profile fidelity and question coverage. This is not independent human validation, diagnostic accuracy or classroom learning evidence. Budgets, unrelated fingerprints, runtime policies and historical records retain their parent configuration."
        : input.profileCorrection
        ? "Operator-authorized Luna medium for all 18 application roles plus the exact v7/v5 profile-fidelity prompt, schema, consistency and bounded repair correction. Native synthetic results and each case's profile fidelity and student-question coverage were reviewed as engineering evidence only, not independent human validation, diagnostic accuracy or classroom learning evidence. Budgets, unrelated fingerprints, runtime policies and historical records retain their parent configuration."
        : `Operator-authorized model/reasoning change to gpt-5.6-luna ${input.reasoningEffort} for all 18 application roles. Recorded live synthetic engineering results were reviewed; this is not independent human validation, diagnostic accuracy or classroom learning evidence. Budgets, prompts, contracts, guards and historical records retain their parent configuration.` }
  };
  const evidence: OperationalApprovalEvidence = {
    ...identity, approval_command_version: amendmentVersion,
    approved_at: new Date().toISOString(), source_artifact_sha256: amendment.validation_evidence.sha256,
    approval_evidence_hash: stableHash(identity), exact_operational_approved_config_hash: runtimeHash,
    rollback_hash: verified.evidence.rollback_hash, approved_manifest_artifact_path: manifestPath,
    [input.deliveryReviewModel ? LUNA_SOL_DELIVERY_REVIEW_AMENDMENT_KEY : input.conversationRepair ? "luna_conversation_reliability_amendment" : input.tutorModel ? "mixed_tutor_profile_fidelity_amendment" : input.profileCorrection ? "luna_medium_profile_fidelity_amendment" : `luna_${input.reasoningEffort}_all_roles_amendment`]: amendment
  };
  const evidencePath = path.join(directory, "approval-evidence.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  verifyApprovedCandidateArtifacts({ approvedManifestPath: manifestPath, approvalEvidencePath: evidencePath,
    expectedRuntimeHash: runtimeHash, expectedEvaluationProtocolHash: evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: evidence.approval_evidence_hash });
  return { manifestPath, evidencePath, evidence };
}

// Low-v1 entry points remain fixed to low, including their artifact identities.
export function stageLunaLowAllRolesCandidate(input: Omit<Parameters<typeof stageLunaAllRolesCandidate>[0], "reasoningEffort" | "profileCorrection" | "tutorModel" | "conversationRepair" | "deliveryReviewModel">) {
  return stageLunaAllRolesCandidate({ ...input, reasoningEffort: "low" });
}
export function stageLunaLowAllRolesCandidateFromManifest(input: Omit<Parameters<typeof stageLunaAllRolesCandidateFromManifest>[0], "reasoningEffort" | "profileCorrection" | "tutorModel" | "conversationRepair" | "deliveryReviewModel">) {
  return stageLunaAllRolesCandidateFromManifest({ ...input, reasoningEffort: "low" });
}
export function prepareLunaLowAllRolesAmendment(input: Omit<Parameters<typeof prepareLunaAllRolesAmendment>[0], "reasoningEffort" | "profileCorrection" | "tutorModel" | "conversationRepair" | "deliveryReviewModel">) {
  return prepareLunaAllRolesAmendment({ ...input, reasoningEffort: "low" });
}

export type ActiveDerivedOperationalApproval = {
  kind: "derived_approval";
  bundle_path: string;
  record: z.infer<typeof DerivedBundleRecordSchema>;
  manifest_path: string;
  approval_evidence_path: string;
  manifest: ApprovedCandidateManifest;
  evidence: OperationalApprovalEvidence;
  runtime_snapshot: ReturnType<typeof modelUpgradeCandidateRuntimeSnapshot>;
};

export type ActiveLegacyOperationalApproval = {
  kind: "legacy_gpt54_baseline";
  bundle_path: string;
  record: z.infer<typeof LegacyBundleRecordSchema>;
  manifest_path: string;
};

export type ActiveLocalCandidateEvaluation = {
  kind: "local_candidate_evaluation";
  bundle_path: string;
  record: z.infer<typeof LocalLunaCandidateRecordSchema>;
  manifest_path: string;
  manifest: ApprovedCandidateManifest;
  runtime_snapshot: ReturnType<typeof modelUpgradeCandidateRuntimeSnapshot>;
};

function assertLocalLunaLowCandidateContext(env: Record<string, string | undefined>) {
  let localDatabase = false;
  try {
    const database = new URL(env.DATABASE_URL ?? "");
    localDatabase = ["postgres:", "postgresql:"].includes(database.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) &&
      /^\/cmcq_ai_students_[a-f0-9]{12}$/.test(database.pathname) &&
      !database.searchParams.has("host") && !database.searchParams.has("hostaddr");
  } catch { /* Invalid or absent database context cannot authorize candidate execution. */ }
  if (env.LUNA_LOW_LOCAL_CANDIDATE_EVALUATION !== "1" || env.APP_ENV !== "development" ||
      !localDatabase || env.RENDER === "true" || Boolean(env.RENDER_SERVICE_ID) ||
      env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE === "true") {
    throw new OperationalApprovalBundleError("local_candidate_evaluation_forbidden",
      "A pending Luna candidate is allowed only in an explicitly enabled fresh local synthetic evaluation database.");
  }
}

function resolveLocalLunaLowCandidate(
  record: z.infer<typeof LocalLunaCandidateRecordSchema>,
  bundlePath: string,
  env: Record<string, string | undefined>
): ActiveLocalCandidateEvaluation {
  assertLocalLunaLowCandidateContext(env);
  if (env.OPERATIONAL_APPROVAL_EVIDENCE_PATH?.trim()) {
    throw new OperationalApprovalBundleError("local_candidate_approval_evidence_conflict",
      "Pending candidate evaluation must not assert production approval evidence.");
  }
  const manifestPath = assertFileHash(record.candidate_manifest, bundlePath, "local_candidate_manifest_integrity_mismatch");
  const parentPath = assertFileHash(record.parent_manifest, bundlePath, "local_candidate_parent_integrity_mismatch");
  const manifest = ApprovedCandidateManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const parent = ApprovedCandidateManifestSchema.parse(JSON.parse(readFileSync(parentPath, "utf8")));
  const deliveryReviewModel = record.version === LUNA_SOL_DELIVERY_REVIEW_CANDIDATE_VERSION ? LUNA_SOL_DELIVERY_REVIEW_MODEL : undefined;
  const conversationRepair = deliveryReviewModel || record.version === LUNA_CONVERSATION_REPAIR_CANDIDATE_VERSION ? LUNA_CONVERSATION_REPAIR : undefined;
  const tutorModel = record.version === MIXED_TUTOR_CANDIDATE_VERSION ? MIXED_TUTOR_MODEL : undefined;
  const profileCorrection = conversationRepair || tutorModel || record.version === LUNA_MEDIUM_PROFILE_FIDELITY_CANDIDATE_VERSION ? LUNA_PROFILE_FIDELITY_CORRECTION : undefined;
  const reasoningEffort = record.version === "luna-low-all-roles-candidate-v1" ? "low" : "medium";
  const expected = buildLunaAllRolesCandidateManifest(parent, reasoningEffort, profileCorrection, tutorModel, conversationRepair, deliveryReviewModel);
  if (modelUpgradeCandidateRuntimeHash(parent, approvedOperationalRoleNamesForManifest(parent)) !== record.parent_runtime_hash ||
      stableHash(expected) !== stableHash(manifest) ||
      modelUpgradeCandidateRuntimeHash(manifest, APPROVED_OPERATIONAL_ROLE_NAMES) !== record.runtime_candidate_hash ||
      env.OPERATIONAL_APPROVED_CONFIG_HASH !== record.runtime_candidate_hash ||
      (env.OPERATIONAL_APPROVED_MANIFEST_PATH?.trim() && path.resolve(env.OPERATIONAL_APPROVED_MANIFEST_PATH) !== manifestPath)) {
    throw new OperationalApprovalBundleError("local_candidate_identity_mismatch",
      "Pending candidate evaluation identity does not match its exact parent and model-only projection.");
  }
  return { kind: "local_candidate_evaluation", bundle_path: bundlePath, record, manifest_path: manifestPath, manifest,
    runtime_snapshot: modelUpgradeCandidateRuntimeSnapshot(manifest, APPROVED_OPERATIONAL_ROLE_NAMES) };
}

export function resolveActiveOperationalApproval(input: {
  env?: Record<string, string | undefined>;
  bundlePath?: string;
} = {}): ActiveDerivedOperationalApproval | ActiveLegacyOperationalApproval | ActiveLocalCandidateEvaluation | null {
  const env = input.env ?? process.env;
  const configuredBundlePath = env.OPERATIONAL_APPROVAL_BUNDLE_PATH?.trim();
  const configuredManifestPath = env.OPERATIONAL_APPROVED_MANIFEST_PATH?.trim();
  const configuredEvidencePath = env.OPERATIONAL_APPROVAL_EVIDENCE_PATH?.trim();
  const bundlePath = path.resolve(input.bundlePath ?? configuredBundlePath ?? defaultActiveApprovalBundlePath());
  const explicitPathsConfigured = Boolean(
    configuredBundlePath || configuredManifestPath || configuredEvidencePath
  );

  if (!existsSync(bundlePath)) {
    if (explicitPathsConfigured) {
      throw new OperationalApprovalBundleError(
        "active_approval_bundle_missing",
        "Configured active operational approval bundle does not exist.",
        { bundle_path: bundlePath }
      );
    }
    return null;
  }

  const record = ActiveBundleRecordSchema.parse(JSON.parse(readFileSync(bundlePath, "utf8")));
  if (record.active_kind === "local_candidate_evaluation") {
    return resolveLocalLunaLowCandidate(record, bundlePath, env);
  }
  if (record.active_kind === "legacy_gpt54_baseline") {
    if (configuredManifestPath || configuredEvidencePath) {
      throw new OperationalApprovalBundleError(
        "legacy_bundle_path_assertion_conflict",
        "Derived approval artifact paths must be unset while the legacy rollback bundle is active."
      );
    }
    return {
      kind: record.active_kind,
      bundle_path: bundlePath,
      record,
      manifest_path: assertFileHash(record.legacy_manifest, bundlePath, "legacy_manifest_integrity_mismatch")
    };
  }

  const manifestPath = assertFileHash(
    record.approved_manifest,
    bundlePath,
    "active_approved_manifest_integrity_mismatch"
  );
  const evidencePath = assertFileHash(
    record.approval_evidence,
    bundlePath,
    "active_approval_evidence_integrity_mismatch"
  );
  if (configuredManifestPath && path.resolve(configuredManifestPath) !== manifestPath) {
    throw new OperationalApprovalBundleError(
      "approved_manifest_path_mismatch",
      "OPERATIONAL_APPROVED_MANIFEST_PATH does not match the active approval bundle."
    );
  }
  if (configuredEvidencePath && path.resolve(configuredEvidencePath) !== evidencePath) {
    throw new OperationalApprovalBundleError(
      "approval_evidence_path_mismatch",
      "OPERATIONAL_APPROVAL_EVIDENCE_PATH does not match the active approval bundle."
    );
  }

  const verified = verifyApprovedCandidateArtifacts({
    approvedManifestPath: manifestPath,
    approvalEvidencePath: evidencePath,
    expectedRuntimeHash: record.runtime_candidate_hash,
    expectedEvaluationProtocolHash: record.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: record.approval_evidence_hash,
    expectedSourceProviderRunId: record.source_provider_run_id,
    expectedDerivedEvaluationId: record.derived_evaluation_id
  });
  if (
    verified.evidence.approved_at !== record.approval_timestamp ||
    stableHash(verified.evidence.human_review) !== record.human_review_evidence_hash
  ) {
    throw new OperationalApprovalBundleError(
      "active_approval_record_mismatch",
      "Active approval record does not match the approved evidence."
    );
  }

  return {
    kind: record.active_kind,
    bundle_path: bundlePath,
    record,
    manifest_path: manifestPath,
    approval_evidence_path: evidencePath,
    manifest: verified.manifest,
    evidence: verified.evidence,
    runtime_snapshot: modelUpgradeCandidateRuntimeSnapshot(
      verified.manifest,
      approvedOperationalRoleNamesForManifest(verified.manifest)
    )
  };
}

function requiredRoleMetadataIssues(manifest: ApprovedCandidateManifest) {
  const issues: string[] = [];
  for (const role of approvedOperationalRoleNamesForManifest(manifest)) {
    const metadata = manifest.configuration_fingerprint.role_version_metadata[role];
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      issues.push(`role_version_metadata_missing:${role}`);
      continue;
    }
    const values = metadata as Record<string, unknown>;
    if (typeof values.prompt_version !== "string" || values.prompt_version.length === 0) {
      issues.push(`prompt_version_missing:${role}`);
    }
    if (typeof values.prompt_hash !== "string" || values.prompt_hash.length === 0) {
      issues.push(`prompt_hash_missing:${role}`);
    }
    if (![values.schema_version, values.output_schema_version, values.input_schema_version]
      .some((value) => typeof value === "string" && value.length > 0)) {
      issues.push(`schema_version_missing:${role}`);
    }
    if (typeof values.validator_version !== "string" || values.validator_version.length === 0) {
      issues.push(`validator_version_missing:${role}`);
    }
    if (typeof values.fallback_version !== "string" || values.fallback_version.length === 0) {
      issues.push(`fallback_version_missing:${role}`);
    }
  }
  return issues;
}

export function resolveApprovedOperationalRuntimeRequirement(input: {
  requestedHash: string;
  env?: Record<string, string | undefined>;
  bundlePath?: string;
}): ApprovedOperationalRuntimeResolution {
  let active: ReturnType<typeof resolveActiveOperationalApproval>;
  try {
    active = resolveActiveOperationalApproval({
      ...(input.env ? { env: input.env } : {}),
      ...(input.bundlePath ? { bundlePath: input.bundlePath } : {})
    });
  } catch (error) {
    return {
      requested_hash: input.requestedHash,
      resolved_hash: null,
      resolution_source: "none",
      approved_bundle_complete: false,
      role_count: 0,
      missing_roles: [...APPROVED_OPERATIONAL_ROLE_NAMES],
      duplicate_roles: [],
      mismatch_reasons: [
        error instanceof OperationalApprovalBundleError ? error.code : "approved_runtime_resolution_failed"
      ],
      bundle_path: input.bundlePath ?? null
    };
  }

  if (!active) {
    return {
      requested_hash: input.requestedHash,
      resolved_hash: null,
      resolution_source: "none",
      approved_bundle_complete: false,
      role_count: 0,
      missing_roles: [...APPROVED_OPERATIONAL_ROLE_NAMES],
      duplicate_roles: [],
      mismatch_reasons: ["approved_derived_bundle_missing"],
      bundle_path: input.bundlePath ?? null
    };
  }

  if (active.kind === "legacy_gpt54_baseline") {
    return {
      requested_hash: input.requestedHash,
      resolved_hash: active.record.approved_runtime_hash,
      resolution_source: "legacy_fallback",
      approved_bundle_complete: false,
      role_count: 0,
      missing_roles: [...APPROVED_OPERATIONAL_ROLE_NAMES],
      duplicate_roles: [],
      mismatch_reasons: [
        ...(input.requestedHash !== active.record.approved_runtime_hash
          ? ["requested_hash_not_resolved"]
          : []),
        "legacy_bundle_cannot_satisfy_approved_runtime_requirement"
      ],
      bundle_path: active.bundle_path
    };
  }

  if (active.kind === "local_candidate_evaluation") {
    return {
      requested_hash: input.requestedHash,
      resolved_hash: active.record.runtime_candidate_hash,
      resolution_source: "none",
      approved_bundle_complete: false,
      role_count: Object.keys(active.manifest.roles).length,
      missing_roles: [],
      duplicate_roles: [],
      mismatch_reasons: ["local_candidate_validation_pending"],
      bundle_path: active.bundle_path
    };
  }

  const actualRoles = Object.keys(active.manifest.roles);
  const approvedRoles = approvedOperationalRoleNamesForManifest(active.manifest);
  const seen = new Set<string>();
  const duplicateRoles = actualRoles.filter((role) => {
    if (seen.has(role)) return true;
    seen.add(role);
    return false;
  });
  const missingRoles = approvedRoles.filter((role) => !seen.has(role));
  const metadataIssues = requiredRoleMetadataIssues(active.manifest);
  const mismatchReasons = [
    ...(active.record.runtime_candidate_hash !== input.requestedHash
      ? ["requested_hash_not_resolved"]
      : []),
    ...missingRoles.map((role) => `approved_role_missing:${role}`),
    ...duplicateRoles.map((role) => `approved_role_duplicate:${role}`),
    ...metadataIssues
  ];

  return {
    requested_hash: input.requestedHash,
    resolved_hash: active.record.runtime_candidate_hash,
    resolution_source: "approved_derived_bundle",
    approved_bundle_complete: mismatchReasons.length === 0 &&
      actualRoles.length === approvedRoles.length,
    role_count: actualRoles.length,
    missing_roles: missingRoles,
    duplicate_roles: duplicateRoles,
    mismatch_reasons: mismatchReasons,
    bundle_path: active.bundle_path
  };
}

function archiveExistingPointer(bundlePath: string) {
  if (!existsSync(bundlePath)) return null;
  const historyDir = path.join(path.dirname(bundlePath), "history");
  mkdirSync(historyDir, { recursive: true });
  const archivePath = path.join(historyDir, `active-approval-bundle-${Date.now()}.json`);
  copyFileSync(bundlePath, archivePath);
  return archivePath;
}

export function activateOperationalApprovalBundle(input: {
  approvalEvidencePath: string;
  approvedManifestPath: string;
  expectedRuntimeHash: string;
  expectedEvaluationProtocolHash: string;
  expectedApprovalEvidenceHash: string;
  expectedSourceProviderRunId: string;
  expectedDerivedEvaluationId: string;
  confirmation: string;
  outputDirectory?: string;
  legacyManifestPath?: string;
}) {
  const requiredConfirmation = "activate approved gpt-5.6 operational candidate v2";
  if (input.confirmation !== requiredConfirmation) {
    throw new OperationalApprovalBundleError(
      "activation_confirmation_mismatch",
      `Activation requires --confirm \"${requiredConfirmation}\".`
    );
  }
  const verified = verifyApprovedCandidateArtifacts({
    approvedManifestPath: path.resolve(input.approvedManifestPath),
    approvalEvidencePath: path.resolve(input.approvalEvidencePath),
    expectedRuntimeHash: input.expectedRuntimeHash,
    expectedEvaluationProtocolHash: input.expectedEvaluationProtocolHash,
    expectedApprovalEvidenceHash: input.expectedApprovalEvidenceHash,
    expectedSourceProviderRunId: input.expectedSourceProviderRunId,
    expectedDerivedEvaluationId: input.expectedDerivedEvaluationId,
    requireEvidenceManifestPathMatch: true
  });
  const legacyManifestPath = path.resolve(
    input.legacyManifestPath ?? path.join(process.cwd(), "config", "approved-operational-agent-config.json")
  );
  const legacyManifest = JSON.parse(readFileSync(legacyManifestPath, "utf8")) as {
    approved_active_configuration_hash?: string;
  };
  if (
    legacyManifest.approved_active_configuration_hash !== LEGACY_GPT54_APPROVED_RUNTIME_HASH ||
    verified.evidence.rollback_hash !== LEGACY_GPT54_APPROVED_RUNTIME_HASH
  ) {
    throw new OperationalApprovalBundleError(
      "rollback_baseline_mismatch",
      "The approval evidence is not bound to the preserved GPT-5.4 rollback baseline."
    );
  }

  const outputDirectory = path.resolve(input.outputDirectory ?? defaultActiveApprovalDirectory());
  const artifactDirectory = path.join(
    outputDirectory,
    "artifacts",
    `${input.expectedRuntimeHash}-${input.expectedApprovalEvidenceHash.slice(0, 12)}`
  );
  const rollbackDirectory = path.join(outputDirectory, "rollback", LEGACY_GPT54_APPROVED_RUNTIME_HASH);
  mkdirSync(artifactDirectory, { recursive: true });
  mkdirSync(rollbackDirectory, { recursive: true });
  const approvedManifestCopy = path.join(artifactDirectory, "approved-candidate-manifest.json");
  const approvalEvidenceCopy = path.join(artifactDirectory, "approval_evidence.json");
  const rollbackManifestCopy = path.join(rollbackDirectory, "approved-operational-agent-config.json");
  copyFileSync(input.approvedManifestPath, approvedManifestCopy);
  copyFileSync(input.approvalEvidencePath, approvalEvidenceCopy);
  copyFileSync(legacyManifestPath, rollbackManifestCopy);

  const bundlePath = path.join(outputDirectory, "active-approval-bundle.json");
  const archivedPointer = archiveExistingPointer(bundlePath);
  const record: z.infer<typeof DerivedBundleRecordSchema> = {
    bundle_version: ACTIVE_APPROVAL_BUNDLE_VERSION,
    resolver_version: ACTIVE_APPROVAL_RESOLVER_VERSION,
    activation_version: OPERATIONAL_MODEL_UPGRADE_ACTIVATION_VERSION,
    active_kind: "derived_approval",
    activated_at: new Date().toISOString(),
    runtime_candidate_hash: input.expectedRuntimeHash,
    evaluation_protocol_hash: input.expectedEvaluationProtocolHash,
    approval_evidence_hash: input.expectedApprovalEvidenceHash,
    source_provider_run_id: input.expectedSourceProviderRunId,
    derived_evaluation_id: input.expectedDerivedEvaluationId,
    approval_timestamp: verified.evidence.approved_at,
    human_review_evidence_hash: stableHash(verified.evidence.human_review),
    approved_manifest: { path: approvedManifestCopy, sha256: sha256File(approvedManifestCopy) },
    approval_evidence: { path: approvalEvidenceCopy, sha256: sha256File(approvalEvidenceCopy) },
    rollback: {
      approved_runtime_hash: LEGACY_GPT54_APPROVED_RUNTIME_HASH,
      manifest: { path: rollbackManifestCopy, sha256: sha256File(rollbackManifestCopy) }
    },
    materialization_context: "production_activation"
  };
  writeJsonAtomically(bundlePath, record);
  resolveActiveOperationalApproval({ bundlePath, env: {} });

  return {
    status: "activated" as const,
    no_provider_call: true,
    bundle_path: bundlePath,
    approved_manifest_path: approvedManifestCopy,
    approval_evidence_path: approvalEvidenceCopy,
    runtime_candidate_hash: record.runtime_candidate_hash,
    evaluation_protocol_hash: record.evaluation_protocol_hash,
    approval_evidence_hash: record.approval_evidence_hash,
    source_provider_run_id: record.source_provider_run_id,
    derived_evaluation_id: record.derived_evaluation_id,
    rollback_hash: record.rollback.approved_runtime_hash,
    archived_prior_pointer: archivedPointer,
    render_variables: {
      OPERATIONAL_APPROVED_CONFIG_HASH: record.runtime_candidate_hash,
      OPERATIONAL_APPROVAL_BUNDLE_PATH: bundlePath,
      OPERATIONAL_APPROVED_MANIFEST_PATH: approvedManifestCopy,
      OPERATIONAL_APPROVAL_EVIDENCE_PATH: approvalEvidenceCopy
    }
  };
}

export function materializeApprovedOperationalRuntimeLocally(input: {
  approvalEvidencePath: string;
  approvedManifestPath: string;
  sourceCandidateManifestPath: string;
  expectedRuntimeHash: string;
  expectedEvaluationProtocolHash: string;
  expectedApprovalEvidenceHash: string;
  expectedSourceProviderRunId: string;
  expectedDerivedEvaluationId: string;
  confirmation: string;
  outputDirectory?: string;
  legacyManifestPath?: string;
  nodeEnv?: string;
  allowNonDefaultOutputDirectoryForTest?: boolean;
}) {
  const requiredConfirmation = "materialize approved operational runtime locally";
  if (input.confirmation !== requiredConfirmation) {
    throw new OperationalApprovalBundleError(
      "local_materialization_confirmation_mismatch",
      `Local materialization requires --confirm-local-materialization "${requiredConfirmation}".`
    );
  }
  if ((input.nodeEnv ?? process.env.NODE_ENV) === "production") {
    throw new OperationalApprovalBundleError(
      "local_materialization_forbidden_in_production",
      "The local approved-runtime materializer is disabled in production."
    );
  }

  const outputDirectory = path.resolve(input.outputDirectory ?? defaultActiveApprovalDirectory());
  // Keep this containment decision relative. A statically resolved absolute
  // directory makes Next's file tracer include every ignored local artifact.
  const relativeOutputDirectory = path.relative(process.cwd(), outputDirectory);
  const relativeStorageSegment = relativeOutputDirectory.split(path.sep)[0];
  const normalizedStorageSegment = process.platform === "win32"
    ? relativeStorageSegment.toLowerCase() : relativeStorageSegment;
  if (
    !input.allowNonDefaultOutputDirectoryForTest &&
    normalizedStorageSegment !== ".data"
  ) {
    throw new OperationalApprovalBundleError(
      "local_materialization_output_outside_ignored_data",
      "Local approved-runtime state must remain under ignored .data storage."
    );
  }

  const approvedManifestPath = path.resolve(input.approvedManifestPath);
  const sourceCandidateManifestPath = path.resolve(input.sourceCandidateManifestPath);
  if (
    !existsSync(sourceCandidateManifestPath) ||
    sha256File(sourceCandidateManifestPath) !== sha256File(approvedManifestPath)
  ) {
    throw new OperationalApprovalBundleError(
      "local_materialization_source_manifest_hash_mismatch",
      "The approved manifest copy does not match the current source candidate manifest byte-for-byte."
    );
  }

  const verified = verifyApprovedCandidateArtifacts({
    approvedManifestPath,
    approvalEvidencePath: path.resolve(input.approvalEvidencePath),
    expectedRuntimeHash: input.expectedRuntimeHash,
    expectedEvaluationProtocolHash: input.expectedEvaluationProtocolHash,
    expectedApprovalEvidenceHash: input.expectedApprovalEvidenceHash,
    expectedSourceProviderRunId: input.expectedSourceProviderRunId,
    expectedDerivedEvaluationId: input.expectedDerivedEvaluationId,
    requireEvidenceManifestPathMatch: true
  });

  const bundlePath = path.join(outputDirectory, "active-approval-bundle.json");
  if (existsSync(bundlePath)) {
    const current = resolveActiveOperationalApproval({ bundlePath, env: {} });
    if (
      current?.kind === "derived_approval" &&
      current.record.runtime_candidate_hash === input.expectedRuntimeHash &&
      current.manifest_path &&
      sha256File(current.manifest_path) === verified.manifest_sha256
    ) {
      const resolution = resolveApprovedOperationalRuntimeRequirement({
        requestedHash: input.expectedRuntimeHash,
        bundlePath,
        env: {}
      });
      if (resolution.approved_bundle_complete) {
        return {
          status: "already_materialized" as const,
          materialization_version: LOCAL_APPROVED_RUNTIME_MATERIALIZATION_VERSION,
          materialization_context: "local_runtime_materialization" as const,
          no_provider_call: true,
          local_state_mutated: false,
          bundle_path: bundlePath,
          approved_manifest_path: current.manifest_path,
          approval_evidence_path: current.approval_evidence_path,
          runtime_candidate_hash: current.record.runtime_candidate_hash,
          evaluation_protocol_hash: current.record.evaluation_protocol_hash,
          approval_evidence_hash: current.record.approval_evidence_hash,
          source_provider_run_id: current.record.source_provider_run_id,
          derived_evaluation_id: current.record.derived_evaluation_id,
          resolution
        };
      }
    }
  }

  const activated = activateOperationalApprovalBundle({
    approvalEvidencePath: path.resolve(input.approvalEvidencePath),
    approvedManifestPath,
    expectedRuntimeHash: input.expectedRuntimeHash,
    expectedEvaluationProtocolHash: input.expectedEvaluationProtocolHash,
    expectedApprovalEvidenceHash: input.expectedApprovalEvidenceHash,
    expectedSourceProviderRunId: input.expectedSourceProviderRunId,
    expectedDerivedEvaluationId: input.expectedDerivedEvaluationId,
    confirmation: "activate approved gpt-5.6 operational candidate v2",
    outputDirectory,
    ...(input.legacyManifestPath ? { legacyManifestPath: input.legacyManifestPath } : {})
  });
  const record = DerivedBundleRecordSchema.parse(JSON.parse(readFileSync(activated.bundle_path, "utf8")));
  writeJsonAtomically(activated.bundle_path, {
    ...record,
    materialization_context: "local_runtime_materialization"
  });
  const resolution = resolveApprovedOperationalRuntimeRequirement({
    requestedHash: input.expectedRuntimeHash,
    bundlePath: activated.bundle_path,
    env: {}
  });
  if (!resolution.approved_bundle_complete) {
    throw new OperationalApprovalBundleError(
      "local_materialization_incomplete",
      "The materialized local approved runtime did not pass complete resolution.",
      { mismatch_reasons: resolution.mismatch_reasons }
    );
  }

  return {
    ...activated,
    status: "materialized_local" as const,
    materialization_version: LOCAL_APPROVED_RUNTIME_MATERIALIZATION_VERSION,
    materialization_context: "local_runtime_materialization" as const,
    no_provider_call: true,
    local_state_mutated: true,
    resolution
  };
}

export function rollbackOperationalApprovalBundle(input: {
  bundlePath?: string;
  expectedCurrentRuntimeHash: string;
  expectedRollbackHash: string;
  confirmation: string;
}) {
  const requiredConfirmation = "rollback to approved gpt-5.4 baseline";
  if (input.confirmation !== requiredConfirmation) {
    throw new OperationalApprovalBundleError(
      "rollback_confirmation_mismatch",
      `Rollback requires --confirm \"${requiredConfirmation}\".`
    );
  }
  const active = resolveActiveOperationalApproval({ bundlePath: input.bundlePath, env: {} });
  if (!active || active.kind !== "derived_approval") {
    throw new OperationalApprovalBundleError(
      "derived_approval_not_active",
      "A derived operational approval must be active before rollback."
    );
  }
  if (
    active.record.runtime_candidate_hash !== input.expectedCurrentRuntimeHash ||
    active.record.rollback.approved_runtime_hash !== input.expectedRollbackHash ||
    input.expectedRollbackHash !== LEGACY_GPT54_APPROVED_RUNTIME_HASH
  ) {
    throw new OperationalApprovalBundleError(
      "rollback_hash_mismatch",
      "Rollback hashes do not match the active and preserved approval bundles."
    );
  }

  const record: z.infer<typeof LegacyBundleRecordSchema> = {
    bundle_version: ACTIVE_APPROVAL_BUNDLE_VERSION,
    resolver_version: ACTIVE_APPROVAL_RESOLVER_VERSION,
    activation_version: OPERATIONAL_MODEL_UPGRADE_ACTIVATION_VERSION,
    active_kind: "legacy_gpt54_baseline",
    activated_at: new Date().toISOString(),
    approved_runtime_hash: LEGACY_GPT54_APPROVED_RUNTIME_HASH,
    legacy_manifest: active.record.rollback.manifest,
    previous_derived_approval: {
      runtime_candidate_hash: active.record.runtime_candidate_hash,
      evaluation_protocol_hash: active.record.evaluation_protocol_hash,
      approval_evidence_hash: active.record.approval_evidence_hash,
      source_provider_run_id: active.record.source_provider_run_id,
      derived_evaluation_id: active.record.derived_evaluation_id,
      approved_manifest: active.record.approved_manifest,
      approval_evidence: active.record.approval_evidence
    }
  };
  archiveExistingPointer(active.bundle_path);
  writeJsonAtomically(active.bundle_path, record);
  resolveActiveOperationalApproval({ bundlePath: active.bundle_path, env: {} });
  return {
    status: "rolled_back" as const,
    no_provider_call: true,
    bundle_path: active.bundle_path,
    active_approved_hash: record.approved_runtime_hash,
    preserved_gpt56_runtime_hash: record.previous_derived_approval.runtime_candidate_hash,
    gpt56_approval_evidence_preserved: true,
    render_variables: {
      OPERATIONAL_APPROVED_CONFIG_HASH: record.approved_runtime_hash,
      OPERATIONAL_APPROVAL_BUNDLE_PATH: active.bundle_path,
      OPERATIONAL_APPROVED_MANIFEST_PATH: "<unset>",
      OPERATIONAL_APPROVAL_EVIDENCE_PATH: "<unset>"
    }
  };
}
