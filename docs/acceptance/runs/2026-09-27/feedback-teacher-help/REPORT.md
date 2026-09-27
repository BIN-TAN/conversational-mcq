# Teacher help after feedback failure

This correction removes the failure-panel End attempt button and hides the
ordinary header end control while initial preparation has failed. Students can
retry when safe, contact their teacher, or pause and return to the same attempt.
Source-integrity conflicts recommend teacher help without an unsafe retry.
The guidance does not send an email or claim that a teacher has been notified.

No backend lifecycle, token allowance, provider configuration, schema, stored
answers, historical events or research derivations changed. The retired bypass
still returns authenticated HTTP 410. The normal confirmed end action elsewhere
and its historical research records remain supported; failure alone never ends
an attempt.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: zero errors; five existing unrelated warnings.
- `npm run build`: passed, 83 static pages, existing Webpack cache warnings.
  The first sandboxed invocation could not create its required local IPC pipe;
  the authorized rerun passed. Render memory settings were not changed.
- `scripts/initial-preparation-ux-smoke.mjs`: all 12 groups passed on an isolated
  temporary local database, using the existing test runner with `--browser`.
  External AI calls were blocked, and the database was removed afterward.
  `preparation-browser.log` and `runner-report.json` preserve actual results.
- The production-build browser test covered transient failure retry, token-limit
  help, source-conflict help without retry, absence of both end controls, retired
  API 401/410, refresh, pause/resume, and unchanged saved response/package records.
  Resume preserved session ID, attempt number, one total attempt and zero
  termination/skip events. It also retained the existing worker, connection
  recovery, and typing/paste aggregate database/research-CSV checks.
- Desktop 1440 px and mobile 390/320 px had no horizontal overflow. Desktop and
  320 px failure screenshots were visually inspected. Local acknowledgement was
  129 ms; this is not a production latency guarantee.
- `git diff --check`: passed for source and documentation. Raw log trailing
  blank lines are retained for hash fidelity.

This UI correction was not a new pedagogical or full-classroom load evaluation.
The 30,000 initial-feedback output ceiling remains active under the prior approval;
no new live AI calls or real student record changes were necessary. Exact push
and deployment evidence are appended to the release ledger after verification.
