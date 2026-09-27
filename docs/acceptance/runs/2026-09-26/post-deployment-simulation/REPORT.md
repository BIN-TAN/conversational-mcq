# Post-Deployment Simulation Audit

Local date: September 26, 2026 (America/Edmonton; machine timestamps use UTC September 27).

## Conclusion

**Engineering regression checks passed, but this is not an all-clear for classroom use.** A real-AI initial-feedback probe still exhausted the 3,000-token allowance for a supported 12-item package. Manual review also found an overclaim in an accepted teaching example. No application code, production settings, or real student records were changed during these simulations.

## Remaining Findings

### P1: Initial-feedback budget can still prevent completion

- With the current 3,000-token allowance, a three-item synthetic package completed; a 12-item package returned `incomplete` at exactly 3,000 output tokens.
- With a test-only allowance of 10,000, both sizes completed. The 12-item output consumed 3,773 tokens, beyond the smaller cap.
- This supports insufficient output allowance as a reproducible failure mode. It is not an exact replay or complete explanation of an individual student's incident. The probe did not retain `incomplete_reason` or full initial-feedback provider output.
- The retry fix permits a new audited call, but does not itself remove an undersized output cap. Repeated retries at an inadequate budget can still fail.
- Next action: validate and approve a larger initial-feedback allowance against the active runtime approval policy, test the full persisted preparation workflow, then recover the affected saved attempt without deleting its responses or failure history. Do not retry indefinitely or truncate the evidence package to fit.
- Source: `src/lib/llm/config.ts`, `formative_value_and_planning_agent` default; evidence: `budget-canary-console-summary.json`.

### P2: A teaching example overstates the evidence for reliability

- In `supported_example_then_numeric_substitution`, turn 1, the generated example treats one applicant's scores of 88 and 89 on two versions as evidence of **high reliability**.
- That illustrates individual agreement; it does not by itself establish reliability of scores in the relevant population and conditions. The rest of the explanation correctly distinguishes reliability from validity and treats SEM as uncertainty, not an exact signed correction.
- The reply passed structural and evidence-reference validation. Those checks do not guarantee disciplinary accuracy of every instructional claim.
- Next action: add a general evidence-strength constraint and reference tests for reliability examples: either explicitly stipulate adequate reliability evidence, or label a single-person comparison as an illustration that cannot estimate reliability. Review analogous overclaims about validity, uncertainty, and transfer, not just these numbers.
- Evidence: `dialogues/READABLE_TRANSCRIPTS.md`, first scenario, turn 1; original provider output is retained in `dialogues/live-results.json`.

### Observed validation retries and latency

Two initial tutor candidates were rejected, then regenerated successfully before acceptance: one cited evidence outside the allowed temporal/closure scope; another changed a profile field it claimed to retain. Both rejected outputs remain in the audit, and replay confirmed rejection. No rejected candidate was treated as an accepted reply in the probe.

The 12 accepted tutor turns took 7.1-52.3 seconds each including regeneration, with a median of 12.8 seconds. These are small-sample provider timings, not a production service-level guarantee.

## Source and Scope

- Application commit: `48dc8d949d0e70c91bcc4fabfda4e267334393a5`.
- Checkout commit: `3a138364eee3006b6a95b5f08f722eca9e34eb6d` (documentation follow-up).
- Engineering source fingerprint: `b5e0d3fabe1e04238a1d3748ef884bac764e2da16194d439b6b56b049d096ba6`; unchanged during acceptance.
- Tutor prompt: `formative-conversation-host-v7.8`, SHA-256 `629bb783488595c96dc810dfb8d2d73ac221f3f470993f8c477b2888c3d08ce6`.
- Real-AI model: `gpt-5.6-sol`, medium reasoning. Tutor and larger-budget probes used 10,000 output tokens only in isolated evaluation.
- Synthetic records only. Engineering tests used disposable local databases and blocked external provider calls. Real-AI probes used synthetic in-memory contexts, not production databases. All disposable databases were removed.
- No production deployment was performed in this test-only task. This report does not claim recovery of a real student's pending attempt.

## Completed Checks

| Layer | Actual result | Important qualification |
| --- | --- | --- |
| Type checking, lint, production build | Passed | Lint retained existing warnings. Build used a local build-time memory allowance, not the worker limit. |
| Core classroom suites | 62/62 passed | Engineering, not instructional efficacy. |
| Navigation suites | 20/20 passed, including a 65-scenario matrix | Suites overlap; do not sum these as independent coverage estimates. |
| Browser workflows | 3 suites passed | Real browser, synthetic provider responses and local server. |
| Low-memory preparation | 17 checks passed | 96 MiB V8 old-space and 4 MiB semi-space; this is not a total-RSS cap. |
| Initial-profile provider-boundary validation | Passed under the same heap limits | Stubbed provider; actual DB persistence, invalid-output blocking and audited recovery tested. |
| Streaming research export stress | 65,536 rows passed | Exact row counts, multiline CSV, hashes/CRC, admission and cleanup verified. |
| Real-AI initial-feedback probes | 3 completed; 1 incomplete | Four actual calls; failure preserved, not counted as a pass. |
| Real-AI tutor dialogues | 6 scenarios, 12 accepted turns; 72/72 mechanical checks | 14 provider calls including two rejected candidates; pedagogical issue remains. |
| Offline replay of AI results | 12 accepted and 2 rejected outputs reproduced | Zero new provider calls; next-turn visible-message chain verified. |

