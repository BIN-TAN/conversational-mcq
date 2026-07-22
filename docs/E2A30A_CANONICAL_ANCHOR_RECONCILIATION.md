# E2A.30a Canonical Anchor Evidence Reconciliation

E2A.30a is a deterministic, no-live correction to the semantic boundary
between production-turn evidence evaluator V5 and target-evidence profile
construction. It does not rerun or relabel E2A.30, approve the autonomous
tutor candidate, alter approved V2, or authorize E2A.31.

## Historical failure

Immutable E2A.30 run `e2a30_20260722212059_c1f72790` remains failed closed as
`e2a30_canary_failed_anchor_resolution`. On its first turn:

- the student simulator produced a response;
- evaluator V5 completed and returned `observed_anchor_reference=explicit` and
  `observed_anchor_stance=endorses_distractor`;
- `buildTargetEvidenceAdjudicationFromEvaluatorOutputV5` independently ran
  `resolveActiveAnchorAlias` V1 against the raw response;
- V1 returned `absent` and `not_expressed` because the historical target
  contract contained unrelated circuit-domain paraphrases for the thermal
  anchor;
- direct comparison of the two wording-dependent projections raised
  `explicit_anchor_not_detected` and `anchor_stance_not_detected` before
  profile construction.

Evaluator V5 supplied the required anchor identity, stance, source binding,
and exact evidence spans. Its prompt, schemas, and model selection are not
changed by E2A.30a.

## Canonical pipeline

The downstream pipeline is now:

1. evaluator V5 structured evidence;
2. `canonical-anchor-evidence-v1` normalization;
3. `active-anchor-alias-resolution-v2` contract-derived resolution;
4. `anchor-parity-reconciliation-v1` identity, stance, and provenance checks;
5. contradiction propagation and profile mapping;
6. existing profile consistency and pre-tutor finalization gates.

Canonical evidence carries the target anchor ID, label and text, matched alias,
match type, application, stance, exact source spans, source turn and sequence,
and bounded confidence. It stores neither hidden reasoning nor hidden state.
Parity compares canonical identity and provenance rather than raw strings. It
still fails closed for identity disagreement, decisive stance conflict, source
binding disagreement, or missing explicit evidence spans.

## Verification corpus

The E2A.30a harness runs 120 deterministic cases across eight domains. Cases
cover labels, option references, rejection, contract paraphrases, bounded
pronouns, mechanism/conclusion conflict, alternate wording, and absent anchor
evidence. Separate negative guards prove that identity, stance, source, and
span failures remain blocked.

The read-only replay consumes only the preserved first E2A.30 simulator and
evaluator outputs. It does not fabricate later turns or tutor output and does
not claim that E2A.30 passed. Historical E2A.27, E2A.28, E2A.29, and E2A.29b
statuses remain immutable; current deterministic contradiction, profile,
transport, and E1 checks remain required.

## Commands and artifacts

Run the no-live checks with:

```bash
npm run eval:formative:e2a30a:smoke
npm run eval:formative:e2a30a:run
npm run eval:formative:e2a30a:report
```

The run command writes the required evidence set under
`.data/e2a30a-anchor-canonicalization/<run_id>/`. The artifact directory is
ignored and must not contain credentials, authorization headers, hidden
prompts, or chain-of-thought.

## E2A.31 boundary

E2A.30a prepares an unexecuted held-out ecology protocol testing explicit
anchor normalization, mechanism/conclusion contradiction, autonomous
clarification, sound progression, and transport recovery. Preparation is not
authorization. No E2A.31 provider dispatch may occur without a separate,
explicit authorization.
