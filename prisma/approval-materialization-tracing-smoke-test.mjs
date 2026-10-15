import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { materializeApprovedOperationalRuntimeLocally } from "../src/lib/operational/active-approval-bundle.ts";

const require = createRequire(import.meta.url);
const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
const root = process.cwd();
mkdirSync(path.join(root, ".data"), { recursive: true });
const workspace = mkdtempSync(path.join(root, ".data", "approval-tracing-smoke-"));
const input = {
  approvalEvidencePath: path.join(workspace, "missing-evidence.json"),
  approvedManifestPath: path.join(workspace, "missing-approved.json"),
  sourceCandidateManifestPath: path.join(workspace, "missing-source.json"),
  expectedRuntimeHash: "0".repeat(64),
  expectedEvaluationProtocolHash: "0".repeat(64),
  expectedApprovalEvidenceHash: "0".repeat(64),
  expectedSourceProviderRunId: "synthetic-no-run",
  expectedDerivedEvaluationId: "synthetic-no-evaluation",
  confirmation: "materialize approved operational runtime locally",
  nodeEnv: "development"
};

function throwsCode(overrides, code) {
  assert.throws(() => materializeApprovedOperationalRuntimeLocally({ ...input, ...overrides }),
    error => error.code === code);
}

test("local materialization permits ignored-root descendants and still requires exact approved evidence", () => {
  for (const outputDirectory of [undefined, ".data", ".data/nested", ".data/a/../nested", path.join(root, ".data", "absolute")]) {
    throwsCode({ outputDirectory }, "local_materialization_source_manifest_hash_mismatch");
  }
});

test("local materialization rejects prefix lookalikes, traversal and paths outside the project", () => {
  for (const outputDirectory of [".data-elsewhere", ".data/../other", "other", "../escape", path.join(path.parse(root).root, "outside", ".data")]) {
    throwsCode({ outputDirectory }, "local_materialization_output_outside_ignored_data");
  }
});

test("ignored-root casing follows the host filesystem path semantics", () => {
  for (const outputDirectory of [".DATA", ".DaTa/nested", path.join(root, ".DATA", "absolute")]) {
    throwsCode({ outputDirectory }, process.platform === "win32"
      ? "local_materialization_source_manifest_hash_mismatch"
      : "local_materialization_output_outside_ignored_data");
  }
  for (const outputDirectory of [".DATA-elsewhere", ".DaTa/../escape"]) {
    throwsCode({ outputDirectory }, "local_materialization_output_outside_ignored_data");
  }
});

test("confirmation, production refusal and the explicit test override remain intact", () => {
  throwsCode({ confirmation: "wrong" }, "local_materialization_confirmation_mismatch");
  throwsCode({ nodeEnv: "production" }, "local_materialization_forbidden_in_production");
  throwsCode({ outputDirectory: "outside", allowNonDefaultOutputDirectoryForTest: true },
    "local_materialization_source_manifest_hash_mismatch");
});

test("installed file tracer includes the default approval file without globbing unrelated ignored history", async () => {
  // Trace a transpiled copy under a synthetic root. No real evidence or .env
  // file is opened, and the application module is never executed by NFT.
  for (const relative of [".data/synthetic-history/sentinel.json", ".data/exports/sentinel.csv",
    ".data/operational-model-upgrade/active-approval/active-approval-bundle.json"]) {
    mkdirSync(path.dirname(path.join(workspace, relative)), { recursive: true });
    writeFileSync(path.join(workspace, relative), "{}", { flag: "wx" });
  }
  const source = readFileSync(path.join(root, "src/lib/operational/active-approval-bundle.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const entry = path.join(workspace, "active-approval-bundle.js");
  writeFileSync(entry, compiled, { flag: "wx" });
  const result = await nodeFileTrace([entry], { base: workspace, processCwd: workspace });
  const traced = [...result.fileList].map(file => file.replaceAll("\\", "/"));
  assert(traced.includes(".data/operational-model-upgrade/active-approval/active-approval-bundle.json"));
  assert(!traced.some(file => file.startsWith(".data/synthetic-history/") || file.startsWith(".data/exports/")));
  writeFileSync(path.join(workspace, "result.json"), JSON.stringify({
    passed: true, source_sha256: createHash("sha256").update(source).digest("hex"), traced,
    unresolved_import_warning_count: result.warnings.size,
    limitation: "Isolated ESM tracing verifies the local directory-glob regression; the full production build verifies the complete bundle."
  }, null, 2), { flag: "wx" });
});
