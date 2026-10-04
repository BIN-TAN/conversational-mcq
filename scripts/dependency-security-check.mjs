import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Owner-approved on 2026-10-04 UTC. This is a build-only risk acceptance,
// not a patch or permission to ignore other advisories. Do not auto-renew it.
export const BUILD_DEPENDENCY_EXCEPTION = {
  advisory: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
  starts_at: "2026-10-04T02:55:04.000Z",
  expires_at: "2026-10-11T02:55:04.000Z",
  nodes: {
    "node_modules/braces": "3.0.3",
    "node_modules/micromatch": "4.0.8",
    "node_modules/fast-glob": "3.3.1",
    "node_modules/tailwindcss/node_modules/fast-glob": "3.3.3",
    "node_modules/tailwindcss/node_modules/chokidar": "3.6.0",
    "node_modules/tailwindcss": "3.4.19",
    "node_modules/@next/eslint-plugin-next": "15.5.24",
    "node_modules/eslint-config-next": "15.5.24"
  }
};

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

export function validateBuildAuditResult(result, lock, now = Date.now()) {
  const report = readAuditResult(result);
  if (report.metadata.vulnerabilities.total === 0) {
    return { vulnerabilities: report.metadata.vulnerabilities, exception: null };
  }
  const policy = BUILD_DEPENDENCY_EXCEPTION;
  const starts = Date.parse(policy.starts_at);
  const expires = Date.parse(policy.expires_at);
  assert(Number.isFinite(now) && now >= starts && now < expires && expires - starts <= 7 * 24 * 60 * 60 * 1000, "dependency_audit_exception_expired_or_inactive");
  const findings = report.vulnerabilities;
  const visited = new Set();
  const visit = (name, ancestors = new Set()) => {
    assert(!ancestors.has(name), "dependency_audit_exception_cyclic_chain");
    if (visited.has(name)) return;
    const finding = findings[name];
    assert(finding && finding.name === name && finding.severity === "high", "dependency_audit_exception_unapproved_finding");
    assert(Array.isArray(finding.nodes) && finding.nodes.length > 0, "dependency_audit_exception_nodes_missing");
    for (const node of finding.nodes) {
      assert(Object.hasOwn(policy.nodes, node) && node.split("node_modules/").at(-1) === name, "dependency_audit_exception_unapproved_node");
      const entry = lock.packages?.[node];
      assert(entry?.dev === true && !entry.devOptional, "dependency_audit_exception_not_build_only");
      assert.equal(entry.version, policy.nodes[node], "dependency_audit_exception_version_changed");
      assert.match(entry.integrity ?? "", /^sha512-[A-Za-z0-9+/]{86}==$/, "dependency_audit_exception_integrity_missing");
    }
    assert(Array.isArray(finding.via) && finding.via.length > 0, "dependency_audit_exception_cause_missing");
    for (const cause of finding.via) {
      if (typeof cause === "string") {
        visit(cause, new Set([...ancestors, name]));
      } else {
        assert(name === "braces" && cause?.name === "braces" && cause.dependency === "braces"
          && cause.url === policy.advisory && cause.severity === "high" && cause.range === "<=3.0.3",
        "dependency_audit_exception_unapproved_advisory");
      }
    }
    visited.add(name);
  };
  for (const name of Object.keys(findings)) visit(name);
  assert(visited.has("braces"), "dependency_audit_exception_root_missing");
  return {
    vulnerabilities: report.metadata.vulnerabilities,
    exception: { advisory: policy.advisory, expires_at: policy.expires_at, scope: "pinned_build_only_nodes", packages: [...visited].sort() }
  };
}

export function verifyPrunedBuildDependencies(root, lock, exists = existsSync) {
  const nodes = new Set(Object.keys(BUILD_DEPENDENCY_EXCEPTION.nodes));
  for (const node of Object.keys(lock.packages ?? {})) {
    if (node.split("node_modules/").at(-1) === "braces") nodes.add(node);
  }
  for (const node of nodes) {
    assert(!exists(path.join(root, node)), "dependency_audit_excepted_build_node_in_runtime");
  }
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
    const audit = (omitDev) => spawnSync("npm", ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])], {
      encoding: "utf8", timeout: 90_000, maxBuffer: 8 * 1024 * 1024
    });
    // Production always has a zero-findings requirement, even during an exception.
    const production = validateAuditResult(audit(true));
    if (process.argv.includes("--runtime")) {
      verifyPrunedBuildDependencies(process.cwd(), lock);
      console.log(JSON.stringify({ status: "passed", scope: "pruned_runtime", vulnerabilities: production, excepted_build_nodes: "absent" }));
    } else {
      const build = validateBuildAuditResult(audit(false), lock);
      console.log(JSON.stringify({ status: build.exception ? "passed_with_temporary_build_exception" : "passed", scope: "all_dependencies", ...build, production_vulnerabilities: production, publisher_integrity: "pinned_in_lockfile" }));
    }
  } catch (error) {
    // No environment, npm configuration, or unfiltered registry output in logs.
    console.error(`Dependency security check failed: ${safeDependencyFailure(error)}`);
    process.exitCode = 1;
  }
}
