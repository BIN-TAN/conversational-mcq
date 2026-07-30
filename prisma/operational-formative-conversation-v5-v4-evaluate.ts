import { loadEnvConfig } from "@next/env";
import {
  executeFormativeConversationV5LiveEvaluation,
  writeFormativeConversationV5PlanArtifact
} from "../src/lib/operational/formative-conversation-v5-evaluation-v4/service";

loadEnvConfig(process.cwd());

type Options = {
  mode: "plan" | "live";
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
  if (mode !== "plan" && mode !== "live") {
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

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.mode === "plan") {
    const result =
      await writeFormativeConversationV5PlanArtifact();
    console.log(
      JSON.stringify(
        {
          status: "planned",
          provider_calls: 0,
          network_requests: 0,
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
  const result =
    await executeFormativeConversationV5LiveEvaluation({
      runtime_candidate_hash: options.runtime_candidate_hash,
      evaluation_protocol_hash:
        options.evaluation_protocol_hash,
      confirm_live_provider_calls:
        options.confirm_live_provider_calls,
      authorization: options.authorization
    });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
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
