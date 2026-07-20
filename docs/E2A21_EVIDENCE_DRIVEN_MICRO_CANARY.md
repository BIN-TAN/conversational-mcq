# E2A.21 Evidence-Driven Micro-Canary

E2A.21 is one explicitly authorized, isolated, live-provider session for the
Item 16 information-function misconception. It evaluates the unapproved and
inactive tutor candidate without changing the approved V2 operational bundle.

## Frozen Boundary

- approved active V2 hash: `8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`
- tutor candidate hash: `f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a`
- tutor candidate file SHA-256: `a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8`
- classifier: `student-simulator-evidence-classifier-v3`
- classifier SHA-256: `9fd28385a6b70d72c02ec7e73adcc54d179e80226abda0edecad8771377bc899`
- orchestration: `e2a20-evidence-driven-session-orchestration-v1`
- frozen protocol hash: `ad396a3a0f2aaf06941288019067262c32e44a306467f191e734a0e0e66da7c6`
- authoritative protocol source: `.data/e2a20a-turn4-classification-adjudication/e2a20a_20260720103109_e94fce3d/e2a21-readiness-update.json`

The candidate remains evaluation-only, unapproved, and inactive. E2A.17 and
E2A.19 are historical inputs and are not rerun.

## Evidence Control

Each provider-generated student response is schema parsed and classified by
classifier V3. The observed visible evidence, not the requested objective or
the simulator's self-report, controls the hidden-state update, tutor route, and
revision eligibility. A valid below-target response is persisted and receives
one tutor response. The sixth below-target response terminates as
`completed_valid_bounded_stop` without forced revision.

The only successful terminal outcomes are:

- `passed_required_endpoint`
- `completed_valid_bounded_stop`

Both require complete persistence, projection, transcript, privacy,
information-flow, cleanup, and usage checks. Human review remains pending.

## Authorized Budget

The live command is fail closed at one session, six simulator calls, six
initial tutor calls, two tutor regenerations, fourteen logical calls,
forty-two adapter attempts, 400,000 input tokens, 31,000 output tokens,
431,000 total tokens, USD 10 when complete pricing is available, and provider
concurrency one. Missing pricing remains null rather than being fabricated.

## Commands

No-live verification:

```bash
npm run eval:formative:e2a21:smoke
npm run eval:formative:e2a21:preflight
```

The live command requires the committed dispatch checkpoint and all explicit
authorization arguments. It must be run only once:

```bash
RUN_LIVE_E2A21=1 LLM_PROVIDER=openai LLM_LIVE_CALLS_ENABLED=true \
npm run eval:formative:e2a21:live -- \
  --confirm-e2a21-single-session-authorization \
  --confirm-paid-provider-evaluation \
  --confirm-single-isolated-session \
  --confirm-sequential-concurrency-one \
  --confirm-human-review-remains-pending \
  --confirm-candidate-remains-unapproved \
  --confirm-no-e2a17-rerun \
  --confirm-no-e2a19-rerun \
  --confirm-no-four-session-canary \
  --confirm-no-36-session-matrix \
  --confirm-no-e2b \
  --confirm-stop-after-micro-canary \
  --candidate-hash f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a \
  --candidate-file-sha256 a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8 \
  --classifier-version student-simulator-evidence-classifier-v3 \
  --classifier-sha256 9fd28385a6b70d72c02ec7e73adcc54d179e80226abda0edecad8771377bc899 \
  --orchestration-version e2a20-evidence-driven-session-orchestration-v1 \
  --protocol-hash ad396a3a0f2aaf06941288019067262c32e44a306467f191e734a0e0e66da7c6 \
  --checkpoint-commit <dispatch-checkpoint> \
  --max-sessions 1 \
  --max-student-turns 6 \
  --max-visible-dialogue-turns 12 \
  --max-simulator-calls 6 \
  --max-initial-tutor-calls 6 \
  --max-tutor-regeneration-calls 2 \
  --max-total-logical-calls 14 \
  --max-adapter-attempts 42 \
  --max-input-tokens 400000 \
  --max-output-tokens 31000 \
  --max-total-tokens 431000 \
  --max-cost-usd 10
```

Artifacts are written incrementally under
`.data/e2a21-evidence-driven-micro-canary/<run_id>/`. The report command is:

```bash
npm run eval:formative:e2a21:report -- --run <run_id>
```

## Result

Not executed at harness freeze. This section is updated only after the single
authorized live dispatch. No result authorizes candidate approval, activation,
the four-session canary, the 36-session matrix, or E2B.
