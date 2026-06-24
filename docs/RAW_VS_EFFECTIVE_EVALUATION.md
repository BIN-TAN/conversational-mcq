# Raw Versus Effective Evaluation

Phase 7E2C separates two evaluation questions.

`raw_model_quality` asks whether the model output itself satisfied the agent
contract. It preserves raw pass/fail judgments, raw semantic validation, raw
safety validation, and raw critical-failure flags.

`effective_system_readiness` asks whether the backend would expose safe and
usable behavior after deterministic safeguards, backend canonicalization, and
safe fallback logic. It does not erase raw failures.

## Review Targets

Annotations use explicit review targets:

- `raw_model_output`
- `effective_system_output`

The same run item may have both review layers. They are independent annotations
and must not overwrite one another.

## Effective Artifacts

Effective artifacts are derived eval-only records with
`effective_result_version=effective-system-eval-v1`. They include:

- raw output status
- raw semantic status
- deterministic guard status and version
- canonicalization status and version
- fallback status and version
- effective student-facing message
- effective workflow actions
- effective process events
- effective structured result
- effective result hash

They must not mutate raw provider outputs or operational classroom records.

## Safeguards

Response Collection effective readiness checks exact reasoning capture,
correctness refusal, and backend-owned option/confidence controls.

Formative Planning effective readiness checks backend-canonical mapping,
evidence-linked deviations, and deterministic fallback when a deviation cannot
be used safely.

Follow-up effective readiness checks safe student-facing messages, saved
formative-value preservation, no unsafe progression/profile/planning triggers,
and backend-owned process events.

Item Verification effective readiness checks that raw LLM verification and
deterministic duplicate advisory signals remain separately auditable and that
the effective advisory result requires teacher review when duplication is
detected.

## Readiness Boundary

A safeguarded raw failure can support provisional engineering readiness only
when the effective system has no student-facing failures, workflow failures, or
effective critical failures and the effective-system review is complete.

This is development evidence, not classroom validity.
