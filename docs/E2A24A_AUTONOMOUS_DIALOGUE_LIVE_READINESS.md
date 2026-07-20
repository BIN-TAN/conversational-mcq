# E2A.24a Autonomous Dialogue Live Readiness

E2A.24a is a no-live audit and protocol-freeze phase. It does not execute
E2A.25, approve the autonomous candidate, activate it, or change approved V2.

## E1 correction

The current E1 suite's earlier 11/12 result was a genuine behavioral
regression, not an expected-negative test. The package-to-feedback router
found the first distractor item and option but did not persist those target
fields on its runtime attempt. The evidence contract consequently used
`current_item/current_option`, so an explicit Item 1, option B response could
not satisfy anchor application. The correction propagates the existing target
item and option into the attempt and makes route alignment reject internally
contradictory progression fields. No E1 invariant was weakened and the frozen
candidate manifest was not changed.

All 12 E1 scenarios are positive expected-behavior scenarios. E2A.24a reports
positive passes, expected-negative passes, and unexpected failures separately.

## Frozen E2A.25 protocol

The protocol contains exactly three held-out sessions:

- linguistics and phonology: concise incomplete evidence followed by a short,
  noncanonical sound explanation;
- economics and decision theory: a verbose high-confidence sunk-cost error,
  an ineffective intervention, frustration, strategy adaptation, and a sound
  resolution or human-reviewed bounded stop;
- computer science algorithms: informal low-confidence evidence, copied tutor
  wording, a mixed contradiction, and an independent sound application.

Every accepted conceptual turn must be persisted and evaluated before a tutor
call. Sound evidence immediately enters revision, with no minimum-turn rule and
no tutor call after sound. Human ratings remain null until review.

The maximum session capacity is 17 visible entries: one initial activity,
eight student turns, and eight tutor turns. This is below the 21-entry complete
history limit, so no truncation or summary-only substitution is permitted.
Episodes longer than 21 entries remain a future context-scaling issue.

Expected normal usage for the frozen trajectories is 10 simulator calls, 10
evaluator calls, and 7 tutor calls, or 27 logical generation calls. The hard
ceiling remains 78 logical calls, 234 adapter attempts, 2,400,000 input tokens,
180,000 output tokens, 2,580,000 total tokens, USD 60, and concurrency one.
Every future provider dispatch must check the budget first.

## Commands

Run a fresh no-live E1 suite, then generate the readiness artifacts:

```bash
OPERATIONAL_AGENT_MODE=disabled LLM_PROVIDER=mock \
LLM_LIVE_CALLS_ENABLED=false npm run eval:formative:all -- \
  --artifact-dir .data/e2a24a-e1-current --fail-on-major

npm run eval:formative:e2a24a:run -- \
  --e1-artifact-root .data/e2a24a-e1-current
npm run eval:formative:e2a24a:report
npm run eval:formative:e2a24a:smoke
```

The only readiness status is
`e2a24a_live_readiness_confirmed_e2a25_authorization_required`. It means the
no-live audit passed. A separate explicit authorization is still required to
execute E2A.25.
