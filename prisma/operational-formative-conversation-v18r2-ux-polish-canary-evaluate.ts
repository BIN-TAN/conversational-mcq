import { prisma } from "../src/lib/db";
import {
  FORMATIVE_CONVERSATION_V18R2_CONTROL_SCHEMA_VERSION,
  assertFormativeConversationV18R2LiveControlEnvironment,
  writeFormativeConversationV18R2ControlPayload
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/security-release";
import {
  buildV18R2UxCanaryPlan,
  executeV18R2UxCanaryLive,
  preflightV18R2UxCanary
} from "../src/lib/operational/formative-conversation-v18r2-ux-polish-canary/service";

type Mode =
  | "module-load-probe"
  | "environment-preflight"
  | "preflight"
  | "plan"
  | "live";

function valueFor(args: string[], name: string) {
  const prefix = `${name}=`;
  return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function options(args: string[]) {
  const allowed = new Set([
    "--mode",
    "--runtime-candidate-hash",
    "--evaluation-protocol-hash",
    "--expected-deployed-git-sha",
    "--confirm-live-provider-calls",
    "--authorization"
  ]);
  for (const argument of args) {
    if (!argument.startsWith("--")) continue;
    const flag = argument.split("=", 1)[0];
    if (!allowed.has(flag)) throw new Error("v18r2_ux_canary_cli_argument_not_permitted");
  }
  const mode = (valueFor(args, "--mode") ?? "plan") as Mode;
  if (![
    "module-load-probe",
    "environment-preflight",
    "preflight",
    "plan",
    "live"
  ].includes(mode)) {
    throw new Error("v18r2_ux_canary_mode_invalid");
  }
  return {
    mode,
    runtime_candidate_hash: valueFor(args, "--runtime-candidate-hash"),
    evaluation_protocol_hash: valueFor(args, "--evaluation-protocol-hash"),
    expected_deployed_git_sha: valueFor(args, "--expected-deployed-git-sha"),
    confirm_live_provider_calls: args.includes("--confirm-live-provider-calls"),
    authorization: valueFor(args, "--authorization")
  };
}

function assertCanonicalLauncher(mode: Mode) {
  if (
    process.env.FORMATIVE_CONVERSATION_V18R2_UX_CANARY_CANONICAL_LAUNCHER_VALIDATED !==
      "true" ||
    process.env.FORMATIVE_CONVERSATION_V5_V18R2_CANONICAL_LOADER_VERSION !==
      "formative-conversation-v18r2-canonical-node-import-tsx-v1"
  ) {
    throw new Error("v18r2_ux_canary_canonical_launcher_required");
  }
  if (
    mode === "live" &&
    process.env.FORMATIVE_CONVERSATION_V18R2_UX_CANARY_OUTER_LOADER_VALIDATED !==
      "true"
  ) {
    throw new Error("v18r2_ux_canary_canonical_outer_loader_required");
  }
}

async function main() {
  const parsed = options(process.argv.slice(2));
  assertCanonicalLauncher(parsed.mode);
  if (parsed.mode === "module-load-probe") {
    console.log(JSON.stringify({
      status: "cli_loaded",
      launch_mechanism: "node --import tsx",
      provider_calls: 0,
      model_auth_requests: 0,
      generation_network_requests: 0,
      checkpoint_created: false
    }));
    return;
  }
  if (parsed.mode === "plan") {
    console.log(JSON.stringify(buildV18R2UxCanaryPlan(), null, 2));
    return;
  }
  if (!parsed.expected_deployed_git_sha) {
    throw new Error("v18r2_ux_canary_expected_deployed_git_sha_required");
  }
  if (parsed.mode === "environment-preflight" || parsed.mode === "preflight") {
    const result = await preflightV18R2UxCanary({
      expected_deployed_git_sha: parsed.expected_deployed_git_sha
    });
    console.log(JSON.stringify({
      status: result.status,
      runtime_candidate_hash: result.loaded.runtime_candidate_hash,
      protocol_hash: result.loaded.protocol_hash,
      database: result.database,
      checkpoint_created: false,
      provider_calls: 0,
      model_auth_requests: 0
    }, null, 2));
    return;
  }
  if (
    !parsed.runtime_candidate_hash ||
    !parsed.evaluation_protocol_hash ||
    !parsed.authorization
  ) {
    throw new Error("v18r2_ux_canary_live_identity_and_authorization_required");
  }
  const control = await assertFormativeConversationV18R2LiveControlEnvironment({
    workspace_root: process.cwd(),
    env: process.env
  });
  const result = await executeV18R2UxCanaryLive({
    runtime_candidate_hash: parsed.runtime_candidate_hash,
    evaluation_protocol_hash: parsed.evaluation_protocol_hash,
    expected_deployed_git_sha: parsed.expected_deployed_git_sha,
    authorization: parsed.authorization,
    confirm_live_provider_calls: parsed.confirm_live_provider_calls,
    staging_base_root: control.staging_base_root
  });
  await writeFormativeConversationV18R2ControlPayload({
    control_path: control.control_path,
    payload: {
      schema_version: FORMATIVE_CONVERSATION_V18R2_CONTROL_SCHEMA_VERSION,
      record_type: "finalized_artifact_package",
      evaluation_revision: "formative-conversation-host-v5-executable-v18r2",
      control_nonce: control.control_nonce,
      mode: "live",
      staging_root: result.artifacts.staging_root,
      release_root: result.artifacts.release_root,
      artifact_manifest_path: result.artifacts.finalized_artifact_manifest_path,
      artifact_manifest_sha256:
        result.artifacts.finalized_artifact_manifest_sha256,
      artifacts_finalized_at: new Date().toISOString(),
      provider_run_id: result.provider_run_id,
      derived_evaluation_id: result.derived_evaluation_id
    }
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
    process.stderr.write(`${JSON.stringify({
      status: "blocked",
      error_code: /^[a-z0-9_]+$/u.test(code)
        ? code
        : "v18r2_ux_canary_cli_failed",
      no_secret_values_printed: true
    })}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
