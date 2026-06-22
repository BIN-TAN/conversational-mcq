# Initial Administration Conversation

Phase 7C keeps the student interface ChatGPT-style while preserving deterministic orchestration and structured controls.

## What Remains Deterministic

The backend still controls:

- assessment and concept order
- current item
- allowed phase
- selected option
- confidence rating
- missing evidence requirements
- item finalization
- concept-unit completion
- progression and completion
- profiling, planning, and follow-up workflow

Routine presentation uses deterministic wording. Correctness, answer keys, hints, explanations, tutoring, and content clarification are not shown during initial administration.

## Free-Text Composer

During active initial-administration item states, students may submit a free-text message to:

- provide reasoning
- revise reasoning
- ask how to use the assessment controls
- express uncertainty or frustration
- request help
- request skip or save/exit
- send an off-topic or unclear message

The UI reminds students:

```text
Use the answer buttons to select an option and the confidence buttons to report confidence.
```

The UI does not send keystrokes or drafts. Only submitted messages are persisted.

## Student Message Handling

`POST /api/student/sessions/[sessionPublicId]/initial/messages`:

- requires authenticated student ownership
- rejects teacher_researcher users and other students
- validates message length and client idempotency key
- derives current item and phase server-side
- persists the full student message before agent or fallback handling
- applies Response Collection Agent output only after schema and semantic validation
- returns student-safe state

The route cannot accept client-supplied correctness, option, confidence, phase, item, concept, profile, planning, follow-up, or response collection mode.

## Mixed Messages

For a message like:

```text
I chose B because the value doubles, but can you tell me if I am right?
```

The system should:

- preserve the full message in the transcript
- save only the exact reasoning segment when verified
- refuse correctness feedback
- leave option selection unchanged unless the option button was used
- continue according to deterministic backend evidence rules
- log neutral process context

The student does not see intent labels, extraction segments, provider metadata, process-event labels, or agent-call IDs.

## Procedural Questions

The agent or fallback may answer from the backend-supplied procedural policy:

- how to choose an option
- how to report confidence
- how to write reasoning
- how to revise before completion
- how to skip evidence
- how to save and return later
- why feedback is withheld during initial administration

It must not invent procedures.

## Help Requests

During initial administration, the system refuses:

- hints
- answer checks
- explanations
- option elimination
- content clarification
- solving guidance
- correctness feedback

The refusal is neutral and may invite the student to provide a current best response, skip, or save and exit. It does not shame the student or infer motivation.

## Frustration And Uncertainty

Student messages such as `I do not know`, `I am confused`, or `This is frustrating` receive allowed support only:

- normalize uncertainty briefly
- remind the student support comes later
- point to best response, skip, or save/exit controls

The system does not diagnose ability, motivation, or misconduct from these messages.

## Student-Safe Serialization

Student responses may include assistant message text, current interaction state, current safe item, saved reasoning, selected option, confidence, missing evidence, allowed controls, and a generic fallback indicator.

They do not include recognized intents, event labels, agent metadata, provider/model names, prompt versions, validation details, profiles, formative values, correctness, answer keys, teacher diagnostic metadata, or internal UUIDs.
