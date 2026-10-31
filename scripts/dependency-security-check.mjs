import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function verifyPublisherDependency(manifest, lock) {
  // npm's registry copy is abandoned. Keep the supported publisher artifact
  // pinned and integrity-checked, including when an audit excludes URL packages.
  const url = "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz";
  const sheetjs = lock.packages?.["node_modules/xlsx"];
  assert.equal(manifest.dependencies.xlsx, url, "sheetjs_publisher_pin_required");
  assert.equal(lock.packages?.[""].dependencies.xlsx, url, "sheetjs_lock_manifest_mismatch");
  assert.equal(sheetjs?.resolved, url, "sheetjs_publisher_source_required");
  assert.equal(sheetjs?.version, "0.20.3", "sheetjs_patched_version_required");
  assert.match(sheetjs?.integrity ?? "", /^sha512-[A-Za-z0-9+/]{86}==$/, "sheetjs_integrity_required");
}

function readAuditResult(result) {
  assert.equal(result.error, undefined, "dependency_audit_execution_failed");
  assert.equal(result.signal ?? null, null, "dependency_audit_execution_interrupted");
  const report = JSON.parse(result.stdout);
  assert.equal(report.error, undefined, "dependency_audit_service_error");
  assert.equal(report.auditReportVersion, 2, "dependency_audit_report_version_unknown");
  assert(report.vulnerabilities && typeof report.vulnerabilities === "object" && !Array.isArray(report.vulnerabilities), "dependency_audit_findings_missing");
  const counts = report.metadata?.vulnerabilities;
  for (const level of ["info", "low", "moderate", "high", "critical", "total"]) {
    assert(Number.isSafeInteger(counts?.[level]) && counts[level] >= 0, "dependency_audit_counts_missing");
  }
  const findings = Object.values(report.vulnerabilities);
  assert.equal(counts.total, findings.length, "dependency_audit_counts_inconsistent");
  for (const level of ["info", "low", "moderate", "high", "critical"]) {
    assert.equal(counts[level], findings.filter((finding) => finding?.severity === level).length, "dependency_audit_counts_inconsistent");
  }
  assert.equal(counts.total, counts.info + counts.low + counts.moderate + counts.high + counts.critical, "dependency_audit_counts_inconsistent");
  assert.equal(result.status, counts.total === 0 ? 0 : 1, "dependency_audit_failed");
  return report;
}

export function validateAuditResult(result) {
  const report = readAuditResult(result);
  const counts = report.metadata.vulnerabilities;
  for (const level of ["info", "low", "moderate", "high", "critical", "total"]) {
    assert.equal(counts[level], 0, `dependency_audit_${level}_findings`);
  }
  assert.equal(Object.keys(report.vulnerabilities).length, 0, "dependency_audit_findings_present");
  assert.equal(result.status, 0, "dependency_audit_failed");
  return counts;
}

/** The advisory ID (GHSA-...) of an npm audit "via" entry. */
function advisoryId(via) {
  const match = typeof via?.url === "string" ? via.url.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i) : null;
  return match ? match[0] : null;
}

/**
 * Full audit with reviewed exceptions for development-only packages (lint tooling). Every
 * advisory in the report must be listed in config/dependency-audit-exceptions.json for its
 * package and severity, still before its review_by date, and every package the report names
 * must be marked dev in the lock (never installed in the runtime image). Anything else fails
 * exactly as validateAuditResult does. The production audit is checked separately with no
 * exceptions.
 */
export function validateFullAuditWithExceptions(result, lock, exceptionsFile, today = new Date().toISOString().slice(0, 10)) {
  const report = readAuditResult(result);
  const counts = report.metadata.vulnerabilities;
  if (counts.total === 0) return { counts, accepted: [] };
  const exceptions = Array.isArray(exceptionsFile?.exceptions) ? exceptionsFile.exceptions : [];
  assert(lock.packages && typeof lock.packages === "object" && !Array.isArray(lock.packages), "dependency_audit_lock_packages_missing");
  const accepted = new Set();
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    const locations = Object.entries(lock.packages).filter(([node]) => node.split("node_modules/").at(-1) === name);
    assert(locations.length > 0 && locations.every(([, entry]) => entry?.dev === true), "dependency_audit_exception_not_dev_only");
    for (const via of finding?.via ?? []) {
      if (typeof via === "string") continue;
      const id = advisoryId(via);
      const exception = exceptions.find((entry) => entry?.advisory === id && entry?.package === (via.name ?? name));
      assert(id && exception, "dependency_audit_moderate_findings");
      assert(exception.severity === via.severity, "dependency_audit_exception_severity_changed");
      assert(typeof exception.review_by === "string" && /^\d{4}-\d{2}-\d{2}$/.test(exception.review_by), "dependency_audit_exception_invalid");
      assert(today <= exception.review_by, "dependency_audit_exception_expired");
      accepted.add(id);
    }
  }
  assert(accepted.size > 0, "dependency_audit_findings_present");
  return { counts, accepted: [...accepted].sort() };
}

