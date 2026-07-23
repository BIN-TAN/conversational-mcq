# E2A.32 Held-Out Protocol Freeze

E2A.32 preparation is deterministic and no-live. It applies the E2A.31c
adjudication correction without changing evaluator V5 or the tutor candidate.
It does not authorize or execute a provider request.

## Trajectory envelope

`trajectory-envelope-v1` separates three concerns:

1. **Simulator intended trajectory** describes the pedagogical role that a
   synthetic student turn is intended to play.
2. **Acceptable reasoning-quality envelope** records a set of plausible
   evaluator outcomes for that turn. It is an adherence observation, not an
   evaluator oracle.
3. **Progression consequences** are derived from observable evidence and the
   existing production sound gate.

Every future canary turn defines:

- `expected_trajectory_role`
- `allowed_reasoning_quality_set`
- `sound_gate_override_rule`
- `progression_consequence`
- `prohibited_states`

Exact expected reasoning labels and a scripted earliest-sound turn are
prohibited. The evaluator's evidence classification is preserved even when it
falls outside the simulator envelope.

The sound-gate override is:

`production_sound_gate_overrides_trajectory_expectation_and_requires_immediate_revision`

If `sound-gate-anchor-consistency-v1` passes, revision begins immediately. A
scripted expectation that the student would still be partial cannot delay
revision or convert the result into an evaluator failure.

## Deterministic boundaries

The no-live regression suite covers:

| Case | Evaluator behavior | Progression behavior |
|---|---|---|
| Sound earlier than scripted | Preserve `sound` | Begin revision immediately |
| Partial longer than scripted | Preserve `partial` | Continue evidence-targeted support |
| Regression after improvement | Preserve the lower observed quality | Reopen targeted support |
| Contradiction after sound | Preserve the contradictory evidence | Block progression and reopen support |
| Copied wording without evidence | Do not infer independent evidence | Request independent evidence |

Trajectory expectations never rewrite evaluator output. Prohibited copied or
contradictory states remain fail-closed.

## Held-out domain

E2A.32 prepares one synthetic chemistry case:

- domain: chemistry
- topic: dynamic chemical equilibrium
- canonical anchor:
  `chemical_equilibrium_rates_item_1:option:C`
- distractor claim:
  "At chemical equilibrium, reactant and product concentrations must be equal
  because the forward and reverse reaction rates are equal."

The target boundary is that equal forward and reverse rates imply no net
concentration change, not equal concentration values. A sound response must
explain the mechanism, apply it explicitly to the active anchor, reject the
equal-concentration claim, and retain no contradiction.

Deterministic exact, normalized, token, structural, and semantic-tag checks
compare the held-out case against E2A.24 through E2A.31. The comparison makes no
embedding or provider request.

## Frozen preparation

The protocol version is:

`e2a32-chemical-equilibrium-trajectory-envelope-canary-v1`

The frozen protocol hash is:

`f0b6f8ee805a4e414fcfbbfc21aae405f522b0eb43a8032b63bd50b5960cf68e`

The preparation binds:

- `trajectory-envelope-v1`
- evaluator V5 and its production request/schema contract
- active-anchor resolver V3
- anchor-stance resolver V1
- `sound-gate-anchor-consistency-v1`
- the unchanged autonomous-dialogue tutor candidate
- the held-out target-evidence and alias contracts
- deterministic trajectory regressions
- overlap, budget, artifact, and provider-call guards

The frozen maximum budget is one isolated session, 29 logical generation calls,
87 adapter attempts, two transport retries per logical call, 900,000 input
tokens, 70,000 output tokens, 970,000 total tokens, USD 25 when pricing metadata
is available, and provider concurrency one. These are inert ceilings; this
phase grants no dispatch authority.

## Commands

All commands install or require a fetch guard:

```bash
npm run eval:formative:e2a32:run
npm run eval:formative:e2a32:report -- --run <run_id>
npm run eval:formative:e2a32:smoke
npm run eval:formative:e2a32:trajectory-envelope-smoke
npm run eval:formative:e2a32:held-out-domain-smoke
npm run eval:formative:e2a32:artifact-smoke
npm run eval:formative:e2a32:provider-call-guard-smoke
```

Artifacts are written under:

`.data/e2a32-chemical-equilibrium-protocol-freeze/<run_id>/`

No E2A.32 live session, candidate approval, candidate activation, larger matrix,
E2B stage, or deployment is authorized by this freeze.
