# E2A.19 Single-Session Student-Simulator Micro-Canary

## Scope

E2A.19 is one explicitly authorized live, isolated synthetic session. It uses
the frozen Session 1 protocol produced by E2A.18 and the unchanged tutor
candidate under evaluation. It does not rerun E2A.17, execute the four-session
canary, execute the 36-session matrix, approve the candidate, or activate it.

The simulator request prompt, output schema, response objectives, and hidden
state mapping remain unchanged from E2A.17. Observable student-language
evidence is classified by `student-simulator-evidence-classifier-v2` before a
student turn is persisted. Provider self-reported evidence levels are audit
metadata and do not control the decision.

## Frozen Boundary

- Candidate configuration hash:
  `f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a`
- Candidate file SHA-256:
  `a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8`
- Approved active V2:
  `8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`
- Frozen protocol hash:
  `66b63f107ad6b2cc2141720ed3d644935a5a99dd5962934eb914968541a0b46c`
- Simulator contract: `e2a18-student-simulator-contract-v2`
- Evidence classifier: `student-simulator-evidence-classifier-v2`

The dispatch checkpoint commit, classifier file hash, artifact-contract hash,
source-logic aggregate, and protected-evidence aggregate are recorded by the
preflight after the harness is committed. A dirty tracked tree, changed commit,
candidate mismatch, protocol mismatch, classifier mismatch, historical
evidence mismatch, existing live run, duplicate process, or live lock blocks
dispatch.

## Limits

- one isolated synthetic session;
- six simulator calls maximum;
- six initial tutor calls maximum;
- two tutor regenerations maximum;
- fourteen logical generation calls maximum;
- forty-two adapter attempts maximum, including bounded retries;
- 400,000 input tokens maximum;
- 31,000 output tokens maximum;
- 431,000 total tokens maximum;
- USD 10 maximum when complete pricing metadata is available;
- provider concurrency one.

Incomplete pricing is recorded as null rather than fabricated. The run aborts
on the first deterministic tutor fallback, soft-only regeneration, safety
finding, invalid transition, missing response, source mismatch, or budget
failure.

## Pre-Dispatch

Run the complete no-live suite and commit the harness. Then record the clean
checkpoint:

```bash
CHECKPOINT_COMMIT="$(git rev-parse HEAD)"
npm run eval:formative:e2a19:preflight -- \
  --live \
  --checkpoint-commit "$CHECKPOINT_COMMIT"
```

The preflight makes no provider request. It requires `RUN_LIVE_E2A19=1`,
`LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, the approved V2 hash,
the canonical server-side OpenAI credential, the approved provider hostname,
PostgreSQL readiness, and a clean source checkpoint.

## Authorized Live Command

Run exactly once after preflight succeeds:

```bash
RUN_LIVE_E2A19=1 npm run eval:formative:e2a19:live -- \
  --confirm-paid-provider-evaluation \
  --confirm-single-isolated-session \
  --confirm-sequential-concurrency-one \
  --confirm-human-review-remains-pending \
  --confirm-candidate-remains-unapproved \
  --confirm-no-e2a17-rerun \
  --confirm-no-four-session-canary \
  --confirm-no-36-session-matrix \
  --confirm-stop-after-micro-canary \
  --candidate-hash f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a \
  --candidate-file-sha256 a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8 \
  --protocol-hash 66b63f107ad6b2cc2141720ed3d644935a5a99dd5962934eb914968541a0b46c \
  --checkpoint-commit "$CHECKPOINT_COMMIT" \
  --max-sessions 1 \
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

No retry of the live micro-canary is authorized in this phase. Human-review
fields remain null after execution. The four-session canary remains blocked
until every E2A.19 review item is explicitly reviewed.

## Result

Pending the single authorized execution.
