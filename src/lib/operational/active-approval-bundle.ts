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

export const ACTIVE_APPROVAL_BUNDLE_VERSION = "operational-active-approval-bundle-v1";
export const ACTIVE_APPROVAL_RESOLVER_VERSION = "operational-active-approval-resolver-v1";
export const OPERATIONAL_MODEL_UPGRADE_ACTIVATION_VERSION = "operational-model-upgrade-activation-v1";
export const LOCAL_APPROVED_RUNTIME_MATERIALIZATION_VERSION =
  "operational-approved-runtime-local-materialization-v1";
export const LEGACY_GPT54_APPROVED_RUNTIME_HASH =
  "58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2";

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
  provider_timeout_ms: z.number().int().positive(),
  provider_max_retries: z.number().int().nonnegative(),
  role_live_toggles: z.object({
    student_communication_agent: z.boolean(),
    topic_dialogue_agent: z.boolean()
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
}).strict();

export type ApprovedCandidateManifest = z.infer<typeof ApprovedCandidateManifestSchema>;

export function approvedCandidateRoleConfig(
  manifest: ApprovedCandidateManifest,
  role: ApprovedOperationalRoleName
) {
  const config = manifest.roles[role];
  if (!config) {
    throw new OperationalApprovalBundleError(
      "approved_role_missing",
      `Approved candidate manifest is missing ${role}.`
    );
  }
  return config;
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

const ActiveBundleRecordSchema = z.union([DerivedBundleRecordSchema, LegacyBundleRecordSchema]);
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
  const expectedRoles = [...APPROVED_OPERATIONAL_ROLE_NAMES].sort();
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
}) {
  const manifest = ApprovedCandidateManifestSchema.parse(
    JSON.parse(readFileSync(input.approvedManifestPath, "utf8"))
  );
  const evidence = ApprovalEvidenceSchema.parse(
    JSON.parse(readFileSync(input.approvalEvidencePath, "utf8"))
  );
  assertExactRoleInventory(manifest);

  const runtimeHash = modelUpgradeCandidateRuntimeHash(manifest, APPROVED_OPERATIONAL_ROLE_NAMES);
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
    ...(!humanReviewApproved(evidence.human_review) ? ["human_approval_missing"] : [])
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

export function resolveActiveOperationalApproval(input: {
  env?: Record<string, string | undefined>;
  bundlePath?: string;
} = {}): ActiveDerivedOperationalApproval | ActiveLegacyOperationalApproval | null {
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
      APPROVED_OPERATIONAL_ROLE_NAMES
    )
  };
}

function requiredRoleMetadataIssues(manifest: ApprovedCandidateManifest) {
  const issues: string[] = [];
  for (const role of APPROVED_OPERATIONAL_ROLE_NAMES) {
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

  const actualRoles = Object.keys(active.manifest.roles);
  const seen = new Set<string>();
  const duplicateRoles = actualRoles.filter((role) => {
    if (seen.has(role)) return true;
    seen.add(role);
    return false;
  });
  const missingRoles = APPROVED_OPERATIONAL_ROLE_NAMES.filter((role) => !seen.has(role));
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
      actualRoles.length === APPROVED_OPERATIONAL_ROLE_NAMES.length,
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
  const defaultDataRoot = path.resolve(process.cwd(), ".data");
  if (
    !input.allowNonDefaultOutputDirectoryForTest &&
    outputDirectory !== defaultDataRoot &&
    !outputDirectory.startsWith(`${defaultDataRoot}${path.sep}`)
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
