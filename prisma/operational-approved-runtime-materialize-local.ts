import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { z } from "zod";
import { APPROVED_OPERATIONAL_RUNTIME_HASH } from "../src/lib/evaluation/formative/schemas";
import {
  materializeApprovedOperationalRuntimeLocally,
  OperationalApprovalBundleError
} from "../src/lib/operational/active-approval-bundle";
import { FULL_GPT56_V2_CANDIDATE_CONFIG_PATH } from "../src/lib/operational/model-upgrade";
import { evaluateModelUpgradeDerivedApprovalEvidence } from "../src/lib/operational/model-upgrade-reevaluation";

loadEnvConfig(process.cwd());

const ApprovalLocatorSchema = z.object({
  approved_at: z.string().datetime(),
  source_provider_run_id: z.string().min(1),
  derived_evaluation_id: z.string().min(1),
  evaluation_protocol_hash: z.string().length(64),
  runtime_candidate_hash: z.string().length(64),
  approval_evidence_hash: z.string().length(64),
  approved_manifest_artifact_path: z.string().min(1)
}).passthrough();

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function candidateApprovalEvidencePaths(root: string) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "approval", "approval_evidence.json"))
    .filter((filePath) => existsSync(filePath));
}

type VerifiedLocator = {
  evidence_path: string;
  manifest_path: string;
  approved_at: string;
  source_provider_run_id: string;
  derived_evaluation_id: string;
  evaluation_protocol_hash: string;
  runtime_candidate_hash: string;
  approval_evidence_hash: string;
};

function verifyLocator(input: {
  evidencePath: string;
  manifestPath?: string;
  candidateManifestPath: string;
  expectedRuntimeHash: string;
}): VerifiedLocator {
  const evidencePath = path.resolve(input.evidencePath);
  const locator = ApprovalLocatorSchema.parse(JSON.parse(readFileSync(evidencePath, "utf8")));
  if (locator.runtime_candidate_hash !== input.expectedRuntimeHash) {
    throw new Error("local_materialization_runtime_hash_mismatch");
  }
  const manifestPath = path.resolve(input.manifestPath ?? locator.approved_manifest_artifact_path);
  if (!existsSync(manifestPath)) throw new Error("local_materialization_approved_manifest_missing");
  if (path.resolve(locator.approved_manifest_artifact_path) !== manifestPath) {
    throw new Error("local_materialization_evidence_manifest_path_mismatch");
  }
  const approval = evaluateModelUpgradeDerivedApprovalEvidence({
    manifestPath: input.candidateManifestPath,
    candidateRunPublicId: locator.source_provider_run_id,
    derivedEvaluationId: locator.derived_evaluation_id,
    expectedRuntimeCandidateHash: input.expectedRuntimeHash,
    expectedEvaluationProtocolHash: locator.evaluation_protocol_hash
  });
  if (!approval.eligible) {
    throw new Error(`local_materialization_approval_not_eligible:${approval.blocking_reasons.join(",")}`);
  }
  return {
    evidence_path: evidencePath,
    manifest_path: manifestPath,
    approved_at: locator.approved_at,
    source_provider_run_id: locator.source_provider_run_id,
    derived_evaluation_id: locator.derived_evaluation_id,
    evaluation_protocol_hash: locator.evaluation_protocol_hash,
    runtime_candidate_hash: locator.runtime_candidate_hash,
    approval_evidence_hash: locator.approval_evidence_hash
  };
}

function selectVerifiedApproval(input: {
  candidateManifestPath: string;
  expectedRuntimeHash: string;
  evidencePath?: string;
  manifestPath?: string;
  derivedEvaluationId?: string;
}) {
  if (input.evidencePath) {
    return verifyLocator({
      evidencePath: input.evidencePath,
      ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
      candidateManifestPath: input.candidateManifestPath,
      expectedRuntimeHash: input.expectedRuntimeHash
    });
  }

  const root = path.join(process.cwd(), ".data", "operational-model-upgrade", "derived-evaluations");
  const rejected: Array<{ evidence_path: string; reason: string }> = [];
  const verified = candidateApprovalEvidencePaths(root).flatMap((evidencePath) => {
    try {
      const candidate = verifyLocator({
        evidencePath,
        candidateManifestPath: input.candidateManifestPath,
        expectedRuntimeHash: input.expectedRuntimeHash
      });
      if (input.derivedEvaluationId && candidate.derived_evaluation_id !== input.derivedEvaluationId) {
        return [];
      }
      return [candidate];
    } catch (error) {
      rejected.push({
        evidence_path: evidencePath,
        reason: error instanceof Error ? error.message.split(":")[0] : "approval_verification_failed"
      });
      return [];
    }
  }).sort((left, right) =>
    right.approved_at.localeCompare(left.approved_at) ||
    left.derived_evaluation_id.localeCompare(right.derived_evaluation_id)
  );
  const selected = verified[0];
  if (!selected) {
    throw new OperationalApprovalBundleError(
      "local_approved_runtime_evidence_missing",
      "No complete local approval record matches the requested runtime hash.",
      {
        requested_hash: input.expectedRuntimeHash,
        candidate_count: rejected.length,
        rejected_reason_codes: [...new Set(rejected.map((entry) => entry.reason))]
      }
    );
  }
  return selected;
}

const expectedRuntimeHash = argValue("--expected-runtime-hash") ?? APPROVED_OPERATIONAL_RUNTIME_HASH;
const candidateManifestPath = path.resolve(
  argValue("--candidate-manifest") ?? FULL_GPT56_V2_CANDIDATE_CONFIG_PATH
);
const confirmation = argValue("--confirm-local-materialization");

try {
  const selected = selectVerifiedApproval({
    candidateManifestPath,
    expectedRuntimeHash,
    ...(argValue("--approval-evidence") ? { evidencePath: argValue("--approval-evidence") } : {}),
    ...(argValue("--approved-manifest") ? { manifestPath: argValue("--approved-manifest") } : {}),
    ...(argValue("--derived-evaluation") ? { derivedEvaluationId: argValue("--derived-evaluation") } : {})
  });
  const result = materializeApprovedOperationalRuntimeLocally({
    approvalEvidencePath: selected.evidence_path,
    approvedManifestPath: selected.manifest_path,
    sourceCandidateManifestPath: candidateManifestPath,
    expectedRuntimeHash,
    expectedEvaluationProtocolHash: selected.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: selected.approval_evidence_hash,
    expectedSourceProviderRunId: selected.source_provider_run_id,
    expectedDerivedEvaluationId: selected.derived_evaluation_id,
    confirmation: confirmation ?? ""
  });
  console.log(JSON.stringify({
    ...result,
    selected_approval_record: {
      source_provider_run_id: selected.source_provider_run_id,
      derived_evaluation_id: selected.derived_evaluation_id,
      approved_at: selected.approved_at,
      runtime_candidate_hash: selected.runtime_candidate_hash,
      evaluation_protocol_hash: selected.evaluation_protocol_hash,
      approval_evidence_hash: selected.approval_evidence_hash
    },
    production_approval_changed: false,
    approval_evidence_changed: false,
    generated_provider_calls: 0,
    secrets_printed: false
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: error instanceof OperationalApprovalBundleError
      ? error.code
      : error instanceof Error
        ? error.message.split(":")[0]
        : "local_materialization_failed",
    details: error instanceof OperationalApprovalBundleError ? error.details ?? null : null,
    generated_provider_calls: 0,
    secrets_printed: false
  }, null, 2));
  process.exitCode = 1;
}
