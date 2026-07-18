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

Phase 8A adds default-off guarded operational integration around automatic
agent workflow wiring. With `OPERATIONAL_AGENT_MODE=disabled`, automatic
profiling, planning, and follow-up startup jobs use deterministic fallback
paths and any queued guarded workflow job has a worker-side backstop before
provider execution. `mock` mode is for local smoke testing. `guarded_live`
requires approved manifest, active configuration hash, usage guard, database
readiness, exact model snapshot, and server-side live-call readiness; it is not
enabled by default and does not by itself authorize classroom use.

Phase 6D2B extends automatic mode after follow-up begins. Meaningful follow-up evidence may create a follow-up evidence update package and enqueue:

1. `run_followup_profile_update`
2. `run_followup_planning_update`
3. `finalize_followup_update`

These jobs stage updated profiling and planning outputs first. Active profile and decision pointers change only if finalization succeeds.

Phase 8A applies the same executor boundary to follow-up update jobs. If a
meaningful follow-up evidence trigger occurs while live readiness is blocked,
the workflow uses deterministic fallback or preserves the previous active
profile/decision according to the update stage. The session remains resumable
and no live provider request is made in disabled mode.

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

Phase 8A routes Response Collection Agent execution in student initial chat
through the same operational executor. While the mode is `disabled`, free-text
submissions use deterministic fallback and do not create a successful provider
agent call.

## Verification

Run:

```bash
npm run workflow:automation-smoke
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
```

The workflow smoke test verifies manual sessions do not enqueue initial workflow jobs, automatic sessions complete the profiling/planning/follow-up startup chain with guarded operational fallback/mock paths, repeated triggers are idempotent, pause/resume works in development-control mode, retry preserves failed-job audit, only approved job types are used, and no OpenAI calls occur. Phase 6D2B follow-up update smokes verify staged evidence packages, atomic activation, and final stop updates. Phase 6D3 smokes verify concept progression, completion, non-intervention defaults, and student-safe progression UI.

## Active Formative Turn Cycle

The active formative activity uses the existing runtime attempt as an
orthogonal state boundary. A valid student message is persisted first, then the
server reconstructs the complete authoritative context and runs:

```text
interpret latest response
-> stage updated profile
-> stage updated plan
-> generate and validate one topic-dialogue reply
-> atomically activate profile, plan, pointers, reply, and attempt state
```

The current attempt status is also the concurrency lease. Exact idempotent
replays reuse the committed result; a competing distinct submission is rejected
before its message is persisted. Provider or validation failure may use the
existing bounded fallback and recovery behavior, but an accepted message must
never leave the student with internal records and no visible reply. Revision,
transfer, next-concept, and completion decisions remain platform validated.

The completion check is downstream of completed-key lookup. Replaying the exact
accepted formative request with the same key returns its persisted projection,
even if a later student action completed the assessment, and creates no new
turn, profile, plan, or reply. A request with a new key after terminal completion
is rejected before persistence.

Agent/evaluator readiness is advisory. The platform readiness gate requires a
substantive response, distractor-specific conceptual evidence, a compatible
post-activity status, and no continued-confusion or unsupported-understanding
signal. One improved answer, `I understand`, or an apparent-resolution label
cannot complete the episode. Revision readiness may route to transfer; transfer
failure reactivates the formative profile/plan/dialogue path.

Profile and planning stages are independently auditable. When a stage cannot
produce a validated update, the prior validated pointer remains active; the
runtime does not create a fresh-looking copy. The stage response package and
teacher/research process event record `update_failed`, the relevant
`stale_*_used` flag, a non-secret fallback source version, failure agent-call
reference when available, result status, and a typed reason. These fields are
internal audit data and are not included in the student projection.

## Deterministic Formative Evaluation

The Phase E1 harness exercises this same automatic formative turn cycle with
isolated three-initial-item plus one-transfer-item fixtures. It uses existing
mock-safe boundaries for agent output while preserving production persistence,
profile/plan versioning, topic dialogue, transcript projection, fallback audit,
idempotency, and platform-owned transitions. A hidden deterministic student
state drives scripted or explicit branching responses but is never supplied to
the workflow.

Engineering invariants report whether the cycle executed correctly. A separate
pedagogical rubric records structured checks and human-review requirements.
Run artifacts live under the ignored `artifacts/formative-evaluation/`
directory. See `docs/FORMATIVE_EVALUATION_HARNESS.md` for commands and limits.

The E1.1 mock-safe boundary preserves the same orchestration contract as live
execution: each accepted turn stages profile and plan updates, persists one
anchored reply, and keeps platform transitions authoritative. The adapter is not
made artificially successful. Validation or provider-boundary failures retain
typed stale-pointer/recovery audit, while the harness reads the persisted
strategy metadata instead of treating every no-live fallback as a recovery
strategy.

