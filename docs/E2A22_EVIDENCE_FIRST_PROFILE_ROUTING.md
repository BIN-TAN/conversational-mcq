# E2A.22 Evidence-First Profile Routing

E2A.22 corrects platform orchestration for formative topic dialogue without
making provider calls. It does not change the tutor candidate, tutor prompts,
provider-facing output schemas, tutor validators, simulator classifier V3,
model settings, history limits, retry policy, or deterministic fallback
implementations.

## Scope and frozen evidence

- Approved active V2: `8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`
- Inactive tutor candidate: `f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a`
- Tutor candidate file SHA-256: `a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8`
- Simulator classifier: `student-simulator-evidence-classifier-v3`
- Classifier SHA-256: `9fd28385a6b70d72c02ec7e73adcc54d179e80226abda0edecad8771377bc899`
- Historical replay source: `e2a21_20260720110713_3f9764d1`

Historical evidence is read only. E2A.22 writes new artifacts under
`.data/e2a22-evidence-first-profile-routing/`.

## Historical production order

Before E2A.22, `processTopicDialogueResponse` performed these relevant steps:

1. Validate the student message and claim the idempotency key.
2. Persist the accepted student `conversation_turn`.
3. Build the authoritative interpretation context.
4. Run the formative activity response evaluator and persist its evidence.
5. Build the post-activity decision.
6. Stage the updated student profile and formative plan.
7. Build the topic-dialogue input and provider request.
8. Generate the tutor response.
9. Apply progression/action gates after generation.
10. Persist the staged profile, plan, effective tutor response, and projections.

The latest response was evaluated before generation, so the defect was not a
confirmed stale pre-response profile. The gap was that there was no immutable
turn-level profile bound to the accepted turn, no cumulative latest-evidence
state persisted before dispatch, no authoritative response mode and operation
selected from that state before request construction, and no freshness
assertion. E2A.21 routed directly from the scalar classifier result without a
full revision-readiness decision.

## Corrected order

The accepted topic-dialogue path now performs the following before any provider
dispatch:

1. Validate and accept the student message.
2. Persist it and retain its authoritative `sequence_index`.
3. Classify immediate interaction intent.
4. Run existing formative response and post-activity evidence evaluation.
5. Stage the existing full profile and plan update.
6. Create an authoritative turn-level evidence profile.
7. Integrate that profile into cumulative evidence state using latest evidence
   precedence.
8. Determine misconception status and revision readiness.
9. Select the platform-owned response mode and dialogue operation.
10. Persist the profile, cumulative state, and route on the student turn.
11. Re-read the latest accepted student turn and assert profile freshness.
12. Construct the tutor request with the profile, route, and authorization.
13. Generate, validate, canonicalize, persist, project, and display the
   effective tutor response.

The provider receives the selected route as an authoritative input. The
platform action gate uses authorization derived from that route. A response
whose action fields do not match the selected route is replaced using the
existing response-mode fallback before persistence.

## Turn evidence profile

`topic-dialogue-turn-evidence-profile-v1` records:

- snapshot identity and source turn identity;
- authoritative source sequence index;
- evaluator, concept, and distractor anchor;
- immediate interaction intent;
- reasoning quality and anchor application;
- current misconception status;
- missing links, contradictions, and observable evidence spans;
- available confidence evidence;
- revision, transfer, and completion readiness;
- limitations and creation time.

Revision readiness requires all of the following for the current ordinary
conceptual response:

- sound reasoning;
- explicit anchor application;
- `resolved_for_current_anchor` status;
- no essential missing link;
- no contradiction.

There is no minimum-turn requirement.

## Cumulative evidence policy

`topic-dialogue-cumulative-evidence-profile-v1` retains historical profile and
misconception snapshot IDs while making the latest conceptual evidence
authoritative for the current route. A sound later response can resolve the
current anchor even when earlier turns contain misconception evidence. A later
contradiction can reopen the misconception. Counts of older weak turns do not
outvote a later sound response.

Protected requests, off-topic messages, and task-language clarification receive
immediate routing priority but do not erase a previously sound conceptual
profile.

## Routing policy

Immediate routes are:

- protected request: `protected_redirect`;
- off-topic response: `redirect_off_topic`;
- task-language confusion: `clarify_task`.

Ordinary conceptual routes are:

- insufficient evidence: `elicit_anchor_evidence`;
- current misconception: `clarify_concept_with_new_strategy`;
- reopened misconception: `repair_recurrence`;
- partial evidence: `refine_partial_reasoning`;
- sound anchor-specific evidence: `request_revision`;
- accepted revision: `present_transfer`;
- accepted independent transfer evidence: `complete_episode`.

Revision, transfer, and completion remain separate actions.

## E2A.21 replay result

All six historical student messages were replayed with no provider call. The
deterministic anchor-specific adjudicator found:

| Turn | Current evidence | Corrected route |
|---|---|---|
| 1 | Misconception | `clarify_concept_with_new_strategy` |
| 2 | Partial | `refine_partial_reasoning` |
| 3 | Sound | `request_revision` |
| 4 | Sound | `request_revision` |
| 5 | Sound | `request_revision` |
| 6 | Sound | `request_revision` |

The first operation-level divergence is turn 1. Therefore, later historical
turns are path-dependent and are not claimed as a literal counterfactual
session. The earliest independently evaluated revision-ready response is turn
3. No counterfactual tutor outputs were generated.

The required quoted response at turn 6 is sound, explicitly applies the
theta-difficulty relationship to Item 16 option A, has no essential missing
link, and routes to `request_revision`.

Classifier V3 remains unchanged. E2A.22 adds a fuller platform-owned
revision-readiness profile instead of rewriting historical classifier evidence.

## E2A.23 draft

E2A.23 is prepared but not authorized or executed. Its draft limits are:

- one isolated session;
- six student turns and twelve visible dialogue turns;
- six simulator calls;
- six initial tutor calls;
- two tutor regenerations;
- fourteen logical generation calls;
- forty-two provider adapter attempts;
- 400,000 input tokens;
- 31,000 output tokens;
- 431,000 total tokens;
- USD 10 maximum estimated cost when pricing is available;
- provider concurrency one.

E2A.23 requires separate explicit authorization. E2A.24 and the 36-session
matrix are not authorized by E2A.22.

## Commands

Generate the no-live E2A.22 artifacts:

```bash
npm run eval:formative:e2a22:run
```

Run focused checks:

```bash
npm run eval:formative:e2a22:profile-first-routing-smoke
npm run eval:formative:e2a22:stale-profile-guard-smoke
npm run eval:formative:e2a22:e2a21-replay-smoke
npm run eval:formative:e2a22:idempotency-smoke
npm run eval:formative:e2a22:progression-separation-smoke
npm run eval:formative:e2a22:request-compilation
npm run eval:formative:e2a22:e2a23-protocol-smoke
npm run eval:formative:e2a22:e2a23-budget-smoke
npm run eval:formative:e2a22:provider-call-guard-smoke
```

Report an existing run:

```bash
npm run eval:formative:e2a22:report -- --run <run_id>
```

No E2A.22 command authorizes candidate approval, activation, or a live call.
