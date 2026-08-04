import { prisma } from "../src/lib/db";
import {
  EVALUATION_DATABASE_LIFECYCLE_OWNER,
  runWithEvaluationDatabaseLifecycle
} from "../src/lib/operational/evaluation-database-lifecycle";
import { createEvaluationDatabaseConnectionOwner } from "../src/lib/operational/evaluation-database-connection-owner";
import {
  compileFormativeConversationV5EnvironmentPreflight,
  compileFormativeConversationV5PreDispatch,
  executeFormativeConversationV5LiveEvaluation,
  writeFormativeConversationV5PlanArtifact
} from "../src/lib/operational/formative-conversation-v5-evaluation-v15/service";
import {
  withFormativeConversationPersistenceDiagnostics,
  type FormativeConversationPersistenceDiagnostic
} from "../src/lib/services/student-assessment/formative-conversation/persistence-observability";
import {
  FORMATIVE_CONVERSATION_V15_CONTROL_SCHEMA_VERSION,
  assertFormativeConversationV15LiveControlEnvironment,
  writeFormativeConversationV15ControlPayload
} from "../src/lib/operational/formative-conversation-v5-evaluation-v15/security-release";

type Options = {
  mode:
    | "module-load-probe"
    | "environment-preflight"
    | "preflight"
    | "plan"
    | "live";
  runtime_candidate_hash: string | null;
  evaluation_protocol_hash: string | null;
  confirm_live_provider_calls: boolean;
  authorization: string | null;
};

function valueFor(args: string[], name: string) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions(args: string[]): Options {
  const allowedFlags = new Set([
    "--mode",
    "--runtime-candidate-hash",
    "--evaluation-protocol-hash",
    "--confirm-live-provider-calls",
    "--authorization"
  ]);
  for (const argument of args) {
    if (!argument.startsWith("--")) {
      continue;
    }
    const flag = argument.split("=", 1)[0];
    if (!allowedFlags.has(flag)) {
      throw new Error(
        "formative_conversation_v5_cli_argument_not_permitted"
      );
    }
  }
  for (const forbidden of [
    "--case",
    "--cases",
    "--persona",
    "--personas",
    "--persona-file",
    "--resume",
    "--resume-run",
    "--session",
    "--session-public-id"
  ]) {
    if (args.some((argument) => argument.startsWith(forbidden))) {
      throw new Error(
        "formative_conversation_v5_runner_substitution_or_scope_not_permitted"
      );
    }
  }
  const mode = valueFor(args, "--mode") ?? "plan";
  if (
    mode !== "module-load-probe" &&
    mode !== "environment-preflight" &&
    mode !== "preflight" &&
    mode !== "plan" &&
    mode !== "live"
  ) {
    throw new Error(
      "formative_conversation_v5_evaluation_mode_invalid"
    );
  }
  return {
    mode,
    runtime_candidate_hash:
      valueFor(args, "--runtime-candidate-hash") ?? null,
    evaluation_protocol_hash:
      valueFor(args, "--evaluation-protocol-hash") ?? null,
    confirm_live_provider_calls: args.includes(
      "--confirm-live-provider-calls"
    ),
    authorization: valueFor(args, "--authorization") ?? null
  };
}

function assertCanonicalLauncher(options: Options) {
  if (
    process.env
      .FORMATIVE_CONVERSATION_V5_V15_CANONICAL_LAUNCHER_VALIDATED !==
      "true" ||
    process.env.FORMATIVE_CONVERSATION_V5_V15_CANONICAL_LOADER_VERSION !==
      "formative-conversation-v5-canonical-node-import-tsx-v1"
  ) {
    throw new Error(
      "formative_conversation_v15_canonical_launcher_required"
    );
  }
  if (
    options.mode === "live" &&
    (process.env
      .FORMATIVE_CONVERSATION_V5_V15_CANONICAL_OUTER_LOADER_VALIDATED !==
      "true" ||
      process.env
        .FORMATIVE_CONVERSATION_V5_V15_CANONICAL_OUTER_LOADER_VERSION !==
        "formative-conversation-v5-canonical-node-import-tsx-v1")
  ) {
    throw new Error(
      "formative_conversation_v15_canonical_outer_loader_required"
    );
  }
}

