# Profiling approval and scoped budget verification

All AI inputs were synthetic. No student attempts, responses, packages or profiles
were modified by these checks.

## Live checks

Six provider calls completed across two runs. The first run's 3-item and 12-item
planning responses passed, but its canonical profile failed the old package
consistency validator despite appropriately identifying contradictory responses.
The initial failure is retained in `first-run-validation.json` as
`checks_passed=false`; it is not counted as a passing semantic validation.

After the systemic validator correction and its offline regression, all three
calls in `validation.json` passed schema, grounding and scenario checks:

- 3-item planning: 30,000 output ceiling; 21,633 ms; 2,907 input and 1,795 output tokens.
- 12-item planning: 30,000 output ceiling; 24,169 ms; 3,864 input and 2,861 output tokens.
- Canonical v6 profiling: unchanged 4,000 ceiling; 12,011 ms; 4,439 input and 1,152 output tokens.

Models/effort were gpt-5.6-sol/medium for planning and gpt-5.6-terra/medium for
profiling, matching the current approved role settings. The tests used the
90-second production timeout. Cases distinguish false reasoning despite a correct
choice, concise accurate reasoning, admitted guessing, correct recognition,
rejection of a tempting false statement, and explicit adoption of a false statement.
The false-statement claims must cite the actual endorsing item's eligible evidence,
not the recognition or rejection items. These few calls do not establish general
pedagogical validity or availability under load.

## Local verification

- 20 scoped-budget/approval tests passed: same-student/test matching, unchanged
  defaults and role settings, duplicate-scope rejection, prompt identity, inherited
  approval verification, tampering rejection, missing-call evidence rejection,
  and preservation of the parent artifacts.
- Stance-evidence and canonical semantic-validation suites passed. A new case
  preserves a local misconception while retaining unresolved package conflict.
- Existing planning-budget amendment tests passed independently.
- Disposable-database checks passed for initial preparation, feedback failure and
  safe continuation, attempt policy, and initial-profile provider validation.
- Four research suites passed: analysis-ready export, selected-session export,
  research-export integrity, and process-data summary. Test databases were removed.
- Type checking passed; lint passed with five pre-existing warnings.
- Production build passed, generating 83 pages. The first sandboxed invocation
  was blocked at local IPC creation; the permitted retry passed. Existing Webpack
  cache serialization warnings remained.

Production activation, the student-specific effective allowance, and exact source
commit must be verified separately and recorded in the release ledger. Local
success does not by itself mean the production configuration has changed.
