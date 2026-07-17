import { loadEnvConfig } from "@next/env";
import {
  activateOperationalApprovalBundle,
  OperationalApprovalBundleError,
  resolveActiveOperationalApproval
} from "../src/lib/operational/active-approval-bundle";
import { approvedRoleEnvironmentAssertions } from "../src/lib/llm/config";

loadEnvConfig(process.cwd());

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const required = {
  approvalEvidencePath: argValue("--approval-evidence"),
  approvedManifestPath: argValue("--approved-manifest"),
  expectedRuntimeHash: argValue("--expected-runtime-hash"),
  expectedEvaluationProtocolHash: argValue("--expected-evaluation-protocol-hash"),
  expectedApprovalEvidenceHash: argValue("--expected-approval-evidence-hash"),
  expectedSourceProviderRunId: argValue("--expected-source-provider-run"),
  expectedDerivedEvaluationId: argValue("--expected-derived-evaluation"),
  confirmation: argValue("--confirm")
};

if (Object.values(required).some((value) => !value)) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "missing_activation_arguments",
    required_arguments: [
      "--approval-evidence <path>",
      "--approved-manifest <path>",
      "--expected-runtime-hash <sha256>",
      "--expected-evaluation-protocol-hash <sha256>",
      "--expected-approval-evidence-hash <sha256>",
      "--expected-source-provider-run <run_id>",
      "--expected-derived-evaluation <derived_evaluation_id>",
      "--confirm \"activate approved gpt-5.6 operational candidate v2\""
    ],
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}

try {
  const result = activateOperationalApprovalBundle({
    approvalEvidencePath: required.approvalEvidencePath!,
    approvedManifestPath: required.approvedManifestPath!,
    expectedRuntimeHash: required.expectedRuntimeHash!,
    expectedEvaluationProtocolHash: required.expectedEvaluationProtocolHash!,
    expectedApprovalEvidenceHash: required.expectedApprovalEvidenceHash!,
    expectedSourceProviderRunId: required.expectedSourceProviderRunId!,
    expectedDerivedEvaluationId: required.expectedDerivedEvaluationId!,
    confirmation: required.confirmation!
  });
  const active = resolveActiveOperationalApproval({ bundlePath: result.bundle_path, env: {} });
  console.log(JSON.stringify({
    ...result,
    required_render_variables: {
      ...result.render_variables,
      OPERATIONAL_AGENT_MODE: "guarded_live",
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "true",
      OPERATIONAL_EFFECTIVE_RESULT_VERSION: "effective-system-eval-v2",
      OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION: "effective-validator-v1"
    },
    optional_exact_role_and_policy_assertions:
      active?.kind === "derived_approval"
        ? approvedRoleEnvironmentAssertions(active.manifest)
        : {}
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: error instanceof OperationalApprovalBundleError ? error.code : "activation_failed",
    details: error instanceof OperationalApprovalBundleError ? error.details ?? null : null,
    no_provider_call: true
  }, null, 2));
  process.exit(1);
}
