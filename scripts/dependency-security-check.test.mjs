import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveNpmCliPath, safeDependencyFailure, validateAuditResult,
  verifyNoInstalledBraces, verifyPrunedBuildDependencies } from "./dependency-security-check.mjs";

const severities = ["info", "low", "moderate", "high", "critical"];
const cleanReport = () => ({ auditReportVersion: 2, vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } });
const result = (body, status = body?.metadata?.vulnerabilities?.total === 0 ? 0 : 1) => ({ stdout: JSON.stringify(body), status });
function findingReport(severity) {
  const report = cleanReport();
  report.vulnerabilities.example = { name: "example", severity, via: [], nodes: ["node_modules/example"] };
  report.metadata.vulnerabilities[severity] = 1;
  report.metadata.vulnerabilities.total = 1;
  return report;
}

// Historical regression fixture only: these findings formerly passed the
// seven-day build exception. They must now block release without date logic.
const formerNodes = {
  "node_modules/braces": "3.0.3", "node_modules/micromatch": "4.0.8", "node_modules/fast-glob": "3.3.1",
  "node_modules/tailwindcss/node_modules/fast-glob": "3.3.3", "node_modules/tailwindcss/node_modules/chokidar": "3.6.0",
  "node_modules/tailwindcss": "3.4.19", "node_modules/@next/eslint-plugin-next": "15.5.24", "node_modules/eslint-config-next": "15.5.24"
};
function formerExceptionReport() {
  const causes = {
    braces: [{ name: "braces", dependency: "braces", url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm", severity: "high", range: "<=3.0.3" }],
    micromatch: ["braces"], "fast-glob": ["micromatch"], chokidar: ["braces"],
    "@next/eslint-plugin-next": ["fast-glob"], "eslint-config-next": ["@next/eslint-plugin-next"],
    tailwindcss: ["chokidar", "fast-glob", "micromatch"]
  };
  const report = cleanReport();
  report.vulnerabilities = Object.fromEntries(Object.entries(causes).map(([name, via]) => [name, {
    name, severity: "high", via,
    nodes: Object.keys(formerNodes).filter(node => node.split("node_modules/").at(-1) === name)
  }]));
  report.metadata.vulnerabilities.high = 7; report.metadata.vulnerabilities.total = 7;
  return report;
}

test("a complete successful zero-findings audit passes", () => {
  assert.deepEqual(validateAuditResult(result(cleanReport())), cleanReport().metadata.vulnerabilities);
});

test("every severity, including info and low, blocks release", () => {
  for (const severity of severities) {
    assert.throws(() => validateAuditResult(result(findingReport(severity))), new RegExp(`dependency_audit_${severity}_findings`));
  }
});

test("the formerly approved braces chain is now a release blocker", () => {
  assert.throws(() => validateAuditResult(result(formerExceptionReport())), /dependency_audit_high_findings/);
});

test("audit process failures cannot turn a clean report into a pass", () => {
  for (const status of [1, 2, null, undefined, "0"]) {
    assert.throws(() => validateAuditResult({ ...result(cleanReport()), status }), /dependency_audit_failed/);
  }
  assert.throws(() => validateAuditResult({ ...result(cleanReport()), signal: "SIGTERM" }), /execution_interrupted/);
  assert.throws(() => validateAuditResult({ ...result(cleanReport()), error: new Error("timeout") }), /execution_failed/);
});

test("malformed, incomplete and service-error reports fail closed", () => {
  for (const body of [null, [], {}, { error: {} }, { ...cleanReport(), error: { code: "unavailable" } },
    { ...cleanReport(), auditReportVersion: 1 }, { ...cleanReport(), vulnerabilities: [] },
    { ...cleanReport(), vulnerabilities: null }, { ...cleanReport(), metadata: {} }]) {
    assert.throws(() => validateAuditResult(result(body, 0)));
  }
  for (const stdout of ["", "invalid JSON", "null"]) assert.throws(() => validateAuditResult({ status: 0, stdout }));
  for (const severity of [...severities, "total"]) {
    for (const invalid of [undefined, -1, 0.5, "0", Number.MAX_SAFE_INTEGER + 1]) {
      const report = cleanReport(); report.metadata.vulnerabilities[severity] = invalid;
      assert.throws(() => validateAuditResult(result(report, 0)), /counts_missing/);
    }
  }
});

test("findings, severity totals and process status must agree", () => {
  const hidden = cleanReport(); hidden.vulnerabilities.example = { severity: "high" };
  const misclassified = findingReport("high"); misclassified.metadata.vulnerabilities.high = 0; misclassified.metadata.vulnerabilities.low = 1;
  const unknown = findingReport("high"); unknown.vulnerabilities.example.severity = "unknown";
  const missing = findingReport("high"); missing.vulnerabilities = {};
  for (const report of [hidden, misclassified, unknown, missing]) {
    assert.throws(() => validateAuditResult(result(report)), /counts_inconsistent/);
  }
  assert.throws(() => validateAuditResult(result(findingReport("high"), 0)), /dependency_audit_failed/);
});

test("runtime pruning checks all dev-only paths and nested braces even without dev flags", () => {
  const lock = { packages: {
    "": { devDependencies: { tool: "1.0.0" } }, "node_modules/tool": { dev: true },
    "node_modules/tool/node_modules/nested": { dev: true }, "node_modules/other/node_modules/braces": {},
    "node_modules/runtime": {}, "node_modules/shared-optional": { devOptional: true }
  } };
  const root = path.resolve("synthetic-runtime");
  const runtimePaths = new Set(["node_modules/runtime", "node_modules/shared-optional"].map(node => path.join(root, node)));
  verifyPrunedBuildDependencies(root, lock, node => runtimePaths.has(node));
  for (const node of ["node_modules/tool", "node_modules/tool/node_modules/nested", "node_modules/other/node_modules/braces"]) {
    assert.throws(() => verifyPrunedBuildDependencies(root, lock, candidate => candidate === path.join(root, node)), /dependency_audit_build_node_in_runtime/);
  }
  for (const packages of [undefined, null, []]) {
    assert.throws(() => verifyPrunedBuildDependencies(root, { packages }, () => false), /lock_packages_missing/);
  }
});

const directoryEntry = (name, symbolic = false) => ({ name, isDirectory: () => !symbolic, isSymbolicLink: () => symbolic });
function scanFixture(tree, links = {}) {
  const root = path.resolve("synthetic-runtime");
  const directories = new Map(Object.entries(tree).map(([name, entries]) => [path.join(root, name), entries]));
  const resolved = new Map(Object.entries(links).map(([name, target]) => [path.join(root, name), path.join(root, target)]));
  return verifyNoInstalledBraces(root, {
    exists: name => directories.has(name) || resolved.has(name),
    realPath: name => resolved.get(name) ?? name,
    readDirectory: name => directories.get(resolved.get(name) ?? name)
  });
}

test("physical runtime scan detects unlisted braces beneath scoped and nested packages", () => {
  const tree = {
    node_modules: [directoryEntry("@scope"), directoryEntry(".bin")],
    "node_modules/@scope": [directoryEntry("runtime")],
    "node_modules/@scope/runtime/node_modules": [directoryEntry("nested")],
    "node_modules/@scope/runtime/node_modules/nested/node_modules": [directoryEntry("braces")]
  };
  assert.throws(() => scanFixture(tree), /dependency_audit_braces_in_runtime/);
  tree["node_modules/@scope/runtime/node_modules/nested/node_modules"] = [directoryEntry("safe")];
  assert.equal(scanFixture(tree), 4);
});

test("physical scan follows package links, handles cycles and blocks dangling braces links", () => {
  const tree = { node_modules: [directoryEntry("linked", true)] };
  assert.equal(scanFixture(tree, { "node_modules/linked/node_modules": "node_modules" }), 1);
  tree.node_modules = [directoryEntry("braces", true)];
  assert.throws(() => scanFixture(tree), /dependency_audit_braces_in_runtime/);
});

test("physical scan errors or excessive directory traversal block release", () => {
  assert.throws(() => verifyNoInstalledBraces("synthetic", {
    exists: () => true, realPath: node => node, readDirectory: () => { throw new Error("unreadable"); }
  }), /unreadable/);
  // A broad tree reaches the bound without relying on the JavaScript stack limit.
  let reads = 0;
  assert.throws(() => verifyNoInstalledBraces("synthetic", {
    exists: () => true, realPath: node => node,
    readDirectory: () => reads++ === 0 ? Array.from({ length: 10_000 }, (_, i) => directoryEntry(`pkg-${i}`)) : []
  }), /dependency_audit_runtime_scan_limit/);
});

test("npm CLI discovery supports npm-run and direct Node installations without a shell", () => {
  const root = path.resolve("synthetic-node");
  const cli = path.join(root, "node_modules/npm/bin/npm-cli.js");
  const configured = path.join(root, "custom/npm-cli.js");
  assert.equal(resolveNpmCliPath({ nodePath: path.join(root, "node.exe"), npmExecPath: configured, exists: node => node === configured }), configured);
  assert.equal(resolveNpmCliPath({ nodePath: path.join(root, "node.exe"), npmExecPath: "npm.cmd", exists: node => node === cli }), cli);
  const unixCli = path.join(root, "lib/node_modules/npm/bin/npm-cli.js");
  assert.equal(resolveNpmCliPath({ nodePath: path.join(root, "bin/node"), npmExecPath: undefined, exists: node => node === unixCli }), unixCli);
  assert.throws(() => resolveNpmCliPath({ nodePath: path.join(root, "node.exe"), npmExecPath: configured, exists: () => false }), /dependency_audit_npm_cli_missing/);
});

test("error reporting never prints raw registry responses or configuration", () => {
  for (const error of [new SyntaxError("synthetic-private-value"), new Error("https://user:synthetic-password@registry.invalid"), null]) {
    assert.equal(safeDependencyFailure(error), "dependency_security_verification_failed");
  }
  assert.equal(safeDependencyFailure(new Error("dependency_audit_high_findings")), "dependency_audit_high_findings");
});

// Exercise the real CLI in a child process. Only built-in audit/filesystem
// boundaries are stubbed; no registry requests or configuration reads occur.
function runCli(audits, { args = [], presentNodes = [], publisherIntegrity = true, npmAvailable = true, unlistedBraces = false } = {}) {
  const script = fileURLToPath(new URL("./dependency-security-check.mjs", import.meta.url));
  const publisher = "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz";
  const integrity = `sha512-${"A".repeat(86)}==`;
  const manifest = { dependencies: { xlsx: publisher } };
  const lock = { packages: { "": manifest,
    "node_modules/xlsx": { version: "0.20.3", resolved: publisher, ...(publisherIntegrity ? { integrity } : {}) },
    ...Object.fromEntries(Object.entries(formerNodes).map(([node, version]) => [node, { version, dev: true, integrity }]))
  } };
  const source = `
    import { createRequire, syncBuiltinESMExports } from "node:module";
    import { fileURLToPath, pathToFileURL } from "node:url";
    const require = createRequire(import.meta.url);
    const fs = require("node:fs"), cp = require("node:child_process"), path = require("node:path");
    const originalReadFile = fs.readFileSync;
    const audits = ${JSON.stringify(audits)}, calls = [];
    const npmCli = path.join(process.cwd(), "synthetic-npm/npm-cli.js");
    process.env.npm_execpath = npmCli;
    cp.spawnSync = (command, args, options) => {
      if (command !== process.execPath || args[0] !== npmCli || args[1] !== "audit" || args[2] !== "--json" || options.shell) throw new Error("unexpected command");
      calls.push(args.slice(1));
      if (!audits.length) throw new Error("unexpected audit");
      return audits.shift();
    };
    fs.readFileSync = (name, ...options) => {
      if (name === "package.json") return ${JSON.stringify(JSON.stringify(manifest))};
      if (name === "package-lock.json") return ${JSON.stringify(JSON.stringify(lock))};
      if ((name instanceof URL ? fileURLToPath(name) : name) === ${JSON.stringify(script)}) return originalReadFile(name, ...options);
      throw new Error("unexpected file read");
    };
    const present = new Set(${JSON.stringify(presentNodes)}.map(node => path.join(process.cwd(), node)));
    const modules = path.join(process.cwd(), "node_modules");
    const unlistedModules = path.join(modules, "unlisted/node_modules");
    fs.existsSync = name => (name === npmCli && ${npmAvailable}) || present.has(name) || (${unlistedBraces} && (name === modules || name === unlistedModules));
    fs.realpathSync = name => name;
    fs.readdirSync = name => (name === modules ? ["unlisted"] : ["braces"]).map(name => ({ name, isDirectory: () => true, isSymbolicLink: () => false }));
    syncBuiltinESMExports();
    Date.now = () => Date.parse("2026-10-04T02:55:05.000Z");
    process.argv = [process.execPath, ${JSON.stringify(script)}, ...${JSON.stringify(args)}];
    await import(pathToFileURL(${JSON.stringify(script)}));
    console.log(JSON.stringify({ audit_calls: calls }));
  `;
  const completed = spawnSync(process.execPath, ["--input-type=module", "--eval", source], { encoding: "utf8", timeout: 10_000 });
  assert.equal(completed.error, undefined);
  const lines = completed.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  assert(Array.isArray(lines.at(-1)?.audit_calls), completed.stderr);
  return { ...completed, output: lines.find(line => line.status), calls: lines.at(-1)?.audit_calls };
}

test("release CLI independently requires clean production and full audits", () => {
  const checked = runCli([result(cleanReport()), result(cleanReport())]);
  assert.equal(checked.status, 0, checked.stderr);
  assert.deepEqual(checked.calls, [["audit", "--json", "--omit=dev"], ["audit", "--json"]]);
  assert.equal(checked.output.status, "passed");
  assert.equal(checked.output.vulnerabilities.total, 0);
  assert.equal(checked.output.production_vulnerabilities.total, 0);
  assert.equal(Object.hasOwn(checked.output, "exception"), false);
});

test("clean production cannot exempt full-audit findings, even within former approval dates", () => {
  for (const report of [formerExceptionReport(), ...severities.map(findingReport)]) {
    const checked = runCli([result(cleanReport()), result(report)]);
    assert.equal(checked.status, 1);
    assert.equal(checked.calls.length, 2);
    assert.equal(checked.output, undefined);
    assert.match(checked.stderr, /Dependency security check failed: dependency_audit_(info|low|moderate|high|critical)_findings/);
  }
});

test("production findings block release before a clean full audit could mask them", () => {
  const checked = runCli([result(findingReport("high")), result(cleanReport())]);
  assert.equal(checked.status, 1);
  assert.deepEqual(checked.calls, [["audit", "--json", "--omit=dev"]]);
  assert.equal(checked.output, undefined);
});

test("release CLI rejects failed or unparseable full audits without leaking raw responses", () => {
  for (const audit of [result(cleanReport(), 1), { status: 0, stdout: "synthetic-private-value" },
    { ...result(cleanReport()), signal: "SIGTERM" }, result({ error: { message: "synthetic-private-value" } }, 1)]) {
    const checked = runCli([result(cleanReport()), audit]);
    assert.equal(checked.status, 1);
    assert.equal(checked.output, undefined);
    assert.doesNotMatch(checked.stderr, /synthetic-private-value/);
  }
});

test("runtime CLI requires clean production and no build-only or unlisted braces packages", () => {
  const checked = runCli([result(cleanReport())], { args: ["--runtime"] });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.output.scope, "pruned_runtime");
  assert.equal(checked.output.build_only_nodes, "absent");
  assert.equal(checked.output.braces, "absent");
  assert.deepEqual(checked.calls, [["audit", "--json", "--omit=dev"]]);
  const present = runCli([result(cleanReport())], { args: ["--runtime"], presentNodes: ["node_modules/braces"] });
  assert.equal(present.status, 1);
  assert.match(present.stderr, /dependency_audit_build_node_in_runtime/);
  const unknown = runCli([result(cleanReport())], { args: ["--runtime"], unlistedBraces: true });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /dependency_audit_braces_in_runtime/);
  const vulnerable = runCli([result(findingReport("low"))], { args: ["--runtime"] });
  assert.equal(vulnerable.status, 1);
  assert.match(vulnerable.stderr, /dependency_audit_low_findings/);
});

test("missing npm, publisher integrity and invalid CLI arguments block checks", () => {
  for (const [options, reason] of [[{ publisherIntegrity: false }, "sheetjs_integrity_required"],
    [{ npmAvailable: false }, "dependency_audit_npm_cli_missing"], [{ args: ["--allow-vulnerabilities"] }, "dependency_audit_unknown_argument"]]) {
    const checked = runCli([], options);
    assert.equal(checked.status, 1);
    assert.deepEqual(checked.calls, []);
    assert.match(checked.stderr, new RegExp(reason));
  }
});

test("Docker keeps both security gates and checks the final pruned image", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /RUN npm run security:dependencies && npm run build/);
  assert.match(dockerfile, /RUN npm prune --omit=dev && node scripts\/dependency-security-check\.mjs --runtime/);
});
