import { mkdirSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { activateOperationalApprovalBundle, prepareSolLowReasoningAmendment, resolveActiveOperationalApproval } from "../src/lib/operational/active-approval-bundle";
import { argValue } from "./operational-model-upgrade-cli-args";

loadEnvConfig(process.cwd());
const required = (name: string) => { const value = argValue(name); if (!value) throw new Error(`Missing ${name}`); return value; };
if (required("--confirm") !== "approve sol low feedback and conversation") throw new Error("Explicit two-role confirmation required.");
const parent = resolveActiveOperationalApproval();
if (parent?.kind !== "derived_approval") throw new Error("Verified derived parent required.");
const root = path.resolve(required("--output-directory"));
mkdirSync(root, { recursive: false, mode: 0o700 });
const prepared = prepareSolLowReasoningAmendment({ parent, expectedParentHash: required("--expected-parent-hash"),
  authorizationReference: required("--authorization-reference"), validationEvidencePath: required("--validation-evidence"),
  outputDirectory: path.join(root, "evidence") });
const evidence = prepared.evidence;
const bundle = activateOperationalApprovalBundle({ approvedManifestPath: prepared.manifestPath, approvalEvidencePath: prepared.evidencePath,
  expectedRuntimeHash: evidence.runtime_candidate_hash, expectedEvaluationProtocolHash: evidence.evaluation_protocol_hash,
  expectedApprovalEvidenceHash: evidence.approval_evidence_hash, expectedSourceProviderRunId: evidence.source_provider_run_id,
  expectedDerivedEvaluationId: evidence.derived_evaluation_id, confirmation: "activate approved gpt-5.6 operational candidate v2",
  outputDirectory: path.join(root, "active") });
console.log(JSON.stringify({ status: "staged_not_applied_to_running_service", render_variables: bundle.render_variables,
  limitations: evidence.human_review.limitations }, null, 2));
