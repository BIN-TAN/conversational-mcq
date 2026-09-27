# Fresh AI and Recovery Verification

Date: September 27, 2026 (America/Edmonton).

## Result

All **15 actual AI calls completed**: two initial-feedback packages, one canonical
profile, and twelve tutor replies across six two-turn scenarios. No provider
failure, token exhaustion, rejected candidate, or regeneration occurred in this
sample. The current validators accepted all final results. A coding-assistant
review of all generated replies found no new blocking or clearly incorrect
instructional behavior in these sampled cases. This is not independent expert
validation or an assurance that all classroom cases are error-free.

No application code, production configuration, or real student records changed.
This is a test-only follow-up, not another deployment. The local checkout was
`fffedbeff23a19c61fb3297f1d96ef2f73e3e984`; application source matched deployed
`a0f587f74e8860e9d3e395bee2abaac3133a7fa6`.

## Real AI Calls

| Scenario | Calls | Result | Observed latency |
| --- | ---: | --- | --- |
| Initial feedback, 3 items | 1 | Schema, evidence references, misconception/guessing checks passed | 25.917 s |
| Initial feedback, 12 items | 1 | Same checks passed; all item reviews present | 37.805 s |
| Canonical profile, supplied explanation adoption/rejection | 1 | Only the endorsed false explanation became a misconception claim | 10.936 s |
| Six two-turn formative scenarios | 12 | All accepted; 72/72 scenario checks passed | 7.855-38.596 s; median 14.519 s |

The two initial-feedback calls used a 30,000 output-token ceiling and consumed
1,613 and 3,561 output tokens respectively. The canonical profile retained its
separate 4,000 ceiling and used 1,090 tokens. Tutor calls used the existing
evaluation configuration, 10,000 maximum output tokens, not the initial-feedback
ceiling. Initial feedback and tutor model: `gpt-5.6-sol`, medium; canonical profile:
`gpt-5.6-terra`, medium. Tutor prompt: `formative-conversation-host-v7.9`.

These are provider timings, not full website response-time guarantees. The
12-item package repeats three reasoning patterns to exercise capacity and
item-local evidence handling; it is not twelve different content domains.

## Conversation Review

1. **Following a worked example:** credited a correct explanation and numerical
   substitution without claiming robust independent transfer.
2. **New-context reasoning:** acknowledged the reliability-validity correction,
   retained unaddressed SEM evidence, then recognized the later justified SEM
   explanation. Closure was supported by student reasoning about both concepts.
3. **Confidence changes:** addressed both explicit errors; later low confidence
   did not invalidate correct reasoning or overwrite initial confidence data.
4. **Quoting and rejecting a claim:** distinguished reported speech from belief,
   kept the separate unresolved misconception, and answered a request for direct
   explanation without adding a practice question.
5. **An error reappearing:** detected renewed reliability-validity endorsement
   and addressed it alongside the persistent SEM error; no mastery claim followed.
6. **Uncertainty and a pause request:** explained the concepts, rejected a
   guaranteed-interval interpretation, then respected the pause without inferring
   learning from merely reading the explanation.

The previous single-person reliability-example concern was not reproduced:
relevant examples stipulated adequate population/condition-specific reliability
evidence or were clearly illustrative. The explanations distinguished consistency,
validity evidence, and individual uncertainty; interval claims included model
assumptions rather than guaranteed true-score boundaries.

Three raw tutor outputs needed the existing deterministic field-evidence
normalization: unchanged profile values had been labelled as updated. The
normalizer corrected retention/update bookkeeping before acceptance. It did not
change student-visible text, profile values, or misconception dispositions.
Original and effective outputs remain in the audit. This is an observed model
metadata imperfection handled by the current safeguard, not a new student-facing
failure. Offline replay accepted all twelve effective outputs and verified that
each second turn contained exactly the preceding displayed reply; zero extra AI
calls were used for replay.

## Recovery and Research Data

Separate engineering tests used three disposable local databases, blocked
external AI calls, and removed all three databases after completion.

| Suite | Actual result |
| --- | --- |
| Browser initial preparation/recovery | 12 groups passed |
| Initial preparation/worker | 17 groups passed |
| Technical failure/lifecycle audit | 7 groups passed |
| Attempt policy and preservation | 12 groups passed |
| Initial profile provider-boundary validation | Passed |
| Analysis-ready, selected-session, integrity, process-summary exports | All 4 suites passed |

The browser confirmed retry and teacher-help guidance without an End attempt
control on the failure screen; source-integrity conflicts did not offer unsafe
retry. Refresh and pause/resume preserved the session ID, attempt number, saved
responses, and response package. No termination or skipped-feedback event was
created by reading the error guidance. Ordinary explicit ending elsewhere remains
separately tested, including historical audit/export behavior.

Browser typing/paste aggregates survived refresh, database capture, and research
CSV export without storing raw draft input in timing telemetry. Worker checks
covered duplicate submissions, leases, restart recovery, bounded retries, and
successful-result reuse. Invalid profile outputs did not replace original student
evidence; valid retry preserved failed-call history. Preparation/provider tests
used 96 MiB old-space and 4 MiB semi-space, not a total-process memory cap.

The real-AI calls above used synthetic in-memory contexts. The persistence and
export tests used controlled provider responses. These are complementary layers,
not a single end-to-end live-provider-to-production-research-export test.

## Deployed Service Check

Read-only checks at 14:04:51 and 14:06:13 MDT confirmed:

- Public health: `status=ok`, database reachable, schema ready, migrations ready.
- Running/build commit: `a0f587f74e8860e9d3e395bee2abaac3133a7fa6`.
- Active approval complete, 18 roles, `mismatch_reasons=[]`.
- Global initial-feedback output ceiling: 30,000.
- Background preparation worker running with the same approved configuration.
- No production student-data access or AI requests from the production server.

The read-only SSH command exited zero. Its existing supplementary ED25519 host-key
signature warning remains; host verification was not disabled. Public health is
not itself proof of live AI success; provider calls are documented separately.

## Limits and Evidence

No new blocking bug was reproduced. Waiting time remains material: the slowest
sampled generation took approximately 39 seconds. These tests do not establish
classroom-scale concurrency, universal semantic accuracy, accessibility with
representative students, durable learning gains, or behavior on every subject.
Synthetic successful calls cannot guarantee future provider availability.

Source evidence is retained under `initial-profile/`, `dialogues/`, and
`engineering/`. `dialogues/READABLE_TRANSCRIPTS.md` contains all actual tutor
replies. Configuration, prompt/source hashes, raw/effective outputs, validation
results, token usage, and timing are retained in the corresponding JSON files.

Executed entry points:

- `RUN_PROFILING_REPAIR_CANARY=true node --import tsx prisma/profiling-repair-live-canary.ts --output-directory <new-directory>`
- `RUN_CLASSROOM_DIALOGUE_CANARY=true ASSESSMENT_QUALITY_MODEL=gpt-5.6-sol node --import tsx prisma/classroom-dialogue-canary.ts --fresh`
- `node --import tsx prisma/classroom-dialogue-replay-smoke-test.ts <dialogues/final-results.json>`
- Existing isolated-database runner in default, `--research`, and `--browser` modes;
  its reports identify the underlying test suites and actual cleanup results.

No fresh typecheck, lint, or application build was necessary: application code was
unchanged, and the browser checks used the previously verified production build.
