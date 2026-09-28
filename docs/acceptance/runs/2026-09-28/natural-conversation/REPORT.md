# Natural student feedback and transcript visibility

## Findings and scope

The fixed audit-style package summary in the supplied teacher transcript was
already suppressed by the active student conversation. The teacher readable
projection had not applied those visibility rules. A transcript alone therefore
did not establish that students saw that paragraph. This release shares the
visibility policy, excludes internal messages from readable dialogue, and retains
raw records with explicit visibility classifications in the research dataset.

The actual formative host now acknowledges a specific student idea, distinguishes
concise correct reasoning from an error, clarifies option/reason mismatches, and
respects rejected alternatives and requests for explanation. This is a systemic
prompt and projection change, not a rewrite of the supplied student records.
Prompt version: formative-conversation-host-v7.10.

## Real provider checks

All inputs were synthetic. No production student data were used or changed.
Model gpt-5.6-sol, medium reasoning, output allowance 10,000 tokens per call.
Fifteen logical calls produced fifteen completed, accepted responses on their
first requests, with no transport retry or semantic regeneration. This test
allowance does not change the deployed 30,000-token initial-feedback policy.

- Twelve calls covered six two-turn scenarios: supported worked examples versus
  independent transfer; high confidence in an error followed by uncertainty;
  quoted or rejected misconceptions; an error reappearing after correction; and
  uncertainty followed by a request to pause. All 72 programmed checks passed.
- Three initial openings covered a concise correct justification, a tempting
  option whose label conflicted with its explanation, and an explicitly rejected
  tempting explanation. The mismatch received a neutral clarification rather
  than a diagnosis. The other openings acknowledged the student's accurate idea.
- Twelve accepted dialogue outputs were replayed through the production dialogue
  pipeline checks, with the next-visible-message chain verified.
- Provider-reported call latencies ranged from 4.553 to 37.845 seconds. Total
  usage was 180,642 tokens, including input context. These are provider timings,
  not student response times or a classroom-load benchmark.

The implementing assistant reviewed all fifteen visible replies after generation.
No new blocking mismatch was identified in those replies. Some requested teaching
examples remain lengthy; no hard word limit or compulsory quiz was introduced.
This review is not independent expert validation or evidence of learning gains.
The unmodified run files retain their original pending-review metadata; this
paragraph records the subsequent non-independent review rather than rewriting
the original execution artifacts.

## Local verification

- `npm run typecheck`: passed.
- `npm run student:conversation-visibility-smoke`: passed.
- `npm run student:transcript-quality-regression`: passed.
- `node --import tsx prisma/formative-interpretation-policy-smoke-test.ts`: passed.
- `node --import tsx prisma/classroom-dialogue-replay-smoke-test.ts <results.json>`:
  passed for all twelve dialogue outputs, without new provider calls.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run build`: passed. Existing webpack
  cache serialization warnings remained.
- `npm run lint`: failed on six pre-existing errors in ignored local `.data`
  grant-demo scripts. These files were not changed or committed.
- `npx eslint . --ignore-pattern '.data/**'`: passed with five pre-existing unused
  symbol warnings in unrelated operational fixture/evaluation files.
- `git diff --check`: passed.

A disposable local database was migrated, seeded, tested and dropped. External
AI traffic was blocked during these database tests. All six suites passed:
teacher readable transcript, analysis-ready export, selected-session export,
research export integrity, process-data summary, and formative pipeline runtime.
The final rerun includes old package/pattern messages without explicit hidden
flags inside an active formative conversation. They are excluded from readable
dialogue but retained in the structured audit. See `database-checks.json` for
individual outcomes and log hashes.

## Research implications and limits

No migration, scoring change, production reset or historical text rewrite.
Raw conversation rows remain available. New `student_visibility` and
`conversation_visibility_version` columns distinguish internal-only turns from
explicitly visible and legacy-unspecified records. Internal turns have null
prompt-to-student latency, not zero. Elapsed intervals use server record times,
can overlap, include time away, and do not establish reading or active work.
Legacy visibility cannot be retrospectively proved from missing metadata.

These canaries exercise production request construction and validators using
in-memory synthetic context. Database suites verify persistence separately with
mock AI. They do not establish every possible classroom path, concurrent-load
capacity, or full psychometric validity. Deployment evidence is recorded
separately in the append-only release ledger after exact-revision verification.
