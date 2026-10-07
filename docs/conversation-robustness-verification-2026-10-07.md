# Conversation robustness verification

## Scope

This evaluation follows the conversational application release of 7 October 2026.
It separates workflow correctness, research-record integrity and teaching judgments.
Real provider calls use disposable local synthetic accounts and the approved model
configuration. No classroom records are used or modified. Seeded histories explicitly
describe constructed situations; they are not evidence that the production tutor
previously made the seeded mistakes.

## Problems and corrections

The preceding evaluation's three unsuccessful development attempts had different
causes: one generated learner reply was empty, and two closing/profile recommendations
violated the existing evidence contract. They were not three independent failures of
navigation. Current-turn-only learner instructions and nonempty reply validation remain
in place; the application still owns lifecycle transitions and validation.

This broader review identified three related interpretation problems. A valid complaint
that two practice options mean the same thing was overcredited as understanding of the
underlying reliability-validity distinction. In a longer dialogue, a student summary
of the tutor's proposed predictive study was credited as independently designing that
study. A closing overview also described the tutor's unanswered SEM explanation as
understanding the student had demonstrated. These examples show why a successfully
validated JSON response does not by itself establish an appropriate teaching judgment.

Host v7.15 clarifies a common boundary: evaluate the particular student contribution
in its chronological assistance context. A wording objection can be correct without
explaining the concept; a supplied study design remains supplied when paraphrased;
and an accurate clause followed by endorsement of the original error is conflicting
evidence. The same boundary applies to profile recommendations, praise and summaries.
Existing evidence observations retain qualifications without adding a separate
follow-up record or compulsory check. These are model instructions and targeted
regressions, not a deterministic semantic classifier.

A further live development journey failed before displaying a reply: its first
candidate cited pre-cutoff student evidence for changed engagement fields, and its
single repair candidate rewrote a field declared retained. The validator correctly
rejected both; the student message was preserved. Semantic-regeneration v2 now
supplies an explicit changed-field evidence whitelist computed by the very same
eligibility predicate used in validation. It distinguishes that subset from the
historical catalog and tells the model to copy retained values from the authoritative
current profile, not its invalid draft. The main instructions apply the cutoff to
all changed fields. Validation was not relaxed; no extra retry, silent field rewrite
or automatic upgrade was added. Three replays of the exact failed synthetic context
returned accepted null-transition replies. These base-call successes demonstrate
nonrecurrence in those replays, not a measured universal repair success rate.

Application guidance now starts with a meaningful decision or reasoning demand, not
cosmetic changes to names or numbers. Examples check their assumptions and all answer
options. The tutor may initiate an application, use an open question, or explain
directly. A student's help request, objection, topic change or stopping request takes
precedence. Objections are reconsidered on their merits rather than automatically
accepted. No forced coverage, teaching sequence or confidence collection was added.

A separate regression failure came from a test assumption: the dashboard fixture
expected only one student after the navigation suite had created additional synthetic
students owned by the same teacher. The corrected assertion checks both the focal
student's canonical profile and all other students' no-evidence category. Production
dashboard logic was not changed to satisfy this test.

## Test design

The original seven live scenario families cover shared difficulties, partial correction,
help before answering, missing prerequisites, sound brief reasoning with low confidence,
option/reason conflict and uncertainty, and reasonable objections with decline/end.

Seven additional live families cover tutor-initiated application, changed placement
decisions, an explicit guaranteed-interval objection, an incorrect objection demanding
agreement, recurrence after earlier progress, help/pause/exit/resume with simultaneous
same-ID requests, and a twelve-reply conversation with mixed intentions. Critical
messages are fixed so the intended edge case actually occurs; other replies are
generated from the visible transcript. Reports distinguish these two sources. The
learner generator receives no hidden profile or answer key.

Nine seeded-history probes isolate correction of the tutor's own faulty interval,
equivalent options, a false objection, hidden-instruction/unseen-answer demands,
recognition of a supplied study, contradictory self-correction, supplied reasoning
after a conflicting history, declining without new learning, and a closing summary
after an unanswered explanation. The last four were added as the broader review
exposed assistance and summary risks. Raw development runs remain available locally;
the release ledger records final outcomes and the order of corrections.

The isolated navigation audit runs 22 suites. Its navigation matrix alone exercises
65 paths, including the 45 combinations of answer A-E, three confidence levels and
three tempting-alternative paths. Other suites cover background preparation failure
and retry, stale state, attempt limits, lifecycle replay, review/edit, cross-student
access, profile provenance, exports, response timing and teacher dashboard parity.

Browser checks exercise actual initial-response controls, rejected input and retry,
refresh, explicit pause, duplicate delivery, forged outcome rejection, read-only history,
student isolation, desktop/mobile teacher views and research ZIP parity. These browser
checks use a mock provider; live AI tests use the service/database path rather than
pretending to measure browser exposure.

## Research preservation

Every completed live journey checks the sealed initial selections, reasons, confidence,
correctness, item/key snapshots and submission timestamps for exact equality. There
are still three initial responses, no new structured FollowupRounds, one completion
event, and a single preparation job after a repeated submission. Replayed messages
create no additional agent call; simultaneous replay and pause/resume are checked
separately. Research manifests verify all 43 entries and transcript parity. The
read-only research audit checks session/item joins, student evidence identity, profile
cutoffs, observation references and carried-forward confidence provenance.

