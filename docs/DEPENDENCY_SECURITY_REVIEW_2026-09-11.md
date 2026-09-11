# Dependency security review and remediation

## Scope and outcome

The production build of commit `fe3ce8e21d464b756b4974102f47b8625c077789`
reported 11 affected dependency packages: one critical, nine high, and one
moderate. A full local audit including development tooling reported 15 affected
packages: one critical, twelve high, and two moderate. These counts include
dependent packages, not 15 independent exploitable defects or observed attacks.

After the targeted updates, both the full dependency audit and a fresh
production-only installation report zero known npm vulnerabilities. This is a
point-in-time dependency result, not proof that the entire system is free of
security defects. No production intrusion investigation was performed and no
claim of compromise is made.

## What the warnings meant

| Dependency | Risk reported | Application exposure and correction |
| --- | --- | --- |
| Next.js | Critical remote code execution in AVIF image optimization; a separate critical Windows filesystem issue; request exhaustion, request forgery, caching and endpoint-disclosure advisories | Public framework surface. Render uses Linux, so the Windows-specific condition does not apply. The application uses the image optimizer for its logo, does not configure remote images or custom-server rewrites, and accepts only PNG/JPEG/WebP uploads. These constraints reduce exposure but are not a substitute for patching. Updated 15.5.19 to 15.5.24 with the matching ESLint integration. |
| sharp / native image libraries | Image-decoder memory-safety vulnerabilities | Next.js image dependency. Updated 0.34.5 to 0.35.4, within the new Next.js supported range, including its native libvips packages. |
| xlsx (SheetJS) | Prototype pollution and regular-expression denial of service while reading crafted spreadsheets | Teacher MCQ spreadsheet imports. Replaced the obsolete npm 0.18.5 package with official publisher 0.20.3, pinned by URL and lockfile SHA-512 integrity. No third-party repackaging. |
| fast-xml-parser | Repeated document-type declarations bypass entity-expansion limits | Word import parsing, including teacher course-material uploads. Updated 5.10.0 to 5.11.1. Office archive checks now reject DTD/entity declarations before either XML parser sees them. |
| @xmldom/xmldom | Malformed XML CPU/memory exhaustion and serializer injection | Transitive through Mammoth Word text extraction. Updated 0.8.13 to 0.8.15 in the same release series. The application extracts text, not user-generated XML serialization, but parsing exposure is relevant. |
| csv-parse | Prototype replacement using duplicate special column names | CSV roster/content and export parsing. The reported duplicate-column branch requires `group_columns_by_name`, which is not enabled by the application. Updated 7.0.0 to 7.0.2 and tested both ordinary and grouped hostile headers. |
| postcss | CSS serialization XSS and local source-map disclosure | Build/CSS processing; no teacher/student CSS compilation interface. Updated 8.5.15 and Next's pinned 8.4.31 copy to 8.5.28 through a scoped override. |
| deepmerge-ts | Stack exhaustion on recursive object graphs | Prisma configuration loading, not student response merging. Prisma and Prisma Client remain 6.19.3. A scoped `@prisma/config` override updates deepmerge-ts 7.1.5 to 8.0.2. Its changed Map-merging behavior is not used by this project's plain Prisma configuration. Config loading, client generation/migrations, and database regressions verify compatibility. |
| @prisma/config / prisma | Inherited deepmerge-ts advisory | Resolved by the preceding scoped override, without a Prisma major-version or database schema migration. |
| js-yaml | Quadratic CPU usage in YAML merges and ordered maps | ESLint/configuration dependency, not a user upload parser. Updated 4.2.0 to 4.3.2. |
| brace-expansion | Unbounded expansion, CPU and memory exhaustion | Build/lint glob handling, not a student input interface. Updated 1.1.15 to 1.1.18 and 5.0.6 to 5.0.9. |
| browserslist | Unbounded cache growth and unsafe custom-stat handling | Build-time browser targeting. Updated 4.28.2 to 4.28.9. |
| baseline-browser-mapping | Process termination on invalid input | Browser-target build tooling. Updated 2.10.37 to 2.11.22. |
| nanoid | Infinite loops for invalid custom/non-secure generator sizes | Transitive PostCSS dependency; the application uses its own crypto-based IDs. Updated 3.3.12 to 3.3.19. |

Publisher references:

