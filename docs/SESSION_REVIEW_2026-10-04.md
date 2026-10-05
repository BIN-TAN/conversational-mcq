# Assessment session review: October 4-5, 2026

## Scope and status

Reviewed the 20 user-supplied readable-transcript/process-summary pairs. The
process files declare `teacher_process_summary_not_full_research_dataset`.
This review does not certify the entire production research ZIP or current
production health. No student identities or verbatim student responses are
included here. Original supplied files were not modified.

Initial review status: local changes and local regression verification only.
The October 5 follow-up below records the subsequent production diagnosis;
deployment evidence will be recorded in the change and deployment ledger.

## Observations

- 20 sessions, 87 item records, 2,654 timeline events.
- 18 sessions contain learning conversations, totaling 30 tutor replies and
  12 student replies. All 30 tutor replies have corresponding recorded display
  acknowledgements; these are not evidence of reading or understanding.
- 10 of those 18 sessions have no student reply after the opening feedback.
  Exiting, pausing, completion, or silence does not identify motivation or
  dissatisfaction. A student-experience survey/interview can provide that evidence.
- Two sessions contain repeated initial-preparation failures and no conversation
  in the supplied export. Three terminal workflow failures appear across them.
  Submission to last recorded pause spans approximately 6.36 and 42.90 minutes,
  including pauses and retries, not continuous active waiting. Failure categories
  and provider/job diagnostics are absent from these summaries. Their root causes
  and present recovery status remain unverified pending server-side inspection.
- No Chinese characters were found in the dialogue bodies. Chinese occurs in
  one saved topic title repeated across two Test 7 sessions. The same raw title
  was passed to the student page heading, so it was not teacher-only metadata.
- A substantive reasoning response plus a request for later explanation was
  rejected three times. Removing the question allowed continuation. This is a
  collection-policy error, not evidence that the student had no reason.
- A tutor opening attributed an explanatory proposition to a student whose
  rationale was only punctuation and a short negative response. Selecting an
  option must not be described as independently explaining that option's rationale.
- Repair prompts displayed zero-second next-response times because system
  deferral events shared their timestamp and were selected as student actions.
- A package-review edit changed confidence and alternative-answer evidence, but
  summary revision counts were zero for those fields. The historical route used
  event names not recognized by the revision counters. The transcript and original
  records preserve the changes.
- Legacy engagement features also added generic response revisions to explanation
  revision counts, potentially counting unrelated field edits as reasoning edits.
- Item-stage summaries mark 86 records valid and one partial. Overall item timing
  can still be partial when other timing components are missing. No negative or
  non-finite top-level item elapsed/first-action/explanation durations, or duplicate
  item IDs within a session, were found in the supplied summaries.

## Implemented changes

1. Student metadata projection uses English fallbacks for Han-containing titles,
   and omits Han-containing descriptions/objectives from that projection. This
   does not translate or rewrite stored assessment content or student responses.
2. English-output instructions and pre-acceptance language checks cover the
   active formative host, teaching artifacts, profile feedback, and response
   collection. Mathematical notation and original student input remain intact.
   Rejected generated output uses existing bounded validation handling.
3. Item-administration tutor v3 accepts model-interpreted mixed reasoning and
   questions, preserves the full response and deferred concern, and advances
   without initial-stage hints or correctness disclosure. Request-only input
   remains deferred. This is evidence collection, not a mastery judgment.
4. Host v7.12 distinguishes option selections from students' actual explanations.
   The research profile provenance mapping recognizes this host version without
   mislabeling carried-forward confidence as newly assessed confidence.
5. Latency v2 excludes system reactions and unknown category-only events from
   next-student-action selection. CSV/JSONL rows identify the calculation version.
6. Process summary v5 and shared confidence/alternative revision predicates
   recognize legacy package-review changes. Future edits emit canonical change
   events with before/after payloads, without duplicate aliases. Explanation
   revision features count explicit explanation-change events only.

Calculation definitions and preservation rules are documented in
`docs/DATA_LOGGING_SPEC.md`; the research dictionary was updated as well.

## Verification

- `npm run typecheck`: passed.
- `npx eslint src prisma scripts`: zero errors, five pre-existing unused-symbol
  warnings in unchanged operational evaluation files.