Service-only missing exposure/typing measurements remain missing, rather than being
invented from server elapsed time. Browser instrumentation separately verifies its
recorded measurements. No migration, new export column, historical rewrite, model
change or production token-limit change is part of this release.

## Representative observed exchanges

The following extracts are synthetic test evidence, not classroom outcomes.

- A student said they could follow the distinction but hesitated about a different
  use. The tutor later introduced a mathematics placement-cutoff decision and asked
  what additional evidence would justify it, without requiring an explicit quiz request.
- A student objected that A and B said the same thing. The corrected probe withdrew
  the defective choice and recorded a content concern with no profile transition.
- After a tutor-supplied hiring study, a student restated its prediction and fairness
  checks. The targeted probe acknowledged the accurate content and recorded recognition
  with an assistance limitation, without resolving the misconception.
- A student said alpha .91 meant 91 percent valid and requested agreement. The tutor
  rejected that interpretation and explained the difference from diagnostic accuracy.
- A student asked for help, paused, left the assessment, returned, and requested the
  earlier explanation. The live journey retained the same attempt and transcript,
  resumed the topic, and allowed finishing without further practice.

## Verified results

The final seven-family application run completed on 7 October 2026 at 22:02:55 UTC:
7/7 journeys passed, with 106 provider dispatches including learner generation.
The final instruction and evidence-validator file hashes match the tested working
tree. The help-first case made no profile transition after the supplied answer;
the partial-correction case retained the independent SEM claim. The previous
objection/decline failure did not recur. One rejected summary candidate was repaired
successfully within the existing one-repair limit, with both candidates audited.

The additional seven-family robustness suite passed twice during development,
including twelve student replies, recurrence, exit/resume and concurrent replay.
Those earlier runs precede the final summary and retry refinements. A later targeted
pause/resume run also passed exact one-student/one-tutor turn-count assertions.
Nine final seeded teaching probes passed their contract assertions and were manually
reviewed, as were the three exact failed-context replays. These are different levels
of testing, not interchangeable independent classroom observations.

The final isolated audit passed 22/22 suites, including the 65-path navigation
matrix. An additional 30-case contract matrix, interpretation-policy checks, retry
request cutoff/scope/immutability checks, typecheck, lint and production build passed.
Lint retained five existing warnings. Desktop/mobile browser checks passed with
mock AI; screenshots were inspected. Read-only research audits passed for all
completed live journeys, including all seven final application cases. The earlier
failed journey remains marked incomplete, not silently included as a successful export.

Local reproducibility artifacts (synthetic, not classroom records):

- Final application report: `.data/ai-student-evaluation/cmcq_ai_students_cc13e0f6db2b/report.json`
- Broader robustness report: `.data/ai-student-evaluation/cmcq_ai_students_2b85dae5f224/report.json`
- Exact replay assertions: `.data/ai-student-evaluation/cmcq_ai_students_daf51d5601b3/report.json`
- Final teaching probes: `.data/conversation-teaching-probes/69485569-2f60-4234-815d-f37ff5e8e504/report.json`
- Failed-context replays: `.data/conversation-failed-replays/ed94ab73-e380-4a8c-8167-43128692a0d8/report.json`
- Preserved development failure: `.data/ai-student-evaluation/cmcq_ai_students_5727d9ae2ac2/report.json`

## Interpretation limits

These checks support the observed operational and conversational behavior, not an
exhaustive guarantee. The model can still produce verbose replies, uneven options or
overgeneralized summaries. Initial claim catalogs vary between runs. A recurring
claim outside the current catalog is retained through the existing
`uncatalogued_misconception` observation and review mechanism; it is not silently
written into the authoritative catalog. Researchers should inspect observations and
transcripts, not interpret the last validated profile as a continuously exhaustive
list of every later difficulty.

A twelve-reply trajectory is not a full thirty-turn or class-capacity load test. The
instruction refinements were made during development; broad earlier runs and final
targeted reruns are distinguished by stored source hashes rather than all being
represented as one immutable release evaluation. Classroom learning, retention,
transfer, fairness and diagnostic validity require separate empirical evidence.

## Reproduction

Use `scripts/conversation-regression-audit.mjs` for the isolated no-network regression
audit. Use `prisma/ai-student-journey-evaluation.ts --suite conversational-robustness`
or `--suite conversational-application` for the live suites. `--case` restricts a live
run to one scenario. Live runs require `--allow-live-synthetic` and an approved local
`--runtime-env` file; never commit that file. `--dry-run` lists scenarios without paid
calls. `prisma/conversation-teaching-probe.ts` uses the same explicit live opt-in.
`scripts/audit-ai-student-research.mjs` audits a completed report without database or
provider access. The fixed change-and-deployment ledger records the exact release,
verified checks, failed development checks, deployment and remaining limitations.
`prisma/conversation-failed-context-replay.ts --report <synthetic-report> --case <id>`
replays a saved synthetic semantic failure three times using the same live opt-in
and runtime arguments. It validates synthetic provenance, does not access the
classroom database and preserves the original failure artifact.
