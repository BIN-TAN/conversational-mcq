# Temporary build dependency exception

The project owner explicitly approved one seven-day exception on October 3,
2026 (America/Edmonton). It permits deployment of the pending API recovery fix
without a major framework/style-tool migration. This is risk acceptance, not a
vulnerability patch and not a general waiver of security checks.

## Exact Scope

- Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm (CVE-2026-93687).
- Affected package: `braces` through 3.0.3, recursive pattern stack exhaustion.
- The official advisory and npm registry were checked on October 4 UTC; no
  patched upstream version was available.
- Starts: `2026-10-04T02:55:04.000Z`.
- Expires: `2026-10-11T02:55:04.000Z` (October 10 at 20:55:04 MDT).
- Eight exact lockfile locations/versions in `BUILD_DEPENDENCY_EXCEPTION` cover
  the seven reported packages, including braces and transitive build tooling.
  Every accepted cause must terminate at this one advisory; the report
  must contain valid, internally consistent counts and a successful audit run.

The implicated toolchain processes repository build configuration, not uploaded
student responses. Changes to build inputs still need code review. The package
remains vulnerable during the exception; its impact is limited by the approved
build-only scope and the controls below.

## Enforced Controls

`scripts/dependency-security-check.mjs` audits production dependencies separately
and requires zero findings at every severity. The complete dependency audit then
accepts only this advisory's known dependency chain, exact locations and versions,
with lockfile `dev=true` and SHA-512 integrity metadata. New advisories, changed
scope, missing evidence, service errors, timeouts and inconsistent reports block
deployment. Audit logs report the actual seven findings, exception and expiry;
they never describe the dependency tree as vulnerability-free.

The final Docker stage prunes development dependencies, reruns the strict
production audit, and verifies the excepted package paths and all lockfile braces
copies are physically absent. There is no production-dependency exception.

Expiry is evaluated during builds. It blocks further builds that still depend on
the exception; it does not stop an already-running classroom service. It does not
auto-renew, and no unattended monitoring or renewal job is implied. A patched
dependency must be reviewed and adopted, or any extension requires a fresh owner
approval. Remove the exception after adopting a validated upstream fix.

## Assessment and Research Boundaries

This change touches deployment checks only. It does not change prompts, scoring,
student permissions, tokens, attempts, answers, profiles, event schemas or research
export calculations. It delivers the previously tested API-recovery changes
tracked in CMCQ-20261003-02. Failed deployments and historical failure records are
preserved in the release ledger.
