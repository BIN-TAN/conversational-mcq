import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFormativeConversationV5TestEnvironment } from "./helpers/formative-conversation-v5-v9-test-environment";

async function main() {
  const directory = mkdtempSync(
    path.join(tmpdir(), "fcv5-v9-process-local-")
  );
  const fifoPath = path.join(directory, "environment.fifo");
  const testSecret =
    "formative-conversation-v9-process-local-secret-000000";
  try {
    execFileSync("mkfifo", ["-m", "600", fifoPath]);
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/operational-formative-conversation-v5-v9-process-local-runner.mjs",
        "--env-fifo",
        fifoPath,
        "--",
        "--mode=module-load-probe"
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    writeFileSync(
      fifoPath,
      JSON.stringify(
        buildFormativeConversationV5TestEnvironment({
          SESSION_SECRET: testSecret,
          FORMATIVE_CONVERSATION_V5_V9_CANARY_EPHEMERAL_SESSION_SECRET:
            "true"
        })
      )
    );
    const exit = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.equal(exit.code, 0, stderr);
    assert.equal(exit.signal, null);
    assert(stdout.includes('"status":"cli_loaded"'));
    assert(stderr.includes('"status":"secret_scan_passed"'));
    assert.equal(stdout.includes(testSecret), false);
    assert.equal(stderr.includes(testSecret), false);
    assert.equal(existsSync(fifoPath), false);
    console.log(
      JSON.stringify({
        status: "passed",
        exact_live_launch_mechanism_loaded: true,
        process_local_fifo_unlinked_after_scan: true,
        exact_secret_absent_from_output: true,
        boolean_secret_suffix_not_misclassified: true,
        provider_calls: 0,
        model_auth_requests: 0,
        network_requests: 0
      })
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message.split(":", 1)[0]
          : "formative_conversation_v9_process_local_launcher_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0
    })
  );
  process.exitCode = 1;
});
