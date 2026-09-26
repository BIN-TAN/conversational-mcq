# Classroom Acceptance Evaluation: 25 September 2026

## Decision

**Not cleared for high-stakes use.** This is a development evaluation, not an
independent validity study, institutional approval, or a guarantee of zero bugs.
The intended consequential use and responsible independent reviewers are still
unconfirmed. No production student records were changed; no release, push, or
Render deployment was performed for this work.

## Implemented

- A repeatable local acceptance runner combines the current classroom regression
  suite, navigation branches, production build, real-browser workflows and
  research-file reconciliation. It uses disposable local databases, blocks
  external test traffic and records command results and source hashes.
- An evidence checklist separates engineering, diagnosis, pedagogy and
  intended-use validity. Missing or stale evidence, incorrect evidence types,
  changed artifacts, missing frozen criteria and unresolved critical findings
  block readiness. Even a complete packet requires an accountable human decision.
  This is a local checklist, not an enforced production deployment permission.
- The legacy pedagogical evaluator no longer awards positive quality scores for
  keyword presence, answer length, linked replies or simulated learning. These
  dimensions require independent review. Mechanically detected failures remain
  visible and cannot be averaged away.
- Semantic item review rejects duplicate or blank source item identifiers, which
  otherwise could make source-to-diagnosis matching ambiguous.
- Initial diagnosis distinguishes a correct conceptual inference from merely
  repeating a supplied fact. The initial-profile prompt is v3, semantic review
  records are v2, and legacy post-package summaries are v2. Old stored records
  and historical messages are not rewritten.
- Initial feedback uses complete validated messages. Legacy presentation no
  longer clips messages or appends generic praise inferred from keywords. The
  prompt leaves room below length limits; obvious unfinished endings follow the
  existing repair/failure path. This mechanical check is not a grammar or truth
  assessment.
- Fixed an obsolete logging-test roster association and duplicate network-guard
  setup in the test harness. Production ownership protection was not weakened.

## Evidence and Corrections

| Stage | Actual finding | Disposition |
| --- | --- | --- |
| Initial engineering run | 55/57 classroom tests passed; logging fixture lacked teacher association and one browser-starting test inherited a duplicate network import. Navigation, build and three browser scripts passed. | Failures retained; fixture and harness repaired. |
| Intermediate engineering run | 57/57 classroom tests, navigation, build and browser checks passed. | Valid for that source hash, before the later feedback fix. |
| Initial live probe | Four requests, 12 cases each; 47/48 label/count checks passed. One false inference was labelled partial because it repeated a true given fact. | General reasoning criterion clarified; expectations not widened to make this case pass. |
| Probe after diagnostic-rule change | 48/48 label/count checks passed, but reading the outputs identified two incomplete student messages at the 350-character boundary. | Not accepted as complete quality success. Added production message validation to the probe and fixed prompt/presentation behavior. |
| Final live probe | Four requests; 48/48 label/count checks, 4/4 provenance checks and 4/4 production student-message checks passed. | Development regression evidence only; substantive independent review remains pending. |
| Final engineering run | Typecheck, lint, 57/57 classroom tests, 20/20 navigation suites (including 64 navigation-matrix scenarios), production build and all three browser scripts passed. The source hash remained unchanged. | Final local engineering evidence retained. Live pedagogical and intended-use validation are separate. |

The same 12 synthetic cases were repeated in forward/reversed order twice per
probe. There were three probe runs and 12 logical AI requests in total. The final
48 checks are **not 48 independent students or 48 distinct cases**. Expectations
were developer-proposed. These development cases are not an untouched held-out
validation set. The probe used `gpt-5.6-sol`, medium reasoning, and an 8,000-token
output ceiling per request. Its named-model configuration does not establish
that the deployed Render configuration is identical.

The live probe covers initial diagnostic planning and its student messages, not
a complete multi-turn live formative-conversation study. Counting extracted
claims cannot prove that every proposition or eventual instructional response is
substantively correct. Model outputs and reference cases are retained for review.

## Research Data

No existing responses, histories, profiles, scores or research exports were
retroactively changed. New diagnostic records carry a new semantic review
version. Do not silently pool old and new diagnoses as if the interpretation rule
had not changed. Source response identities remain exact; ambiguous packages are
rejected rather than silently merged.

Engineering checks include persisted item progression, profile/source linkage,
response timing and revision observations, client-event deduplication, server
outcome protection, pause/reload behavior, student isolation, and agreement among
teacher views, database records and downloaded research files. Passing selected
scenarios does not demonstrate complete capture for every browser, interruption,
device or deployment. Missing observations must remain missing, not become zero.

## Still Required Before Consequential Use

1. Define the precise decision: course marks, pass/fail, qualification or another
   use; freeze content, target population, accommodations, scoring, attempt and
   appeal policies. Post-feedback retries are not independent baseline measures.
2. Have qualified independent reviewers assess item coverage, answer keys,
   diagnoses and actual tutoring responses. Preserve individual ratings and
   disagreements before adjudication; review false-positive diagnoses, missed
   claims and unsupported resolution separately.
3. Evaluate the complete live formative flow against independently reviewed,
   held-out cases, including partial corrections, unresolved multiple claims,
   voluntary exit and maximum-turn closure, using the intended configuration.
4. Conduct representative student pilots for response processes, usability,
   accessibility, fairness and consequences; obtain score/decision precision
   evidence appropriate to the intended use and assessment length.
5. Test classroom-scale browser and provider load and recovery in a representative
   environment. Existing reservation-concurrency checks are not a full classroom
   load trial.
6. Collect independent outcome/transfer evidence for any learning-effectiveness
   claim. Tutor-generated profile improvements alone cannot establish learning.
7. Obtain accountable human approval, with manual fallback, appeals, monitoring
   and rollback. No automated pass in this package grants that approval.

## Reproduction and Retained Files

- Protocol and calculations: `docs/CLASSROOM_ACCEPTANCE.md`.
- Blank independent review record: `docs/acceptance/reviewer-template.json`.
- Engineering: `npm run classroom:acceptance` (local PostgreSQL required).
- Gate regression: `npm run classroom:acceptance:smoke`.
- Bounded live probe: `RUN_ASSESSMENT_QUALITY_CANARY=true ASSESSMENT_QUALITY_MODEL=<model> npm run classroom:assessment-quality`.
- Evidence checker: `npm run classroom:acceptance:check -- packet.json current-identity.json evidence-directory`.

This directory retains `engineering-initial.json`,
`engineering-intermediate.json`, `engineering-final.json`, `ai-initial.json`,
`ai-diagnostic-rule.json`, `ai-final.json` and `reference-cases.json`. Raw local logs are copied
to `.data/classroom-acceptance-2026-09-25/`; that local working directory is not
version-controlled. Reports contain log hashes for reconciliation. No real
student transcripts or credentials are included in the retained review packet.

The engineering report's `source_commit` is the base Git commit, not a claim that
the tested working-tree changes have been committed. `source_sha256` identifies
the tested source content, and `source_unchanged` must be true at completion.

Final browser checks verified first-login teacher routing; saved-response retry,
edit, pause/resume and read-only review; nine recorded response-stage visits;
desktop/mobile teacher data views against the database and research ZIP; typing
and paste aggregates without raw input text; asynchronous initial preparation,
reload, temporary connection recovery, retry and worker startup/shutdown. The
preparation browser script passed all 10 checks. No live AI was used in these
browser scenarios. Desktop screenshots were inspected; mobile layout checks
were also asserted by the browser scripts.
