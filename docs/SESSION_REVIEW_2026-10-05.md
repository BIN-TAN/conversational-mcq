# Assessment transcript and process review: October 5

## Scope

Reviewed five supplied transcript/process-summary pairs: one assessment started
October 5, two October 1, and two September 25. A newly downloaded file is not a
new AI conversation: the four older transcripts retain their original generation
dates even when the process data record an October 5 return. Identifiable source
files remain outside the repository; no student responses are copied here.

## Findings and action

1. The newest Test 7 opening is specific and conceptually useful. It recognizes
   the correct point about different forms and explains why score conversion alone
   does not establish comparability. The student provided no chat reply in the
   supplied observation, so this opening is not evidence of subsequent learning.
   The distinction is consistent with [ETS's reliability and comparability
   guidance](https://www.ets.org/research/policy_research_reports/publications/periodical/2020/kgqh.html).
2. An older Test 5 collection repeatedly requested a rewritten reason after an
   uncertainty statement. Current collection policy already accepts on-topic
   uncertainty and limits neutral clarification of fragments. Existing regression
   checks cover those branches; this review does not rewrite the historical record
   or present an old loop as a newly observed Sol-low failure.
3. The older Test 5 tutor used hypothetical variance components whose source the
   student subsequently questioned. The current prompt already requires invented
   numbers to be labeled as illustrative. Long explanations in that transcript
   often followed explicit requests for further explanation; length alone is not
   a defect. The reliability distinctions broadly match [ETS's basic-concepts
   guide](https://www.ets.org/research/policy_research_reports/publications/report/2018/jysw.html).
4. Current pause reporting was easy to misread: four records contained assessment
   pauses linked to the conversation while conversation-only counters were zero.
   The teacher view and JSON now show the scopes separately and include join IDs.
5. A returning attempt carried a prior visit's tutor-display receipt into a later
   pause interval, yielding approximately 3.9 days. The new shared pause projection
   keeps that receipt but leaves current-visit latency null unless a display was
   acknowledged since the latest resume/view-open. This correction also applies
   to `pause_episodes.csv`; its dictionary records the rule and projection version.
6. Three transcripts contain no student chat reply; one contains one reply and
   one contains eight. Ending, pausing, partial display and submitted dialogue are
   separate observations. Conversation closure is now explicit in the teacher
   summary. No satisfaction, avoidance, misconduct or improvement is inferred.
7. Chinese text occurs in teacher/research topic metadata, not tutor message bodies
   in these transcripts. Current student metadata projection and output validation
   retain English presentation while preserving original teacher/research content.

## Data boundaries

The supplied JSON files are teacher process summaries, not full research ZIPs.
Item IDs, recorded response stages, display-to-turn references, pause arithmetic,
message counts and source chronology can be checked from them. Full profile
interpretations, source-call validity and all research-table joins require the
underlying records or complete export. Missing input telemetry remains null.
Initial explanation time, server prompt-response intervals and browser submission
times use different clocks/contracts; their differences do not by themselves
indicate missing responses. Attempt time spans include days between visits and
are not active study time.

Changes are read-only projections and teacher presentation. Student prompts,
Sol-low settings, scores, assessment limits and historical research evidence are
unchanged. Automated tests use synthetic data. Verification and deployment results
are retained in the release record rather than inferred from this review.

## Verification

All five supplied pairs passed local consistency checks: 194 transcript turns,
18 items, 75 stage visits and eight pause episodes. Checks covered session/item
identity, ordered unique turn sequences, display-to-tutor references, recorded
choice/confidence actions, student chat totals, nonnegative stage durations,
monotonic submission-time calculations and pause-duration arithmetic. No tutor
message body contained Chinese text. These checks establish consistency within
the exports, not equivalence to all underlying database rows.

The participation and process-summary suites, 46 collection/learning-summary
checks and 13 English/mixed-intent checks passed. Eight isolated-database suites
passed for research export integrity, readable transcripts, analysis-ready export,
timing dictionary, resumed sessions, visibility, item timing and conversational
flow. Desktop/mobile browser checks and screenshot review passed, as did
typechecking, changed-file lint and a clean-snapshot production build.

A supplemental production read-only query did not return a result through the
remote command channel. It is not counted as a successful source-record audit.
No new live AI conversation was generated for these read-only reporting changes.
