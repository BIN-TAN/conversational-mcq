# Removal of the braces build dependency chain

The official [GHSA-vfj7-8cjw-p6xm advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
and npm registry were rechecked on October 10, 2026, Edmonton time. The advisory
still affected braces through 3.0.3, the latest published version, with no patched
release. Deeply nested patterns could exhaust the JavaScript stack. The prior
lockfile produced seven full-audit findings in development tooling and zero
production-audit findings.

The original exception expired at 2026-10-11T02:55:04Z. It was not renewed,
restarted, or broadened. The historical approval is preserved in
`DEPENDENCY_SECURITY_EXCEPTION_2026-10-03.md`; its executable acceptance path is
removed. Expiry prevented affected new builds, not operation of an already
running service.

## Dependency changes

- Use the released Tailwind 4.3.3 compiler and matching `@tailwindcss/postcss`.
  Remove Tailwind 3's chokidar, fast-glob, micromatch and braces chain.
- Remove `eslint-config-next` and its transitive Next plugin package. Preserve
  all 21 Next rules and their effective configuration as a transparent local
  copy, replacing the only fast-glob directory call with real `tinyglobby`.
  The complete source, MIT license, upstream and delivered hashes, compatibility
  tests and maintenance instructions are in `tooling/eslint-next/README.md`.
- Keep the existing runtime dependency versions. No package aliases, audit
  filters or renamed vulnerable packages are used.

## Style compatibility

Tailwind's new compiler uses the existing design tokens recorded in
`tailwind.config.ts`, with MIT-attributed v3 Preflight and narrowly retained
sibling-spacing, divider and focus-outline styles. These CSS assets contain no
JavaScript pattern parser. Source scanning explicitly covers application and
component files, excluding private tools and archived research material.
Existing JSX, student wording, teaching logic, prompts and data definitions are
unchanged. The existing PostCSS-based participation UI test and build-readiness
dependency checks use the new PostCSS package.

Tailwind 4 requires modern browsers: Safari 16.4+, Chrome 111+ and Firefox 128+.
Preserving visual defaults does not restore compatibility with older engines.
See the [official upgrade guide](https://tailwindcss.com/docs/upgrade-guide).
When adding new spacing or outline variants, review the retained compatibility
selectors and their compiler tests rather than assuming v3 defaults.

## Release gates

Both full and production audits require zero findings at every severity.
Command failures, service errors, malformed reports and inconsistent counts
block release. npm is invoked through its JavaScript entry point for Windows
and Linux compatibility; no command shell is required.

The final Docker stage still prunes development dependencies and runs the
runtime security gate. That gate checks actual development-only lockfile paths
and independently scans nested installed package directories for braces,
including unexpected copies absent from the lockfile. A local production-only
installation is supplementary evidence; the canonical Render image must also
pass its final-stage check and post-deployment inspection.

Relevant checks include `security:dependency-smoke`, `security:dependencies`,
`security:lint-tooling-smoke`, `security:style-tooling-smoke`, full/production
`npm audit`, typecheck, lint, build, student conversation, master export and
timing-separation regressions. Desktop/mobile login, student chat and teacher
views are compared using isolated synthetic fixtures. Actual results, corrected
failures, deployment identity and limitations belong in the appended release
ledger, not inferred from this description.

No production records or credentials are used for write tests. These software
and synthetic-fixture checks are not evidence of classroom learning gains.
