# E2A.16 Human Review Closure

E2A.16 is a no-live evidence-closure phase for the calibrated E2A.14
candidate. It does not approve or activate the candidate and does not execute
the student simulator.

The authoritative closure run is
`e2a16_20260720071641_9e2e4f59`. Its source review package is the immutable
E2A.15b packet from `e2a15b_20260720053628_0e8a35af`, identified by SHA-256
`688ddb6c5ddd050c08f7df5ab85446f8387a5a4d8b84348a9b00ceb95fe1685c`.
The package contains 40 unique items: eight fresh provider cases, 30 preserved
E2A.13 recompositions, and two explicit historical provider attempts.

## Human attestation

The project owner supplied an attestation that two reviewers independently
reviewed all 40 items. E2A.16 records only the role-based audit aliases
`primary_project_owner` and `secondary_colleague_reviewer`; these are not legal
identities. Both reviewers reported an overall acceptable decision, zero
critical failures, no unresolved material disagreement, and acceptance of the
inherited E2A.13 provider evidence.

Detailed item-level human ratings were not retained. E2A.16 therefore does not
claim `human_ratings_verified` or `inter_rater_agreement_verified`, and no
inter-rater reliability statistic is available. The user-supplied summary of
the AI-assisted independent adjudication is stored as a separate evidence
layer: 40 reviewed, 40 pass, zero critical failures, with minor non-blocking
observations only. It is not represented as human review and is not merged
with the human or automated evidence.

The three evidence layers are recorded as concordant at the overall-decision
and critical-failure level. The closure result is
`human_review_closed_by_dual_attestation`.

## Candidate status

The candidate remains
`f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a`
with file SHA-256
`a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8`.
It is byte-identical, unapproved, inactive, and evaluation-only. Approved V2
`8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`
remains active and unchanged. Historical E2A.13 status remains
`v8_30case_failed`.

The readiness result
`candidate_ready_for_bounded_student_simulator_canary` means only that the
candidate may proceed to a separately authorized E2A.17 canary. It is not
approval, approval evidence readiness, activation, or production readiness.

## E2A.17 draft

The frozen draft defines four independent sessions with at most six student
turns and 12 visible dialogue turns per session. The exact logical generation
ceiling is:

- 24 student-simulator calls;
- 24 initial tutor-generation calls;
- 24 permitted tutor regenerations, one only after genuine hard rejection;
- 72 total generation calls;
- 216 provider-adapter attempts at the existing maximum of two transport
  retries per generation call;
- 2,112,000 input tokens, 180,000 output tokens, and 2,292,000 total tokens;
- USD 30 maximum estimated cost when complete pricing is available;
- provider concurrency one.

Simulator regeneration is disabled, soft flags cannot trigger tutor
regeneration, and the deterministic fallback-rate ceiling is zero. The draft
requires a fresh fixture per session, exact visible history, platform-owned
routing and progression, hidden-state separation, incremental artifacts,
complete fixture cleanup, exact usage reconciliation, and human review of all
student-facing outputs. E2A.16 made zero provider calls and did not dispatch
this protocol.

## Commands

```bash
npm run eval:formative:e2a16:smoke
npm run eval:formative:e2a16:close -- \
  --confirm-user-supplied-dual-attestation \
  --confirm-no-item-level-ratings-retained \
  --confirm-no-inter-rater-reliability \
  --confirm-no-provider-calls
npm run eval:formative:e2a16:report -- \
  --run e2a16_20260720071641_9e2e4f59
npm run eval:formative:e2a17:protocol-draft-smoke
npm run eval:formative:e2a17:budget-smoke
npm run eval:formative:e2a17:provider-call-guard-smoke
```

Artifacts are stored under
`.data/e2a16-human-review-closure/e2a16_20260720071641_9e2e4f59/`.
E2A.17 requires separate explicit authorization and a clean live preflight.