async function main(input: {
  diagnostics: FormativeConversationPersistenceDiagnostic[];
}) {
  const options = parseOptions(process.argv.slice(2));
  assertCanonicalLauncher(options);
  if (options.mode === "module-load-probe") {
    console.log(
      JSON.stringify({
        status: "cli_loaded",
        launch_mechanism: "node --import tsx",
        provider_calls: 0,
        network_requests: 0,
        secrets_displayed: false
      })
    );
    return;
  }
  if (options.mode === "environment-preflight") {
    const result =
      compileFormativeConversationV5EnvironmentPreflight();
    console.log(
      JSON.stringify(
        {
          status: "environment_ready",
          runtime_candidate_hash:
            result.loaded.runtime_candidate_hash,
          evaluation_protocol_hash:
            result.loaded.protocol_hash,
          active_runtime_hash:
            result.governance.active_runtime_hash,
          live_environment: result.live_environment,
          checkpoint_created: false,
          provider_calls: 0,
          provider_auth_network_requests: 0,
          database_readiness_queries: 0
        },
        null,
        2
      )
    );
    return;
  }
  if (options.mode === "preflight") {
    const result =
      await compileFormativeConversationV5PreDispatch();
    console.log(
      JSON.stringify(
        {
          status:
            result.dispatch_boundary.status,
          runtime_candidate_hash:
            result.loaded.runtime_candidate_hash,
          evaluation_protocol_hash:
            result.loaded.protocol_hash,
          active_runtime_hash:
            result.governance.active_runtime_hash,
          checkpoint_created: false,
          provider_calls: 0,
          provider_auth_network_requests: 0,
          database_readiness_queries: 2,
          readiness: result.readiness
        },
        null,
        2
      )
    );
    return;
  }
  if (options.mode === "plan") {
    const result =
      await writeFormativeConversationV5PlanArtifact();
    console.log(
      JSON.stringify(
        {
          status: "planned",
          provider_calls: 0,
          provider_network_requests: 0,
          provider_auth_network_requests: 0,
          database_readiness_queries: 2,
          plan_artifact_path: result.artifact_path,
          plan_artifact_sha256: result.artifact_sha256,
          plan: result.artifact
        },
        null,
        2
      )
    );
    return;
  }
  if (
    !options.runtime_candidate_hash ||
    !options.evaluation_protocol_hash ||
    !options.authorization
  ) {
    throw new Error(
      "formative_conversation_v5_live_identity_and_authorization_required"
    );
  }
  const controlEnvironment =
    await assertFormativeConversationV15LiveControlEnvironment({
      workspace_root: process.cwd(),
      env: process.env
    });
  const result =
    await executeFormativeConversationV5LiveEvaluation({
      runtime_candidate_hash: options.runtime_candidate_hash,
      evaluation_protocol_hash:
        options.evaluation_protocol_hash,
      confirm_live_provider_calls:
        options.confirm_live_provider_calls,
      authorization: options.authorization,
      persistence_diagnostics: input.diagnostics
    });
  await writeFormativeConversationV15ControlPayload({
    control_path: controlEnvironment.control_path,
    payload: {
      schema_version:
        FORMATIVE_CONVERSATION_V15_CONTROL_SCHEMA_VERSION,
      record_type: "finalized_artifact_package",
      evaluation_revision:
        "formative-conversation-host-v5-executable-v15",
      control_nonce: controlEnvironment.control_nonce,
      mode: "live",
      staging_root: result.artifacts.staging_root,
      release_root: result.artifacts.release_root,
      artifact_manifest_path:
        result.artifacts.finalized_artifact_manifest_path,
      artifact_manifest_sha256:
        result.artifacts.finalized_artifact_manifest_sha256,
      artifacts_finalized_at: new Date().toISOString(),
      provider_run_id: result.provider_run_id,
      derived_evaluation_id: result.derived_evaluation_id
    }
  });
  console.log(JSON.stringify(result, null, 2));
}

const persistenceDiagnostics: FormativeConversationPersistenceDiagnostic[] = [];
const databaseOwner = createEvaluationDatabaseConnectionOwner({
  client: prisma,
  client_id: "formative-conversation-v15-evaluation-prisma",
  on_diagnostic: (diagnostic) => persistenceDiagnostics.push(diagnostic)
});

runWithEvaluationDatabaseLifecycle({
  owner: EVALUATION_DATABASE_LIFECYCLE_OWNER,
  run: () =>
    withFormativeConversationPersistenceDiagnostics(
      {
        record: databaseOwner.record_diagnostic,
        connection_identity: databaseOwner.identity,
        run_read: databaseOwner.run_read,
        run_idempotent_write: databaseOwner.run_idempotent_write
      },
      () => main({ diagnostics: persistenceDiagnostics })
    ),
  disconnect: databaseOwner.disconnect_final
}).catch((error) => {
  console.error(
    JSON.stringify({
      status: "blocked",
      error_code:
        error instanceof Error
          ? error.message.split(":", 1)[0]
          : "formative_conversation_v5_evaluation_failed",
      no_secret_values_printed: true
    })
  );
  process.exitCode = 1;
});
