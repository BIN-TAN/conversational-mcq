import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  BUILD_DEPENDENCY_EXCEPTION as policy,
  validateAuditResult,
  validateBuildAuditResult,
  verifyPrunedBuildDependencies
} from "./dependency-security-check.mjs";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const now = Date.parse(policy.starts_at) + 1000;
const rootCause = {
  name: "braces", dependency: "braces", url: policy.advisory,
  severity: "high", range: "<=3.0.3"
};
const via = {
  braces: [rootCause], micromatch: ["braces"], "fast-glob": ["micromatch"],
  chokidar: ["braces"], "@next/eslint-plugin-next": ["fast-glob"],
  "eslint-config-next": ["@next/eslint-plugin-next"],
  tailwindcss: ["chokidar", "fast-glob", "micromatch"]
};
function report() {
  return {
    auditReportVersion: 2,
    vulnerabilities: Object.fromEntries(Object.entries(via).map(([name, causes]) => [name, {
      name, severity: "high", via: structuredClone(causes),
      nodes: Object.keys(policy.nodes).filter((node) => node.split("node_modules/").at(-1) === name)
    }])),
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 7, critical: 0, total: 7 } }
  };
}
const result = (body, status = 1) => ({ stdout: JSON.stringify(body), status });

test("only the approved pinned build chain passes, with truthful finding counts", () => {
  const checked = validateBuildAuditResult(result(report()), lock, now);
  assert.equal(checked.vulnerabilities.high, 7);
  assert.equal(checked.exception.advisory, policy.advisory);
  assert.equal(checked.exception.packages.length, 7);
  assert.equal(checked.exception.expires_at, policy.expires_at);
});

test("production accepts zero findings only, with no exception", () => {
  assert.throws(() => validateAuditResult(result(report())));
  const clean = { auditReportVersion: 2, vulnerabilities: {}, metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }
  } };
  assert.equal(validateAuditResult(result(clean, 0)).total, 0);
  assert.equal(validateBuildAuditResult(result(clean, 0), lock, Date.parse(policy.expires_at)).exception, null);
});

test("exception expires after exactly seven days and never auto-renews", () => {
  const starts = Date.parse(policy.starts_at), expires = Date.parse(policy.expires_at);
  assert.equal(expires - starts, 7 * 86400000);
  validateBuildAuditResult(result(report()), lock, starts);
  validateBuildAuditResult(result(report()), lock, expires - 1);
  for (const at of [starts - 1, expires, expires + 86400000, NaN]) {
    assert.throws(() => validateBuildAuditResult(result(report()), lock, at), /expired_or_inactive/);
  }
});

test("another advisory on the same package, or a renamed advisory, blocks deployment", () => {
  for (const change of [
    (r) => { r.vulnerabilities.braces.via.push({ ...rootCause, url: "https://github.com/advisories/GHSA-unapproved" }); },
    (r) => { r.vulnerabilities.braces.via[0].url += "?unapproved"; },
    (r) => { r.vulnerabilities.braces.via[0].range = "*"; },
    (r) => { r.vulnerabilities.braces.via[0].severity = "critical"; },
    (r) => { r.vulnerabilities.micromatch.via = [{ ...rootCause }]; }
  ]) {
    const r = report(); change(r);
    assert.throws(() => validateBuildAuditResult(result(r), lock, now), /unapproved_advisory/);
  }
});

test("unrelated low-severity findings are still release blockers", () => {
  const r = report();
  r.vulnerabilities.unapproved = { name: "unapproved", severity: "low", via: ["braces"], nodes: ["node_modules/unapproved"] };
  r.metadata.vulnerabilities.low = 1; r.metadata.vulnerabilities.total++;
  assert.throws(() => validateBuildAuditResult(result(r), lock, now), /unapproved_finding/);
});

test("changed dependency locations, versions, integrity or runtime reachability fail closed", () => {
  for (const change of [
    (l) => { delete l.packages["node_modules/braces"].dev; },
    (l) => { l.packages["node_modules/braces"].devOptional = true; },
    (l) => { l.packages["node_modules/braces"].version = "3.0.2"; },
    (l) => { delete l.packages["node_modules/braces"].integrity; },
    (l) => { delete l.packages["node_modules/braces"]; }
  ]) {
    const modified = structuredClone(lock); change(modified);
    assert.throws(() => validateBuildAuditResult(result(report()), modified, now));
  }
  const r = report(); r.vulnerabilities.braces.nodes.push("node_modules/other/node_modules/braces");
  assert.throws(() => validateBuildAuditResult(result(r), lock, now), /unapproved_node/);
});

test("missing causes, cycles, and empty node lists cannot conceal a finding", () => {
  for (const change of [
    (r) => { r.vulnerabilities.braces.via = []; },
    (r) => { r.vulnerabilities.braces.via = ["tailwindcss"]; },
    (r) => { r.vulnerabilities.braces.via = ["missing"]; },
    (r) => { r.vulnerabilities.braces.nodes = []; }
  ]) {
    const r = report(); change(r);
    assert.throws(() => validateBuildAuditResult(result(r), lock, now));
  }
});

test("failed commands, malformed reports and inconsistent counts block deployment", () => {
  for (const invalid of [
    result(report(), 0), result(report(), 2), result(report(), null),
    { ...result(report()), signal: "SIGTERM" },
    { ...result(report()), error: new Error("timeout") },
    { status: 1, stdout: "invalid JSON" }, result({}), result({ error: {} }),
    result({ ...report(), vulnerabilities: [] }),
    result({ ...report(), metadata: {} })
  ]) assert.throws(() => validateBuildAuditResult(invalid, lock, now));
  const r = report(); r.metadata.vulnerabilities.high = 0;
  assert.throws(() => validateBuildAuditResult(result(r), lock, now), /counts_inconsistent/);
});

test("runner must physically exclude every excepted path and nested braces copy", () => {
  verifyPrunedBuildDependencies("/synthetic", lock, () => false);
  for (const node of Object.keys(policy.nodes)) {
    assert.throws(() => verifyPrunedBuildDependencies("/synthetic", lock, (p) => p === path.join("/synthetic", node)), /build_node_in_runtime/);
  }
  const changed = structuredClone(lock);
  changed.packages["node_modules/extra/node_modules/braces"] = { version: "3.0.3" };
  assert.throws(() => verifyPrunedBuildDependencies("/synthetic", changed, (p) => p.includes("/extra/")), /build_node_in_runtime/);
});

test("Docker keeps both security gates and checks the final pruned image", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /RUN npm run security:dependencies && npm run build/);
  assert.match(dockerfile, /RUN npm prune --omit=dev && node scripts\/dependency-security-check\.mjs --runtime/);
});
