# E2A.33 Causal-Inference Protocol Freeze

E2A.33 is a deterministic, no-live protocol freeze for one introductory
statistics and causal-inference scenario. It does not authorize or execute a
provider request, approve or activate the candidate, or begin a larger
evaluation stage.

## Held-out scope

The initial activity is:

> A study found that students who spend more hours using a certain educational
> app receive higher exam scores. The researcher concludes that using the app
> causes students to perform better. Do you agree? Explain.

The active distractor is option D:

> The app improves exam performance because students gain skills directly from
> the app.

The canonical anchor is:

`causal_inference_educational_app_item_1:option:D`

E2A.24 already contained an abstract correlation-versus-causation target.
E2A.33 therefore does **not** claim that the broad concept is unseen. Its
held-out scope is the exact educational-app/exam-score scenario, the
motivation-or-study-habits confounder mechanism, the canonical anchor and
aliases, and the trajectory envelope.

Deterministic exact, normalized, token, structural-template, and semantic-tag
audits compare E2A.33 against E2A.24 through E2A.32. They disclose the expected
E2A.24 concept overlap and E2A.32 `trajectory-envelope-v1` reuse while requiring
that no prior scenario is reused. No embedding or provider request is used.

## Evidence contract

The frozen `TargetEvidenceContractV5` requires a sound response to:

1. distinguish an observed correlation from an identified causal effect;
2. identify a plausible confounder such as motivation or study habits;
3. explain how the confounder can affect both app use and exam scores;
4. state why stronger causal evidence, such as a randomized experiment, is
   needed;
5. explicitly reject the active causal distractor; and
6. reach a coherent conclusion.

There is no minimum turn count. The production sound gate authorizes immediate
revision whenever the complete evidence boundary passes.

The required contradiction fixture identifies a confounder and explains the
correlation limitation while still endorsing option D. Resolver V3,
anchor-stance resolver V1, contradiction propagation V2, and the production
sound gate produce:

- `anchor_application = explicit`
- `anchor_stance = endorses_distractor`
- `anchor_consistency = contradictory_to_conceptual_reasoning`
- `revision_ready = false`

## Trajectory envelope

The E2A.33 role vocabulary contains:

- `misconception`
- `copied_wording`
- `partial_improvement`
- `contradiction`
- `clarification`
- `sound`

Each role defines an allowed reasoning-quality set, a sound-gate override rule,
progression consequences, and prohibited states. These are simulator-intended
roles, not exact evaluator labels. A separate deterministic projection maps the
roles into the unchanged `trajectory-envelope-v1` runtime contract.

The deterministic suite covers:

- early sound overriding the intended trajectory;
- prolonged partial reasoning;
- contradiction after conceptual improvement;
- copied wording without understanding;
- confidence/correctness mismatch;
- explicit distractor endorsement;
- explicit distractor rejection; and
- transfer of causal reasoning to another observational association.

Evaluator evidence is preserved in every case. Correctness or confidence does
not promote incomplete reasoning, and every sound-gate pass requires immediate
revision.

## Frozen boundary

The protocol version is:

`e2a33-causal-inference-trajectory-envelope-canary-v1`

The frozen protocol hash is:

`c6536a9861c91692e9d5d26a6868f43d79c87d23dd2f9e7cf4dc744ef4ffa45b`

The composite runtime identity binds the application commit, protocol and
source hashes, candidate configuration, evaluator V5, target contract,
canonical anchor, resolver versions, contradiction propagation V2,
`trajectory-envelope-v1`, the production sound gate, and protected-source
hashes. It is generated in each artifact packet and should be read from
`composite-runtime-identity.json` after the freeze commit.

The inert maximum budget is one isolated session, 29 logical generation calls,
87 adapter attempts, two transport retries per logical call, 900,000 input
tokens, 70,000 output tokens, 970,000 total tokens, USD 25 when pricing metadata
is available, and provider concurrency one.

## Commands

```bash
npm run eval:formative:e2a33:run
npm run eval:formative:e2a33:report -- --run <run_id>
npm run eval:formative:e2a33:smoke
npm run eval:formative:e2a33:trajectory-envelope-smoke
npm run eval:formative:e2a33:contradiction-smoke
npm run eval:formative:e2a33:held-out-domain-smoke
npm run eval:formative:e2a33:artifact-smoke
npm run eval:formative:e2a33:provider-call-guard-smoke
```

Artifacts are written under:

`.data/e2a33-causal-inference-protocol-freeze/<run_id>/`

No E2A.33 live session, provider dispatch, candidate approval or activation,
larger matrix, E2B stage, or deployment is authorized by this freeze.
