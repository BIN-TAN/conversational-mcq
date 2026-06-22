# Automatic Workflow

Phase 6D2A adds assessment-level workflow mode:

- `manual_review`
- `automatic`

Existing assessments and sessions are backfilled to `manual_review`. Newly created assessments default to `automatic`. A session stores `assessment_sessions.workflow_mode_snapshot` at start time, so changing an assessment mode affects future sessions only.

## Manual Review

Manual-review sessions keep the existing teacher_researcher controls:

- run profiling
- run formative planning
- start first follow-up

## Automatic Mode

After a student completes the initial concept-unit item set and an `initial_concept_unit_response_package` exists, automatic sessions enqueue:

1. `run_initial_profiling`
2. `run_initial_planning`
3. `start_initial_followup`

The chain runs through the same Phase 6B, Phase 6C, and Phase 6D1 backend services, agent contracts, usage guards, and audit logging as manual triggers.

The chain is asynchronous. It must not depend on a teacher dashboard tab, student browser, or real-time page connection.

Phase 6D2B extends automatic mode after follow-up begins. Meaningful follow-up evidence may create a follow-up evidence update package and enqueue:

1. `run_followup_profile_update`
2. `run_followup_planning_update`
3. `finalize_followup_update`

These jobs stage updated profiling and planning outputs first. Active profile and decision pointers change only if finalization succeeds.

Phase 6D3 adds one progression finalization job:

1. `finalize_concept_progression`

This job resolves a `concept_progression_records` row after a linked final update cycle completes or fails. If evidence is resolved and the student already chose to move on or complete, the service advances deterministically to the next `concept_units.order_index` concept or completes the final assessment. If evidence remains unresolved/unknown, the student receives a neutral confirmation choice; no teacher approval is required.

## Teacher Exceptions

Append-only override actions:

- `pause_automation`
- `resume_automation`
- `retry_current_step`
- `stop_followup`

Overrides do not edit item responses, correctness, reasoning, profile output, formative decisions, response packages, or transcript records.

In standard classroom mode, active-session intervention controls are disabled by default. `DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED=false` hides teacher controls and rejects active-session mutation APIs. These controls are for explicit development/testing mode only.

## Student-Safe States

Students see neutral progress messages only:

- Profiling: `Your initial responses have been saved. The system is reviewing them to prepare the next step. You may leave and return later.`
- Planning: `The system is preparing the next support step. Your progress has been saved.`
- Follow-up opening: `Your follow-up conversation is being prepared. You may leave and return later.`
- Follow-up update: `I'm reviewing your latest response so the next step can be better matched to your current understanding. Your progress has been saved.`
- Progression processing: `Reviewing your latest response before continuing.`
- Failure: `The system is having trouble preparing the next step. Your progress has been saved, and you can return later.`

Students do not see job names, provider names, model names, token counts, budget details, profile labels, formative values, correctness, or internal errors.

## Boundaries

Phase 6D3 still does not implement:

- item generation or rewriting behavior
- adaptive concept routing
- CSV export changes
- countdown timers
- a pedagogical maximum number of follow-up turns

Phase 7C adds Response Collection Agent handling only for submitted initial-administration free-text messages. It does not change automatic profiling/planning/follow-up jobs or concept progression.

## Verification

Run:

```bash
npm run workflow:automation-smoke
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
```

The workflow smoke test verifies manual sessions do not enqueue initial workflow jobs, automatic sessions complete the profiling/planning/follow-up startup chain, repeated triggers are idempotent, pause/resume works in development-control mode, retry preserves failed-job audit, only approved job types are used, and no OpenAI calls occur in mock mode. Phase 6D2B follow-up update smokes verify staged evidence packages, atomic activation, and final stop updates. Phase 6D3 smokes verify concept progression, completion, non-intervention defaults, and student-safe progression UI.
