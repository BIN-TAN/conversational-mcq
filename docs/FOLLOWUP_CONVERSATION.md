# Follow-Up Conversation

Phase 6D1 adds the first student-facing open-ended follow-up conversation round after planning completes.

## Route And APIs

Student route:

```text
/student/assessment/[sessionPublicId]
```

Student APIs:

```text
POST /api/student/sessions/[sessionPublicId]/followup/messages
POST /api/student/sessions/[sessionPublicId]/followup/stop
```

The routes require student authentication and ownership of the session. Teacher_researcher users cannot post as a student session owner.

## Student Experience

When follow-up is active, the student sees a ChatGPT-style conversation area with:

- the saved assistant opening message
- chronological student and assistant follow-up turns
- a free-text message box
- Send
- Stop follow-up
- Review responses
- Save and exit

The UI does not send keystrokes. It sends only an intentional submitted message with a client idempotency key.

The UI does not show profile labels, formative labels, evidence-sufficiency labels, independence labels, correctness, correct answers, model names, prompt details, or teacher-only diagnostic metadata.

## Initial Response Locking

Initial item responses remain locked during follow-up. Follow-up messages are appended to `conversation_turns` with `followup_round_db_id`; they do not overwrite `item_responses`.

Review responses remains student-safe and read-only after initial concept-unit completion.

## Stop Behavior

Students may stop the active follow-up round. Stopping:

- marks the round `stopped`
- moves the assessment session to `followup_stopped`
- preserves the transcript
- disables further follow-up sends for that round

Phase 6D1 does not automatically start the next concept unit after stop.

## Save, Exit, Resume

Students may save and exit during follow-up. Server-saved turns remain in the database. If the browser has unsent draft text, the UI asks for confirmation before leaving.

Resume support derives state from the server. It does not create duplicate follow-up rounds or duplicate turns.

## Context Safeguards

There is no pedagogical maximum number of follow-up turns. Technical context safeguards are configured server-side:

```text
FOLLOWUP_CONTEXT_MAX_TURNS
FOLLOWUP_MESSAGE_MAX_CHARS
FOLLOWUP_CONTEXT_MAX_CHARS
```

The full transcript remains stored. Provider calls receive only bounded recent context.

## Process Interpretation

Prompt-injection-like messages, off-topic redirects, long pauses, and other process events are recorded as process context. They are not misconduct labels, cheating claims, or confirmed GenAI-use claims.

## Verification

Run:

```bash
npm run student:followup-ui-smoke
```

The smoke test verifies active and stopped follow-up states, neutral presenter copy, assistant opening display, student message/reply display, review locking, transcript safety, stop behavior, absence of profile/planning labels in student payloads, and no OpenAI network calls.
