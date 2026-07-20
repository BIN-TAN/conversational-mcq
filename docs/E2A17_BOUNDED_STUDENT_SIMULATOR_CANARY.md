# E2A.17 Bounded Independent Student-Simulator Canary

E2A.17 evaluates the unapproved Topic Dialogue candidate in four isolated,
synthetic, multi-turn sessions. It does not approve or activate the candidate,
does not run the 36-session matrix, and does not create approval evidence.

## Frozen boundary

- Candidate configuration hash:
  `f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a`
- Candidate file SHA-256:
  `a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8`
- Approved active V2 hash:
  `8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`
- Frozen E2A.17 protocol hash:
  `34f6ece0965958b2fcd64e888234ac3f309d4ff083bd0afe26ae406f4200a913`
- Source E2A.16 run:
  `e2a16_20260720071641_9e2e4f59`

The source-frozen harness must be committed and the tracked worktree must be
clean before dispatch. After dispatch begins, candidate, protocol, simulator,
tutor runtime, prompts, schemas, validators, routing, and progression logic
must not change.

## No-live checks

```bash
npm run eval:formative:e2a17:protocol-smoke
npm run eval:formative:e2a17:budget-smoke
npm run eval:formative:e2a17:information-flow-smoke
npm run eval:formative:e2a17:fixture-isolation-smoke
npm run eval:formative:e2a17:request-compilation
npm run eval:formative:e2a17:provider-call-guard-smoke
npm run eval:formative:e2a17:preflight
```

The injected-mock smoke executes the same persistence, candidate V3 runtime,
projection, transcript-refresh, privacy, and cleanup boundaries without a
provider request.

## Authorized live command

Use the source-freeze commit as `<checkpoint-commit>`. The credential remains
in the ignored local environment or canonical credential file and must never be
printed.

```bash
RUN_LIVE_E2A17=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
OPERATIONAL_APPROVED_CONFIG_HASH=8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993 \
npm run eval:formative:e2a17:live -- \
  --checkpoint-commit <checkpoint-commit> \
  --candidate-hash f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a \
  --protocol-hash 34f6ece0965958b2fcd64e888234ac3f309d4ff083bd0afe26ae406f4200a913 \
  --max-sessions 4 \
  --max-simulator-calls 24 \
  --max-initial-tutor-calls 24 \
  --max-tutor-regeneration-calls 24 \
  --max-total-generation-calls 72 \
  --max-adapter-attempts 216 \
  --max-input-tokens 2112000 \
  --max-output-tokens 180000 \
  --max-total-tokens 2292000 \
  --max-cost-usd 30 \
  --confirm-paid-provider-evaluation \
  --confirm-four-independent-sessions \
  --confirm-sequential-concurrency-one \
  --confirm-human-review-remains-pending \
  --confirm-candidate-remains-unapproved \
  --confirm-no-36-session-matrix \
  --confirm-stop-after-canary
```

The command is single-use. A prior live E2A.17 artifact blocks another run.
Artifacts are written incrementally under
`.data/e2a17-bounded-student-simulator-canary/<run_id>/`.

## Human review

`human-review-packet.json` includes every effective tutor response and every
rejected or regenerated tutor attempt. Human decisions remain null. The only
automated passing status is
`e2a17_canary_pass_pending_human_review`; it is not approval or activation.

## Recorded result

The single authorized live canary ran from dispatch checkpoint
`a10915dfdeb5c8f24c72de2b948d35d2a1295b04` and produced immutable run
`e2a17_20260720080442_b0e3f036` under
`.data/e2a17-bounded-student-simulator-canary/`.

- Final status: `e2a17_canary_incomplete`
- Early-abort reason:
  `e2a17_simulator_contract_failure:evidence_level_exceeded`
- Completed sessions: `0/4`
- Persisted student turns / visible tutor replies: `0 / 0`
- Simulator calls: `1`
- Initial tutor calls / tutor regenerations: `0 / 0`
- Total generation calls / adapter attempts / transport retries: `1 / 1 / 0`
- Input / output / reasoning / total tokens: `675 / 215 / 107 / 890`
- Recorded provider latency: `5526 ms`
- Cost: unavailable because complete pricing metadata was not available; no
  cost was fabricated
- Deterministic fallbacks / soft-only regenerations: `0 / 0`
- Synthetic fixture cleanup: passed
- Candidate and approved V2 integrity: passed
- Candidate approved / activated: `false / false`
- Approval or activation evidence created: `false`
- 36-session matrix run: `false`
- Human-review tutor output count: `0`; no tutor call occurred

All 25 required artifact paths were created. Artifact-integrity validation did
not pass because 13 downstream JSONL artifacts are empty after the mandatory
pre-persistence simulator-contract abort. The provider output, usage,
candidate/protocol integrity, early-abort reason, and cleanup evidence remain
preserved. The live canary must not be rerun. The next decision requires review
of the simulator contract failure and a separately authorized future phase;
this result does not permit the 36-session matrix, approval, or activation.
