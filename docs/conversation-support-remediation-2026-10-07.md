# Support-sensitive conversation remediation

## Implemented scope

This follow-up addresses the four concerns recorded in
`conversation-support-needs-verification-2026-10-07.md`. It preserves ordinary
conversation, initial-assessment records and application-owned transitions. It
does not add compulsory practice, a confidence recheck, a learner track, or a
requirement to resolve every difficulty before finishing.

Host v7.16 narrows explanations when confusion persists, permits a changed
representation or worked example, and asks for more comparable generated options.
These are teaching instructions, not fixed word limits or a predetermined sequence.
Students can request an answer, decline practice, change topic, pause or finish.

Earlier accepted recognition qualifications now enter subsequent requests as a
compact `conversation-assistance-history-v1` projection. Only the same conversation's
validated calls, displayed tutor turns and earlier student evidence are eligible.
Interpretation policy v4 rejects a resolved claim supported exclusively by previously
recognition-qualified evidence without a current, explicitly justified reconsideration.
New substantive evidence remains eligible. The original observation is retained;
neither a new citation nor a reconsideration label alone establishes understanding.

Profile integration prompt v2 receives the eligibility count used by its unchanged
validator. It no longer has to infer that count from raw match totals. An alignment
rejection may use the existing single repair. The underlying legacy classifier is
not redefined: its low-confidence `knowledge_gap` signal is not proof that a
misconception is absent. The separate canonical profiler still receives response
evidence. No invalid integration output is accepted or silently relabelled.

One new development concern was that candid guessing and brief explanations became
low engagement. The canonical input now includes
`participation-evidence-constraints-v1`: knowledge/expression limits do not alone
justify low engagement, and a participation inference needs its own evidence and
alternative explanations. Missing process evidence remains distinct from inadequate
participation. The exact approved canonical prompt v6 and runtime are retained.

## Test design and provenance

The seven-case suite contains five support-needs stress cases and two sound-reasoning
comparisons. These are constructed conditions, not measured achievement groups.
Each uses three initial items and six subsequent student messages. Critical replies
are scripted; other replies are generated from the visible conversation only.
Real tutor/provider calls run through isolated local application services, background
preparation, persistence, teacher-summary construction and research export.

Three additional seeded-history probes target closing after assisted recognition,
persistent confusion without another quiz, and a naturally introduced application.
The supplied tutor history is a constructed stimulus, not a claim that a live tutor
previously produced that exact history. All three returned accepted outputs in three
dispatches; their actual messages and evidence observations were reviewed.

The first remediation run, `cmcq_ai_students_466d3c90ddd1`, completed 7/7 journeys
in 101 dispatches. Its 91 application calls contained no rejected outputs. All seven
43-entry research manifests passed the independent read-only audit. Partial progress
no longer resolved the earlier assisted claims; the separate SEM issue remained open.
Both sound-reasoning comparisons received Mostly understood. This run also exposed
the new engagement interpretation concern and therefore predates its input constraint.

A development attempt changed the canonical prompt to v7 without a matching approval.
The guard correctly prevented that profiling call, but the existing workflow used its
conservative fallback. The synthetic runner initially counted workflow completion as
successful profiling. The run `cmcq_ai_students_f5c0b63f70ea` was stopped after 46
dispatches and is not release evidence. The unapproved prompt change was withdrawn.
The runner now requires exactly one succeeded, validated live canonical profiling call
after preparation, preventing silent fallback from satisfying that check.

The subsequent seven-case run, `cmcq_ai_students_a84e562fd8ff`, finished at
2026-10-07T23:16:20Z with 101 dispatches and seven validated live initial profiles.
All journeys and independent 43-entry export audits passed. Its 91 application calls
had no failed/rejected call records or semantic repairs. Actual exchanges and evidence
observations were reviewed, not just the completion status.

| Constructed condition | Observed behavior |
| --- | --- |
| Persistent prerequisite confusion | Changed examples and provided requested worked explanations; retained unresolved reliability/validity and SEM issues. Some replies remained lengthy. |
| Partial progress with another difficulty | Focused on hiring, connected wellbeing when requested, and deferred SEM. No profile upgrade from the assisted closing summary. |
| Guessing and agreement | Recorded adequate participation but insufficient understanding; did not upgrade on agreement or force practice. |
| Confident persistent error | Retained misconceptions, answered objections and accepted stopping. Review exposed one incorrect attribution described below. |
| Overload and pause/return | Honored two-sentence help, no-question requests, pause and return in the same attempt; no understanding upgrade. |
| Brief English with sound reasoning | Mostly understood; credited a substantive population-specific explanation without treating short language as poor engagement. |
| Strong prior reasoning | Mostly understood; discussed limits and changed uses, with supported rather than broad independent-transfer interpretations. |

This run exposed one additional semantic error: the tutor said the student was right
and attributed the opposite of the student's expressed claim to them. No profile
upgrade resulted, but the feedback was misleading. Final host guidance explicitly
checks negation, scope and qualifications before agreement, distinguishing the student's
accurate contribution from the tutor's correction. This is a general attribution rule,
not a special-case replacement of a particular reply.

