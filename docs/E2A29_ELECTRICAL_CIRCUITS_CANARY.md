# E2A.29 Electrical-Circuits Canary

E2A.29 is one explicitly authorized, isolated live evaluation session for the
unapproved autonomous topic-dialogue candidate. It uses the held-out
electrical-circuits protocol frozen by E2A.28a. The authorization does not
permit a rerun, another live session, a broader matrix, E2B, approval,
activation, or deployment.

## Held-Out Scenario

The domain is introductory electrical circuits. The target distinction is
that a simple steady-state series circuit has the same current through each
component while electrical energy is transferred. The active distractor says
that a bulb uses up current, so less current leaves the bulb than enters it.

The planned trajectory is materially different from the antimicrobial-
resistance and geometrical-optics sessions. It includes a concise
misconception, echoed tutor wording, partial improvement, a correct
conservation mechanism paired with explicit endorsement of the wrong option,
a natural clarification, and later independent coherent rejection. The
contradictory response must become a finalized non-sound learning state rather
than an infrastructure abort. Genuine sound rejection must trigger immediate
revision with no later tutor call.

Deterministic overlap analysis covers exact, normalized, token, structural,
and bounded lexical-semantic checks against E2A.24 responses, E2A.25 through
E2A.28 provider evidence, E2A.26/E2A.26a/E2A.27a calibration data, prompt
examples, and target-contract examples. This analysis uses no embeddings and
makes no network request.

## Frozen Boundary

- Authoritative E2A.28a run:
  `e2a28a_20260722100440_2157dea0`
- Frozen protocol hash:
  `369535b52c909eb8bc3875d3a0cb6a97afb0acfa0dd1fb902eae9493e12d3a9b`
- Candidate configuration hash:
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`
- Candidate file SHA-256:
  `d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2`
- Approved V2 hash retained:
  `8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`
- Dispatch commit:
  `c5e1b1ac06f5619f139c5178e29f4ec18f67dee9`
- Composite runtime identity:
  `ea2ac31d7921ed05e9a3c2a868f2d257311ff9a42fbe2f00215705ec6013d7fd`

## Resource Ceiling

The maximum preliminary budget is one isolated session, nine simulator calls,
nine evaluator calls, nine tutor calls, two tutor regenerations, 29 logical
generation calls, 87 adapter attempts, 900,000 input tokens, 70,000 output
tokens, 970,000 total tokens, USD 25 when pricing is available, and provider
concurrency one. Expected normal use is six simulator calls, six evaluator
calls, five tutor calls, no regeneration, 17 logical calls, and 17 adapter
attempts.

The run was fail-closed at those limits. The user supplied separate explicit
authorization, and the committed harness required all authorization flags,
candidate and protocol hashes, application provenance, a one-use checkpoint,
clean tracked state, protected-evidence parity, database readiness, credential
readiness, and concurrency one before dispatch.

## Executed Result

The one authorized dispatch was consumed on 2026-07-22 as immutable run
`e2a29_20260722120813_3fd136e6`. It stopped with
`e2a29_canary_failed_evidence_accuracy` during the first evidence-evaluator
call. The exact fail-closed reason was:

```text
e2a29_provider_call_failed:evidence_evaluator:provider_5xx
```

The sanitized provider error is `openai_server_error` with HTTP status 520.
The evaluator returned no provider request or response ID, no raw output, and
no token usage. The platform therefore produced no structured evidence,
profile, progression decision, or tutor call. This is a transport/provider
failure, not evidence that the V5 semantic-anchor contract passed or failed.

The synthetic simulator completed turn 1 with the intended misconception:
the lamp was said to use up current to make light. Because evaluator evidence
was unavailable, the session completed zero accepted turns and never reached
the planned contradictory or sound-resolution turns.

Observed usage was one student-simulator call, one failed evidence-evaluator
call, no tutor calls, no tutor regeneration, two logical generation calls, two
adapter attempts, no transport retries, 765 input tokens, 93 output tokens,
858 total tokens, and 22,211 ms aggregate provider latency. Pricing metadata
was unavailable, so no cost was fabricated and the USD ceiling cannot be
independently verified from price data. All enforced call and token ceilings
remained within budget.

## Evidence and Human Review

The immutable evidence directory is:

```text
.data/e2a29-electrical-circuits-anchor-contradiction-canary/e2a29_20260722120813_3fd136e6
```

All 59 artifacts passed hash validation and are read-only. The four-item
`human-review-packet.json` binds the initial activity, simulator provider
result, visible synthetic student turn, failed evaluator result, provenance,
and null review fields. Human review cannot adjudicate evaluator accuracy,
tutor quality, contradiction handling, or sound progression because no
evaluator or tutor output exists. Ratings and recommendation remain null;
human review is pending and is not fabricated.

The post-run audit passed artifact integrity, protected-evidence parity,
failure-path completeness, budget accounting, synthetic-fixture cleanup, and
candidate/baseline preservation. The candidate remains unapproved and
inactive, approved V2 remains unchanged, and no later live stage ran.

Use only the read-only commands for this consumed run:

```bash
npm run eval:formative:e2a29:report -- --run e2a29_20260722120813_3fd136e6
npm run eval:formative:e2a29:audit -- --run e2a29_20260722120813_3fd136e6
```

E2A.29 did not pass and must not be rerun under the consumed authorization.
Any future transport retry or protocol change requires a separately frozen,
separately authorized evaluation stage.
