import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AgentName as AgentNameType } from "@/lib/agents/names";
import {
  readApprovedOperationalAgentConfig
} from "@/lib/agents/operational/approved-config";
import { OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX } from "@/lib/services/operational-live-canary/database-url";

export const OPERATIONAL_LIVE_CANARY_CONTEXT_VERSION = "operational-live-canary-context-v1" as const;
const OPERATIONAL_LIVE_CANARY_SMOKE_DATABASE_SUFFIX = "_live_canary_smoke_e2e";

export type OperationalLiveCanaryContext = {
  contextVersion: typeof OPERATIONAL_LIVE_CANARY_CONTEXT_VERSION;
  runPublicId: string;
  stepPublicId: string;
  logicalInvocationKey: string;
  manifestVersion: string;
  manifestHash: string;
  approvedConfigHash: string;
  effectiveResultVersion: string;
  effectiveValidatorVersion: string;
  targetedEvidenceRunPublicId: string;
  databaseName: string;
  syntheticOnly: true;
  createdThroughPhase8cCli: true;
  attestationHash: string;
};

export type CanaryContextInvalidSubreason =
  | "canary_context_missing"
  | "canary_run_id_mismatch"
  | "canary_step_id_mismatch"
  | "canary_logical_invocation_mismatch"
  | "canary_agent_mismatch"
  | "canary_manifest_hash_mismatch"
  | "canary_config_hash_mismatch"
  | "canary_database_invalid"
  | "canary_run_not_found"
  | "canary_run_status_invalid"
  | "canary_step_not_in_run"
  | "canary_evidence_reference_mismatch"
  | "canary_fixture_namespace_invalid"
  | "canary_attestation_hash_mismatch"
  | "canary_effective_result_version_mismatch"
  | "canary_effective_validator_version_mismatch";

export type CanaryContextDiagnostics = {
  canary_context_present: boolean;
  canary_context_version: string | null;
  canary_run_public_id: string | null;
  canary_step_public_id: string | null;
  canary_logical_invocation_key: string | null;
  canary_manifest_version: string | null;
  canary_manifest_hash: string | null;
  canary_approved_config_hash: string | null;
  canary_effective_result_version: string | null;
  canary_effective_validator_version: string | null;
  canary_targeted_evidence_run_id: string | null;
  canary_database_name: string | null;
  canary_database_suffix_valid: boolean | null;
  canary_synthetic_only: boolean | null;
  canary_created_through_phase8c_cli: boolean | null;
  canary_attestation_hash_present: boolean;
  canary_attestation_hash_valid: boolean | null;
  canary_run_row_exists: boolean | null;
  canary_run_status: string | null;
  canary_step_belongs_to_run: boolean | null;
  canary_step_logical_invocation_matches: boolean | null;
  canary_step_agent_matches: boolean | null;
  canary_fixture_namespace_valid: boolean | null;
  final_canary_context_valid: boolean | null;
  failed_canary_context_rule: CanaryContextInvalidSubreason | null;
};

type RunLike = {
  run_public_id: string;
  manifest_version: string;
  manifest_hash: string;
  approved_config_hash: string;
};

type StepLike = {
  step_public_id: string;
  logical_invocation_key: string;
};

type ManifestLike = {
  manifest_version: string;
  deterministic_manifest_hash: string;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stable);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])])
    );
  }

  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(stable(value));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function contextHashPayload(context: Omit<OperationalLiveCanaryContext, "attestationHash">) {
  return {
    approvedConfigHash: context.approvedConfigHash,
    contextVersion: context.contextVersion,
    createdThroughPhase8cCli: context.createdThroughPhase8cCli,
    databaseName: context.databaseName,
    effectiveResultVersion: context.effectiveResultVersion,
    effectiveValidatorVersion: context.effectiveValidatorVersion,
    logicalInvocationKey: context.logicalInvocationKey,
    manifestHash: context.manifestHash,
    manifestVersion: context.manifestVersion,
    runPublicId: context.runPublicId,
    stepPublicId: context.stepPublicId,
    syntheticOnly: context.syntheticOnly,
    targetedEvidenceRunPublicId: context.targetedEvidenceRunPublicId
  };
}

function contextWithoutAttestation(
  context: OperationalLiveCanaryContext
): Omit<OperationalLiveCanaryContext, "attestationHash"> {
  return {
    contextVersion: context.contextVersion,
    runPublicId: context.runPublicId,
    stepPublicId: context.stepPublicId,
    logicalInvocationKey: context.logicalInvocationKey,
    manifestVersion: context.manifestVersion,
    manifestHash: context.manifestHash,
    approvedConfigHash: context.approvedConfigHash,
    effectiveResultVersion: context.effectiveResultVersion,
    effectiveValidatorVersion: context.effectiveValidatorVersion,
    targetedEvidenceRunPublicId: context.targetedEvidenceRunPublicId,
    databaseName: context.databaseName,
    syntheticOnly: context.syntheticOnly,
    createdThroughPhase8cCli: context.createdThroughPhase8cCli
  };
}

