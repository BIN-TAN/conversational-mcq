# E2A.36a Student Self-Correction Intent Envelope

E2A.36a is a deterministic, no-provider correction for the simulator intent
boundary exposed by E2A.36. It does not rerun E2A.36, execute E2A.37, change
Evaluator V5, change the tutor candidate, change learning-profile evolution,
change adaptive stopping, approve or activate a candidate, or authorize a
larger evaluation stage.

## Historical boundary

The immutable E2A.36 run remains:

`e2a36_20260725033701_3afd3874`

Its status remains:

`e2a36_canary_failed_stability`

At Turn 4, both permitted simulator attempts produced visible
self-correction:

1. `I think I need to change what I said. I was too quick to call it accurate enough.`
2. `I think I need to change what I said before. I was too quick about it.`

Both structured outputs used `unsupported_understanding_claim`. The old
validation boundary treated intent metadata alignment as authoritative enough
to stop the run, despite the compatible visible interaction behavior. No
Turn 4 evaluator or tutor call occurred.

All 113 historical artifacts remain read-only and byte-stable at aggregate
SHA-256:

`7e2983e517009a179b0f75c7c50cf0031bedcf9b829d2383203d9ae462aceadc`

E2A.36 remains failed. This correction does not reinterpret it as passed.

## Intent envelope

`self-correction-intent-envelope-v2` separates three decisions:

1. **Visible interaction behavior** determines whether the student visibly
   self-corrects, reflects, expresses uncertainty, makes an unsupported
   understanding claim, or provides an ordinary response.
2. **Simulator metadata** remains stored for audit, but is non-authoritative.
   Exact metadata-label equality is not required when visible behavior falls
   inside the allowed envelope.
3. **Conceptual evidence update** remains a separate evaluator-backed
   decision. Correction wording or metadata cannot create conceptual evidence,
   profile-update eligibility, or misconception resolution.

The shared simulator validator uses this envelope only when the permitted
response is revision evidence. Other simulator intents retain their existing
strict metadata validation.

Required boundaries are:

| Visible response | Interaction result | Conceptual update |
|---|---|---|
| `I was wrong because reliability does not prove validity.` | self-correction accepted | true when independently supported by conceptual evidence |
| `I was wrong, I choose another option.` | self-correction accepted | false |
| `I understand now.` | unsupported understanding claim | false |
| `Actually, I am not sure anymore.` | reflection/uncertainty accepted | false |
| Self-correction with a contradictory conclusion | self-correction accepted | non-sound update; misconception remains |

The V2 envelope is domain-neutral. It contains no educational-measurement
answer rule and cannot bypass evidence, contradiction, profile, or stopping
contracts.

## Calibration and replay

The deterministic calibration contains 160 cases: 10 behavior/evidence
archetypes across 16 generic contexts. It covers:

- evidence-bearing correction;
- answer revision without reasoning;
- unsupported understanding claims;
- reflection and uncertainty;
- contradictory correction;
- natural revision phrasing;
- correction with independent evidence;
- conceptual evidence without correction metadata;
- metadata that overstates visible behavior; and
- uncertain reconsideration.

All 160 cases and seven focused regression checks pass. The shared simulator
validator accepts a visible self-correction when metadata says
`unsupported_understanding_claim`, but rejects `I understand now.` even when
metadata says `revision_evidence`.

Immutable offline replay of both E2A.36 Turn 4 provider outputs now records:

- `self_correction_intent = true`;
- `conceptual_evidence_update = false`;
- `profile_update_eligible = false`;
- `metadata_alignment = compatible_disagreement`;
- `accepted_by_intent_envelope = true`; and
- no `rendered_intent_mismatch`.

The replay reads existing provider outputs and makes no provider or network
request.

## E2A.37 preparation

The inert protocol version is:

`e2a37-measurement-longitudinal-self-correction-intent-envelope-canary-v1`

Its protocol hash is:

`ddc5aff551509cb9e6f69cd788c6854564f92e25344745589cc1756a9ea39383`

Its preparation composite runtime identity is:

`9eb18e82648a67d07ba19a2435b655c50fb0c41c1118584a2ebc7dbc65fbbd7d`

The protocol binds the V2 contract and source, the shared simulator validator,
the unchanged candidate, Evaluator V5, tutor candidate, learning-profile and
stopping-policy source, the immutable E2A.36 tree, budget, and artifact
contract.

The inert budget is one isolated session, 29 logical calls, 87 adapter
attempts, at most three adapter attempts and two transport retries per logical
call, 900,000 input tokens, 70,000 output tokens, 970,000 total tokens, USD 25
when pricing metadata is available, and provider concurrency one.

E2A.37 is `prepared_not_authorized_not_executable`. It has no provider
dispatch path in this phase.

## Artifacts

The authoritative no-live packet is:

`.data/e2a36a-self-correction-intent-envelope/e2a36a_20260725T040453Z_6f3a315d/`

It contains 16 read-only artifacts. Artifact validation, historical integrity,
protected-source integrity, calibration, regressions, replay, E2A.37 protocol,
and provider-call guard all pass. Provider calls and network requests are zero.

## Commands

```bash
npm run eval:formative:e2a36a:run
npm run eval:formative:e2a36a:report
npm run eval:formative:e2a36a:smoke
npm run eval:formative:e2a36a:calibration-smoke
npm run eval:formative:e2a36a:regression-smoke
npm run eval:formative:e2a36a:replay-smoke
npm run eval:formative:e2a36a:historical-integrity-smoke
npm run eval:formative:e2a36a:e2a37-protocol-smoke
npm run eval:formative:e2a36a:artifact-smoke
npm run eval:formative:e2a36a:provider-call-guard-smoke
```

No command in this set creates a provider client or authorizes live
execution.
