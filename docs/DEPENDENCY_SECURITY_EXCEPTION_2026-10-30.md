# Temporary development-only dependency exception (30 Oct 2026)

## Approval

The project owner explicitly approved this exception on 30 October 2026 (America/Edmonton), after
the Render build of release 29 (148be62) stopped at the dependency audit. It is risk acceptance
for development-only lint tooling, not a vulnerability patch and not a general waiver.

## Exact scope

- Advisory: https://github.com/advisories/GHSA-g3hv-75wg-m249 (CVE-2026-118764), moderate.
  minimatch: denial of service through attacker-supplied glob patterns (globParts amplification).
  Published 27 Oct 2026, reviewed in the GitHub database 30 Oct 2026. Patched only in 11.0.1.
- Affected copies: minimatch 3.1.5 and 10.2.5, both marked dev in package-lock.json, used by
  ESLint 9, its plugins (import, jsx-a11y, react) and typescript-eslint while linting the
  project's own files with the project's own patterns. npm audit lists 13 dev packages, all
  through this one advisory.
- Not affected: the production audit (`npm audit --omit=dev`) reports zero findings; the runtime
  image does not install these packages (`--runtime` verification is unchanged). No student or
  instructor input reaches a glob pattern.
- Why no upgrade: ESLint 9 needs the minimatch 3 API, so overriding to 11 would break linting.
- Expires: review_by 2026-12-01. After that date the build fails again until the exception is
  reviewed, renewed with a new approval, or removed after an upstream fix.

## How it is enforced

`config/dependency-audit-exceptions.json` lists the advisory, package, severity, review date and
reason. `scripts/dependency-security-check.mjs` (`validateFullAuditWithExceptions`) accepts the
full audit only when every advisory in it is listed for its package and severity, before its
review date, and every package the report names is marked dev in the lock. The production audit
keeps the zero-findings rule with no exceptions. `prisma/dependency-audit-exceptions-unit-test.ts`
checks these rules.