export function operationalLiveCanaryContextAttestationHash(
  context: Omit<OperationalLiveCanaryContext, "attestationHash">
) {
  return sha256(stableJson(contextHashPayload(context)));
}

export function createOperationalLiveCanaryContext(input: {
  run: RunLike;
  step: StepLike;
  manifest: ManifestLike;
  databaseName: string;
}): OperationalLiveCanaryContext {
  const approvedManifest = readApprovedOperationalAgentConfig();
  const base = {
    contextVersion: OPERATIONAL_LIVE_CANARY_CONTEXT_VERSION,
    runPublicId: input.run.run_public_id,
    stepPublicId: input.step.step_public_id,
    logicalInvocationKey: input.step.logical_invocation_key,
    manifestVersion: input.manifest.manifest_version,
    manifestHash: input.manifest.deterministic_manifest_hash,
    approvedConfigHash: input.run.approved_config_hash,
    effectiveResultVersion: approvedManifest.effective_result_version,
    effectiveValidatorVersion: approvedManifest.effective_validator_version,
    targetedEvidenceRunPublicId: approvedManifest.evaluation_evidence.targeted_run_public_id,
    databaseName: input.databaseName,
    syntheticOnly: true,
    createdThroughPhase8cCli: true
  } satisfies Omit<OperationalLiveCanaryContext, "attestationHash">;

  return {
    ...base,
    attestationHash: operationalLiveCanaryContextAttestationHash(base)
  };
}

export function missingCanaryContextDiagnostics(): CanaryContextDiagnostics {
  return {
    canary_context_present: false,
    canary_context_version: null,
    canary_run_public_id: null,
    canary_step_public_id: null,
    canary_logical_invocation_key: null,
    canary_manifest_version: null,
    canary_manifest_hash: null,
    canary_approved_config_hash: null,
    canary_effective_result_version: null,
    canary_effective_validator_version: null,
    canary_targeted_evidence_run_id: null,
    canary_database_name: null,
    canary_database_suffix_valid: null,
    canary_synthetic_only: null,
    canary_created_through_phase8c_cli: null,
    canary_attestation_hash_present: false,
    canary_attestation_hash_valid: null,
    canary_run_row_exists: null,
    canary_run_status: null,
    canary_step_belongs_to_run: null,
    canary_step_logical_invocation_matches: null,
    canary_step_agent_matches: null,
    canary_fixture_namespace_valid: null,
    final_canary_context_valid: false,
    failed_canary_context_rule: "canary_context_missing"
  };
}

function contextDiagnostics(
  context: OperationalLiveCanaryContext,
  overrides: Partial<CanaryContextDiagnostics> = {}
): CanaryContextDiagnostics {
  const testAllowsSmokeDatabase =
    process.env.OPERATIONAL_LIVE_CANARY_TEST_ALLOW_SMOKE_DATABASE === "true" &&
    context.databaseName.endsWith(OPERATIONAL_LIVE_CANARY_SMOKE_DATABASE_SUFFIX);
  return {
    canary_context_present: true,
    canary_context_version: context.contextVersion,
    canary_run_public_id: context.runPublicId,
    canary_step_public_id: context.stepPublicId,
    canary_logical_invocation_key: context.logicalInvocationKey,
    canary_manifest_version: context.manifestVersion,
    canary_manifest_hash: context.manifestHash,
    canary_approved_config_hash: context.approvedConfigHash,
    canary_effective_result_version: context.effectiveResultVersion,
    canary_effective_validator_version: context.effectiveValidatorVersion,
    canary_targeted_evidence_run_id: context.targetedEvidenceRunPublicId,
    canary_database_name: context.databaseName,
    canary_database_suffix_valid:
      context.databaseName.endsWith(OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX) ||
      testAllowsSmokeDatabase,
    canary_synthetic_only: context.syntheticOnly,
    canary_created_through_phase8c_cli: context.createdThroughPhase8cCli,
    canary_attestation_hash_present: Boolean(context.attestationHash),
    canary_attestation_hash_valid:
      context.attestationHash === operationalLiveCanaryContextAttestationHash(contextWithoutAttestation(context)),
    canary_run_row_exists: null,
    canary_run_status: null,
    canary_step_belongs_to_run: null,
    canary_step_logical_invocation_matches: null,
    canary_step_agent_matches: null,
    canary_fixture_namespace_valid: null,
    final_canary_context_valid: null,
    failed_canary_context_rule: null,
    ...overrides
  };
}

function fixtureNamespaceValid(step: {
  scenario_id: string;
  student_public_id: string | null;
  logical_invocation_key: string;
}) {
  return (
    step.scenario_id.startsWith("student_") ||
    step.scenario_id.startsWith("teacher_")
  ) &&
    step.logical_invocation_key.startsWith("phase8c:") &&
    (step.student_public_id === null || step.student_public_id.startsWith("phase8c_"));
}

function invalidResult(context: OperationalLiveCanaryContext, rule: CanaryContextInvalidSubreason, overrides: Partial<CanaryContextDiagnostics> = {}) {
  return {
    valid: false,
    failedRule: rule,
    diagnostics: contextDiagnostics(context, {
      final_canary_context_valid: false,
      failed_canary_context_rule: rule,
      ...overrides
    })
  };
}

