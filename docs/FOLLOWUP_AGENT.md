# Follow-Up Agent

Phase 6D1 integrates only the Follow-up Agent for the first open-ended follow-up conversation round after a saved student profile and saved formative decision exist.

## Scope

The service converts the latest `formative_decisions` plan into student-facing follow-up turns inside one active `followup_rounds` record.

It does not update the student profile, rerun formative planning, create follow-up evidence packages, start another concept unit, modify initial item responses, reveal correctness, alter the master CSV export, or call OpenAI during normal verification.

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

Phase 6D2A still does not implement follow-up evidence packages, updated profiles, replanning, a second follow-up round, or next-concept progression.

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
  should_offer_move_on: boolean;
  off_topic_detected: boolean;
  events_to_log: SafeProcessEvent[];
}
```

The service rejects unknown labels, schema-invalid output, and semantically invalid output. The returned `target_formative_value` must match the current saved formative decision. The agent may propose only trusted event types:

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

Phase 6D1 does not implement:

- Phase 6D2 iterative profile updates
- re-running the Student Profiling Agent from follow-up evidence
- re-running the Formative Value and Planning Agent after follow-up
- follow-up evidence package creation
- move-next orchestration
- Response Collection Agent LLM behavior
- live Item Preparation Agent behavior
- master CSV follow-up/profile field filling beyond already stored records

## Verification

Run:

```bash
npm run agent:followup-smoke
```

The smoke test verifies safe input building, prohibited field exclusion, teacher-only start authorization, student message handling, idempotency, bounded provider context, strict output validation, semantic validation, usage-blocked handling, agent-call audit, process-event logging, teacher review serialization, student-safe serialization, student stop behavior, no profile update, no replanning, no new concept unit, and no OpenAI network calls.
