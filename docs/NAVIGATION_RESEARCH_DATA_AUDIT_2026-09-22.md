# Navigation Research Data Audit

## Scope

This follow-up checks persisted research evidence for the navigation scenarios
in `STUDENT_NAVIGATION_AUDIT_2026-09-22.md`, not only the next visible screen.
All new records are synthetic and stored in isolated local databases. No
classroom accounts or historical research records are changed, and no live
provider calls are made. Baseline source commit: `e3c04f76`.

## Defects Found and Corrected

1. A rejected content/procedural question could become `reasoning_text_initial`
   because the package builder treated arbitrary student text as justification.
   Only accepted reasoning sources and accepted reasoning edits now qualify.
   Rejected utterances remain in the transcript for process analyses.
2. A confidence-only edit repeated the selected option in its payload, causing
   `answer_changed=true` even when the answer stayed the same. The package now
   checks changes in answer values, not the number of payloads containing them.
3. Package-review edits of a tempting alternative were ignored by the package
   projection. The latest accepted review edit or reset now supersedes earlier
   alternative evidence without carrying an old explanation forward.
4. `item_responses.csv` depended on a submitted package for alternative evidence,
   losing these product fields in partial/abandoned attempts. It now uses the
   latest accepted transcript evidence, with package fallback for legacy data.
   `no_tempting_option` distinguishes explicit No from missing/reset evidence;
   new edit history also retains the previous value of this flag.

New packages and manifests carry
`response_evidence_version=accepted-response-evidence-v2`. Sealed historical
packages are not rewritten. Re-export can improve current product projections
where source turns survive, but old baseline fields and downstream historical
interpretations still require a transcript audit before research use.

## Assertions

The navigation matrix now checks research exports for every synthetic session:

- All 45 answer/confidence/alternative route combinations, including split
  alternative/explanation entry and duplicate completion requests.
- Answer-to-former-alternative reset, No after an alternative, switching an
  alternative, and retaining the choice across 12 unrelated confidence edits.
- Pause/resume at each of five micro-steps, one retained attempt, lifecycle
  event order, and rejected writes from paused/stale/cross-student contexts.
- Rejected questions/text followed by accepted uncertainty, with the rejected
  text retained as process evidence rather than a response product.
- Simultaneous same-ID requests, repeated Start, and terminal-session protection.
- New package baseline and review-edit regressions; older packages unchanged.

For each session: CSV values match persisted responses; item versions and
finalization flags agree; turns/events export once; accepted field-change rows
reconstruct revision-operation counts; completion/submission events occur once;
restricted keys remain absent in ordinary exports; server-only tests do not
invent browser visits or replace missing timing with zero. Scenario-to-session
IDs are saved in the matrix log for traceability.

The browser progression test also compares the teacher-downloadable ZIP with
database records after lost-reply retry, cancel/save, answer reset, pause/resume,
review edits and end/history. It checks one authoritative accepted retry result
with the original observation link, separately from browser request failure.
The second item explicitly inserts a synthetic legacy stuck-state record to
exercise recovery; that insertion is not claimed as browser-generated input.

## Verification

- Expanded navigation matrix: 64/64 scenarios passed. Final run artifact:
  `cmcq-navigation-audit-ynGdUA/student-navigation-matrix-test.log`.
- Complete navigation/regression runner: 20/20 suites passed, including current
  formative lifecycle, preparation, transcript and research-export checks.
  Artifact: `cmcq-navigation-audit-iAbJuL/results.json`.
- `response-stage-observation-smoke-test.ts`: timing, retries, clocks,
  visibility, missingness, revision exports and privacy passed.
- `research-process-coverage-smoke-test.ts`: 121 explicitly documented stage
  columns, calculations, conditional missingness and actor-separated coverage
  passed.
- Browser progression/research ZIP: passed all navigation and product/event
  assertions, including the accepted lost-reply outcome and original observation
  link. Artifact: `cmcq-login-progression-ZVDl3T/research-checks.json`.
- Response-stage browser: passed all six check groups; nine observed visits.
  Data coverage and the stage dictionary are in `cmcq-response-stage-DVMfej`.
- Preparation/chat browser: 10/10 checks passed, including independent worker
  completion, failed-job retry, typed-input/paste aggregates and export parity.
  Artifact: `cmcq-preparation-ux-mVFJwl`. No provider calls.
- `npm run typecheck`, `npm run lint`, production build and `git diff --check`
  passed. Lint has five existing warnings in unrelated fixtures/evaluation code.
  The initial build exhausted Node's default heap; the completed build used
  `NODE_OPTIONS=--max-old-space-size=8192`.

Artifacts are under the local temporary directory. Reproduction commands and
database safety prefixes are in the navigation audit. Also run:

```sh
node --import tsx prisma/response-stage-observation-smoke-test.ts
node --import tsx prisma/research-process-coverage-smoke-test.ts
```

The browser ZIP test downloads through the teacher's signed-in browser. Its
earlier API-client request did not send the local secure cookie; that was a test
transport issue, not a change to application authentication. Stage CSV booleans
use `1`/`0`; product CSV booleans use `true`/`false`, with blanks retained as
missing. Assertions parse those encodings explicitly.

## Changed Files

- `src/lib/services/response-packages.ts` and
  `student-assessment/response-evidence.ts`: accepted baseline/alternative
  evidence and a versioned projection.
- `src/lib/services/student-assessment/service.ts`: retain the prior explicit
  no-alternative flag in accepted edit records.
- `src/lib/services/teacher-research-data/`: current-product alternative fields,
  revision flag export, manifest version and variable definitions.
- Navigation matrix and login/progression browser test: database/export parity
  assertions for the tested scenarios.
- `DATA_LOGGING_SPEC.md` and `PROCESS_PRODUCT_ANALYTICS_GUIDE.md`: evidence
  semantics, missingness, historical limitations and CSV boolean encodings.

## Limits

These checks establish the tested synthetic paths, not completeness of every
production record or AI-generated reply. Browser exit/offline delivery remains
best effort, and observations do not establish attention or engagement. Do not
sum overlapping response, system-wait, hidden and elapsed times. Missing timing
remains missing. This is collection/export verification, not a new learning
analytics interpretation layer or classroom-scale load test.

This follow-up's changes are verified locally; it does not include a new push or
Render deployment. The earlier deployed navigation fix is a separate release.