export async function validateOperationalLiveCanaryContext(input: {
  context: OperationalLiveCanaryContext | null | undefined;
  agentName: AgentNameType | null | undefined;
  prisma: PrismaClient;
}) {
  const approvedManifest = readApprovedOperationalAgentConfig();
  const context = input.context;
  if (!context) {
    return {
      valid: false,
      failedRule: "canary_context_missing" as const,
      diagnostics: missingCanaryContextDiagnostics()
    };
  }

  if (context.contextVersion !== OPERATIONAL_LIVE_CANARY_CONTEXT_VERSION) {
    return invalidResult(context, "canary_attestation_hash_mismatch");
  }

  const testAllowsSmokeDatabase =
    process.env.OPERATIONAL_LIVE_CANARY_TEST_ALLOW_SMOKE_DATABASE === "true" &&
    context.databaseName.endsWith(OPERATIONAL_LIVE_CANARY_SMOKE_DATABASE_SUFFIX);
  if (!context.databaseName.endsWith(OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX) && !testAllowsSmokeDatabase) {
    return invalidResult(context, "canary_database_invalid");
  }

  if (!context.syntheticOnly || !context.createdThroughPhase8cCli) {
    return invalidResult(context, context.syntheticOnly ? "canary_fixture_namespace_invalid" : "canary_fixture_namespace_invalid");
  }

  if (
    context.targetedEvidenceRunPublicId !== approvedManifest.evaluation_evidence.targeted_run_public_id
  ) {
    return invalidResult(context, "canary_evidence_reference_mismatch");
  }

  if (context.effectiveResultVersion !== approvedManifest.effective_result_version) {
    return invalidResult(context, "canary_effective_result_version_mismatch");
  }

  if (context.effectiveValidatorVersion !== approvedManifest.effective_validator_version) {
    return invalidResult(context, "canary_effective_validator_version_mismatch");
  }

  if (context.approvedConfigHash !== approvedManifest.approved_active_configuration_hash) {
    return invalidResult(context, "canary_config_hash_mismatch");
  }

  if (
    context.attestationHash !==
    operationalLiveCanaryContextAttestationHash(contextWithoutAttestation(context))
  ) {
    return invalidResult(context, "canary_attestation_hash_mismatch");
  }

  const run = await input.prisma.operationalLiveCanaryRun.findUnique({
    where: { run_public_id: context.runPublicId },
    include: { steps: true }
  });
  if (!run) {
    return invalidResult(context, "canary_run_not_found", {
      canary_run_row_exists: false
    });
  }

  if (run.status !== "running") {
    return invalidResult(context, "canary_run_status_invalid", {
      canary_run_row_exists: true,
      canary_run_status: run.status
    });
  }

  if (run.manifest_hash !== context.manifestHash) {
    return invalidResult(context, "canary_manifest_hash_mismatch", {
      canary_run_row_exists: true,
      canary_run_status: run.status
    });
  }

  if (run.approved_config_hash !== context.approvedConfigHash) {
    return invalidResult(context, "canary_config_hash_mismatch", {
      canary_run_row_exists: true,
      canary_run_status: run.status
    });
  }

  const step = run.steps.find((entry) => entry.step_public_id === context.stepPublicId);
  if (!step) {
    return invalidResult(context, "canary_step_not_in_run", {
      canary_run_row_exists: true,
      canary_run_status: run.status,
      canary_step_belongs_to_run: false
    });
  }

  if (step.logical_invocation_key !== context.logicalInvocationKey) {
    return invalidResult(context, "canary_logical_invocation_mismatch", {
      canary_run_row_exists: true,
      canary_run_status: run.status,
      canary_step_belongs_to_run: true,
      canary_step_logical_invocation_matches: false
    });
  }

  if (input.agentName && step.agent_name !== input.agentName) {
    return invalidResult(context, "canary_agent_mismatch", {
      canary_run_row_exists: true,
      canary_run_status: run.status,
      canary_step_belongs_to_run: true,
      canary_step_logical_invocation_matches: true,
      canary_step_agent_matches: false
    });
  }

  if (!fixtureNamespaceValid(step)) {
    return invalidResult(context, "canary_fixture_namespace_invalid", {
      canary_run_row_exists: true,
      canary_run_status: run.status,
      canary_step_belongs_to_run: true,
      canary_step_logical_invocation_matches: true,
      canary_step_agent_matches: input.agentName ? step.agent_name === input.agentName : null,
      canary_fixture_namespace_valid: false
    });
  }

  return {
    valid: true,
    failedRule: null,
    diagnostics: contextDiagnostics(context, {
      canary_run_row_exists: true,
      canary_run_status: run.status,
      canary_step_belongs_to_run: true,
      canary_step_logical_invocation_matches: true,
      canary_step_agent_matches: input.agentName ? step.agent_name === input.agentName : null,
      canary_fixture_namespace_valid: true,
      final_canary_context_valid: true,
      failed_canary_context_rule: null
    })
  };
}
