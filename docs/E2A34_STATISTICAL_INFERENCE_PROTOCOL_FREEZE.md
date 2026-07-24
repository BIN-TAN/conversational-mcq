# E2A.34 Statistical-Inference Protocol Freeze

E2A.34 is a deterministic, no-live protocol freeze for one research-methods
statistical-inference scenario. It does not authorize or execute a provider
request, approve or activate the candidate, or begin a larger evaluation
stage.

## Held-out scope

The initial activity is:

> A researcher conducts a hypothesis test and obtains p = .03. The researcher
> concludes: "Because p = .03, there is a 97% chance that the research
> hypothesis is true." Do you agree? Explain.

The active distractor is option D:

> The probability of the research hypothesis being true can be directly
> calculated from the p-value.

The canonical anchor is:

`research_methods_p_value_interpretation_item_1:option:D`

The target mechanism distinguishes the probability of data under the null
hypothesis from the probability of a hypothesis given the data. The protocol
requires the null-hypothesis reference condition, the unusual-data
interpretation, the conditional-probability direction, explicit rejection of
the direct hypothesis-probability claim, and a coherent conclusion. It also
records that stronger inferential claims need appropriate statistical
reasoning and supporting design assumptions.

This is not a renamed E2A.33 causal-inference scenario. E2A.33 concerns causal
identification, association, and confounding. E2A.34 concerns inversion of a
null-conditional p-value into a posterior hypothesis probability. Its planned
content contains no educational-app, exam-score association, confounder, or
causal-effect alias.

## Frozen contracts

The packet freezes:

1. `TargetEvidenceContractV5`
2. `e2a34-p-value-canonical-anchor-v1`
3. the active anchor alias contract
4. `e2a34-p-value-anchor-stance-v1`
5. the E2A.34 projection of `trajectory-envelope-v1`
6. `e2a34-artifact-contract-v1`
7. `e2a34-bounded-canary-budget-v1`
8. `e2a34-composite-runtime-identity-v1`

Reference resolution and stance resolution remain separate. The target-bound
alias and stance evidence covers:

- direct endorsement of the 97% interpretation;
- direct rejection of the hypothesis-probability interpretation;
- uncertainty;
- negation;
- contrast;
- contextual pronouns; and
- paraphrases.

The deterministic alias calibration contains 20 cases. It uses the unchanged
reference and stance resolvers and adds no statistical-inference logic to those
shared services.

## Trajectory envelope

The simulator-intended roles are:

- `misconception`
- `copied_wording`
- `partial_improvement`
- `contradiction`
- `clarification`
- `sound`

They define allowed reasoning-quality sets and progression consequences, not
authoritative turn labels. Observable evidence and the unchanged production
sound gate remain authoritative.

The required contradiction says that the p-value assumes the null while still
endorsing the 97% hypothesis-probability claim. The deterministic resolver,
contradiction propagation, and sound gate preserve:

- `anchor_application = explicit`
- `anchor_stance = endorses_distractor`
- `anchor_consistency = contradictory_to_conceptual_reasoning`
- `revision_ready = false`

The required sound state explains that p = .03 describes unusual data under
the null and does not mean a 97% probability that the research hypothesis is
true. Sound evidence authorizes immediate revision with no minimum turn count.

Nine deterministic regressions cover:

- early sound overriding trajectory intent;
- prolonged partial reasoning;
- contradiction after partial improvement;
- copied statistical wording without understanding;
- confidence/correctness mismatch;
- explicit distractor endorsement;
- explicit distractor rejection;
- missing statistical reasoning; and
- sound rejection of the p-value misconception.

The E2A.33d preservation prerequisite is loaded by hash. Evaluator essential
missing links must survive the V7 mapper and must reach the unchanged sound
gate before sound can be authorized.

## Overlap audit

Exact, normalized, token, structural-template, and deterministic semantic-tag
checks compare E2A.34 against E2A.24 through E2A.33d. Thirteen historical-stage
inputs pass. Reuse is limited to the declared `trajectory-envelope-v1`
protocol structure; no prior scenario is reused. The audit uses no embedding,
network, or provider request.

## Frozen identity

The protocol version is:

`e2a34-statistical-inference-trajectory-envelope-canary-v1`

The frozen protocol hash is:

`83ddef09e6d70631ce30f1161659fe85aa25b3bcc38891ba7b3f7bc6a9e0c405`

The canonical no-live artifact run is:

`e2a34_20260724T153144381_ffc2d6a3`

Its composite runtime identity is:

`39f61e1aa128a7586b1c6f534c6401ffaadbdc61ab59e54943556dde84f35195`

The identity binds the protocol and source hashes, candidate configuration,
evaluator V5, target evidence contract, canonical anchor, stance contract,
reference and stance resolvers, contradiction propagation, mapper
evidence-preservation contract, pre-tutor finalization, production sound gate,
trajectory envelope, transport retry policy, and protected-source hashes.

## Inert budget

The frozen maximum is:

- one isolated session;
- 29 logical generation calls;
- 87 adapter attempts;
- two transport retries per logical call;
- 900,000 input tokens;
- 70,000 output tokens;
- 970,000 total tokens;
- USD 25 when pricing metadata is available; and
- provider concurrency one.

This budget is metadata only. E2A.34 execution is not authorized by this
freeze.

## Commands

```bash
npm run eval:formative:e2a34:run
npm run eval:formative:e2a34:report -- --run <run_id>
npm run eval:formative:e2a34:smoke
npm run eval:formative:e2a34:trajectory-envelope-smoke
npm run eval:formative:e2a34:held-out-domain-smoke
npm run eval:formative:e2a34:canonical-anchor-smoke
npm run eval:formative:e2a34:stance-resolver-smoke
npm run eval:formative:e2a34:mapper-preservation-smoke
npm run eval:formative:e2a34:sound-gate-smoke
npm run eval:formative:e2a34:evaluator-v5-request-smoke
npm run eval:formative:e2a34:artifact-smoke
npm run eval:formative:e2a34:provider-call-guard-smoke
```

Artifacts are written under:

`.data/e2a34-statistical-inference-protocol-freeze/<run_id>/`

No live E2A.34 session, provider dispatch, candidate approval or activation,
larger matrix, E2B stage, or deployment is authorized.
