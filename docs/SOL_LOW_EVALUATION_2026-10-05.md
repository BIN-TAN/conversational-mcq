# Sol low reasoning and input deduplication evaluation

The first live round supports using Sol with low reasoning for initial feedback
and ongoing learning conversations. All eight scenarios completed, and review
found no blocking instructional or data-integrity regression. Other roles retain
their current models and reasoning settings. This is a small synthetic evaluation,
not an independent demonstration of equal learning outcomes.

## Changes

Exact repeated input values and repeated field names are encoded once per request
for four interpretation and feedback roles. Every source value and observation
is retained and reconstruction is checked before transmission. Original research
records remain expanded. See [transport and audit definitions](AI_INPUT_DEDUPLICATION.md).
Only `formative_value_and_planning_agent` and `formative_conversation_agent` change
from Sol medium to Sol low. Output ceilings, attempt limits and validators remain
unchanged. A scoped, verified approval amendment preserves the prior configuration.

## Live results

Run `cmcq_ai_students_4f25e37ed64e` finished at 2026-10-05 09:27:45 UTC using a
fresh local database, the production credential and 99 provider dispatches:
80 application calls and 19 adaptive synthetic learner generations. All tracked
application-source hashes stayed unchanged during the evaluation. No classroom
records were used or modified.

| Scenario | Result |
| --- | --- |
| Cumulative recap after correction | All three corrections recognized; earlier question answered; progress grounded in student explanations. |
| Brief explanation then detail | Short explanation without a quiz; numerical example stated assumptions; stopping preference respected. |
| Mixed reasoning and questions | Correct concise reasoning credited; subsequent questions answered directly. |
| Several errors, partial correction | Distractor endorsement counted as evidence; the two unresolved errors remained unresolved. |
| Little reasoning, then pause | Correct guesses did not become mastery; pause and resume preserved the attempt without inferring dislike. |
| Revisions, alternatives and replays | Revised answers used; revision events retained; duplicate submissions/messages created no extra calls. |
| Qualified reasoning and challenge | Scientific qualifications credited; internal consistency distinguished from temporal stability. |
| Language and internal details | Generated tutor text remained English; hidden labels were withheld; ordinary conceptual discussion resumed. |

All 27 tutor generations validated without semantic regeneration. One unchanged
Terra-medium profile-integration role produced a high-confidence overclaim; the
existing validator rejected it and automatic repair succeeded before release to
the conversation. This recovery also occurred in the earlier medium baseline.
It remains in the audit, rather than being counted as a flawless first response.
Some requested summaries still repeat concepts; this is a pacing observation.

Research audits passed for all eight attempts: 24 item records, 46 exact-matching
student/tutor turns, three profile transitions, source-role and evidence links,
confidence carry-forward and 37 checksum-verified manifest entries per attempt.
Missing browser/input telemetry remained null. The teacher dashboard service
reported the correct completion counts. No new browser exposure test was run.

## Timing and token comparison

The baseline is the latest successful earlier medium-reasoning run of each same
scenario, on the preceding application source. Initial scenarios and follow-up
counts match, but generated conversations, caches and provider conditions differ.
Both sets contain 80 application calls and 27 tutor calls. They are descriptive
comparisons, not randomized A/B estimates.

| Measure | Earlier medium | Low plus deduplication |
| --- | ---: | ---: |
| Median tutor call latency | 11.34 s | 7.36 s |
| Mean tutor input tokens | 30,596 | 25,300 |
| Mean profiling input tokens | 51,499 | 40,691 |
| Mean initial-feedback input tokens | 8,279 | 8,088 |
| Mean initial-feedback reasoning tokens | 758 | 250 |
| Mean tutor reasoning tokens | 388 (27 calls) | 138 (27 calls) |
| Median initial-feedback call latency | 19.93 s | 19.78 s |

Tutor latency ranged from 3.25 to 26.84 seconds in the new round. Local submission
returned in 47-167 ms while background preparation continued. Lower reasoning did
not materially change median initial-feedback latency in this sample. Body-byte
reductions are larger than total input-token reductions because instructions and
output schemas remain present; they must not be reported as equivalent savings.

## Cost per assessment attempt

Read-only production usage for attempts started since September 28 contained 14
completed attempts with complete input/output token totals. Their estimated mean
AI cost before this release was **US$0.71-0.89 per completed mini-test attempt**.
The typical completed attempt had two recorded tutor calls (range 1-4). Some
production records are synthetic checks, so this is not a classroom-only sample.

The eight new synthetic attempts cost **US$0.47 each on average**, compared
with **US$0.61** for the matching prior scenarios, a descriptive reduction of
about 23%. These totals include
preparation, application retries and conversation calls, but exclude synthetic
learner generation, hosting, database charges and tax. They are not a forecast
for long conversations or larger item packages. The production estimate's range
reflects cache-detail gaps, not missing input/output totals. The synthetic
comparison includes usage nested in accepted-output provider wrappers; omitting
those wrappers would undercount recorded cache and reasoning details.

Prices used per million tokens (USD), checked against official model pages:

| Model | Uncached input | Cached input | Output including reasoning |
| --- | ---: | ---: | ---: |
| [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) | 4.00 | 0.40 | 20.00 |
| [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) | 2.00 | 0.20 | 12.00 |
| [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | 0.20 | 0.02 | 1.20 |

For recorded cache details, call cost = `((input - cached - cache_write) *
input_rate + cached * cached_rate + cache_write * input_rate * 1.25 + output *
output_rate) / 1,000,000`. Reasoning is already included in output. Without cache
details, input cost is bounded between all cached and all cache-write pricing;
unknown cache-write counts with known cached counts use ordinary input as the
lower bound and the cache-write premium as the upper bound. Calls with no usage
are not treated as zero. Large-context tier multipliers apply when relevant.
The estimate is not an invoice or a guarantee of future cost.

## Verification and limits

75 base offline deduplication assertions (231 including all eight saved-input
replays), five legacy compaction suites, 88 approval
integrity checks, ten focused database suites, typecheck and the clean-snapshot
production build passed. Lint retained five existing warnings and zero errors.
The dependency gate retained the previously authorized build-only exception;
production dependencies had zero findings.

All 52 live input-projection audits were independently reconstructed and matched
their saved source/wire hashes, byte sizes and encoding statistics. Reconstruction
excludes the initial-feedback record's audit-only `runtime_budget` addition and
follows `accepted_output.provider_raw_output` when present. Neither difference
represents omitted model evidence or lost research data.

The first build attempt was blocked by sandbox IPC restrictions, and the direct
local retry reached its default 4 GB heap ceiling. The clean snapshot passed
using the existing 12 GB build-only setting. A historical July activation test
still has stale profiling prompt identities; its focused planning subset and the
current approval-chain checks pass. No production validator was relaxed.

This round covers three-item packages with two to four learner replies, not
12-item packages, 30-turn endurance or classroom-scale concurrency. Deployment
identity and activation evidence are recorded separately in the Word release
record; passing local tests alone does not mean the setting is live.
