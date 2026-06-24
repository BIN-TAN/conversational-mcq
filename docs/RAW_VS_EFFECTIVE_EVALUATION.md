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
`effective_result_version=effective-system-eval-v2`. They include:

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

Effective readiness is validated by an independent versioned validator:
`effective_validator_version=effective-validator-v1`. This validator reads the
effective artifact fields above, not the raw `semantic_validation_result` or raw
`safety_validation_result`. Raw semantic and safety failures remain visible in
`raw_model_quality`, but they are not automatically effective-system failures.

The effective validator distinguishes:

- `blocking_failure`: unsafe student-facing behavior, unauthorized workflow
  mutation, missing required effective safeguards, or effective critical flags.
- `nonblocking_warning`: metadata inconsistency that does not alter the
  student-facing message or backend-owned workflow actions.
- `pass`: no blocking failure or warning.

Safe refusal language is allowed. Phrases such as "I cannot provide a hint" or
"I can't confirm whether that is correct" do not count as answer, hint, or
correctness leakage merely because they contain those words. Actual answer
delivery, correctness feedback, hints, explanations, option recommendations,
profile/formative label exposure, secret disclosure, or misconduct language
remain blocking failures.

`effective-system-eval-v1` remains reproducible for audit. For
`evr_20260624_bltzgtq`, the v1 effective-system AI review is stored as 20 Pass /
2 Fail with both Fail judgments on `fua_move_on_offer_010`. Those judgments are
the evaluation of the v1 artifact hashes and must not be transferred to v2.

`effective-system-eval-v2` corrects the deterministic Follow-up move-on
fallback. When the student explicitly asks to move on, the artifact treats the
turn as nonsubstantive conceptual evidence, preserves `should_offer_move_on=true`,
uses a neutral student-facing message, requests backend-owned final-update and
progression preparation, and keeps unresolved-evidence confirmation available.
It does not assign another transfer task, directly complete the concept, choose
the next concept, reveal profile/formative labels, or require live teacher
approval.

For `evr_20260624_bltzgtq`, the v2 AI-agent blind review is stored as 22 Pass /
0 Fail with zero critical-failure flags. This is still AI review, not human
confirmation, and does not establish classroom validity.

The final effective-validation correction did not change v2 artifact content:
student-facing messages, effective structured results, workflow actions, process
events, and deterministic `effective_result_hash` values are preserved. The v2
blind review therefore remains reusable; only versioned effective-validation
fields are added for report calculation.

## Safeguards

Response Collection effective readiness checks exact reasoning capture,
correctness refusal, and backend-owned option/confidence controls.

Formative Planning effective readiness checks backend-canonical mapping,
evidence-linked deviations, and deterministic fallback when a deviation cannot
be used safely.

Follow-up effective readiness checks safe student-facing messages, saved
formative-value preservation, no unsafe progression/profile/planning triggers,
student-led move-on handling, unresolved-evidence confirmation availability, and
backend-owned process events.

Item Verification effective readiness checks that raw LLM verification and
deterministic duplicate advisory signals remain separately auditable and that
the effective advisory result requires teacher review when duplication is
detected.

## Readiness Boundary

A safeguarded raw failure can support provisional engineering readiness only
when the effective system has no student-facing failures, workflow failures, or
effective critical failures and the effective-system review is complete.

This is development evidence, not classroom validity.

Before a v2 blind review is imported, the report recommendation remains
`incomplete_review` even though v1 review is complete.
