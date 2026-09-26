import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runtimeMemoryArguments } from "./runtime-memory-budget.mjs";

const MiB = 1024 * 1024;

test("shared 512 MiB service reserves native and worker headroom", () => {
  assert.deepEqual(runtimeMemoryArguments("start", 512 * MiB), {
    web: ["--max-old-space-size=192", "--max-semi-space-size=4"],
    worker: ["--max-old-space-size=96", "--max-semi-space-size=4"]
  });
});

test("larger containers receive proportionate budgets", () => {
  assert.deepEqual(runtimeMemoryArguments("start", 2048 * MiB), {
    web: ["--max-old-space-size=768", "--max-semi-space-size=8"],
    worker: ["--max-old-space-size=384", "--max-semi-space-size=8"]
  });
});

test("development and unavailable constraints preserve existing behavior", () => {
  for (const bytes of [0, undefined, NaN, Infinity, -1]) {
    assert.deepEqual(runtimeMemoryArguments("start", bytes), { web: [], worker: [] });
  }
  assert.deepEqual(runtimeMemoryArguments("dev", 512 * MiB), { web: [], worker: [] });
});

test("runtime command arguments override inherited 8 GiB build settings", () => {
  const budgets = runtimeMemoryArguments("start", 512 * MiB);
  for (const [role, args] of Object.entries(budgets)) {
    const result = spawnSync(process.execPath,
      [...args, "-e", 'console.log(require("v8").getHeapStatistics().heap_size_limit)'],
      { env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=8192" }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const limit = Number(result.stdout.trim());
    assert.ok(limit > 0 && limit < (role === "web" ? 224 : 128) * MiB, `${role}: ${limit}`);
  }
});
