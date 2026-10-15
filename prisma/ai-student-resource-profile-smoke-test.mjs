import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temporary = mkdtempSync(path.join(os.tmpdir(), "cmcq-resource-profile-"));
const blocker = path.join(temporary, "no-network.cjs");
writeFileSync(blocker, `const stop=()=>{throw Error('Resource profile smoke forbids network');};globalThis.fetch=stop;for(const name of ['node:http','node:https']){const m=require(name);m.request=stop;m.get=stop;}require('node:net').Socket.prototype.connect=stop;`);
const run = (extra = [], suite = "conversational-reliability") => spawnSync(process.execPath,
  ["--require", blocker, "--import", "tsx", "prisma/ai-student-journey-evaluation.ts", "--dry-run", "--suite", suite,
    ...(suite === "conversational-reliability" ? ["--case", "maximum_length_unresolved_support"] : []), ...extra],
  { cwd: process.cwd(), encoding: "utf8", windowsHide: true, timeout: 30_000 });
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const valid = { version: "synthetic-conversation-resource-profile-v1", synthetic_only: true,
  session_token_limit: 2_000_000, student_daily_token_limit: 5_000_000 };
const profilePath = path.join(temporary, "profile.json");
const writeProfile = value => writeFileSync(profilePath, JSON.stringify(value));
try {
  const original = run();
  check(original.status === 0, original.stderr);
  const defaults = JSON.parse(original.stdout);
  check(defaults.resource_profile === null, "Absent profile preserves the historical path.");
  check(defaults.harness_resource_limits.LLM_SESSION_TOKEN_LIMIT === "1000000" &&
    defaults.harness_resource_limits.LLM_DAILY_STUDENT_TOKEN_LIMIT === "1000000", "Historical token defaults remain one million.");
  writeProfile(valid);
  const selected = run(["--resource-profile", profilePath]);
  check(selected.status === 0, selected.stderr);
  const parsed = JSON.parse(selected.stdout);
  check(parsed.harness_resource_limits.LLM_SESSION_TOKEN_LIMIT === "2000000" &&
    parsed.harness_resource_limits.LLM_DAILY_STUDENT_TOKEN_LIMIT === "5000000", "Only the explicit bounded profile raises these two allowances.");
  check(parsed.resource_profile.path === profilePath && parsed.resource_profile.sha256 ===
    createHash("sha256").update(readFileSync(profilePath)).digest("hex"), "Exact file bytes and path are retained.");
  check(parsed.harness_resource_limits.LLM_AGENT_CALL_LIMIT_PER_SESSION === "80" &&
    parsed.harness_resource_limits.LLM_AGENT_CALL_LIMIT_PER_DAY === "260" &&
    parsed.harness_resource_limits.LLM_DAILY_CLASS_TOKEN_LIMIT === "8000000", "Other harness allowances are unchanged.");
  check(JSON.stringify(parsed.cases) === JSON.stringify(defaults.cases), "Thirty-message scenario and authored learner behavior remain unchanged.");
  for (const [name, bad] of [
    ["unknown field", { ...valid, LLM_SESSION_CALL_LIMIT: 99999 }],
    ["wrong version", { ...valid, version: "other" }],
    ["non-synthetic profile", { ...valid, synthetic_only: false }],
    ["unbounded session", { ...valid, session_token_limit: 999999999 }],
    ["unbounded daily", { ...valid, student_daily_token_limit: 999999999 }],
    ["negative", { ...valid, session_token_limit: -1 }],
    ["coerced string", { ...valid, session_token_limit: "2000000" }],
    ["missing value", { ...valid, student_daily_token_limit: undefined }]
  ]) { writeProfile(bad); check(run(["--resource-profile", profilePath]).status !== 0, `Reject ${name} before DB/provider work.`); }
  writeFileSync(profilePath, "not-json");
  check(run(["--resource-profile", profilePath]).status !== 0, "Malformed JSON fails closed.");
  writeFileSync(profilePath, " ".repeat(4097));
  check(run(["--resource-profile", profilePath]).status !== 0, "Oversized profile fails closed.");
  writeProfile(valid);
  check(run(["--resource-profile", profilePath], "conversational-support-needs").status !== 0, "Explicit profile cannot change other suites.");
  check(run(["--resource-profile"]).status !== 0, "Missing option argument cannot silently use defaults.");
  console.log(JSON.stringify({ status: "passed", checks, network_calls: 0, database_calls: 0, paid_calls: 0,
    scope: "Actual harness dry-run with process-level network blocker; historical defaults, exact profile identity, bounded override and rejection before any database/provider action." }));
} finally {
  for (const name of readdirSync(temporary)) unlinkSync(path.join(temporary, name));
  rmdirSync(temporary);
}
