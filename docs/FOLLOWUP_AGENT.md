# Follow-Up Agent

Phase 6D1 integrates the Follow-up Agent for the first open-ended follow-up conversation round after a saved student profile and saved formative decision exist. Phase 6D2B extends the same agent output contract so the backend can detect meaningful follow-up evidence for staged current-concept update cycles.

## Scope

The service converts the latest `formative_decisions` plan into student-facing follow-up turns inside one active `followup_rounds` record.

The Follow-up Agent itself does not update the student profile, rerun formative planning, create follow-up evidence packages, start another concept unit, modify initial item responses, reveal correctness, alter the master CSV export, or call OpenAI during normal verification. In Phase 6D2B, the orchestration layer may use trusted follow-up output metadata to create a staged update cycle; agent output never directly controls workflow state.

## Preconditions

Follow-up may start only when:

- initial concept-unit administration is completed
- a valid latest `student_profiles` row exists
- a valid latest `formative_decisions` row exists
- the assessment session is in `planning_completed`
- no active follow-up round already exists for the concept-unit session

Phase 6D1 uses a manual teacher trigger for controlled testing:

```text
POST /api/teacher/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/start-followup
```

The route requires `teacher_researcher`, rejects students with 403, uses public IDs at route boundaries, and does not expose hidden prompts, provider secrets, internal UUIDs, or raw environment values.

Phase 6D2A may start the first follow-up round from a backend workflow job when the session's workflow snapshot is `automatic`. This reuses the same Follow-up Agent service, usage guard, schema validation, semantic validation, and audit logging as the manual trigger. The startup job is idempotent and reuses a not-started round during retry rather than creating duplicate rounds.

Phase 6D2B may create follow-up evidence packages, updated profile candidates, updated planning candidates, and a next follow-up round only through the atomic update-cycle service. Phase 6D3 adds deterministic, student-led concept progression outside the Follow-up Agent itself.

## Input Evidence

`FollowupInput` is built from allowlisted backend records:

- latest saved student profile
- latest saved formative decision
- formative action plan
- target evidence
- success criteria
- follow-up prompt constraints
- concept-unit metadata
- item response evidence
- correctness values as backend-only evidence
- reasoning text, confidence ratings, skip flags, and revision counts
- item snapshots and teacher diagnostic metadata
- current follow-up round state
- bounded recent follow-up transcript
- latest student message for reply turns
- process-event aggregates
- Phase 6D1 constraints

The builder does not pass raw Prisma objects to the provider.

Excluded fields include password hashes, access-code hashes, cookies, authorization headers, API keys, database URLs, session secrets, auth tokens, unrelated summative outcomes, and unnecessary internal UUIDs.

## Output Contract

The Follow-up Agent must return strict `FollowupOutput`:

```ts
{
  agent_name: "followup_agent";
  assistant_message: string;
  followup_action_type:
    | "explanation"
    | "hint"
    | "clarification_prompt"
    | "reasoning_refinement_prompt"
    | "misconception_correction"
    | "transfer_task"
    | "confidence_calibration_prompt"
    | "independent_verification_prompt"
    | "off_topic_redirect"
    | "move_on_offer";
  target_formative_value: FormativeValue;
  evidence_request?: string;
  expects_student_response: boolean;
  evidence_trigger_candidate: boolean;
  student_turn_substantive: boolean;
  evidence_trigger_reasons: Array<
    | "substantive_explanation"
    | "reasoning_revision"
    | "task_completion"
    | "transfer_application"
    | "understanding_claim"
    | "move_on_request"
    | "other_relevant_evidence"
  >;
  should_offer_move_on: boolean;
  off_topic_detected: boolean;
  events_to_log: SafeProcessEvent[];
}
```

The service rejects unknown labels, schema-invalid output, and semantically invalid output. The returned `target_formative_value` must match the current saved formative decision. Opening messages must use `student_turn_substantive = false` and `evidence_trigger_reasons = []`. The agent may propose only trusted event types:

- `followup_task_assigned`
- `followup_turn_completed`
- `off_topic_followup`
- `prompt_injection_attempt`

## Conversation Behavior

The first call uses:

```text
turn_type = "opening"
student_message = null
```

Student replies use:

