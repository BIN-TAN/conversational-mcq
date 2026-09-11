import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

export function validateAuditResult(result) {
  assert.equal(result.error, undefined, "dependency_audit_execution_failed");
  const report = JSON.parse(result.stdout);
  assert.equal(report.error, undefined, "dependency_audit_service_error");
  assert.equal(report.auditReportVersion, 2, "dependency_audit_report_version_unknown");
  assert(report.vulnerabilities && typeof report.vulnerabilities === "object", "dependency_audit_findings_missing");
  const counts = report.metadata?.vulnerabilities;
  for (const level of ["info", "low", "moderate", "high", "critical", "total"]) {
    assert(Number.isSafeInteger(counts?.[level]) && counts[level] >= 0, "dependency_audit_counts_missing");
    assert.equal(counts[level], 0, `dependency_audit_${level}_findings`);
  }
  assert.equal(Object.keys(report.vulnerabilities).length, 0, "dependency_audit_findings_present");
  assert.equal(result.status, 0, "dependency_audit_failed");
  return counts;
}

export function safeDependencyFailure(error) {
  const reason = error instanceof Error ? error.message.split("\n")[0] : "";
  return /^(dependency_audit|sheetjs)_[a-z_]+$/.test(reason)
    ? reason : "dependency_security_verification_failed";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    verifyPublisherDependency(JSON.parse(readFileSync("package.json", "utf8")), JSON.parse(readFileSync("package-lock.json", "utf8")));
    const result = spawnSync("npm", ["audit", "--json"], {
      encoding: "utf8", timeout: 90_000, maxBuffer: 8 * 1024 * 1024
    });
    const counts = validateAuditResult(result);
    console.log(JSON.stringify({ status: "passed", scope: "all_dependencies", vulnerabilities: counts, publisher_integrity: "pinned_in_lockfile" }));
  } catch (error) {
    // No environment, npm configuration, or unfiltered registry output in logs.
    console.error(`Dependency security check failed: ${safeDependencyFailure(error)}`);
    process.exitCode = 1;
  }
}