- English/mixed-intent smoke: 12 checks passed.
- Collection/learning-summary smoke: 46 checks passed.
- Transcript-quality, process-summary, interpretation-policy, conversation-
  visibility, classroom-acceptance, targeted-quality, and research-format
  regression scripts: passed.
- Disposable local PostgreSQL database: migrations and seed passed;
  package-review edits, readable transcripts, research-export integrity,
  and detailed CSV export tests all passed. Final run also verifies the latency
  CSV calculation-version column. The temporary database was dropped afterward.
- `git diff --check`: passed.

The sandbox initially blocked the local database connection. The same tests
were then run successfully with permission to connect to the disposable local
database. No production database was used. The new English/mixed-intent test is
registered in the classroom audit runner.

## Remaining work

- Inspect the two failed sessions' production workflow/agent-call failure
  categories before diagnosing or attempting recovery. Do not reset attempts or
  label these episodes voluntary disengagement from the summaries alone.
- After an authorized deployment, verify the deployed revision and student
  heading projection; run fresh synthetic live conversations to evaluate model
  adherence, question coverage, and attribution. Local contract tests do not
  establish semantic reliability across future AI responses.
- Re-export affected historical data after deployment to obtain corrected derived
  counts and latency values. Retain old exports and raw events for provenance.

## October 5 production diagnosis and repair

Read-only inspection of workflow and agent-call metadata identified the same
quote-provenance failure in both originally affected sessions and a newly failed
session. The generated interpretation quoted the selected answer letter while
claiming it came from reasoning. All three mismatch annotations had
`basis=answer_only`; the letter matched the separate choice field, not the
reasoning field. These failures were not memory or output-token exhaustion.
One originally affected session subsequently recovered through its existing
retry flow; the other was paused with a retryable job. The newly identified
session was paused after exhausting automatic retries.

The revised prompt explicitly separates choices from reasoning quotations.
`choice-annotation-normalization-v1` removes only unlinked, misplaced answer-only
annotations; substantive claims and supported-reasoning requirements still fail
closed. Original provider output is retained beside a versioned normalization
audit, and the normalized effective output is validated in full. No historical
student response, profile, attempt limit, or session status was changed during
diagnosis. Paused/exited students are not silently resumed.

Local regression includes persisted original/effective output separation,
idempotent normalization, retained genuine quotations, and continued rejection
of invented substantive quotes, linked misconceptions, and unsupported mastery.
The isolated test harness initially supplied a feature flag conflicting with
the approved runtime; removing that test-only override allowed the provider-
boundary and all four export/edit database regressions to pass. Network access
remained blocked throughout these tests.

## Deployed verification

Application `3f1d5e113e55be5fd84ba29bcf9f3ed406c91e88` was pushed and verified
Live in Render deployment `dep-db1k3b7f3r2c73c3n300` on October 5. Health,
database readiness and the web/preparation-worker processes passed. The sampled
2 GB container reported zero OOM events. This was not a load test.

- Three historical failed outputs each contained one misplaced answer-only
  annotation. Read-only replay passed full semantic validation after the narrow
  normalization, with no changes to the saved student records.
- Four fresh, synthetic real AI calls passed: mixed reasoning/question,
  question-only deferral, punctuation-only reasoning and explicit inability to
  explain. The two profiles retained insufficient reasoning for the weak item
  and supported reasoning for the other items, without invented misconceptions.
  No normalization was needed on these fresh outputs. These were provider-path
  probes, not complete multi-turn browser conversations.
- All 20 selected-session research bundles passed manifest checksums, duration
  and pause-row agreement with the teacher summary, and the affected historical
  confidence-revision check. There were 38 files per bundle, 87 item rows and
  14 pause episodes in total. Seven dashboard data projections and the affected
  English topic projection passed. A single whole-course ZIP was not downloaded.
- The final English/mixed-intent local smoke includes 13 checks. The additional
  check and database persistence test cover the choice-annotation normalization.

The earlier remaining-work section records the pre-deployment review status;
the findings above resolve its production-diagnosis and export-verification
tasks within this stated scope. Students who paused or exited are not silently
resumed. No original responses, attempt histories or historical exports were
rewritten. Re-exporting generates the corrected derived summaries. Detailed
evidence and limitations are recorded in release `CMCQ-20261005-01`.
