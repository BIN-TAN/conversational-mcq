# Operational Agent Fallbacks

Phase 8A fallbacks keep the workflow resumable when operational live readiness is blocked, a provider call fails, or an output fails validation. Fallbacks are deterministic and auditable; they are not presented as LLM-derived inference.

## Response Collection

The backend extracts only exact reasoning substrings from the student message. It refuses hints, explanations, and correctness requests, keeps option and confidence controls backend-owned, and derives missing-evidence state from stored item-response state.

## Student Profiling

Initial profiling fallback creates an explicitly deterministic conservative profile using `insufficient_evidence_for_formative_decision`. Updated profiling fallback preserves the previous active profile and does not move the latest-profile pointer.

## Formative Planning

The backend derives the default formative value and mapping state. Invalid or unavailable raw planning output is canonicalized or replaced with a course-agnostic deterministic fallback plan. Updated planning failure preserves the previous active decision.

## Follow-Up

Follow-up fallback preserves the saved formative value, applies off-topic redirects, applies `followup-move-on-fallback-v2`, keeps move-on requests nonsubstantive, and lets only backend-owned final-update/progression preparation run. Agents never advance, complete, or select the next concept.

## Item Verification

Item verification combines raw advisory output with deterministic duplicate detection. Effective warnings require teacher review. The system never rewrites items, generates replacement items, edits concept definitions, or removes the teacher publication override.

