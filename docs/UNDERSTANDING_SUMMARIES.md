# Understanding Summaries

## Scope

`understanding-summary-v1` is a read-only teacher/research projection of retained
profiles. It is not a new AI diagnosis, grade, learning-gain estimate, or claim
of psychometric validity. It does not rewrite profiles, messages, responses,
answer keys, timestamps, attempts, or original research records. Historical
exports retain their old meanings; re-exports identify this new mapping version.

The teacher dashboard, simple CSV, detailed CSV, and research dataset use the
same selector and classifier in `learning-profile-summary.ts`.

## Current Profile Selection

For each topic with a formative conversation, validate the retained transitions
using the existing canonical transition validator. Use the latest valid
transition's updated profile; without one, use the conversation's original
initial profile. Do not replace that baseline with a later integration/planning
artifact or an unlinked updated profile. For a topic without a conversation,
use its stored current-profile pointer, not the newest row by creation time.

For multi-topic sessions, the summary describes the most recently created
current topic profile. It is not a cross-topic average or a claim that all topics
are understood. Per-topic profiles and transitions remain in the research data.
Profile timestamp ties use profile ID only for stable ordering, not causal inference.

Dashboard participation still uses the latest attempt. Understanding and item
results use the latest full initial submission, excluding waived attempts, so
a new unfinished attempt does not erase prior submitted evidence. CSV session
rows describe their own attempt; comparisons must align the session IDs.

## Classification Precedence

1. Missing, fallback, intermediate, or unverified source provenance is
   **Unavailable / insufficient evidence**. A successful validated profiling or
   conversation source call is required; this is operational eligibility, not
   proof of educational validity.
2. Explicit insufficient evidence (ability or evidence sufficiency), insufficient
   evidence for a formative decision, low engagement that limits interpretation,
   or conflicting evidence is **Unavailable / insufficient evidence**. Missing
   evidence is not a demonstrated knowledge deficit.
3. A supported misconception diagnosis, or native ability classified as minimal,
   fragmented/limited, or misconception-based, is **Need more work**.
4. Native partial, fragile-correct, or procedural/application-error understanding,
   or an integrated diagnosis of uncertain independence, is **Still developing**.
5. Native `mostly_correct_understanding` or
   `robust_transfer_ready_understanding`, without the preceding conditions, is
   **Mostly understood**. A transfer test is not required to recognize supported
   understanding of the assessed content. Unknown categories remain unavailable.

An integrated `correct_but_fragile_understanding` focus alone does not override
the native understanding dimension: a student can understand most of the content
while still needing to strengthen part of their reasoning. The qualifier is
retained as `understanding_caution=reasoning_refinement_needed`. Native
`fragile_correct_understanding` still maps to Still developing. This separation
does not remove limitations or assert complete mastery.

These are categorical rules, not a calculated score or percentage-correct cutoff.
No label is promoted from correctness alone, confidence alone, time spent,
completion, a teacher explanation, or an unvalidated model reply.

## Transfer and Evidence Stage

`transfer_evidence_status=supported_by_profile` requires both the native robust
transfer ability and integrated transfer-ready diagnosis, eligible provenance,
and a Mostly understood summary. Otherwise it is `not_established`, or
`unavailable` without an eligible profile. This reports the retained model
interpretation; it is not independent proof of general transfer.

`understanding_profile_stage` distinguishes `baseline`, `updated`, and
`unavailable`. An eligible baseline can still contain insufficient/conflicting
evidence, so profile-stage counts are not the same as interpretable-label counts.
Pause, finish, or additional chat without a validated transition does not create
a reassessment. The dashboard displays baseline/updated counts separately from
its understanding distribution; percentages continue to use all eligible students.

## Research Fields

- `understanding_summary_version`: this mapping's version.
- `understanding_label`: the shared teacher/research category.
- `understanding_reason`: deterministic mapping reason or provenance limitation.
- `understanding_caution`: separately retained reasoning/independence qualifier.
- `understanding_profile_record_id`: joins the original `profile_record_id`.
- `understanding_profile_stage`: eligible baseline/updated, otherwise unavailable.
- `understanding_profile_created_at`: original profile timestamp, never export time.
- `transfer_evidence_status`: separate transfer interpretation described above.

