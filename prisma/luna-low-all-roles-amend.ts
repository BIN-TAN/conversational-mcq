import { loadEnvConfig } from "@next/env";
import {
  prepareLunaAllRolesAmendment,
  resolveActiveOperationalApproval,
  stageLunaAllRolesCandidate,
  stageLunaAllRolesCandidateFromManifest
} from "../src/lib/operational/active-approval-bundle";
import { argValue } from "./operational-model-upgrade-cli-args";
import { MIXED_TUTOR_MODEL } from "../src/lib/operational/mixed-tutor-identity";

// Neither mode activates a bundle or sends provider requests.
loadEnvConfig(process.cwd());
const required = (name: string) => {
  const value = argValue(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const mode = required("--mode");
if (!["candidate", "approve"].includes(mode)) throw new Error("Use --mode candidate or approve.");
const reasoningEffort = argValue("--reasoning-effort") ?? "low";
if (reasoningEffort !== "low" && reasoningEffort !== "medium") throw new Error("Use --reasoning-effort low or medium.");
const profileCorrection = argValue("--profile-correction");
if (profileCorrection !== undefined && (profileCorrection !== "profile-fidelity-v1" || reasoningEffort !== "medium")) {
  throw new Error("Use --profile-correction profile-fidelity-v1 only with medium reasoning.");
}
const tutorModel = argValue("--tutor-model");
if (tutorModel !== undefined && (tutorModel !== MIXED_TUTOR_MODEL || reasoningEffort !== "medium" || profileCorrection !== "profile-fidelity-v1")) {
  throw new Error("Use --tutor-model gpt-6.1-sol only with medium reasoning and the exact profile-fidelity correction.");
}
const confirmation = tutorModel
  ? "authorize gpt-6.1-sol medium tutor and 17 gpt-5.6-luna medium application roles and exact profile fidelity correction"
  : `authorize all application roles gpt-5.6-luna ${reasoningEffort}${profileCorrection ? " and exact profile fidelity correction" : ""}`;
if (required("--confirm") !== confirmation) {
  throw new Error("Explicit all-role model and reasoning authorization is required.");
}
const common = {
  reasoningEffort: reasoningEffort as "low" | "medium",
  profileCorrection: profileCorrection as "profile-fidelity-v1" | undefined,
  tutorModel: tutorModel as typeof MIXED_TUTOR_MODEL | undefined,
  outputDirectory: required("--output-directory"),
  authorizationReference: required("--authorization-reference")
};
const exportedParentPath = argValue("--parent-manifest");
if (exportedParentPath) {
  if (mode !== "candidate") throw new Error("An exported manifest alone cannot authorize production approval.");
  const result = stageLunaAllRolesCandidateFromManifest({
    ...common, parentManifestPath: exportedParentPath,
    expectedParentManifestSha256: required("--expected-parent-manifest-sha256"),
    expectedParentRuntimeHash: required("--expected-parent-hash")
  });
  console.log(JSON.stringify({ ...result, provider_calls: 0, activation_performed: false }, null, 2));
} else {
  const parent = resolveActiveOperationalApproval();
  if (parent?.kind !== "derived_approval") throw new Error("A verified derived parent approval is required.");
  const input = { ...common, parent, expectedParentHash: required("--expected-parent-hash") };
  if (mode === "candidate") {
    console.log(JSON.stringify({ ...stageLunaAllRolesCandidate(input), provider_calls: 0, activation_performed: false }, null, 2));
  } else {
    const result = prepareLunaAllRolesAmendment({ ...input, validationEvidencePath: required("--validation-evidence") });
    console.log(JSON.stringify({
      status: "approved_artifacts_prepared_not_activated", manifestPath: result.manifestPath,
      evidencePath: result.evidencePath, runtime_candidate_hash: result.evidence.runtime_candidate_hash,
      evaluation_protocol_hash: result.evidence.evaluation_protocol_hash,
      approval_evidence_hash: result.evidence.approval_evidence_hash,
      source_provider_run_id: result.evidence.source_provider_run_id,
      derived_evaluation_id: result.evidence.derived_evaluation_id,
      limitations: result.evidence.human_review.limitations,
      provider_calls: 0, activation_performed: false
    }, null, 2));
  }
}