Three replays of the exact observed synthetic context accepted the final guidance
without reproducing that reversal. Fifteen final seeded probes passed in 16 dispatches,
including the erroneous claim, an actual correction and a mixed position. The actual
correction was credited only for the reliability/validity claim, retaining SEM. One
draft changed a retained next-evidence field; the existing single repair corrected it.
Final probe prompt hash: `ea466cc19eb9a8389d5764d6fea8b95f13a1efe6b1b79aa0f4538822069d0daf`.

A complete final-source rerun of the affected journey,
`cmcq_ai_students_b95bfc666ad1`, finished at 2026-10-07T23:16:43Z in 15 dispatches.
The reversal did not recur. The tutor respected a no-quiz request and stopping, while
the teacher-assistance recommendation retained all unresolved claims. Its one invalid
draft changed an engagement summary declared retained; the existing single repair
corrected it before acceptance. All 13 application call records succeeded, the canonical
profile came from a validated live call, and its independent research audit passed.
The stored 20 source hashes match the final tested teaching and interpretation source.
The seven-case run predates only the final attribution guidance; it is not represented
as seven final-prompt replications. Final additional internal-label leakage checks passed
without changing the input, evidence or profile contracts.

Representative synthetic exchanges, quoted from the reviewed runs:

- Student: "I guessed some answers. Please explain one idea without testing me again."
  The tutor explained SEM directly. Later agreement and admitted confusion produced no
  understanding upgrade; finishing without practice remained available.
- Student: "I need a break. I want to pause, not start a new attempt."
  Tutor: "Of course. We'll pause here--no new attempt or question." The application
  pause/exit/resume checks preserved the same attempt and deduplicated delivery.
- Student: "Your example does not convince me. I still think repeating a wrong score
  enough times will turn it into the right score."
  Final tutor: "Repeating measurements can improve an estimate--but only when the errors
  vary randomly around the correct value. It does not make a stable wrong result become
  correct." It distinguished random error from fixed bias without attributing the
  correction to the student. Punctuation is normalized in these excerpts.

Release commit and verified deployment evidence are maintained in
`release-records/releases.json` and the corresponding Word record.

## Regression verification

The final isolated audit passed all 22 suites, including 65 navigation-matrix paths,
protected state, attempts, recovery, lifecycle, dashboard and research exports. The
30-case conversation contract matrix, interpretation-policy tests, provider-request
checks, 88 approval and budget integrity checks, 40 stance/evidence checks, and
canonical semantic-validation tests also passed. Provider-request checks do not make
provider calls. The contract fixture uses a 12-turn ceiling and is not a live test of
the production 30-turn maximum.

Typechecking and the isolated production build passed. A restricted-sandbox build
attempt stopped at the build tool's local IPC permission check; the authorized build
outside that restriction passed. Source lint excluding private
`.data` and `outputs` files passed with zero errors and five existing warnings. The
unfiltered lint command failed on private helper files and is not recorded as passing.
Production dependencies have zero reported vulnerabilities under the checked policy;
the existing build-only braces exception retains its original expiry on October 11.

The first broad audit passed 21/22 suites because a strict legacy context fixture did
not strip the new optional history field. The adapter was corrected and the final
audit passed 22/22. Another focused test detected that the new policy version was not
recognized by the invalid-candidate audit projection; the version mapping was fixed
and preservation of the original candidate was verified.

An additional legacy `agent-profiling-smoke-test` remains incompatible with the isolated
audit configuration: it expected an agent row that was not produced in that harness.
It failed before and after the withdrawn prompt-version change. The current v18r2
pipeline test instead verifies the participation constraint through its supported
injected profiling path, and the final live suite requires a validated provider call.
The legacy test is recorded as deferred harness maintenance, not a passing check or
evidence that all profiling configurations were exercised. No new browser UI test was
performed in this release; the covered service and navigation paths are identified
separately from the earlier release's browser checks.

## Research-data boundaries

No database migration or CSV schema change is required. Sealed answers, reasons,
confidence, keys/snapshots and submission times are unchanged. The new projections
remain in audited call inputs; existing evidence observations, invalid candidates and
validated transitions preserve their provenance. Historical labels and conversations
are not recomputed. Initial confidence remains carried forward, not reassessed.

Service-only simulations cannot measure browser exposure, reading, typing or human
pause duration. Missing measurements remain missing. Student time, system waiting and
model latency are not merged. Concurrent-delivery tests may log expected uniqueness
conflicts while verifying exactly one accepted student message and tutor reply.

## Interpretation and remaining limits

The deterministic guard prevents a specific evidence-bookkeeping contradiction; it
does not understand every paraphrase, detect every unsupported claim, or grade the
quality of reconsideration. Unrecorded assistance classifications and semantics still
need contextual review. Summaries can remain stronger in tone than their supporting
observations, even when no profile is upgraded.

Pacing and generated-option balance are instructions, not guarantees. Some explanations
remain longer than necessary and generated practice is not an independently validated
item bank. Operational completion, accurate exports and plausible dialogue are not
evidence of learning gains, durable transfer or equal effectiveness across achievement
groups. Those claims require authentic participation, independent learning outcomes,
student experience feedback and human review of diagnostic interpretations.
