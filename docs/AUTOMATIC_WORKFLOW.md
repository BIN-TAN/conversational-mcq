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

## Teacher Exceptions

Append-only override actions:

- `pause_automation`
- `resume_automation`
- `retry_current_step`
- `stop_followup`

Overrides do not edit item responses, correctness, reasoning, profile output, formative decisions, response packages, or transcript records.

## Student-Safe States

Students see neutral progress messages only:

- Profiling: `Your initial responses have been saved. The system is reviewing them to prepare the next step. You may leave and return later.`
- Planning: `The system is preparing the next support step. Your progress has been saved.`
- Follow-up opening: `Your follow-up conversation is being prepared. You may leave and return later.`
- Follow-up update: `I'm reviewing your latest response so the next step can be better matched to your current understanding. Your progress has been saved.`
- Failure: `The system is having trouble preparing the next step. Your progress has been saved, and you can return later.`

Students do not see job names, provider names, model names, token counts, budget details, profile labels, formative values, correctness, or internal errors.

## Boundaries

Phase 6D2B still does not implement:

- next-concept progression
- Response Collection Agent LLM behavior
- live Item Preparation Agent behavior
- CSV export changes
- countdown timers
- a pedagogical maximum number of follow-up turns

## Verification

Run:

```bash
npm run workflow:automation-smoke
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
```

The workflow smoke test verifies manual sessions do not enqueue initial workflow jobs, automatic sessions complete the profiling/planning/follow-up startup chain, repeated triggers are idempotent, pause/resume works, retry preserves failed-job audit, only approved job types are used, and no OpenAI calls occur in mock mode. Phase 6D2B follow-up update smokes verify staged evidence packages, atomic activation, final stop updates, and no next-concept progression.
