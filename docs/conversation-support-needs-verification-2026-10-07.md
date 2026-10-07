# Conversation support-needs verification

## Question and scope

Does the current assessment support students who enter with several difficulties,
limited prerequisite knowledge, or a greater need for explanation? Seven new synthetic
journeys were run against the unchanged released application on 7 October 2026.
Five deliberately challenging cases were accompanied by two conceptually sound
comparison cases. These are designed stress cases, not measured achievement groups.
They do not establish that the system improves learning more for one group than another.

The tested application is `8c65218b20667e08dadd04759d3c237d80438ab9`, host instructions
v7.15. The checkout commit recorded by the runner is the subsequent documentation-only
commit `000f932c31790c407be75e2861c349bbfce6cf1e`. Application files were unchanged.
The new evaluation fixture and suite selector are test tooling only; no production
prompt, model, budget, dashboard, database schema or student record was changed.

The run used real provider calls, disposable local accounts, the actual application
services, persisted profiles, background preparation, teacher-summary construction
and research exports. It was not a browser usability study or a production load test.
All cases used the same three reliability, validity and SEM items, six student replies,
and the existing approved runtime. Critical replies were scripted; ten other replies
were generated adaptively from the student-visible conversation. The learner generator
received no hidden profile or answer key.

## Results

Run: `.data/ai-student-evaluation/cmcq_ai_students_ffa5f5406d09/report.json`.
Started 22:23:28 UTC and finished 22:36:44 UTC on 7 October 2026.
Runtime hash: `bb157af19e9bc876e077d2c2b6ea58bfaa5aa365f5d8cf7ac37709c970b2f2d4`.

- Seven of seven journeys completed their operational assertions.
- There were 101 provider dispatches: 91 application calls and 10 learner-generation calls.
- The formative transcripts contained 42 student replies and 49 tutor messages.
- No journey blocked, exceeded its token budget, or lost or duplicated an accepted turn.
- Three internal profile-integration candidates were rejected. Operational completion
  therefore does not mean that every internal AI output passed validation.
- All seven research exports passed the read-only structural/provenance audit, including
  all 43 manifest entries per session. This does not validate the meaning of every
  profile recommendation.

| Scenario | Observed behavior | Remaining concern |
| --- | --- | --- |
| Persistent prerequisite confusion | Changed examples, supplied a requested worked example, retained unresolved understanding, and provided specific teacher-help topics on exit. | Some explanations became dense despite continuing confusion; an internal integration draft was rejected. |
| Partial progress with multiple difficulties | Respected the requested hiring topic and retained the separate SEM difficulty. | A later summary promoted previously assisted recognition into two resolved claims; internal integration draft rejected. |
| Guessing and polite agreement | Did not turn correct guesses, agreement or an option-only reply into demonstrated understanding. Accepted direct-help and stopping requests. | Occasionally inferred an ambiguous referent, although it qualified that inference. |
| Confident persistent error | Challenged the misconception respectfully, reconsidered a relevant objection, and retained uncertainty when the student stopped. | Some replies were long; one successful six-reply case does not demonstrate sustained adaptation. |
| Overwhelmed student, pause and return | Gave two short sentences when requested, responded supportively, and preserved the same attempt through pause/exit/resume and duplicate delivery. | Internal integration draft rejected. Synthetic pause durations are not human experience measurements. |
| Brief English, sound reasoning, low confidence | Teacher summary was Mostly understood; no forced elaborate writing or follow-up confidence collection. | Opening practice question had an answer-length cue; a later recap omitted a help qualification without making a profile upgrade. |
| Strong prior reasoning | Teacher summary was Mostly understood; discussion moved to meaningful boundary conditions rather than compulsory basic remediation. | A narrow new application is not proof of broad or durable transfer. |

The final teacher-summary categories were, in the table order: Need more work,
Still developing, Unavailable / insufficient evidence, Need more work, Need more work,
Mostly understood, and Mostly understood. These differences were largely constructed
by the initial reasoning and scenario scripts. They are not treatment-effect estimates.
Engagement remained adequate in all seven cases; uncertainty and stopping were not
automatically treated as poor motivation.

## Findings requiring attention

### 1. Assistance qualifications can be lost in later conclusions

