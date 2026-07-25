# E2A.38a Longitudinal Evidence Update Decoupling

E2A.38a is a deterministic, no-provider correction for the longitudinal
evidence-update boundary exposed by E2A.38. It does not rerun E2A.38, execute
E2A.39, change Evaluator V5, change the sound gate, change the tutor candidate,
change adaptive stopping, change the trajectory envelope, approve or activate
a candidate, or authorize a larger evaluation stage.

## Historical boundary

The immutable E2A.38 run remains:

`e2a38_20260725104322_25d11b2c`

Its status remains:

`e2a38_canary_failed_evidence_accuracy`

At Turn 5, Evaluator V5 accepted a sound ordinary conceptual response with an
explicit distractor rejection, no blocking contradiction, and no essential
missing links. The sound gate and trajectory envelope correctly selected
immediate revision. Longitudinal profile evolution nevertheless retained an
earlier partial profile because the integration passed a
self-correction-specific conceptual-update flag into the ordinary-response
path. Adaptive stopping read the stale partial profile and selected
`continue_dialogue`.

All 122 historical artifacts remain read-only and byte-stable at aggregate
SHA-256:

`01217f4ba5b103711577fd4c485d4e6903e82911390044203f3b4e7ad68f4898`

E2A.38 remains failed. This correction does not reinterpret it as passed.

## Source contract

`conceptual-evidence-update-source-v1` separates:

1. **Conceptual evidence update** from accepted evaluator evidence.
2. **Self-correction intent** as interaction context rather than evidence.
3. **Self-correction evidence context** for correction turns only.

The resolver selects one of three sources:

- `ordinary_evaluator_evidence` for accepted, observable ordinary conceptual
  evidence mapped to a valid profile update;
- `self_correction_evidence` when a correction turn contains independently
  supported conceptual evidence; or
- `no_eligible_conceptual_evidence` for intent-only, copied, unsupported,
  uncertain, or non-conceptual responses.

An ordinary conceptual response does not depend on self-correction flags.
Partial or misconception evidence may update the current profile without
becoming sound. Sound still requires explicit anchor rejection, conceptual
consistency, no essential missing links, and no contradiction. The source
contract does not modify those sound criteria.

The contract hash is:

`cf8dc2cef12aa5b170e0ae29333f8f3a448dfb0664b265edd501f7aa4e822790`

The implementation hash is:

`340eb064feb814b2c9e2584b2242cdf24cc72afe06373d9aa228f6086129fafe`

## Calibration and regressions

The deterministic calibration contains 180 cases: 12 evidence archetypes
across 15 generic contexts. It covers ordinary sound, partial, misconception,
missing, copied, and unsupported evidence; correction with evidence;
intent-only correction; copied correction; contradictory correction;
reflection; and non-conceptual responses.

All five required regressions pass:

- sound evidence without self-correction updates the current profile;
- self-correction without evidence preserves the prior profile;
- sound followed by regression reopens the profile;
- partial evidence remains partial; and
- adaptive stopping uses the latest valid profile.

## E2A.38 Turn 5 replay

The replay reads the immutable Turn 5 evaluator, mapper, profile, engagement,
and self-correction artifacts without reading from a provider.

Before correction:

- sound gate: passed;
- longitudinal current reasoning quality: `partial`;
- effective stopping expectation: `continue_dialogue`.

After applying the new source resolver:

- source: `ordinary_evaluator_evidence`;
- self-correction intent: false;
- conceptual update: true;
- longitudinal current reasoning quality: `sound`;
- adaptive stopping decision: `stop_formative_dialogue`;
- revision readiness: true;
- tutor dispatch allowed: false.

The unchanged stopping policy receives the corrected latest-valid profile and
produces the required terminal decision.

## Protected components

Byte-level integrity checks confirm no changes to:

- the GPT-5.6 candidate manifest;
- the autonomous tutor candidate;
- Evaluator V5;
- sound-gate criteria;
- `adaptive-stopping-policy-v1`; or
- `trajectory-envelope-v1`.

The correction adds a source-selection layer only. It does not weaken
evaluation, soundness, or progression criteria.

## E2A.39 preparation

The inert protocol version is:

`e2a39-longitudinal-evidence-update-decoupling-canary-v1`

Its protocol hash is:

`eac352266f94853ffec1de832c3506cfc41d6ecbc73e6b0b894165035d4bf3f8`

Its preparation composite runtime identity is:

`6dde1efb41bf86a9bfaa840d92f69cf88052d4a4ce9a9ec4913dca5379f35c4f`

The protocol binds the new source contract and implementation, the unchanged
candidate and protected components, the immutable E2A.38 tree, the artifact
contract, and a bounded one-session budget.

E2A.39 is `prepared_not_authorized_not_executable`. It has no live entrypoint
or provider-dispatch path in this phase.

## Artifacts

The authoritative no-live packet is:

`.data/e2a38a-longitudinal-evidence-update-decoupling/e2a38a_20260725T110802444Z_198f05a9/`

It contains 16 read-only artifacts. Historical integrity, protected-source
integrity, calibration, regressions, replay, E2A.39 preparation, artifact
validation, and provider-call guard all pass.

Key SHA-256 values:

- `summary.json`:
  `81001f21303a2911f0ec552233fd2b5fffae8be4873760743811cac015946e5a`;
- `e2a38-turn5-offline-replay.json`:
  `2fa25ee45d920787f362c36301a9793d4d65a9c62d0efbfa5efbe3b27037dc80`;
- `e2a39-protocol.json`:
  `8cfb749e5b37e5cf68ed8367bb7ed840f7881698e37cb86e743fc72d4b0dc2aa`;
- `e2a39-composite-runtime-identity.json`:
  `868c89683de0a4c80f83e5558f79a274c240801f6ca04a8f08f8f4de240b0c83`;
- `artifact-validation.json`:
  `37124d0bed2eee61b7fdf288f42a75d3e9bd704485645484087afaaf99ccae68`.

Provider calls and network requests are zero.

## Commands

```bash
npm run eval:formative:e2a38a:run
npm run eval:formative:e2a38a:report
npm run eval:formative:e2a38a:smoke
npm run eval:formative:e2a38a:contract-smoke
npm run eval:formative:e2a38a:calibration-smoke
npm run eval:formative:e2a38a:regression-smoke
npm run eval:formative:e2a38a:replay-smoke
npm run eval:formative:e2a38a:historical-integrity-smoke
npm run eval:formative:e2a38a:e2a39-protocol-smoke
npm run eval:formative:e2a38a:artifact-smoke
npm run eval:formative:e2a38a:provider-call-guard-smoke
```

No command in this set creates a provider client or authorizes live execution.
