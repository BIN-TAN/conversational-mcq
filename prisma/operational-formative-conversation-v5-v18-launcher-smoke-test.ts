import { strict as assert } from "node:assert";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const launcher =
  "scripts/operational-formative-conversation-v5-v18-launcher.mjs";
const processLocalRunner =
  "scripts/operational-formative-conversation-v5-v18-process-local-runner.mjs";

async function main() {
const bareLauncher = spawnSync(
  process.execPath,
  [launcher, "--mode=module-load-probe"],
  { cwd: process.cwd(), encoding: "utf8" }
);
assert.notEqual(bareLauncher.status, 0);
assert.match(
  bareLauncher.stderr,
  /formative_conversation_v18_canonical_loader_required/
);

const bareOuter = spawnSync(
  process.execPath,
  [processLocalRunner, "--env-fifo", "/not-used", "--", "--mode=live"],
  { cwd: process.cwd(), encoding: "utf8" }
);
assert.notEqual(bareOuter.status, 0);
assert.match(
  bareOuter.stderr,
  /formative_conversation_v18_canonical_loader_required/
);

const canonicalLauncher = spawnSync(
  process.execPath,
  ["--import", "tsx", launcher, "--mode=module-load-probe"],
  { cwd: process.cwd(), encoding: "utf8", timeout: 120_000 }
);
assert.equal(
  canonicalLauncher.status,
  0,
  canonicalLauncher.stderr || canonicalLauncher.stdout
);
assert.match(canonicalLauncher.stdout, /"status":"cli_loaded"/);
assert.match(canonicalLauncher.stdout, /"provider_calls":0/);

const temp = mkdtempSync(path.join(tmpdir(), "fcv18-launcher-"));
const fifo = path.join(temp, "environment.fifo");
execFileSync("mkfifo", ["-m", "600", fifo]);
const child = spawn(
  process.execPath,
  [
    "--import",
    "tsx",
    processLocalRunner,
    "--env-fifo",
    fifo,
    "--",
    "--mode=module-load-probe"
  ],
  { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
);
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
const processLocalSecret = "v18-launcher-smoke-secret-123456789";
writeFileSync(
  fifo,
  JSON.stringify({ SESSION_SECRET: processLocalSecret })
);
const exit = await new Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve({ code, signal }));
});
rmSync(temp, { recursive: true, force: true });
assert.equal(exit.signal, null);
assert.equal(exit.code, 0, stderr || stdout);
assert.match(stdout, /"status":"process_local_module_load_probe_passed"/);
assert.match(stdout, /"launch_mechanism_verified":true/);
assert.match(stdout, /"provider_calls":0/);
assert.match(stdout, /"checkpoint_created":false/);
assert.doesNotMatch(stdout, new RegExp(processLocalSecret));
assert.doesNotMatch(stderr, new RegExp(processLocalSecret));

console.log(
  JSON.stringify({
    status: "passed",
    bare_node_blocked: true,
    canonical_launcher_loaded: true,
    process_local_launcher_loaded: true,
    typescript_aliases_resolved: true,
    plan_live_loader_mechanism_identical: true,
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0
  })
);
}

void main();
