import { stableHash } from "@/lib/operational/stable-hash";

export const FORMATIVE_CONVERSATION_V18R1_DEPLOYED_PROVENANCE_VERSION =
  "deployment-source-provenance-v1";
export const FORMATIVE_CONVERSATION_V18R1_DEPLOYED_PROVENANCE_MODE =
  "render_deployed_artifact";

const Sha256 = /^[a-f0-9]{64}$/u;
const GitSha = /^[a-f0-9]{40}$/u;

export type FormativeConversationV18R1DeployedIdentity = {
  runtime_candidate_hash: string;
  evaluation_protocol_hash: string;
  runner_implementation_hash: string;
  candidate_manifest_hash: string;
  fixture_manifest_hash: string;
  aggregate_fixture_hash: string;
  compiled_plan_hash: string;
  live_environment_contract_hash: string;
  dispatch_checkpoint_contract_hash: string;
  provenance_contract_hash: string;
  deployed_source_closure_hash: string;
  security_wrapper_hash: string;
  formative_prompt_hash: string;
  profiling_prompt_hash: string;
  canonical_evidence_identity_implementation_hash: string;
  misconception_claim_identity_implementation_hash: string;
};

const identityFields = [
  "runtime_candidate_hash",
  "evaluation_protocol_hash",
  "runner_implementation_hash",
  "candidate_manifest_hash",
  "fixture_manifest_hash",
  "aggregate_fixture_hash",
  "compiled_plan_hash",
  "live_environment_contract_hash",
  "dispatch_checkpoint_contract_hash",
  "provenance_contract_hash",
  "deployed_source_closure_hash",
  "security_wrapper_hash",
  "formative_prompt_hash",
  "profiling_prompt_hash",
  "canonical_evidence_identity_implementation_hash",
  "misconception_claim_identity_implementation_hash"
] as const satisfies readonly (keyof FormativeConversationV18R1DeployedIdentity)[];

export function verifyFormativeConversationV18R1DeployedProvenance(input: {
  mode: string;
  render_git_commit?: string | null;
  operator_authorized_git_sha?: string | null;
  expected_identity: FormativeConversationV18R1DeployedIdentity;
  deployed_identity: FormativeConversationV18R1DeployedIdentity;
}) {
  if (input.mode !== FORMATIVE_CONVERSATION_V18R1_DEPLOYED_PROVENANCE_MODE) {
    throw new Error("formative_conversation_v18r1_deployment_mode_unsupported");
  }
  const deploymentReported = input.render_git_commit?.trim().toLowerCase() ?? "";
  const operatorAuthorized =
    input.operator_authorized_git_sha?.trim().toLowerCase() ?? "";
  if (!deploymentReported) {
    throw new Error("formative_conversation_v18r1_render_git_commit_missing");
  }
  if (!GitSha.test(deploymentReported)) {
    throw new Error("formative_conversation_v18r1_render_git_commit_malformed");
  }
  if (!operatorAuthorized) {
    throw new Error("formative_conversation_v18r1_expected_git_sha_missing");
  }
  if (!GitSha.test(operatorAuthorized)) {
    throw new Error("formative_conversation_v18r1_expected_git_sha_malformed");
  }
  if (deploymentReported !== operatorAuthorized) {
    throw new Error("formative_conversation_v18r1_deployed_git_sha_mismatch");
  }
  for (const field of identityFields) {
    if (
      !Sha256.test(input.expected_identity[field]) ||
      !Sha256.test(input.deployed_identity[field]) ||
      input.expected_identity[field] !== input.deployed_identity[field]
    ) {
      throw new Error(`formative_conversation_v18r1_deployed_identity_mismatch:${field}`);
    }
  }
  const hashable = {
    version: FORMATIVE_CONVERSATION_V18R1_DEPLOYED_PROVENANCE_VERSION,
    mode: FORMATIVE_CONVERSATION_V18R1_DEPLOYED_PROVENANCE_MODE,
    source_commit_sha: operatorAuthorized,
    deployment_reported_commit_sha: deploymentReported,
    operator_authorized_commit_sha: operatorAuthorized,
    runtime_candidate_hash: input.deployed_identity.runtime_candidate_hash,
    protocol_hash: input.deployed_identity.evaluation_protocol_hash,
    deployed_artifact_identity_status: "verified" as const,
    deployed_identity: input.deployed_identity,
    git_invocations: 0 as const
  };
  return { ...hashable, provenance_hash: stableHash(hashable) };
}