In `partial_progress_many_difficulties`, earlier tutor outputs explicitly recorded
`recognition_with_support_limitation` and `supported_recognition`. At closing, two
reliability-validity claims were marked resolved using the same student evidence IDs,
without a new contribution that went beyond the supplied explanation. The separate
SEM claim remained unresolved. The resulting teacher category was Still developing,
not global mastery, but the claim-level conclusion and student recap were stronger
than the preceding evidence qualification supported.

An accurate restatement after help is useful evidence of uptake. The problem is not
that such a student receives credit, but that its assistance context disappears.
The student-facing wording should acknowledge the particular idea expressed without
silently converting supported recognition into independently demonstrated resolution.

The closing request included the visible transcript, but not the earlier structured
recognition observations. Its memory was null, intervention history was empty, and
profile history contained only the initial profile. Inspection of
`src/lib/services/student-assessment/formative-conversation/context.ts` confirms that
the transcript projection carries text rather than these per-turn qualifications.
Existing host instructions already prohibit resolving claims from supplied reasoning.
Missing explicit carry-forward of qualifications is a plausible contributing mechanism,
not an experimentally isolated sole cause.

Recommended correction: carry a compact, evidence-linked assistance history into later
interpretations and closing summaries. A later stronger claim should identify the new
supporting contribution, or explicitly justify reconsideration of the earlier reading.
Keep the evidence and qualification available to human review. Do not impose an
independent test as a condition of receiving help or ending the conversation, and do not
substitute a lexical-copy detector for interpretation of the exchange.

### 2. Low-confidence integration contract mismatch

Three cases with identical initial wrong options and explicit wrong reasons, all with
low confidence, produced `insufficient_misconception_alignment` in
`profile_integration_agent`. The confident-error case used those same options and
reasons with high confidence and did not encounter this rejection.

The implementation explains the immediate mismatch:

- `classifyAbilitySignal` in `ability-evidence.ts` classifies a wrong diagnostic
  distractor with low confidence as `knowledge_gap` in this branch.
- `alignedMisconceptionEvidenceCount` in `profile-integration.ts` counts only items
  categorized as `misconception_signal`, with aligned misconception metadata.
- The AI read the explicit reasoning and proposed `likely_misconception`, but the
  validator requires at least two items in that counted category. All three were
  `knowledge_gap`, so the candidate was rejected.

The rejected draft was retained as invalid with a null validated output; the existing
conservative integration fallback allowed preparation to continue. Canonical initial
profiling and the subsequent conversation remained available. This was not a provider
outage, a student-facing dead end, or evidence of poorer learning by a group.

Recommended correction: reconcile the feature definitions, model contract and validator
so that confidence qualifies the strength of an interpretation without erasing explicit
reasoning evidence. Evaluate both confidence conditions, guessing, contradictory reasons
and sparse evidence. Do not simply remove the validator or count a rejected candidate
as validated research evidence. A controlled confidence contrast suggests where to
investigate; it does not establish population-level differential validity.

### 3. Implicit support needs receive less consistent pacing than explicit requests

The explicit request for two short sentences received 21 words. On returning after a
pause, the student received a 36-word reminder. By contrast, persistent confusion led
to explanations of 199, 275 and 228 words, including ancillary validity sources and
interval detail. A fully worked example was requested, so length alone is not a defect.
These observations identify density and sequencing concerns; word count is not a
measurement of cognitive load, engagement or learning.

Recommended correction: respond to the observed difficulty with one manageable concept
or concrete contrast, provide a worked example when useful, and invite clarification
or optional application. Increase challenge when the student contribution supports it.
Use a flexible teaching policy, not a rigid explain-practice-review sequence, fixed
ability track, or universal word limit. Requests to pause, decline or stop remain valid.

### 4. Generated application choices can cue the answer

In the brief-language control, the correct opening practice option was substantially
longer and more qualified than its alternatives. The context also closely resembled
the preceding reliability-validity distinction. This weakens its use as evidence of
independent application. The tutor later supplied the answer and correctly recorded
the immediate response as recognition with support, but the closing description lost
that qualification.

Recommended correction: check plausibility and balance of generated alternatives, use
reviewed examples where available, and permit ordinary open conversation. An option
selection alone is not sufficient to establish independent reasoning or broad transfer.

## Representative synthetic exchanges

These extracts are from test accounts, not classroom participants. Observed tutor
actions below are paraphrases unless quotation marks are used.

1. Student: "I keep mixing up consistent and correct. Could you show one fully worked
   example instead of asking me to solve something?" The tutor provided an example;
   after further uncertainty and a stopping request it retained unresolved understanding
   and suggested specific questions for the teacher. No mastery transition occurred.
