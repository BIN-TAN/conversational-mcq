import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT
} from "../src/lib/operational/formative-conversation-v5-evaluation-v12/contracts";
import {
  buildFormativeConversationV5EvaluationPlan,
  loadFormativeConversationV5EvaluationPackage
} from "../src/lib/operational/formative-conversation-v5-evaluation-v12/package";
import {
  buildFormativeConversationV5TestEnvironment
} from "./helpers/formative-conversation-v5-v12-test-environment";

const LAUNCHER =
  "scripts/operational-formative-conversation-v5-v12-launcher.mjs";
const PROCESS_LOCAL_RUNNER =
  "scripts/operational-formative-conversation-v5-v12-process-local-runner.mjs";
const LOADER_ERROR =
  "formative_conversation_v12_canonical_loader_required";
const CLI =
  "prisma/operational-formative-conversation-v5-v12-evaluate.ts";
const DOCUMENTATION =
  "docs/FORMATIVE_CONVERSATION_V5_EXECUTABLE_V12.md";

function main() {
  const loaded = loadFormativeConversationV5EvaluationPackage();
  const checkpointPath = path.resolve(
    FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
    "dispatch",
    `${loaded.protocol_hash}.json`
  );
  assert.equal(existsSync(checkpointPath), false);

  const bareLauncher = spawnSync(
    process.execPath,
    [LAUNCHER, "--mode=module-load-probe"],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.notEqual(bareLauncher.status, 0);
  assert.match(bareLauncher.stderr, new RegExp(LOADER_ERROR));
  assert.equal(bareLauncher.stdout, "");

  const bareProcessRunner = spawnSync(
    process.execPath,
    [
      PROCESS_LOCAL_RUNNER,
      "--env-fifo",
      path.resolve(".data/nonexistent-v12-environment.fifo"),
      "--",
      "--mode=environment-preflight"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.notEqual(bareProcessRunner.status, 0);
  assert.match(bareProcessRunner.stderr, new RegExp(LOADER_ERROR));
  assert.equal(bareProcessRunner.stdout, "");

  const directCli = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI, "--mode=module-load-probe"],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.notEqual(directCli.status, 0);
  assert.match(
    directCli.stderr,
    /formative_conversation_v12_canonical_launcher_required/
  );
  assert.equal(directCli.stdout, "");

  const canonical = spawnSync(
    process.execPath,
    ["--import", "tsx", LAUNCHER, "--mode=module-load-probe"],
    {
      cwd: process.cwd(),
      env: buildFormativeConversationV5TestEnvironment(),
      encoding: "utf8",
      timeout: 120_000
    }
  );
  assert.equal(
    canonical.status,
    0,
    canonical.stderr.trim() || canonical.error?.message
  );
  const result = JSON.parse(canonical.stdout) as {
    status: string;
    launch_mechanism: string;
    provider_calls: number;
    network_requests: number;
  };
  assert.equal(result.status, "cli_loaded");
  assert.equal(result.launch_mechanism, "node --import tsx");
  assert.equal(result.provider_calls, 0);
  assert.equal(result.network_requests, 0);

  const wrapperSource = readFileSync(PROCESS_LOCAL_RUNNER, "utf8");
  assert.match(wrapperSource, /assertCanonicalLoader\(\)/);
  assert.match(wrapperSource, /await import\(/);
  assert.match(wrapperSource, /"--import",\s*\n\s*"tsx"/);
  const plan = buildFormativeConversationV5EvaluationPlan();
  const documentation = readFileSync(DOCUMENTATION, "utf8");
  assert.equal(
    documentation.includes(plan.required_live_command),
    true,
    "The documented frozen command must match the generated executable command."
  );
  assert.equal(existsSync(checkpointPath), false);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        bare_launcher_failed_safely: true,
        bare_process_runner_failed_safely: true,
        direct_cli_bypass_failed_safely: true,
        canonical_launcher_loaded: true,
        typescript_aliases_resolved: true,
        documented_command_matches_generated_command: true,
        checkpoint_created: false,
        provider_calls: 0,
        network_requests: 0
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message.split(":", 1)[0]
          : "formative_conversation_v12_launcher_smoke_failed",
      checkpoint_created: false,
      provider_calls: 0,
      network_requests: 0
    })
  );
  process.exitCode = 1;
}