### E1.2 current-workflow privacy journey

The production-like privacy smoke follows the authoritative workflow rather
than the retired direct transition from package completion to
`followup_active`. Its isolated fixture completes three initial items and the
package review, waits for profile and plan persistence, enters
`FORMATIVE_ACTIVITY`, accepts iterative topic-dialogue turns, collects revision
evidence, presents the one transfer item, and returns to formative dialogue
after an insufficient transfer response.

At each boundary, the smoke scans the student state, review, transcript,
activity-runtime projection, command response, and rendered student page. A
schema-aware recursive scanner rejects protected nested keys and a separate
visible-text scanner rejects serialized internal enums, agent metadata, and
failure/fallback details. Refresh must reproduce the same visible turn order.
The inverse boundary is also tested: authorized teacher audit data contains
versioned profile, plan, and agent provenance while those records are absent
from every student projection. Safe recovery remains student-visible, but its
provider failure and stale-pointer audit remain internal.

### E2A controlled expression variation

E2A reuses the isolated E1 fixture and this automatic workflow while replacing
only deterministic student-message wording with a validated, explicitly
opted-in LLM surface realization. The E1 branching policy still owns hidden
truth and permitted intent; operational services still own profile, planning,
activity, dialogue, revision, and transfer. Simulator output cannot transition
workflow state. See `docs/FORMATIVE_EVALUATION_E2A.md`.

For guarded E2A execution, the requested approved hash must resolve through an
integrity-checked derived approval bundle containing all 17 operational roles.
An absent local pointer or a legacy fallback cannot authorize the workflow.
The local materializer writes only ignored control-plane state; the readiness
command reruns E1 and privacy prerequisites without provider generation before
issuing a short-lived canary attestation.

E2A.2 scopes formative execution mode to each runner invocation. Deterministic
E1 and no-live contract checks call deterministic/mock-safe role adapters even
when a derived runtime is locally materialized. Readiness resolves policy and
provenance but does not administer a session. Live canary and production alone
use configured live dispatch, and their safe recovery is reserved for genuine
bounded failures rather than missing no-live opt-in.

The approved ten-student-message policy is not compatible with approved topic
dialogue input V2: V2 caps `maximum_dialogue_turns` at eight and carries only
recent summaries. A separate inactive V3 candidate carries 18 exact prior
visible messages plus the latest student message. Until that candidate is
evaluated and explicitly approved, the approved E2A canary remains blocked.

E2A.3 evaluates the V3 delta outside classroom and canary execution. The
provider runner receives fixed synthetic topic-dialogue inputs directly and
does not create assessment sessions, workflow jobs, conversation turns, agent
calls, profiles, plans, or operational effective-result records. It records 16
unchanged roles as immutable inherited-evidence references and evaluates only
`topic_dialogue_agent`; this reference does not authorize runtime use.

The 2026-07-18 E2A.3 attempt did not reach provider fetch. The existing topic
dialogue output schema failed strict Responses schema conversion, so the
candidate remains blocked before runtime evaluation. This is not a fallback or
an activation signal; the approved V2 bundle remains the only active bundle.

E2A.4 repairs only the candidate provider contract by adding strict
`topic-dialogue-output-v3` and `eval-topic-boundary-v3`; approved V2 runtime and
failed V3 evidence remain unchanged. A server adapter converts validated V3
semantic fields to the readable V2 runtime shape, while student serialization
omits schema metadata and audit serialization retains version provenance. The
all-role formatter audit and request compilation cover 17 roles with no
network request.

The E2A.4 dispatch canary proved that two corrected requests reached the
provider and returned schema-valid outputs. It then failed fixed progression
and response-function invariants, so the remaining 28 protocol cases did not
run. No automatic workflow setting, approved hash, approval record, activation
record, E2A canary, or 36-session matrix was changed.

E2A.5 makes recommendation, authorization, and execution explicit. Topic
dialogue output may recommend only the action already authorized by a
server-owned authorization object. With `remain_in_dialogue`, the reply must
directly address the latest message, retain the distractor anchor, elicit new
evidence, and avoid readiness, transfer, or completion language. Revision,
transfer, and completion authorization are separate and cannot imply one
another.

The E2A.4 provider harness did not invoke the operational gate or persist
runtime state, so its raw recommendations were not executed transitions.
Controlled E2A.5 checks apply production readiness evidence and the candidate
validator before a hypothetical projection. Rejected output remains in
dialogue and requires bounded regeneration; rejection details are internal.
