# E2A.23 Evidence-First Micro-Canary

E2A.23 is the authorized, exactly-once, one-session live validation of the
E2A.22 profile-first routing correction. It evaluates the inactive tutor
candidate without approving or activating it. E2A.17, E2A.19, E2A.21, the
four-session canary, the 36-session matrix, and E2B are outside this run.

## Frozen identity

- Approved active V2: `8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`
- Tutor candidate: `f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a`
- Tutor candidate file SHA-256: `a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8`
- Simulator classifier: `student-simulator-evidence-classifier-v3`
- Classifier SHA-256: `9fd28385a6b70d72c02ec7e73adcc54d179e80226abda0edecad8771377bc899`
- Routing: `e2a22-evidence-first-profile-routing-v1`
- Protocol hash: `1ecdb5c85e9c4b5192b91e2fe56191f5ef5ceb4c3294f5540ac9b4fe53fdaf72`
- Artifact contract: 33 named artifacts under
  `.data/e2a23-evidence-first-micro-canary/<run_id>/`

The dispatch checkpoint is the clean harness commit. The runner freezes the
application commit, routing, activity-runtime, evidence-evaluator, protocol,
artifact-contract, source-logic, candidate, classifier, and protected-evidence
hashes before the first provider request and verifies them after each request.

## Execution order

For every accepted student message, the runner persists the turn, classifies
intent, evaluates current conceptual evidence, creates one immutable turn
profile, updates cumulative evidence, selects the platform-owned route, checks
profile freshness, and only then constructs the tutor request. A stale profile
fails closed. Sound anchor-specific evidence must route immediately to
`request_revision`; there is no minimum dialogue-turn requirement.

## Budget and stopping rules

The run is limited to one isolated session, six student turns, twelve visible
dialogue turns, six simulator calls, six initial tutor calls, two tutor
regenerations, fourteen logical calls, forty-two adapter attempts, 400,000
input tokens, 31,000 output tokens, 431,000 total tokens, USD 10 when complete
pricing is available, and provider concurrency one. The first deterministic
fallback or any stale-profile, safety, progression, transcript, or source
integrity failure stops the run.

The preferred endpoint is `revision_authorized`. Exhausting six valid turns
without revision-ready evidence is a bounded stop pending adjudication, not a
pass of the profile-first revision objective.

## No-live verification

```bash
npm run eval:formative:e2a23:smoke
npm run eval:formative:e2a23:protocol-smoke
npm run eval:formative:e2a23:budget-smoke
npm run eval:formative:e2a23:composite-identity-smoke
npm run eval:formative:e2a23:profile-first-routing-smoke
npm run eval:formative:e2a23:stale-profile-guard-smoke
npm run eval:formative:e2a23:latest-evidence-precedence-smoke
npm run eval:formative:e2a23:no-minimum-turn-smoke
npm run eval:formative:e2a23:progression-separation-smoke
npm run eval:formative:e2a23:idempotency-smoke
npm run eval:formative:e2a23:information-flow-smoke
npm run eval:formative:e2a23:fixture-lifecycle-smoke
npm run eval:formative:e2a23:artifact-contract-smoke
npm run eval:formative:e2a23:request-compilation
npm run eval:formative:e2a23:authorization-guard-smoke
```

The preflight makes no provider request. After committing the harness and
building the checkpoint source, run it with the same live environment that
will be used for dispatch:

```bash
CHECKPOINT_COMMIT="$(git rev-parse HEAD)"
RUN_LIVE_E2A23=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
npm run eval:formative:e2a23:preflight -- \
  --live \
  --checkpoint-commit "$CHECKPOINT_COMMIT"
```

## Authorized exactly-once command

Run only after every no-live check passes and the tracked tree is clean:

```bash
CHECKPOINT_COMMIT="$(git rev-parse HEAD)"
RUN_LIVE_E2A23=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
npm run eval:formative:e2a23:live -- \
  --candidate-hash f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a \
  --candidate-file-sha256 a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8 \
  --classifier-version student-simulator-evidence-classifier-v3 \
  --classifier-sha256 9fd28385a6b70d72c02ec7e73adcc54d179e80226abda0edecad8771377bc899 \
  --orchestration-version e2a22-evidence-first-profile-routing-v1 \
  --protocol-hash 1ecdb5c85e9c4b5192b91e2fe56191f5ef5ceb4c3294f5540ac9b4fe53fdaf72 \
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
  --max-cost-usd 10 \
  --checkpoint-commit "$CHECKPOINT_COMMIT" \
  --confirm-e2a23-single-session-authorization \
  --confirm-paid-provider-evaluation \
  --confirm-single-isolated-session \
  --confirm-sequential-concurrency-one \
  --confirm-human-review-remains-pending \
  --confirm-candidate-remains-unapproved \
  --confirm-no-e2a17-rerun \
  --confirm-no-e2a19-rerun \
  --confirm-no-e2a21-rerun \
  --confirm-no-four-session-canary \
  --confirm-no-36-session-matrix \
  --confirm-no-e2b \
  --confirm-stop-after-micro-canary
```

Do not rerun the command after an E2A.23 live run directory exists. Report an
existing run with `npm run eval:formative:e2a23:report -- --run <run_id>`.
Every human-review decision remains null until an actual human completes the
separate review. E2A.24 remains unauthorized.
