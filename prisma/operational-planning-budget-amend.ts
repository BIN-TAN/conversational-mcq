import { mkdirSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  activateOperationalApprovalBundle, preparePlanningBudgetAmendment,
  resolveActiveOperationalApproval
} from "../src/lib/operational/active-approval-bundle";
import { argValue } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());
const expected = argValue("--expected-parent-hash");
const authorization = argValue("--authorization-reference");
const output = argValue("--output-directory");
if (!expected || !authorization || !output ||
    argValue("--confirm") !== "approve initial feedback budget 10000") {
  throw new Error("Explicit operator authorization, expected parent hash, and a new output directory are required.");
}
const parent = resolveActiveOperationalApproval();
if (parent?.kind !== "derived_approval") throw new Error("A verified parent approval is required.");
const root = path.resolve(output);
mkdirSync(root, { recursive: false });
const prepared = preparePlanningBudgetAmendment({
  parent, expectedParentHash: expected, authorizationReference: authorization,
  canaryEvidencePath: path.resolve("docs/acceptance/runs/2026-09-26/post-deployment-simulation/budget-canary-console-summary.json"),
  outputDirectory: path.join(root, "evidence")
});
const evidence = prepared.evidence;
const bundle = activateOperationalApprovalBundle({
  approvedManifestPath: prepared.manifestPath, approvalEvidencePath: prepared.evidencePath,
  expectedRuntimeHash: evidence.runtime_candidate_hash,
  expectedEvaluationProtocolHash: evidence.evaluation_protocol_hash,
  expectedApprovalEvidenceHash: evidence.approval_evidence_hash,
  expectedSourceProviderRunId: evidence.source_provider_run_id,
  expectedDerivedEvaluationId: evidence.derived_evaluation_id,
  confirmation: "activate approved gpt-5.6 operational candidate v2",
  outputDirectory: path.join(root, "active")
});
console.log(JSON.stringify({
  status: "staged_not_applied_to_running_service",
  parent_runtime_hash: parent.record.runtime_candidate_hash,
  planning_max_output_tokens: 10000,
  render_variables: bundle.render_variables,
  limitations: evidence.human_review.limitations
}, null, 2));