Total real-AI calls in these probes: 18 (4 initial-feedback calls and 14 tutor calls). This is not 18 full student sessions.

## Student and Teacher Workflows

Verified teacher first-login redirect and refresh; initial answer/reason/confidence/tempting-option collection; lost-response retry; changed answers; cancellation; package review and editing; reload; pause/resume; ending; read-only history; mobile progression; and recovery from the old stuck state. Browser checks reported no horizontal page overflow or console errors in the tested views. Selected desktop/mobile screenshots were inspected.

Initial submission acknowledged in **126 ms** in the local browser test while preparation continued in the background. Saved responses remained reviewable, refresh only polled, temporary network failure recovered, explicit retry used the saved job, and the validated opening appeared after the independent worker completed. This measurement excludes real AI generation and is not production latency.

Preparation tests verified job ownership, rollback on enqueue failure, single job for duplicate submissions, exclusive worker claims, another student's progress while one job runs, heartbeat/lease recovery, bounded retries, pause/end handling, immutable source-evidence checks, preservation of failed call history and frozen response packages, and reuse of validated successful generation without duplicate openings.

## Research Data Verification

- Browser actions were reconciled against persisted responses, revisions, completion events, retry outcomes, teacher views, and downloaded research ZIPs.
- Nine observed stage visits populated the relevant first-input/readiness and submission timing data. Reasoning, confidence, tempting-option selection/reasoning, edit attribution, reload clock separation, and explicit pause were exercised.
- Synthetic typing/paste aggregates survived reload and export without including raw draft input text in timing telemetry.
- Duplicate event delivery was deduplicated; client-forged outcome events and cross-student access were rejected. Read-only history did not create new process activity.
- Initial semantic profiles retained quoted student evidence, interpretation stance/rationale/version, source call linkage, validation status, and provider metadata in the synthetic database. Invalid profiles did not become successful mock evidence; valid retries preserved failed audits and sealed responses.
- The final stress run exported 81,578,264 uncompressed bytes into a 712,487-byte ZIP. Observed process RSS rose from 86,900,736 to 186,122,240 bytes. This is one isolated process on synthetic highly compressible rows, not a guarantee for combined Render web/worker memory or simultaneous classroom load.
- Real-AI dialogue probes did not write to the database. Their evidence references and profile transitions were validated/replayed in memory; the separate engineering tests cover persistence. These layers must not be described as one end-to-end live-provider export trial.

## Dialogue Review

The six two-turn scenarios exercised following a worked example without overstating independent transfer; reasoning in a new context while retaining an unaddressed misconception; current self-confidence without retroactively recalibrating initial confidence; quoting/rejecting a misconception versus endorsing it; a corrected misconception reappearing; and uncertainty followed by a request to pause without testing.

In the sampled outputs, both targeted misconceptions were addressed, unsupported mastery was not declared on reading alone, quoted claims/questions were distinguished from endorsement, renewed errors were retained as current evidence, and pause requests were respected. Some conversations appropriately continued; completion was not required for every scenario. One disciplinary overclaim remains as noted above. Independent expert review and representative student evaluation remain necessary.

## Failed Setup Attempts Preserved

The extra low-memory harness first used a too-short synthetic session secret; validation correctly rejected it before the intended checks ran. After correcting that local harness, an explicit role-toggle override conflicted with the approved runtime policy; that check also correctly rejected the configuration. The final harness removed the conflicting override while preserving the external-network guard, and all three checks passed. No application safeguards were weakened. The two failed reports and final report are retained under `engineering/` and must not be represented as application regressions or omitted from the test history.

## Reproduction and Evidence

- `node scripts/classroom-acceptance.mjs all`
- `RUN_SEMANTIC_REVIEW_CANARY=true SEMANTIC_REVIEW_CANARY_MODEL=gpt-5.6-sol SEMANTIC_REVIEW_CANARY_TOKENS=3000 node --import tsx prisma/semantic-item-review-live-canary.ts`
- Repeat the preceding command with `SEMANTIC_REVIEW_CANARY_TOKENS=10000` in isolated evaluation, not production configuration.
- `RUN_CLASSROOM_DIALOGUE_CANARY=true ASSESSMENT_QUALITY_MODEL=gpt-5.6-sol node --import tsx prisma/classroom-dialogue-canary.ts --fresh`
- `node --import tsx prisma/classroom-dialogue-replay-smoke-test.ts docs/acceptance/runs/2026-09-26/post-deployment-simulation/dialogues/final-results.json`
- Extra disposable-database checks: `prisma/initial-preparation-smoke-test.ts`, `prisma/student-formative-live-validation-smoke-test.ts --initial-profile-only`, and `prisma/research-export-streaming-smoke-test.ts --stress`; external network blocked and the tested processes limited to 96 MiB old-space / 4 MiB semi-space. Migration and seeding used 512 MiB.

See `engineering/` for machine reports and selected safe console results, `dialogues/` for complete synthetic AI evidence and readable transcripts, and `artifact-manifest.json` for SHA-256 hashes. Initial-budget results are console metadata rather than full saved model replies, as explicitly marked in that file.

## Limits

This run does not exhaust all possible navigation sequences or demonstrate zero bugs, classroom-scale simultaneous live-provider capacity, fairness, accessibility with representative learners, or measured learning/transfer benefits. The current acceptance runner intentionally excludes the obsolete pre-v18r2 formative runtime path; this is not an assertion that every legacy script in the repository passes. Production attempt recovery, increased initial-feedback allowance, and the reliability-example safeguard remain follow-up work.