`latest_student_safe_status` is retained as a compatibility alias of
`understanding_label`. Despite its historical name, it is not evidence of what
was displayed to a student. Actual messages/exposure records are separate.
Research dataset sessions and assessment summaries carry these additive fields.
Original V2 intermediate categories and raw profile dimensions stay unchanged;
they need not equal the current canonical summary.

The research data dictionary and simple CSV dictionary document these variables.
Simple/detailed exports advance to v3/v2 respectively. The additive research
dataset fields carry their own `understanding_summary_version`.

## Verification

- `npm run student:learning-profile-summary-smoke`: categorical rule precedence,
  positive understanding without transfer, weak/uncertain reasoning, insufficient
  evidence, unvalidated calls, fallback/intermediate profiles, and no mutation.
- `npm run student:profile-record-projection-smoke`: persisted canonical baseline
  versus newer intermediate data; shared labels and profile IDs across dashboard,
  research, simple and detailed exports; fallback and original-record preservation.
- `npm run student:teacher-dashboard-smoke`: roster denominator, attempt policy,
  lifecycle, item snapshots, ownership and profiles with explicit source provenance.

Database smoke tests must run on a disposable local database, not classroom data.

## Verification Record: 2026-09-28

Local candidate only; no push or Render deployment is claimed by this record.

- All 13 suites passed in a fresh disposable localhost database with external AI
  blocked: learning-profile summary, profile-record projection, teacher dashboard,
  attempt comparison, analysis-ready export, selected-session export, export
  integrity, process summary, readable transcript, simple CSV, detailed CSV,
  streaming export, and v18r2 pipeline runtime. The database was dropped afterward.
- Cross-surface tests compared both labels and source-profile IDs, including
  mostly-correct understanding with a fragile-reasoning qualifier, supported
  misconceptions, conflicting evidence, fallback, and later intermediate rows.
- Runtime tests checked that a canonical updated transition replaces its baseline
  in the summary. A later unlinked updated row cannot replace the baseline.
- Type checking passed. Lint passed for the changed TypeScript files. Whole-repo
  lint still reports six existing errors in ignored `.data/grant-demo-*` scripts
  and five unrelated unused-variable warnings; these files were not changed.
- A production build passed in an isolated source copy. Synthetic-account browser
  checks passed at desktop and 390-pixel phone width: evidence disclosure,
  overview/comparison navigation, label and stage counts, and no horizontal
  overflow (document width and scroll width both 390 pixels). This was not a
  classroom record or live AI evaluation.
- Two earlier test runs exposed test-maintenance issues: an overly broad text
  ban matched the new denominator explanation, and fixture cleanup omitted newly
  added source-call rows. Both were corrected and the complete suite rerun.
- Live read-only review confirmed a retained profile with native mostly-correct
  understanding and an integrated fragile-reasoning focus, without a validated
  later change. No identifiable transcript is copied into this record.
- The existing production Research dataset generator completed an all-authorized,
  non-restricted export with 11,643 rows. Browser download was invoked, but the
  browser tool did not expose the resulting file, so this record does not claim
  independent byte/checksum verification of that production archive. Local
  integrity and streaming checks passed separately. Student evidence was unchanged.

Limits: no new model calls, historical re-profiling, psychometric validation,
large-cohort load test, or production deployment occurred in this verification.

## Deployment Follow-up: 2026-09-28

After the local audit above, application commit
`007278cc9b7262c451d1edc64d5ab200f9a8a615` was pushed to `origin/main` and
deployed to the canonical Render service. Deployment
`dep-datfgrrrjlhs73bks340` reported **Deploy succeeded | Live**, with matching
runtime build metadata and both web and preparation-worker processes running.
Health returned HTTP 200, database reachable and schema ready at
`2026-09-28T23:35:12.459Z`.

Live Test 3 dashboard verification showed 9 eligible students: Need more work 1,
Still developing 0, Mostly understood 1, and unavailable 7. It displayed 2 initial
profiles and 0 updated profiles; the evidence explanation expanded correctly.
These are versioned projections of retained evidence, not newly measured learning
gains. No original student record or profile was rewritten. The production ZIP
verification limitation above remains. Full release evidence is recorded under
`CMCQ-20260928-02` in `docs/release-records/releases.json` and the existing Word
change record.
