# E2A.27a Contradiction Propagation Correction

E2A.27a is a no-live correction and replay phase. It does not rerun E2A.25 or
E2A.27, execute E2A.28, approve a candidate, activate a candidate, or change
the approved V2 operational configuration. Historical E2A.12 through E2A.27
evidence remains immutable.

## Confirmed Defect

The immutable E2A.27 Turn 4 response explained the virtual-image mechanism but
ended by endorsing option B. Evaluator V3 described the conflict in its safe
summary and rationale, but it did not expose stable structured fields for the
observed anchor stance, conceptual conclusion, or their conflict. Downstream
V3 normalization also did not recognize the `makes option B appropriate`
construction and conflated a conceptual mechanism with the final option
conclusion. The resulting profile omitted the blocking contradiction.

E2A.27a preserves V3 and adds these production versions:

- `production-turn-evidence-evaluator-v4`
- `turn-evidence-profile-mapper-v4`
- `turn-evidence-profile-consistency-v4`
- `anchor-contradiction-propagation-v1`
- `pre-tutor-profile-finalization-v1`

The contradiction contract is domain-neutral. A structured evaluator
observation records the active anchor, observed stance, conceptual conclusion,
alignment, conflict type, blocking status, and exact safe evidence spans. A
blocking conflict must remain structured through mapping and consistency
validation. It cannot become sound, resolved, or revision-ready.

## Dispatch Order

The runtime now finalizes the latest turn profile before tutor dispatch. The
accepted student turn, evaluator result, target contract, anchor
interpretation, contradiction propagation, profile, consistency result,
cumulative profile, sound gate, mode, and freshness attestation all precede a
tutor request. Missing, stale, inconsistent, or non-finalized profile state
fails closed before a tutor provider call. A valid contradictory learning
state does not abort; it produces a non-sound profile, remains in dialogue,
and may receive a contradiction-focused tutor response.

## No-Live Evidence

The command below reconstructs E2A.27 from immutable provider outputs, runs a
144-case deterministic calibration across six non-IRT domains, checks
protected evidence and candidate identity, and prepares E2A.28 without making
a network request:

```bash
npm run eval:formative:e2a27a:run
npm run eval:formative:e2a27a:report
npm run eval:formative:e2a27a:smoke
```

Artifacts are written to
`.data/e2a27a-contradiction-propagation/<run_id>/`. They include the exact
Turn 4 reconstruction, field-level propagation trace, corrected replay,
non-regression results, calibration corpus and results, derived failure-path
and review-binding assessments, burden metrics, identity audits, and the
unexecuted E2A.28 protocol. Derived records mark unrecoverable historical
context as missing rather than fabricating it.

## E2A.28 Preparation

The held-out E2A.28 draft uses health sciences: antibiotic resistance is
explained by selection among pre-existing variation rather than intentional,
need-driven adaptation within individual bacteria. Its trajectory deliberately
includes a correct differential-survival mechanism followed by an explicit
endorsement of the active distractor. The expected state is a
finalized, contradictory, non-sound profile that remains in dialogue, followed
by clarification and later independent rejection.

E2A.28 is not authorized and was not executed. Its maximum draft budget is one
session, 29 logical calls, 87 adapter attempts, 900,000 input tokens, 70,000
output tokens, 970,000 total tokens, USD 25 when pricing is available, and
provider concurrency one. A separate explicit authorization and successful
preflight are required before any live dispatch.