```text
turn_type = "student_reply"
student_message = latest saved student message
```

Student messages are saved before provider execution so a failed assistant reply does not discard student evidence. Idempotency uses the student `client_message_id` to avoid duplicate student turns or duplicate assistant replies on retry.

There is no pedagogical maximum number of turns in Phase 6D1. Technical safeguards include message length limits and bounded context sent to the provider:

```text
FOLLOWUP_CONTEXT_MAX_TURNS=24
FOLLOWUP_MESSAGE_MAX_CHARS=6000
FOLLOWUP_CONTEXT_MAX_CHARS=50000
```

The full transcript remains stored in the database; only the bounded recent context is sent to the provider.

## Phase 6D2B Update Metadata

The agent classifies the latest student reply conservatively. Substantive evidence can include concept explanations, revised reasoning, task completion, transfer/application reasoning, a supported understanding claim, or a move-on request. Brief acknowledgements, blank messages, off-topic social turns, and process events alone do not trigger updating.

Immediate trigger categories may create an update cycle. If no immediate category appears, the orchestration layer may use `FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE`, defaulting to `3`, as a technical fallback based on substantive student turns. This is not a pedagogical maximum number of turns.

## Student Boundary

Students see only conversation text. They do not see:

- ability profile
- engagement profile
- integrated diagnostic profile
- evidence sufficiency
- independence interpretability
- formative value
- action-plan labels
- target evidence
- success criteria
- correctness
- answer keys
- hidden prompts
- model or provider configuration

The follow-up conversation may give post-initial support according to the saved plan, but it must not overwrite initial responses or reveal teacher-only metadata.

## Audit Logging

`agent_calls` records provider, model, prompt/schema versions, prompt hash, redacted input, raw and parsed output, validation status, retry count, usage guard snapshot, live-call allowance, token usage when available, timing, and `followup_round_db_id`.

Process events are logged for agent start, success, failure, schema validation outcomes, follow-up start, follow-up turns, prompt-injection-like messages, trusted agent-proposed events, and student stop.

Prompt-injection and off-topic events are process context. They are not misconduct labels.

## Mock And Live Behavior

Default local behavior:

```text
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
```

The mock provider returns schema-valid follow-up output for infrastructure and UI testing only. Mock output is not validated formative guidance.

Live OpenAI follow-up can occur only when server-side configuration explicitly enables:

```text
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPENAI_API_KEY
OPENAI_MODEL_FOLLOWUP
```

The usage guard must also allow the call. Browser code never receives provider credentials or model configuration.

## Not Implemented

Phase 6D3 still does not implement:

- Response Collection Agent LLM behavior
- item generation or rewriting behavior
- adaptive concept routing
- master CSV follow-up/profile field filling beyond already stored records
- a pedagogical maximum number of follow-up turns

## Verification

Run:

```bash
npm run agent:followup-smoke
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
```

The smoke tests verify safe input building, prohibited field exclusion, teacher-only start authorization, student message handling, idempotency, bounded provider context, strict output validation, semantic validation, usage-blocked handling, agent-call audit, process-event logging, teacher review serialization, student-safe serialization, student stop behavior, staged follow-up update cycles, final stop updates, and no OpenAI network calls.

## Phase 6D3 Progression Boundary

Follow-up Agent signals such as `should_offer_move_on` or `move_on_request` may make a progression offer available, but they never move the student automatically. The student must explicitly choose to move on or complete, and the backend determines the next concept by teacher-defined order.

## Phase 7E2A Quality Patch

Prompt version `followup-v5` and semantic validation enforce the pure off-topic
invariant:

- `followup_action_type=off_topic_redirect`
- `off_topic_detected=true`
- `student_turn_substantive=false`
- `evidence_trigger_candidate=false`
- `evidence_trigger_reasons=[]`
- `should_offer_move_on=false`

A pure off-topic reply must not count toward evidence thresholds, trigger
profile/planning updates, trigger move-on, or create a follow-up evidence
package. Mixed off-topic plus concept-relevant evidence should be handled under
the appropriate concept-evidence action rather than as a pure redirect.

The safety evaluator no longer flags a neutral refusal to share system
instructions as hidden-prompt disclosure unless hidden instructions are actually
revealed or materially paraphrased.