2. Student: "The hiring score could keep measuring reading skill instead of job skill.
   We need to compare it with relevant job performance. But I still think subtracting
   SEM gives the exact true score." The tutor separated the two issues. Earlier
   assistance-aware observations were appropriate, but the final resolution of the
   related reliability-validity claims was too strong for the recorded support context.
3. Student: "I do not actually understand that yet. I was just agreeing with you."
   The tutor continued with explanation and did not upgrade the profile.
4. Student: "I need a break. I want to pause, not start a new attempt." Pause and
   return retained the attempt and conversation. The student could finish without
   accepting another practice question.
5. Brief initial reasoning: "Same scores can be wrong skill. Need job evidence."
   The sound reasoning was recognized despite short English and low confidence.

## Research-data verification

The runner checked exact preservation of all sealed initial selections, reasons,
confidence, scoring references, snapshots and submission records. It asserted turn
counts, replay behavior, completion, and the absence of new structured FollowupRounds.
The read-only export audit verified joins, transcript parity, evidence identities,
profile cutoffs and provenance references for all seven cases. The pause case exported
both learning-conversation and assessment pause/resume scopes. Its immediate synthetic
pauses were 97 ms and 13 ms; these test lifecycle recording, not meaningful break length.

Browser exposure, typing and other unavailable service-only measures remained missing.
They were not replaced with server latency or invented zeros. Rejected internal drafts
remained identifiable as rejected. Export correctness means that observed outputs and
their provenance were preserved; it does not make a questionable profile conclusion
educationally valid.

## A defensible comparison in the classroom

Use independently measured prior knowledge, preferably continuously rather than a
permanent high/low label. Do not define the comparison groups using the same AI profile
whose validity is being evaluated. Keep content and opportunity to participate comparable.

Separate the following outcomes:

- Operational reliability: blocked exchanges, retries and latency per session and per
  accepted turn. Longer conversations create more opportunities for a failure.
- Teaching quality: blinded human ratings of conceptual correctness, responsive help,
  explanation density, treatment of objections, and assistance-aware summaries.
- Diagnostic interpretation: agreement and disagreements with independent evidence-based
  human judgments, including false resolution and missed understanding.
- Learning: independently answered new items and, where feasible, later retention,
  accounting for baseline knowledge. Completion and the latest AI label are not learning
  gains by themselves.
- Experience: student feedback about helpfulness, effort and reasons for stopping.
  Logs can locate pauses and exits but cannot establish that students disliked the tutor.

Current logs support the process and technical parts of this comparison. Human ratings,
independent outcome tasks and experience reports need a study design and collection.
The synthetic cases provide reproducible stress tests, not a model of human learning or
evidence of treatment effectiveness. Three cases intentionally reuse one initial response
condition, and scripted later messages partly determine their learning trajectories.

The design rationale is consistent with the IES practice guide's recommendations to
interleave worked examples with problem solving and connect concrete and abstract
representations. This supports the proposed support strategy, not an efficacy claim
about this application: [Organizing Instruction and Study to Improve Student Learning](https://ies.ed.gov/ncee/wwc/PracticeGuide/1).

## Reproduction and change status

New fixture: `src/lib/evaluation/conversational-support-needs-scenarios.ts`.
Suite selector: `prisma/ai-student-journey-evaluation.ts`.

```sh
node --import tsx prisma/ai-student-journey-evaluation.ts --suite conversational-support-needs
node --import tsx prisma/ai-student-journey-evaluation.ts --suite conversational-support-needs --allow-live-synthetic --runtime-env <approved-private-runtime-file>
node scripts/audit-ai-student-research.mjs .data/ai-student-evaluation/cmcq_ai_students_ffa5f5406d09/report.json
npm run typecheck
npx eslint prisma/ai-student-journey-evaluation.ts src/lib/evaluation/conversational-support-needs-scenarios.ts
git diff --check
```

Dry run, fixture structural assertions, typecheck, focused lint and whitespace checks
passed. The first typecheck caught a fixture type annotation requiring omitted scenario
identity fields; it was corrected before the final passing check. Scenario content and
the recorded scenario hash were unchanged by that type-only correction.

This review adds reusable tests and records actual outcomes. The four concerns above
are identified follow-up work, not deployed fixes. No new application deployment is
claimed, and no classroom account or historical record was modified.
