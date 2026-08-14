# V18R2 Contract Coherence and Bounded Lifecycle

V18R2 is an inactive, no-provider successor to immutable V18R1. It is V18R2,
not V19. V18R1 commit `2147e4d340e9adbfd8014433ceede852fbdc54fc`,
provider run `fcv5v18r1_provider_20260813160503_9f33cf65`, and derived
evaluation `fcv5v18r1_derived_20260813160503_1534d9b2` remain unchanged and
must not be rerun.

## Forensic finding

All seven V18R1 failures selected `continue_conversation`. The V18R1 prompt
required every evidence ID used by an evidence observation to also appear in
`canonical_evidence_ids`. At the same time, the V18R1 transition schema rejected
every nonterminal recommendation that carried `canonical_evidence_ids`, an
updated profile, field evidence, or misconception dispositions. The seven
preserved primary candidates have no independent P1 defect. The opening and
Sound/SEM passing controls establish that this was one prompt/schema
contradiction rather than a general transport or terminal-transition failure.

V18R2 separates:

- **Canonical observation evidence:** eligible student-originating assessment
  or formative evidence available for interpretation regardless of whether a
  transition occurs.
- **Profile-transition supporting evidence:** canonical student evidence cited
  specifically to support an actual proposed profile change.
- **`canonical_evidence_ids`:** only the second category, inside a terminal
  transition. It is not a generic observation log.

Nonterminal observations remain in the existing non-authoritative evidence
observation and conversation provenance mechanisms. They are not persisted as
a profile transition.

## Output branches

For `continue_conversation`:

- top-level `outcome` is `continue_conversation`;
- `profile_transition_recommendation` is exactly `null`;
- observation evidence may remain in `evidence_observations`;
- no profile transition, field disposition, claim disposition, or transition
  supporting evidence is created.

For `sound_understanding`, `largely_improved_understanding`, or
`teacher_assistance_recommended`:

- top-level outcome and transition outcome agree;
- the complete V18 transition recommendation remains required;
- canonical claim identity, canonical evidence identity, evidence eligibility,
  temporal admissibility, evidence closure, and profile field disposition rules
  remain unchanged.

The strict Responses schema uses a nullable transition object because the
provider schema path does not encode the full discriminated union. The local
acceptance boundary deterministically enforces the branch invariant after
schema parsing. Malformed structured output is not treated as semantic
regeneration.

## Phase-local turn lifecycle

The maximum is 12 unique, accepted, persisted student-authored messages inside
`FormativeConversationSession`.

The counter starts at zero when the formative phase begins. Initial assessment
responses, assessment reasoning, confidence, tempting-distractor reasoning,
assessment process evidence, profiling calls, the assistant-first opening,
tutor messages, transport retries, provider retries, semantic regeneration,
duplicate submissions, and exact idempotent replay do not increment it.

The first new student message after the formative phase begins is turn 1. Turns
1 through 11 may continue or terminate based on the LLM's qualitative judgment.
Turn 12 is `final_allowed_turn=true` and
`another_student_turn_available=false`. On turn 12,
`continue_conversation` remains structurally representable but is rejected as a
semantic lifecycle violation. One bounded semantic regeneration receives the
same evidence and lifecycle context. No deterministic outcome is selected.

If both final-turn candidates remain invalid, the platform closes the
conversation and displays neutral lifecycle guidance. It does not fabricate
`teacher_assistance_recommended`, mastery, failure, or a profile transition.

## Handoff distinction

An LLM semantic `teacher_assistance_recommended` outcome is an evidence-based
terminal profile recommendation and may occur before turn 12. A platform
lifecycle handoff means only that the bounded lifecycle ended without a valid
terminal LLM recommendation after regeneration.

The distinction is persisted in the conversation lifecycle reason, append-only
lifecycle event, review signal, tutor-turn generation source, teacher
projection, and research export. A platform lifecycle handoff has no profile
transition and no semantic teacher-assistance outcome.

## Governance

V18R2 changes the formative prompt, agent/output contract, context contract,
lifecycle behavior, and authorization-bound runtime identity. The profiling
prompt and model semantics remain unchanged. The substantive future 12-case set,
base call graph, and budget projection remain unchanged because none of those
fixtures reaches the new 12-turn exhaustion boundary.

The pre-freeze package was intentionally non-executable. The final V18R2
executable package adds only the frozen launcher, process-local runner,
environment parity, exactly-once checkpoint, provenance, security, accounting,
and materialization boundaries required for a future separately authorized
evaluation:

- `live_execution_prepared=true`
- `approval.eligible=false`
- `activation.permitted=false`
- no real dispatch checkpoint, provider run, derived evaluation, approval
  evidence, or activation is created during freeze preparation.

A later commit, push, committed-source verification, canonical deployment,
deployment verification, Git-SHA-bound authorization, and separate exactly-once
evaluation are required before any V18R2 live dispatch.
