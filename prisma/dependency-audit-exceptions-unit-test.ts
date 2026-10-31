/**
 * Reviewed, expiring exceptions for advisories in development-only packages
 * (scripts/dependency-security-check.mjs, config/dependency-audit-exceptions.json).
 * The production audit keeps no exceptions. Pure checks: no npm or network calls.
 * Run with: npx tsx prisma/dependency-audit-exceptions-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeDependencyFailure, validateAuditResult, validateFullAuditWithExceptions } from "../scripts/dependency-security-check.mjs";

const advisory = { source: 1, name: "minimatch", dependency: "minimatch", title: "minimatch has potential denial of service via globparts amplification",
  url: "https://github.com/advisories/GHSA-g3hv-75wg-m249", severity: "moderate", range: "<11.0.1" };
const report = (vulnerabilities: Record<string, { severity: string; via: unknown[] }>) => {
  const findings = Object.values(vulnerabilities);
  const count = (level: string) => findings.filter((finding) => finding.severity === level).length;
  return JSON.stringify({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: {
    info: count("info"), low: count("low"), moderate: count("moderate"), high: count("high"), critical: count("critical"), total: findings.length } } });
};
const devLock = { packages: { "": {}, "node_modules/minimatch": { version: "3.1.5", dev: true }, "node_modules/eslint": { version: "9.0.0", dev: true },
  "node_modules/next": { version: "15.5.27" } } };
const exceptions = JSON.parse(readFileSync("config/dependency-audit-exceptions.json", "utf8"));
const listed = report({ minimatch: { severity: "moderate", via: [advisory] }, eslint: { severity: "moderate", via: ["minimatch"] } });

let passed = 0;
const check = (name: string, run: () => void) => { run(); passed += 1; console.log(`ok - ${name}`); };

check("A listed advisory in development-only packages passes until its review date", () => {
  const result = validateFullAuditWithExceptions({ status: 1, stdout: listed }, devLock, exceptions, "2026-10-30");
  assert.deepEqual(result.accepted, ["GHSA-g3hv-75wg-m249"]);
  assert.equal(result.counts.moderate, 2);
});
check("After review_by the build fails again", () => {
  assert.throws(() => validateFullAuditWithExceptions({ status: 1, stdout: listed }, devLock, exceptions, "2026-12-02"), /dependency_audit_exception_expired/);
});
check("An unlisted advisory, a changed severity or a package that ships at runtime fails", () => {
  const other = report({ minimatch: { severity: "moderate", via: [{ ...advisory, url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" }] } });
  assert.throws(() => validateFullAuditWithExceptions({ status: 1, stdout: other }, devLock, exceptions, "2026-10-30"), /dependency_audit_moderate_findings/);
  const raised = report({ minimatch: { severity: "high", via: [{ ...advisory, severity: "high" }] } });
  assert.throws(() => validateFullAuditWithExceptions({ status: 1, stdout: raised }, devLock, exceptions, "2026-10-30"), /dependency_audit_exception_severity_changed/);
  const runtime = report({ next: { severity: "moderate", via: [{ ...advisory, name: "next" }] } });
  assert.throws(() => validateFullAuditWithExceptions({ status: 1, stdout: runtime }, devLock, exceptions, "2026-10-30"), /dependency_audit_exception_not_dev_only/);
  const shipped = { packages: { ...devLock.packages, "node_modules/minimatch": { version: "3.1.5" } } };
  assert.throws(() => validateFullAuditWithExceptions({ status: 1, stdout: listed }, shipped, exceptions, "2026-10-30"), /dependency_audit_exception_not_dev_only/);
});
check("The production audit keeps no exceptions, and a clean full audit passes unchanged", () => {
  assert.throws(() => validateAuditResult({ status: 1, stdout: listed }), /dependency_audit_moderate_findings/);
  const clean = report({});
  assert.deepEqual(validateFullAuditWithExceptions({ status: 0, stdout: clean }, devLock, exceptions, "2026-10-30").accepted, []);
  assert.equal(safeDependencyFailure(new Error("dependency_audit_exception_expired")), "dependency_audit_exception_expired");
});
check("Every listed exception is reviewed, dated and explained", () => {
  for (const entry of exceptions.exceptions) {
    assert.match(entry.advisory, /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    assert.match(entry.reviewed_on, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.review_by, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.review_by > entry.reviewed_on && entry.reason.length > 40);
  }
});
console.log(`\n${passed} dependency audit exception checks passed; no npm or network calls.`);
