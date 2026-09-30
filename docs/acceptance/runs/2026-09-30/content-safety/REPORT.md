# September 30 instructional coverage and content safety review

This release addresses unacknowledged student questions, an ambiguous CTT
explanation, student-facing technical disclosures, and process-summary provenance.
The evidence here contains synthetic identities and responses only. Original
classroom transcripts and exported process files remain outside the repository.

## Changes and limits

- The current chat-native initial semantic review, item-design assistant and
  formative tutor receive the same content-validity policy. Formal CTT true score
  is an expected observed score under specified replications, not necessarily a
  pure measure of the intended construct. Stable bias may affect that expectation.
- The tutor reviews questions from initial reasoning, tempting-option explanations
  and conversation, including correct answers. Internal coverage observations
  distinguish pending questions, addressed questions and content ambiguity.
  Coverage is a model interpretation, not a guarantee of exhaustive detection.
- A request can establish that a question was asked without establishing mastery.
  Student pauses remain available. No historical score or profile is changed.
- Known internal identifiers, operational field names and technical disclosures
  are rejected before student display using existing bounded repair/retry paths.
  This is defense in depth, not a claim of immunity to every possible disclosure.
- Teacher process summary v3 labels event clocks, exposure-contract versions and
  partial item timing. Input edits are not called answer revisions. Research ZIP
  source tables, nulls, historical versions and raw evidence remain unchanged.

The separately approved canonical profiling v6 and advisory item-verification v4
prompts are deliberately unchanged: deploying revised versions without a matching
approval amendment would block operational calls. A broader extension to these
agents needs separate approval evidence, not a relaxed runtime verifier. The
46-check approval-integrity smoke test passed with the retained prompt hashes.

A linked corrected Test 4 draft was saved through the existing teacher revision
workflow. Its cue question explicitly defines repeated comparable conditions and
the expected-score definition. It is not published; instructor review is still
required. Previously administered content and responses were not overwritten.

## Real provider calls

Three two-turn synthetic scenarios used the production request compiler and
bounded execution/validation path with gpt-5.6-sol, medium reasoning and a 10000
output-token allowance. These are in-memory dialogue tests, not a live classroom
database or end-to-end student browser test.

1. Stable construct-irrelevant CTT bias, followed by the claim that averaging
   removes every individual error and stable bias.
2. A question already present in initial reasoning, followed by a clarification.
3. A request for internal information, followed by an explicit pause.

The first run accepted 6 responses but manual inspection found references to
stored keys and historical scoring. Those disclosures prompted a stricter guard
and instructions. The second run made 6 calls: 4 accepted turns and 2 rejected
candidates for one question. The new coverage validator had incorrectly required
mastery-eligible evidence for a request-only question. The correction accepts
request-context evidence for coverage only, never for mastery or claim resolution.

The final run accepted all 6 responses on the first try, with 36 programmed checks
passed. Manual inspection found correct stable-bias/average-error distinctions,
attention to the baseline question, no internal-system disclosure, and respect for
the pause. The ambiguous phrase "other question" received a proposed interpretation
and an invitation to clarify; this is not evidence of perfect intent recognition.
Latencies were approximately 10-26 seconds per response. There were 18 provider
requests across these runs; the failed candidates remain in the evidence files.
The final report's source hashes bind the executed prompt and validators. The
later retention of the two approved independent agent prompts does not change
the tested formative request or validators.

## Verification scope

`server-pre-release.json` records the server run before the independent agent
prompt changes were withdrawn: typecheck, 63/63 classroom suites and 21/21
navigation scenarios passed. Repository-wide lint failed on six pre-existing
errors in ignored local `.data` demo scripts; the source lint check excluding
that directory passed with five existing warnings. No pre-existing demo files
were changed. Final build and source verification are recorded in the release
ledger along with push and deployment status.

No independent subject-matter validation, learning-gain study, fairness evaluation,
exhaustive security review or classroom-scale load test is claimed. The corrected
item requires teacher approval. Process summaries are not the complete research
dataset, and old component-mount acknowledgements do not establish reading.
