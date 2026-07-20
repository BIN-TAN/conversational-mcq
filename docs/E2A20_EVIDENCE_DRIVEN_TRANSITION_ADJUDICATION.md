# E2A.20 Evidence-Driven Transition Adjudication

E2A.20 is a no-live adjudication of the preserved E2A.19 micro-canary run
`e2a19_20260720094054_74982b99`. It does not change the historical E2A.19
status or artifacts and does not approve or activate the tutor candidate.

## Root Cause

E2A.19 correctly classified simulator turn 4 as accepted under its substantive
evidence ceiling. The observed evidence level remained partial, below the
scenario's desired substantive transition. The harness then treated that
desired transition as a mandatory pre-persistence minimum and aborted before
persisting turn 4 or constructing its tutor request.

The correction separates five concepts:

- the evidence ceiling is a hard upper bound;
- the response objective is a quality target;
- the desired hidden-state transition is a non-authoritative trajectory;
- observed evidence controls hidden state and routing;
- progression remains platform-authorized and evidence-bound.

A role-safe response at or below the ceiling is accepted and persisted even
when it does not reach the desired transition. The tutor is routed from the
observed evidence while turns remain. At the sixth turn, insufficient evidence
produces a documented valid bounded stop rather than forced revision or a
contract failure.

## Preserved Boundary

- approved V2 hash:
  `8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993`;
- tutor candidate hash:
  `f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a`;
- tutor candidate file SHA-256:
  `a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8`;
- simulator contract: `e2a18-student-simulator-contract-v2`;
- evidence classifier: `student-simulator-evidence-classifier-v2`;
- classifier SHA-256:
  `5839e68b24bbdfe437fe133a86da201b2df96d769e9d24b966d370727d4d9037`.

The simulator prompt, schema, classifier, hidden-state definitions, tutor
candidate, tutor prompts, tutor schemas, tutor validator, routing contracts,
progression contracts, retry policy, and deterministic fallbacks remain
unchanged.

## Outcome Taxonomy

The corrected orchestration distinguishes:

- `passed_required_endpoint`;
- `completed_valid_bounded_stop`;
- `failed_contract`;
- `failed_safety`;
- `failed_stability`;
- `incomplete_infrastructure`.

A bounded stop is informative but does not demonstrate required progression
coverage and is not equivalent to reaching revision authorization.

## Commands

Run the complete no-provider smoke:

```bash
npm run eval:formative:e2a20:smoke
```

Generate the adjudication artifacts:

```bash
npm run eval:formative:e2a20:run
```

Read a generated report:

```bash
npm run eval:formative:e2a20:report -- --run <run_id>
```

Artifacts are written under
`.data/e2a20-evidence-driven-transition-adjudication/<run_id>/` and remain
ignored by Git.

## E2A.21 Draft

E2A.20 prepares but does not execute the E2A.21 evidence-driven single-session
micro-canary. E2A.21 preserves the one-session, six-student-turn,
twelve-visible-turn, fourteen-logical-call, forty-two-adapter-attempt,
400,000-input-token, 31,000-output-token, and USD 10 ceilings. Observed evidence
controls progression; the future run may reach revision authorization or end in
a valid bounded stop after six turns.

No E2A.21 provider dispatch is authorized by this document.

## Result

The deterministic adjudication run
`e2a20_20260720095853_6b995450` completed with status
`e2a20_orchestration_corrected_e2a21_ready`.

- the exact E2A.19 turn-4 response was reconstructed and retained at the
  classifier V2 result `partial`;
- turn 4 was within its `substantive` evidence ceiling and should have been
  persisted, followed by `remain_in_dialogue` / `refine_partial_reasoning`;
- historical replay is determinate through construction of the missing turn-4
  tutor request and indeterminate before the nonexistent provider dispatch;
- all 8 deterministic transition cases passed;
- all 17 operational role requests compiled without network access;
- all 17 required E2A.20 artifacts passed integrity validation;
- protected approved, candidate, classifier, and E2A.12-E2A.19 evidence hashes
  were unchanged; and
- E2A.20 made 0 provider calls and 0 network requests.

E2A.19 remains `e2a19_micro_canary_failed`. E2A.21 was not executed. Its next
live micro-canary requires separate explicit user authorization.
