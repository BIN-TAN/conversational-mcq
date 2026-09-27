# Initial feedback and instructional boundary release verification

All retained test records are synthetic. No identifiable student transcript is
included. Production deployment and any separate technical recovery are recorded
in the change/deployment ledger, not inferred from these local results.

## Verification

- Full classroom acceptance run passed: 62 classroom suites, 20 navigation
  suites, type checking, lint, production build, and three browser suites.
  The navigation suite includes the 65-scenario matrix; counts overlap and
  should not be summed as independent experiments. See `engineering/`.
- After that run, the safe incomplete reason was additionally persisted to the
  existing dedicated AgentCall column. Type checking, lint, production build,
  and all four constrained-memory test groups were rerun on that final change.
- The final constrained-memory run passed initial preparation, initial profile
  validation, persisted audit metadata, and streaming research export with a
  96 MiB old-space / 4 MiB semi-space setting. See `low-memory-final/`.
- One intermediate provider-boundary rerun timed out after the first successful
  recovery assertion. Its evidence is retained in `low-memory-timeout/`. A fresh
  isolated rerun passed in approximately 40 seconds. The cause of that local
  timeout was not established; it is not reported as a production failure or
  erased from the record. `low-memory/` is the earlier passing run.
- Planning-only approval checks passed: exact 3,000 to 10,000 change, inherited
  approval verification, unchanged active configuration during staging, and
  rejection of model changes, other role budgets, excessive budgets, absent
  authorization, invented semantic review, and tampered parent/canary evidence.
- The broader historical activation fixture fails because its student-profiling
  prompt version/hash/schema metadata are stale. The unchanged HEAD test
  reproduces those same three errors. Its assertions were not weakened; the
  focused `--planning-budget-only` checks run independently of that later check.
- Lint has zero errors and five pre-existing warnings. Final production build
  generated 83 pages, with existing unused-import and Webpack cache warnings.
- `git diff --check` passed.

## Real provider checks

Six two-turn scenarios produced 12 accepted responses, all 72 frozen mechanical
checks passing. Fourteen provider calls were needed: two candidates were rejected
by the evidence/retained-field validators and regenerated successfully. Replay
confirmed the same 12 acceptances, two rejections, and visible message chain.
Host version is v7.9. Actual generated replies and their provenance are retained
in `dialogues/`. Agent inspection found the previously problematic reliability
example now explicitly stipulates an appropriate study; it no longer infers
population reliability from one person's score pair. This is not independent
human review or a validated semantic accuracy rate.

The initial planning budget canaries are retained in the preceding
`2026-09-26/post-deployment-simulation/` record. A 12-item response exhausted
3,000 tokens and passed at 10,000; a three-item response passed both. These are
small capacity checks, not a universal bound or replay of a student's answers.

## Limits

These tests do not establish full classroom concurrency, absence of every AI
error, instructional effectiveness, or high-stakes assessment validity. The
larger budget changes capacity, not validation criteria. Research records remain
raw observations and versioned model interpretations, not proof of learning.
