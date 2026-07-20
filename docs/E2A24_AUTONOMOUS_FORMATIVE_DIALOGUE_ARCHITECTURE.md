# E2A.24 Autonomous Formative Dialogue Architecture

E2A.24 is a no-live architecture and candidate-design phase. It does not
approve or activate a configuration and it does not authorize E2A.25. The
approved V2 configuration remains active.

## Architecture finding

The approved dialogue path is evidence-first for progression, but ordinary
conceptual responses still use a platform-selected operation before tutor
generation. That operation-first boundary limits the tutor's ability to choose
the next pedagogical strategy from the complete episode history.

E2A.24 introduces an inactive candidate in which the platform evaluates the
latest turn first and the existing `topic_dialogue_agent` chooses the next
pedagogical strategy only when the authoritative current profile is not sound.
No new provider role is added.

## Platform authority

The platform retains exclusive control over:

- stage and response-mode authorization;
- revision, transfer, completion, and bounded-stop readiness;
- active item and distractor anchor;
- answer-key and hidden-instruction protection;
- persistence, sequence ordering, idempotency, and projections;
- turn and usage limits.

The fixed workflow remains:

```text
initial response package
-> package review
-> initial distractor-focused activity
-> autonomous formative dialogue
-> request revision
-> evaluate revision
-> present transfer
-> evaluate independent transfer
-> complete episode
```

The autonomous agent cannot authorize or perform any progression transition.

## Per-turn order

Every accepted formative-dialogue response follows this order:

1. Validate the student message.
2. Persist it with its authoritative sequence index.
3. Reconstruct the complete visible active episode.
4. Classify immediate interaction intent.
5. Run independent structured conceptual-evidence evaluation.
6. Create the latest-turn evidence profile.
7. Update the cumulative profile.
8. Determine sound understanding and revision readiness.
9. Select the platform response mode.
10. Invoke the autonomous tutor only when dialogue should continue.
11. Hard-validate the generated response.
12. Persist exactly one effective response.
13. Create student and audit projections.
14. Refresh the visible transcript.

The tutor request is rejected if its transcript or profile predates the latest
accepted student turn.

## Complete visible context

`complete-visible-formative-episode-v1` contains the initial activity and every
accepted student/effective tutor turn in exact chronological order. Each turn
contains only its visible ID, sequence index, dialogue turn number, actor type,
and exact visible message text. Hidden drafts, validator findings, and audit
metadata are excluded. The latest student message is also supplied separately
as the authoritative current turn. Raw visible turns are not truncated within
the frozen episode limit.

Both `formative_activity_response_evaluator_agent` and
`topic_dialogue_agent` receive this context. The
`post_activity_evidence_evaluator_agent` remains reserved for later
post-activity or progression evidence.

## Evidence and sound gate

The independent evaluator uses `production-turn-evidence-evaluator-v2` and a
generic `target-evidence-contract-v1`. The platform-owned mapper and consistency
policy remain `turn-evidence-profile-mapper-v2` and
`turn-evidence-profile-consistency-v2`.

Sound understanding requires every essential relationship and mechanism,
explicit anchor application, a coherent conclusion, no prohibited
contradiction, and no essential missing link. A sound latest profile sets
`resolved_for_current_anchor`, makes revision ready, selects
`request_revision`, and suppresses the tutor call. There is no minimum-turn
requirement. Earlier misconception evidence remains in the trajectory but does
not override later sound evidence; a later contradiction can reopen it.

Immediate protected, task-confused, and off-topic intents receive a
platform-owned response. Their conceptual evidence is still evaluated and
retained, including mixed-intent sound evidence.

## Autonomous tutor contract

The candidate versions `topic_dialogue_agent` as
`topic-dialogue-autonomous-pedagogy-v1`. It receives the complete visible
episode, latest authoritative profile, cumulative trajectory, target contract,
active anchor, missing links, contradictions, confidence/engagement evidence,
intervention outcomes, ineffective strategies, and current budget.

Its strict output contains:

- source profile and student-turn IDs;
- one primary learning gap and pedagogical goal;
- a concise free-text pedagogical strategy and fit rationale;
- considered prior interventions and repetition risk;
- evidence sought from the next response;
- one student-facing message and whether a response is required.

Former operation labels remain audit, analytics, fixture, and fallback
categories. They no longer preselect ordinary conceptual pedagogy.

## Intervention and validation policy

`pedagogical-intervention-memory-v1` stores the profile/turn source, targeted
gap, goal, strategy, message hash, sought evidence, next turn, observed outcome,
effectiveness note, and timestamp. The tutor must consider prior outcomes and
adapt after ineffective interventions. It is not given a permanent prohibited
strategy list.

Hard validation is limited to strict structure, stage/mode compatibility,
profile freshness, privacy, protected-answer/instruction controls,
provider-control fields, unauthorized progression, invalid transfer/completion
content, and exact high-confidence disallowed duplication. Pedagogical quality
and semantic repetition findings are audit-only unless clearly unusable or
unsafe. Only one bounded regeneration is allowed after a genuine hard reject.

## Candidate and no-live evidence

The separate manifest is:

`config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json`

Its deterministic configuration hash is
`b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`.
It inherits the prior candidate and changes only the topic-dialogue contract,
associated metadata, and frozen raw-turn window. All unrelated role hashes are
unchanged. The candidate is unapproved and inactive.

E2A.24 no-live evidence covers four academic domains, 120 heterogeneous
student-response specimens, complete-history serialization, latest-turn
freshness, sound/no-minimum-turn routing, strategy adaptation, intervention
memory, repetition, mixed intent, idempotency, progression separation, and
all-role request compilation. All provider and network call counts must remain
zero.

## E2A.25 draft only

E2A.24 prepares three isolated E2A.25 designs: rapid concise understanding,
verbose confident misconception with frustration, and noncanonical mixed
evidence. The frozen ceiling is 78 logical generation calls, 234 adapter
attempts, 2,400,000 input tokens, 180,000 output tokens, 2,580,000 total tokens,
USD 60, and provider concurrency one. E2A.25 is not executed or authorized by
this phase.
