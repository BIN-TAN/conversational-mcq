# Attempts and Classroom Comparisons

## Teacher Workflow

The dashboard keeps **Overview** as its default. **Compare attempts** shows four
columns: Attempt 1, Attempt 2, Attempt 3, and Latest submitted. Teachers can compare
all participants or the same students for a selected pair (1 to 2, 2 to 3, 1 to 3,
or first to latest). A learning-objective filter and an optional submitted-all-three
filter narrow the view. Item wording, answer distributions, confidence and matched
answer/confidence changes are expandable rather than filling the initial screen.

Participation uses the latest session status. Overview results use the latest
complete initial submission, even if its tutoring is unfinished. A subsequent
unfinished attempt does not replace that submission. Profile-derived overview
categories still describe the chosen attempt's recorded profile; they are not
new AI judgments or necessarily the student's pre-feedback understanding.

## Chances and Exceptions

- Three optional chances are allowed per mini-test family, not scheduled tests.
- A successful new session consumes one chance, including an early voluntary exit.
- Refresh, resume, duplicate starts, submission retry and provider retry do not.
- A corrected version shares the allowance, but original version-specific attempt
  numbers and research records are not rewritten or silently joined across tests.
- A teacher can restore a chance on a terminal attempt for a documented technical
  problem. Repeating that action does not restore a second chance. The waived
  attempt stays in research exports but is excluded from default comparisons.
- A replacement has a new original attempt number, potentially 4 or higher. It
  appears in Latest submitted; an original waived attempt leaves its numbered
  column empty. Do not renumber or treat a waived attempt as ordinary practice.
- Existing histories over three remain intact. Remaining chances are zero until
  fewer than three non-waived chances remain. The migration grants no reset.
- Deleting session evidence does not replenish the allowance. The small ledger
  retains usage metadata without response content. Account deletion removes it.
- Students see at most three recent terminal attempts; research retains all
  non-deleted attempts. This feature performs no automatic evidence deletion.

## Comparison Rules

`attempt-comparison-v1` selects the earliest sealed initial package for every
required topic. Expected initial item counts must match unique response counts;
when recorded, completed counts must also match. An incomplete or missing package
does not count as a full submission. Missing original choice/confidence remains
blank rather than inferred from the final response. Explicitly skipped evidence
may be blank within a valid submitted package.

The final submitted answer, confidence and reasoning are the values just before
feedback in that attempt. First recorded values within the same attempt are kept
separately. Post-feedback changes remain in existing item/event datasets.

All-participant columns can contain different students. Same-student columns
restrict the cohort to students with both endpoints of the selected pair; other
columns can still have missing submissions. The optional all-three filter further
requires submitted original attempts 1, 2 and 3. First-to-latest requires an actual
attempt 1 and a distinct later full submission; a single attempt is not a zero gain.
Latest means latest at the displayed/exported snapshot, not a known final attempt.

Correct response percentages use scored responses, not enrolled students.
High-confidence incorrect counts use scored responses with recorded confidence
as denominator. Missing/partial submissions and unscored responses are not zeros.
Counts and denominators appear together. Item comparisons require the same item
ID, version, wording, options, media and scoring key. Changed keys are checked
privately, not encoded in public fingerprints. Unknown snapshots never match
across sessions. Each excluded item pair is counted. Content corrections are not
silently interpreted as learning changes.

The dashboard uses the active teacher roster, or participants when no roster is
available. Export summaries use students with sessions in the selected export
scope, not an invented enrolled denominator. The same selection rules are shared,
but denominators differ by explicitly documented scope. Corrected assessment
versions remain separately selectable/exported; family ID links them for research.

## Research Files

The existing analysis-ready ZIP contains:

- `attempt_records.csv`: every selected session, including incomplete, waived and
  historical attempts over three, with original identifiers and policy metadata.
- `attempt_submission_items.csv`: first recorded and final pre-feedback values,
  original snapshot version, objective, and submission time.
- `attempt_paired_changes.csv`: student-matched, item-matched endpoints for all
  four comparisons, including choice, confidence, reasoning and elapsed time.
- `attempt_class_summaries.csv`: class distributions for each attempt view.
- `attempt_data_dictionary.csv` and `attempt_comparison_notes.txt`: definitions,
  scope, missingness, restrictions and interpretation.

All rows include a calculation version, export scope and database snapshot time.
Files are included in the existing hash/row-count manifest. Student identifiers
use the existing stable pseudonyms. Standard exports omit correctness and derived
correctness changes/rates; these require restricted export authorization.
Original packages, raw process events and all other existing datasets are retained.
Comparison rows are derived views, not additional observations to count alongside
the same source responses. Partial/session exports cannot establish a full history.

Retesting is self-selected and may follow different amounts of feedback/practice.
Matched changes describe recorded change, not a causal tutor effect or independent
evidence of transfer. A three-chance policy improves manageability, not randomization.

## Local Verification

- `node --import tsx prisma/attempt-comparison-smoke-test.ts`
- `node --import ./scripts/classroom-audit-network-guard.mjs --import tsx prisma/attempt-policy-database-smoke-test.ts`
- `node --import tsx scripts/attempt-comparison-ux-smoke.mjs`

Database/browser tests require an explicitly selected localhost
`conversational_mcq_classroom_audit_*` database and `LLM_LIVE_CALLS_ENABLED=false`.
Production requires the new migration before serving the updated application.