export function verifyPrunedBuildDependencies(root, lock, exists = existsSync) {
  assert(lock.packages && typeof lock.packages === "object" && !Array.isArray(lock.packages), "dependency_audit_lock_packages_missing");
  // npm marks dependencies used only for development with dev:true. Check the
  // actual pruned image against the current lock, without an advisory allowlist.
  for (const [node, entry] of Object.entries(lock.packages)) {
    if (node && (entry?.dev === true || node.split("node_modules/").at(-1) === "braces")) {
      assert(!exists(path.join(root, node)), "dependency_audit_build_node_in_runtime");
    }
  }
}

export function verifyNoInstalledBraces(root, { exists = existsSync, readDirectory = readdirSync, realPath = realpathSync } = {}) {
  const visited = new Set();
  const scan = (directory, scoped = false) => {
    if (!exists(directory)) return;
    const resolved = `${scoped ? "scope" : "modules"}:${realPath(directory)}`;
    if (visited.has(resolved)) return;
    assert(visited.size < 10_000, "dependency_audit_runtime_scan_limit");
    visited.add(resolved);
    for (const entry of readDirectory(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
      const installed = path.join(directory, entry.name);
      assert(scoped || entry.name !== "braces", "dependency_audit_braces_in_runtime");
      if (!scoped && entry.name.startsWith("@")) scan(installed, true);
      else scan(path.join(installed, "node_modules"));
    }
  };
  // Inspect package directories only. Resolved paths bound symlink cycles;
  // the limit blocks release rather than silently skipping an oversized tree.
  scan(path.join(root, "node_modules"));
  return visited.size;
}

export function resolveNpmCliPath({ npmExecPath = process.env.npm_execpath, nodePath = process.execPath, exists = existsSync } = {}) {
  const nodeDirectory = path.dirname(nodePath);
  const candidates = [
    npmExecPath,
    path.join(nodeDirectory, "node_modules/npm/bin/npm-cli.js"),
    path.resolve(nodeDirectory, "../lib/node_modules/npm/bin/npm-cli.js")
  ];
  const cli = candidates.find(candidate => typeof candidate === "string" && path.isAbsolute(candidate)
    && path.basename(candidate) === "npm-cli.js" && exists(candidate));
  assert(cli, "dependency_audit_npm_cli_missing");
  return cli;
}

export function safeDependencyFailure(error) {
  const reason = error instanceof Error ? error.message.split("\n")[0] : "";
  return /^(dependency_audit|sheetjs)_[a-z_]+$/.test(reason)
    ? reason : "dependency_security_verification_failed";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert(process.argv.slice(2).every((arg) => arg === "--runtime"), "dependency_audit_unknown_argument");
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    verifyPublisherDependency(JSON.parse(readFileSync("package.json", "utf8")), lock);
    // Invoke JavaScript directly: Windows cannot spawn npm.cmd without a shell.
    const npmCli = resolveNpmCliPath();
    const audit = (omitDev) => spawnSync(process.execPath, [npmCli, "audit", "--json", ...(omitDev ? ["--omit=dev"] : [])], {
      encoding: "utf8", timeout: 90_000, maxBuffer: 8 * 1024 * 1024
    });
    // The production audit must report zero findings; the full audit may carry only reviewed,
    // listed advisories in development-only packages (config/dependency-audit-exceptions.json).
    const production = validateAuditResult(audit(true));
    if (process.argv.includes("--runtime")) {
      verifyPrunedBuildDependencies(process.cwd(), lock);
      const directoriesScanned = verifyNoInstalledBraces(process.cwd());
      console.log(JSON.stringify({ status: "passed", scope: "pruned_runtime", vulnerabilities: production, build_only_nodes: "absent", braces: "absent", package_directories_scanned: directoriesScanned }));
    } else {
      // Development-only findings pass only when reviewed and listed, until their review date.
      const exceptions = JSON.parse(readFileSync("config/dependency-audit-exceptions.json", "utf8"));
      const { counts: vulnerabilities, accepted } = validateFullAuditWithExceptions(audit(false), lock, exceptions);
      console.log(JSON.stringify({ status: "passed", scope: "all_dependencies", vulnerabilities, accepted_dev_only_advisories: accepted, production_vulnerabilities: production, publisher_integrity: "pinned_in_lockfile" }));
    }
  } catch (error) {
    // No environment, npm configuration, or unfiltered registry output in logs.
    console.error(`Dependency security check failed: ${safeDependencyFailure(error)}`);
    process.exitCode = 1;
  }
}
