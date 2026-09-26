# Stance-Aware Reasoning and Classroom Evaluation

Date: 2026-09-26. Local implementation/evaluation, not a deployment record.
No production records were changed. No commit, push or Render deployment was
performed in this task. Earlier uncommitted engineering improvements remain in
the working tree; the 2026-09-25 reports have not been replaced.

## Why this change

The intended use is formative teaching in a real classroom, where incorrect
instruction can harm learning. It is not authorization for automatic grading,
selection or qualification. Diagnostic rules must distinguish a student's stance
toward a supplied explanation from both that explanation's accuracy and evidence
of independent application. Reusing an option's reasoning is not automatically
irrelevant repetition, and rejecting a tempting distractor is not endorsing it.

## Implemented

- New semantic review v3 records item-local interpretation IDs, original student
  quotes, source fields, proposition, stance, evidence basis, accuracy, scope,
  referenced sealed option and rationale. Current live outputs require these
  fields; old records stay readable without retrospective annotations.
- Candidate misconceptions link to specific endorsed false explanatory
  propositions. Rejected, uncertain, quoted, answer-only and undifferentiated
  compound positions cannot be promoted to atomic claims by the mechanical
  validator. Eligible observations cannot silently disappear or be counted twice.
- Backend projection caps recognition-only evidence and retains recognition and
  scope limitations. Wrong source text, wrong item/option, ambiguous identity and
  unsupported links reject the output through existing repair/failure handling.
- Initial planning prompt v4, canonical handoff prompt v6 and formative-host
  prompt v7.5 distinguish adoption, rejection, uncertainty, quotation, recognition
  and independent application. Initial administration stays neutral and the
  existing all-claim closure and canonical evidence-ID rules remain in place.
- Classroom acceptance v2 targets response-process interpretation, instructional
  safety, accessibility, teacher intervention and actual student experience.
  It no longer treats formal cut-score decisions as the default intended use.
  Learning-gain claims still require separate independent outcome evidence.

Field definitions, storage paths and boundaries:
[`STANCE_AWARE_REASONING.md`](../../../STANCE_AWARE_REASONING.md).
Evaluation protocol: [`CLASSROOM_ACCEPTANCE.md`](../../../CLASSROOM_ACCEPTANCE.md).

## Actual Verification

| Check | Actual result | Scope |
| --- | --- | --- |
| Initial contract test | 35/36, failed | Test compared serialized object property order rather than deep equality. Failure retained, comparison repaired. |
| Final stance contract | 40/40 | Expected/actual values, rationale, times and source hashes in `contract-final.json`. Includes canonical policy wiring, not its semantic accuracy. |
| First full engineering run | Failed: 57/58 classroom suites | An old provider-schema assertion compiled the historical read schema. Fixed to test the actual current live schema; historical compatibility remains separately tested. Other phases passed. |
| Full engineering rerun | Passed: 58/58 classroom suites, 20/20 navigation suites, typecheck, lint, production build and three browser scripts | `engineering-full.json`; source hash unchanged during the run. Five existing lint warnings, no errors. This precedes the final canonical handoff prompt-only addition. |
| Final canonical-handoff delta | Passed: typecheck, lint, 58/58 classroom suites and 20/20 navigation suites | `engineering-final-server.json`; final source unchanged during this server-only run. No additional live calls or rerun of build/browser after the prompt-only addition. |
| Browser process data | Passed, 9 stage visits | Teacher views, persisted database data and downloaded research ZIP reconciled; includes first action, rejected/retried submission, reload, pause, deduplication and student isolation. |
| Browser initial preparation | 10 checks passed | Background completion, worker/web launch, retry, history, responsive layout and typing/paste aggregates. Mock provider; not live AI latency. |
| Four live synthetic requests | All provider calls completed; 2/4 original provenance validations passed | 24 reference cases in two 12-case banks, each forward/reverse. All 24 stance-bank checks passed. Both conceptual-bank outputs were rejected because irrelevant instructions had no conceptual interpretation. Original outputs retained. |
| Revalidation after validator fix | 4/4 provenance and student-message validations, 48/48 developer expectations | Same saved outputs and unchanged hashed expectations. This is **zero new provider calls**, not independent replication. |

