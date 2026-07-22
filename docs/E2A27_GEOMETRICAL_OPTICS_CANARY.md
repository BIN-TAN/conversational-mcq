# E2A.27 Geometrical-Optics Canary

E2A.27 is one explicitly authorized, isolated live evaluation session for the
unapproved autonomous topic-dialogue candidate. It uses the held-out
geometrical-optics protocol frozen by E2A.26a. It does not authorize a rerun,
a broader matrix, E2B, approval, activation, or deployment.

## Frozen Boundary

- Authoritative E2A.26a run:
  `e2a26a_20260722035845_e8280a5f`
- Frozen protocol hash:
  `1eb8f769c354e3dfcf5ebe488692a4f4b46e8cf6bba67cd54bdd79d8faa5325c`
- Candidate configuration hash:
  `b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b`
- Candidate file SHA-256:
  `d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2`
- Approved V2 hash retained:
  `8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`

The protocol tests whether a response can correctly explain converging-lens
ray behavior while still reaching a contradictory conclusion about option B.
The V3 evaluator, mapper, consistency policy, anchor interpretation, and sound
gate must keep that response non-sound. Revision is permitted only after an
independent, coherent rejection of the distractor.

## Resource Ceiling

The single run is fail-closed at one session, 29 logical generation calls, 87
adapter attempts, 900,000 input tokens, 70,000 output tokens, 970,000 total
tokens, and USD 25 when pricing metadata is available. Calls are sequential at
provider concurrency one. Expected normal usage is 6 simulator calls, 6
evidence-evaluator calls, 5 initial tutor calls, no regeneration, and 17
logical calls.

## Operator Sequence

Before dispatch, run the no-live checks, commit the harness, write current
build provenance, and create the ignored dispatch checkpoint:

```bash
npm run eval:formative:e2a27:smoke
npm run eval:formative:e2a27:authorization-guard-smoke
npm run app:build-info:write
npm run eval:formative:e2a27:checkpoint
```

The live command requires every confirmation and the exact dynamic values in
`.data/e2a27-geometrical-optics-anchor-consistency-canary/e2a27-dispatch-checkpoint.json`:

```bash
RUN_LIVE_E2A27=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
npm run eval:formative:e2a27:live -- \
  --confirm-e2a27-one-session-authorization \
  --confirm-paid-provider-evaluation \
  --confirm-exactly-one-isolated-session \
  --confirm-sequential-concurrency-one \
  --confirm-human-review-remains-pending \
  --confirm-candidate-remains-unapproved \
  --confirm-no-four-session-canary \
  --confirm-no-36-session-matrix \
  --confirm-no-e2b \
  --confirm-no-approval \
  --confirm-no-activation \
  --confirm-stop-after-e2a27 \
  --checkpoint-commit <checkpoint-commit> \
  --protocol-hash 1eb8f769c354e3dfcf5ebe488692a4f4b46e8cf6bba67cd54bdd79d8faa5325c \
  --candidate-hash b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b \
  --candidate-file-sha256 d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2 \
  --composite-identity-hash <checkpoint-composite-identity-hash> \
  --max-sessions 1 \
  --max-simulator-calls 9 \
  --max-evaluator-calls 9 \
  --max-initial-tutor-calls 9 \
  --max-tutor-regenerations 2 \
  --max-logical-calls 29 \
  --max-adapter-attempts 87 \
  --max-input-tokens 900000 \
  --max-output-tokens 70000 \
  --max-total-tokens 970000 \
  --max-cost-usd 25
```

The candidate hash, checkpoint commit, and composite identity are validated by
the harness. Operators must not edit source or frozen configuration after the
checkpoint is recorded.

## Evidence and Review

Artifacts are written incrementally under
`.data/e2a27-geometrical-optics-anchor-consistency-canary/<run_id>/`. The run
retains sanitized provider evidence, complete visible history, V3 target
evidence and anchor interpretation, profiles, routes, interventions,
persistence/projection audits, privacy findings, usage, cleanup evidence, and
a human-review packet. Human ratings remain null. No authorization data,
secret, hidden simulator objective, or chain-of-thought is stored.

Use the read-only commands after the one dispatch:

```bash
npm run eval:formative:e2a27:report -- --run <run_id>
npm run eval:formative:e2a27:audit -- --run <run_id>
```

The only passing status is `e2a27_canary_pass_pending_human_review`. A pass
does not approve or activate the candidate and does not establish production
readiness.

## Executed Result

The one authorized live dispatch was consumed on 2026-07-22. It produced the
immutable run `e2a27_20260722061521_9bd4a441` and stopped fail-closed with
`e2a27_canary_failed_anchor_interpretation`. Do not rerun E2A.27 under this
authorization.

The run reached the deliberate turn-4 mechanism/conclusion conflict. The
student simulator explained that the outgoing rays remain divergent and that
only backward extensions meet, but still endorsed option B. The independent
evaluator recognized that conflict in its safe summary and rationale. The
target/profile mapping did not promote it to the required structured
`anchor_conclusion_conceptual_explanation_conflict`, so the run aborted with
`e2a27_anchor_contradiction_not_structured`. No turn-4 output was displayed or
persisted as an effective response. Every generated turn-4 provider output was
retained in the failure-path and human-review evidence.

Observed usage was 4 simulator calls, 4 evidence-evaluator calls, 4 initial
tutor calls, no tutor regenerations, 12 logical calls, 12 adapter attempts,
37,651 input tokens, 8,874 output tokens, 3,579 reasoning tokens, 46,525 total
tokens, no transport retries, and 194,721 ms aggregate provider latency.
Pricing metadata was unavailable, so no cost was fabricated. All hard call and
token limits remained within budget.

The run directory contains 54 hash-validated artifacts, including a 23-item
human-review packet whose ratings remain null. Synthetic fixture cleanup,
privacy, candidate integrity, approved-V2 integrity, and protected-evidence
hash parity passed. The candidate remains unapproved and inactive, and no
later live stage ran.

The shared post-run audit command currently reports
`approved_v2_hash_changed` because it reads that property from
`canary-summary.json`, where the harness did not serialize it. The immutable
`candidate-integrity.json` records the unchanged approved V2 hash
`8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`.
This is a post-run audit/report-contract defect, not evidence of an approved
configuration change. Frozen source was not modified after dispatch.

Two failed-run reporting limitations also remain. The human-review packet
retains all 23 visible/provider evidence items and leaves every rating null,
but provider-output items do not each embed their exact prior visible
conversation; completed-turn histories are stored separately for turns 1-3.
The failed-session student-burden metric also reports zero turns instead of the
observed 4 attempted and 3 fully persisted turns. These gaps block treating
the packet as fully review-complete.

The local `operational:approval-manifest:verify` command also reports current
environment assertion mismatches for three model variables and a missing
`OPERATIONAL_APPROVED_CONFIG_HASH`. This no-provider check does not change the
approved bundle or E2A.27 evidence, but the environment must be reconciled
before any broader runtime-readiness claim.