- [Next.js AVIF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)
- [Next.js Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)
- [Official SheetJS installation and maintained distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)
- [XML entity expansion advisory](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories/GHSA-8r6m-32jq-jx6q)
- [xmldom parser advisory](https://github.com/xmldom/xmldom/security/advisories/GHSA-8344-3jmq-59r6)
- [CSV prototype advisory](https://github.com/adaltas/node-csv/security/advisories/GHSA-8cw4-87c7-c6xx)
- [Deepmerge 8 changes and security fix](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)

The complete pre-fix advisory IDs, affected ranges, and dependency chains are
retained in `.data/dependency-security/20260911/before.json`. This report is
generated diagnostic evidence and is not part of the source commit.

## Additional upload protection

Inspection found that the old XLSX path expanded the workbook before its row
limit check. The existing DOCX guard trusted ZIP-declared sizes and inspected
sanitized ZIP paths, which could hide the original traversal path.

Both formats now pass through the same bounded Office archive reader:

- At most 1,000 archive entries and 12 MB total expanded content; expansion is
  limited to 80 times the input size. The existing compressed upload limits
  remain in place. Actual streaming output is counted in addition to metadata.
- Original traversal paths, macros, DTD/entity declarations, and malformed
  archives fail before parsing. XML with NUL/unsupported encoding is rejected
  with an ordinary import error rather than interpreted ambiguously.
- Downstream parsers receive only the bounded, checked archive contents.
- XLSX reads are bounded to the existing 500-data-row limit plus the header and
  one overflow row. Oversized/sparse worksheet ranges and excessive columns are
  rejected before conversion to row objects.
- The first visible worksheet is selected. A hidden first worksheet can no
  longer be imported while the UI claims hidden worksheets were ignored.
- Invalid files create no partial import batch. Existing authentication,
  assessment ownership, draft creation, and teacher key confirmation remain.

These guards do not execute macros, formulas, external file links, or provider
calls. Imported formula-like text remains literal text. Original source hashes
remain based on the original uploaded bytes, not the checked ZIP serialization.

## Preventing recurrence

`npm run security:dependencies` checks the complete dependency graph and fails
on any reported vulnerability, missing/malformed audit response, service error,
or timeout. It does not suppress advisories or use `npm audit fix --force`.
The publisher-hosted SheetJS artifact is additionally checked for the reviewed
version, exact source URL, and lockfile integrity pin.

The Docker build runs that check before building the application. A new
source build therefore cannot silently ship the reported dependency warnings.
Registry failure intentionally blocks the build; do not bypass the gate to
obtain a deployment. Cached image redeploys do not constitute a fresh audit.
Rerun the check before a release or dependency update. This does not configure
a recurring monitor or change Render settings.

`npm run security:dependency-smoke` is deterministic and makes no network or
provider requests. It tests parser boundaries, known patched version floors,
audit failure handling, image conversion, CSS compatibility, and Prisma config
compatibility. These checks and the import/research checks are also included
in `npm run classroom:audit`.

## Research-data limitations

The preceding data-integrity corrections were rechecked rather than changing
their definitions again. Stable event IDs, concurrent retry deduplication,
snapshot joins, all supported item options, timing/missingness, pseudonyms,
CSV formula neutralization, ZIP hashes, and manifest coverage remain covered.

Limits that cannot honestly be removed by a dependency patch remain explicit:

- Historical events that never reached the server cannot be reconstructed.
  No fabricated backfill or rewriting of historical evidence was performed.
- Browser termination, disabled storage, and never-revisited sessions can lose
  pending observational telemetry. No gap marker is not proof of complete
  capture. Saved answers and telemetry must not be conflated.
- Recorded visibility and typing aggregates are not direct measures of
  attention, motivation, misconduct, or learning.
- Free-text responses can identify a person even when account IDs are
  pseudonymized. The approved research cohort, consent/withdrawal decisions,
  and free-text review remain required before sharing. This patch does not
  invent consent or broaden research access.

## Verification record

- Full dependency audit: zero known vulnerabilities.
- Fresh `npm ci --omit=dev --ignore-scripts` in a disposable directory: passed;
  production audit: zero known vulnerabilities.
- Security smoke: 17 checks passed, including non-disclosing audit errors.
- Classroom audit: 49/49 scripts passed, including the 28-check research-data
  audit and guarded student/teacher, import, profile, and export regressions.
  The previously excluded pre-canonical V5.3 runtime fixture remains unchanged;
  current V18R2 runtime/lifecycle checks cover that path in this suite. This is
  not a claim that every historical evaluation suite was rerun.
- Typecheck: passed. Lint: no errors; five existing historical V18 warnings.
- Production build: passed on Next.js 15.5.24.
- Local production HTTP verification: 14 checks passed, including health,
  database/schema readiness, unauthenticated route/upload rejection, login
  pages, local image optimization, and rejection of unapproved remote images.

The production-mode checks ran locally on Node.js 24.16.0. The Render image
uses Node.js 22; a Linux container build and deployed verification have not
been performed for this patch. The npm audit does not assess base-image OS
packages or prove resistance to every sustained or distributed overload.

Database checks use only a disposable local PostgreSQL database with the
existing 61 migrations. External requests are blocked in regression children.
The test server was stopped and the disposable database and clean-install
directory were removed after verification.
No OpenAI calls, model-auth requests, real dispatch checkpoints, or production
data operations are authorized or performed. Historical evaluation packages,
teaching prompts, profile semantics, schema/migrations, approval, and rollback
bundles are unchanged. These changes are local until separately committed and
deployed.
