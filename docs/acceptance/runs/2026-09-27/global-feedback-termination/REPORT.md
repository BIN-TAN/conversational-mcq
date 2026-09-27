# Shared initial feedback allowance and termination verification

Application: `3e7a8e5a34d0cd41202b1acd2f9ecc4b1d21cb66`.

The 30,000 output-token ceiling now applies to initial feedback for all students
and assessments. It is not a total session allowance or a change to later
conversation and canonical profiling limits. The existing approval chain is
preserved by a new operator-authorized amendment; no independent pedagogical
review is claimed. Global and individual grants cannot be combined.

## Behavior and evidence

- Failed preparation offers retry or confirmed End attempt. Cancellation leaves
  the attempt active; confirmation ends the whole attempt without another topic.
- The retired authenticated continuation endpoint returns 410 with no mutation.
- Submitted responses, response packages and failed AI calls remain intact.
  No completion timestamp, profile or learning gain is fabricated.
- Research exports distinguish technical termination from successful completion
  and from historical activity skipping. Existing review reasons are preserved.
- Retry/end races, repeated end calls, ownership and source conflicts are covered.

## Verification

The bundled Node runtime executed the existing isolated-database runner with
default, `--research` and `--browser` modes. Each created and removed its own
temporary local database. These suites made no external AI calls. Logs in this
directory are the actual synthetic outputs; trailing blank lines are retained.

| Check | Result |
| --- | --- |
| profiling-repair-smoke-test | 46 checks passed |
| initial-feedback-failure-smoke-test | 7 groups passed, 96 MiB heap |
| initial-preparation-smoke-test | 17 groups passed, 96 MiB heap |
| student-attempt-policy-smoke-test | 12 groups passed |
| provider-validation --initial-profile-only | Passed, 96 MiB heap |
| analysis-ready / selected-session / integrity / process-summary exports | All 4 suites passed |
| initial-preparation-ux-smoke browser integration | All 11 groups passed |
| npm run typecheck | Passed |
| npm run lint | Zero errors; 5 existing unrelated warnings remain |
| changed-file lint | Zero errors or warnings |
| npm run build | Passed; 83 static pages |

Local browser submission acknowledgement was 167 ms, not a production latency
guarantee. The browser verified persisted typing/paste aggregates and research
CSV without raw draft text, refresh, connection recovery, supervised preparation,
retry, retired endpoint, confirmed termination and stable reload. Desktop 1440 px
and mobile 390/320 px had no horizontal overflow; rendered failure screens were
visually inspected. Production build retained existing Webpack cache warnings.

Three live provider calls used synthetic content only, through
`RUN_PROFILING_REPAIR_CANARY=true node --import tsx prisma/profiling-repair-live-canary.ts`.
All passed schema, citation and scenario assertions. `validation.json` retains
configuration, prompt identities, regression hashes and usage:

| Role and scenario | Ceiling | Actual output tokens | Latency |
| --- | ---: | ---: | ---: |
| Initial feedback, 3 items | 30000 | 1572 | 21.564 s |
| Initial feedback, 12 items | 30000 | 3481 | 32.426 s |
| Canonical v6 profile, 3 items | 4000 unchanged | 1139 | 11.530 s |

The ceiling does not force that much output. More capacity cannot guarantee
completion within the unchanged 90-second timeout or avoid provider outages.
No production student session was reset, ended or answered during verification.
Full classroom concurrency and independent pedagogical effectiveness were not
re-evaluated. Exact push, deployment and active approval evidence are recorded
in the release ledger and Word record, separately from these local tests.
