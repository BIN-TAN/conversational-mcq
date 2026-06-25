# Response Collection Agent

Phase 7C integrates the Response Collection Agent only for submitted student free-text messages during initial item administration. Routine assessment introduction, concept introduction, item presentation, option selection, confidence selection, review, skip controls, save/exit, concept progression, profiling, planning, follow-up, and completion remain controlled by deterministic backend services.

## Mode

Assessments have `response_collection_mode`:

- `llm_assisted`: student free-text messages may be handled by the Response Collection Agent when provider readiness and usage guards allow it.
- `deterministic`: student free-text messages use deterministic safe fallback only.

Sessions store `response_collection_mode_snapshot` when they start. Later assessment edits do not change existing session behavior.

New assessments default to `llm_assisted`. Migrated existing assessments and sessions are backfilled to `deterministic`.

## Invocation Boundary

The agent may run only when all are true:

- the session snapshot is `llm_assisted`
- the student submits a free-text message through the initial-message route
- the session is in an allowed initial-administration phase
- server-side provider readiness allows execution
- usage guard allows execution
- mock student workflow is explicitly enabled if `LLM_PROVIDER=mock`

The agent is not called for routine deterministic presentation, option-button clicks, confidence-control clicks, save/exit clicks, review panel activity, browser process events, or final submission with no free-text interpretation.

## Input Allowlist

The provider receives an explicit `ResponseCollectionInput` containing:

- current phase
- allowed interaction type
- current item student-safe content
- submitted student message
- current collected response state
- missing evidence state
- bounded recent student-safe transcript
- orchestration constraints
- procedural policy
- allowed student controls

The input excludes answer keys, correctness, distractor rationales, expected reasoning patterns, misconception indicators, profiles, formative decisions, summative outcomes, internal UUIDs, password hashes, access-code hashes, session cookies, Authorization headers, API keys, database URLs, session secrets, and raw environment variables.

## Output Contract

`response-collection-output-v2` uses fixed enums for recognized intents, reasoning capture status, requested control action, and recommended interaction outcome. Output status uses `output_status`.

The agent may return:

- a brief assistant message
- recognized intent labels for backend audit only
- exact reasoning evidence segments copied from the student message
- advisory control requirements
- advisory interaction outcome
- safe process events from a narrow allowlist

The agent may not set selected option, confidence, correctness, item order, concept order, evidence requirements, phase, submission finalization, profile values, formative decisions, follow-up activity, or assessment completion.

## Semantic Validation

Backend validation rejects output when:

- assistant text is empty or too long
- a reasoning segment is not an exact substring of the submitted message
- help requests are not blocked
- natural-language option or confidence statements are treated as official controls
- forbidden phase, correctness, profile, planning, or misconduct fields appear
- the assistant gives hints, answer checks, explanations, content tutoring, or item-specific feedback

On validation failure, the student message remains stored, deterministic fallback is used, and structured evidence is not modified from invalid output.

## Reasoning Extraction

A mixed message can contain both valid reasoning and a disallowed help request. The backend may save only verified exact reasoning segments, joined by a stable newline separator. The original full message remains in the transcript.

Natural-language option statements and confidence statements are preserved as transcript text but do not change structured option or confidence fields.

## Fallback

Fallback is used for deterministic mode, provider unavailability, disabled live calls, usage blocking, mock-provider restriction, timeout, refusal, incomplete output, invalid output, or semantic validation failure.

Fallback may provide procedural reminders, refuse help neutrally, ask the student to restate reasoning separately, or point to structured skip/save controls. It never gives content help, correctness feedback, hints, explanations, option changes, confidence changes, phase changes, profiles, planning, or follow-up output.

Fallback turns are not recorded as successful agent calls and do not fabricate provider metadata.

## Audit

Actual agent executions create `agent_calls` rows with provider, model, prompt/schema versions, prompt hash, input payload, raw output, validated output, usage guard snapshot, retry information, token usage when available, and latency. Secrets are not stored.

Neutral process events may include response collection invocation, success, failure, fallback usage, reasoning extraction, reasoning extraction failure, invalid help request, procedural clarification request, emotional/frustration response, and prompt-injection attempt.

Prompt-injection attempts and process events are contextual evidence, not misconduct labels.

## Verification

```bash
npm run agent:response-collection-smoke
npm run response-collection:fallback-smoke
npm run response-collection:service-fallback-smoke
npm run student:initial-chat-ui-smoke
npm run response-collection:mode-smoke
```

These tests use synthetic records and do not call OpenAI.

## Phase 7E2A Quality Patch

Prompt version `response-collection-v4` keeps the initial interface
conversational while requiring stricter metadata:

- hint, correctness, explanation, content-clarification, invalid-help, or answer-seeking prompt-injection intents require `blocked_content_help=true`
- disallowed help should log `invalid_help_request` where appropriate
- prompt-injection requests for answers may log both `prompt_injection_attempt` and `invalid_help_request`
- `missing_evidence_status` must reflect backend missing-evidence state
- free-text reasoning does not complete option or confidence controls

The safety evaluator no longer flags a neutral refusal such as “I cannot provide
a hint during this initial phase” as a hint leak.

## Phase 7E2C Mixed-Message Remediation

Prompt version `response-collection-v5` corrects the mixed reasoning plus
correctness-request case. When a single student message contains both a valid
reasoning sentence and a disallowed request for correctness, hints, or
explanation, the valid reasoning segment must still be captured verbatim.

Backend validation requires every extracted reasoning segment to be an exact
substring of the original student message. Paraphrased, invented, or
over-expanded reasoning is rejected and handled through safe fallback logic.
The agent must still refuse correctness feedback, provide no hint or
explanation, and leave option and confidence controls backend-authoritative.

## Phase 8A Operational Effective Result

Operational Response Collection calls route through `executeOperationalAgent`.
The student workflow consumes only the effective result. If readiness is
disabled, blocked, invalid, unsafe, or unavailable, deterministic fallback
preserves the exact-substring rule, refuses disallowed help, keeps option and
confidence backend-owned, and records neutral process context without
fabricating provider metadata.