Final canonical-handoff delta verification is recorded separately in
`engineering-final-server.json`. Browser/build evidence above
is not relabeled as a full run of that later source hash.

The boundary repair permits an empty interpretation list for irrelevant text,
just as for insufficient evidence. It does not permit supported reasoning with
no supporting observation. Both sides of that boundary have regression checks.

The production initial-profile persistence smoke uses a synthetic provider to
verify that stance, student quote, rationale, version and AgentCall linkage are
actually written to the database, not merely returned by a model. Historical
quote-only diagnostic fixtures remain tested separately. The final handoff policy
uses existing canonical profile fields; it is not a second copy of the new v3
structured interpretation schema.

## Live Evidence and Limits

The four calls used `gpt-5.6-sol`, medium reasoning, 16,000 maximum output tokens,
with synthetic content only. Reported output usage was 5,806; 4,750; 4,536; and
4,714 tokens. Measured request latencies were approximately 61, 48, 45 and 48
seconds. This is an isolated initial-planning probe, not a classroom performance
estimate, end-to-end teaching trial, or test of the canonical profiling role.

Cases/expectations were saved before the requests. `ai-original.json` contains
model outputs, prompt/configuration/source hashes and original failures.
`ai-revalidation.json` binds its parent report hash, frozen case hash and current
validator hash. It does not overwrite the original record. `reference-cases.json`
states each case's expected judgment, claim range, stance distinctions and review
rationale. Outputs are synthetic and contain no identifiable student transcripts.

Passing expectations means labels/counts and specified distinctions met
developer-proposed criteria. It does not establish each claim's content accuracy.
There was still some variation in whether separately articulated false claims
were described as supplied or student-explained; those cases did not prescribe
a unique basis. Review evidence origin before using it analytically. Cases used
for development are not a held-out validation set. Repeated calls are not
independent students, and no diagnostic accuracy percentage or learning gain is
inferred from these counts.

## Deployment and Review Prerequisites

1. Reconcile the approved production prompt/model/output-budget configuration
   with this candidate before deploying. The live probe used 16,000 tokens, not
   the older 3,000-token planning default found in the repository. No approved
   runtime bundle or production setting was bypassed or changed. Actual Render
   configuration was not queried in this task.
2. Run the final canonical profiling and teaching handoff under the intended
   production configuration, including compounded beliefs, reversals and
   recognition-only responses. The present live probe does not cover that path.
3. Have qualified reviewers check claim content, false positives, omissions,
   feedback accuracy/burden and justified closure using independent ratings.
4. Pilot with representative students and teacher oversight. Classroom-scale
   full browser/provider load, accessibility and real learning outcomes remain
   separate evidence needs; mock concurrency tests do not settle them.

The source-provenance validator cannot decide whether an LLM correctly understood
a student's sentence. The initial review, canonical profile and tutor can still
disagree; prompt alignment reduces this risk but does not prove agreement.
Teacher correction/intervention and incident monitoring remain necessary.

## Reproduction

```sh
npm run classroom:stance-evidence
npm run classroom:acceptance
npm run classroom:acceptance -- server
RUN_ASSESSMENT_QUALITY_CANARY=true ASSESSMENT_QUALITY_MODEL=gpt-5.6-sol npm run classroom:assessment-quality
npm run classroom:assessment-quality:replay -- docs/acceptance/runs/2026-09-26/ai-original.json
```

The live command makes four bounded paid requests; replay makes none. Full local
engineering logs are retained under `.data/classroom-acceptance-2026-09-26/` and
their hashes in the public reports. The local directory is not a public student
data export or a committed release artifact. A generated artifact manifest binds
the retained JSON reports by SHA-256. Approval and deployment evidence belong in
the existing release ledger/Word record only when a release actually occurs.
