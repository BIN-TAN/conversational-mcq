# E2A.35a Self-Correction Evidence Separation

E2A.35a is a deterministic, no-provider correction for the self-correction
evidence boundary exposed by E2A.35. It does not rerun E2A.35, execute E2A.36,
change Evaluator V5, change the tutor candidate, approve or activate a
candidate, or authorize a larger evaluation stage.

## Historical boundary

The immutable E2A.35 run remains:

`e2a35_20260724224131_d10b5897`

Its status remains:

`e2a35_canary_failed_stability`

Turn 2 produced two simulator messages:

1. `Actually, I think my previous answer was wrong. I would change it.`
2. `Actually, I think my previous answer was wrong. I would change what I said about D.`

Both messages express correction intent. Neither contains observable
sampling-bias mechanism evidence. The prior resolver correctly recognized
self-correction intent, but its revised-evidence heuristic promoted the second
message because it mentioned the active anchor and contained enough
non-stop-word tokens. That conflated an intent signal with a conceptual
evidence update.

The 96 historical artifacts remain read-only and byte-stable at aggregate
SHA-256:

`b514cfa4a17b391f353ef2de37548c68db74c60bc8a267964e2aa45345fba27b`

E2A.35 remains a historical failed run. This correction does not reinterpret
it as passed.

## Evidence separation

`self-correction-evidence-contract-v1` evaluates three separate decisions:

1. **Self-correction intent** records whether the student claims to revise an
   earlier response.
2. **Conceptual evidence update** requires observable conceptual evidence; a
   correction claim, answer revision, or anchor mention is insufficient.
3. **Profile update eligibility** is derived from the conceptual evidence
   decision, never from correction wording alone.

The required boundaries are:

| Student response | Intent | Conceptual update | Profile consequence |
|---|---:|---:|---|
| `I was wrong.` or `I meant D.` | true | false | preserve prior profile |
| `I was wrong because volunteers may differ systematically.` | true | true | evaluate latest evidence |
| Copied correction wording without independent explanation | true | false | preserve prior profile |
| `I was wrong, but D is still correct.` | true | non-sound only | update or reopen, never sound |

Conceptual evidence can also update the profile without self-correction
language. This inverse boundary prevents the intent detector from becoming a
prerequisite for legitimate new evidence.

Sound updates still require complete, consistent, independently applied
evidence, explicit anchor rejection, no essential missing links, and no
blocking contradiction. A contradiction or renewed misconception may reopen
the profile, but cannot authorize revision.

## Calibration and regressions

The deterministic calibration contains 160 cases: 16 correction/evidence
archetypes across 10 domain-neutral contexts. It includes:

- bare correction claims and answer revisions without reasoning;
- conceptual corrections;
- copied correction language;
- contradictions and regressions after correction;
- option mentions without evidence;
- valid correction plus explicit anchor rejection;
- correction language that preserves the misconception;
- uncertain correction language; and
- conceptual evidence without correction intent.

All 160 calibration cases and 10 focused regression cases pass. The suite also
asserts separation in both directions:

- self-correction intent does not imply a conceptual evidence update; and
- a conceptual evidence update does not require self-correction intent.

## Offline E2A.35 replay

The replay reads the two immutable Turn 2 provider outputs and applies the new
contract without a provider or network request. Both attempts now resolve to:

- `self_correction_intent = true`;
- `conceptual_evidence_update = false`;
- `profile_update_disposition = preserve_prior`;
- `latest_valid_evidence_eligible = false`;
- `sound_update_eligible = false`; and
- `revision_ready = false`.

The replay verifies the corrected boundary only. It does not complete, rerun,
or pass E2A.35.

## E2A.36 preparation

The inert protocol version is:

`e2a36-sampling-bias-self-correction-evidence-canary-v1`

Its protocol hash is:

`938da74e88c8590fc4038e0cd94d4dd0b7b1dbce19998578590efc1d587d952d`

Its preparation composite runtime identity is:

`18e6fb5fa568b1f1c7dcc40fe788ef3a7b107f98d5350f6a2edf201c1aa6c521`

The protocol has no provider-dispatch path. Execution is not authorized and
no live execution was performed. Its frozen budget is one isolated session,
29 logical calls, 87 adapter attempts, at most three adapter attempts and two
transport retries per logical call, 900,000 input tokens, 70,000 output
tokens, 970,000 total tokens, USD 25 when pricing metadata is available, and
provider concurrency one.

## Verification artifacts

The authoritative no-live run is:

`.data/e2a35a-self-correction-evidence-separation/e2a35a_20260725T011237Z_efbbea36/`

It contains 16 read-only artifacts covering the contract, 160-case
calibration, regressions, immutable replay, protected-source hashes,
historical integrity before and after, provider-call guard, E2A.36 protocol,
budget, artifact contract, composite identity, and artifact validation.

The provider-call and network-request counters are both zero. Protected source
checks confirm that Evaluator V5 and the tutor candidate are unchanged.

## Commands

```bash
npm run eval:formative:e2a35a:run
npm run eval:formative:e2a35a:report
npm run eval:formative:e2a35a:smoke
npm run eval:formative:e2a35a:calibration-smoke
npm run eval:formative:e2a35a:regression-smoke
npm run eval:formative:e2a35a:replay-smoke
npm run eval:formative:e2a35a:historical-integrity-smoke
npm run eval:formative:e2a35a:e2a36-protocol-smoke
npm run eval:formative:e2a35a:artifact-smoke
npm run eval:formative:e2a35a:provider-call-guard-smoke
```

No command in this set creates a provider client or authorizes live
execution.
