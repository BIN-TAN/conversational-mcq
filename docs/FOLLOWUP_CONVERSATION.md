# Follow-Up Conversation

Phase 6D1 adds the first student-facing open-ended follow-up conversation round after planning completes.

Phase 6D2B adds iterative follow-up evidence updating within the current concept unit. It does not move students to the next concept unit.

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
- Finish follow-up
- Response record
- Save and exit

The UI does not send keystrokes. It sends only an intentional submitted message with a client idempotency key. Enter sends and Shift+Enter inserts a newline.

The UI does not show profile labels, formative labels, evidence-sufficiency labels, independence labels, correctness, correct answers, model names, prompt details, or teacher-only diagnostic metadata.

In Phase 6D2A automatic sessions, the follow-up opening may be prepared asynchronously after planning completes. While the opening is being prepared, the student sees only neutral saved-progress copy and may leave or return later. The browser does not run workflow jobs.

In Phase 6D2B automatic sessions, meaningful submitted follow-up evidence may enqueue backend update jobs. While the update is pending, the message box is disabled and the student sees neutral saved-progress copy. The student does not see profile labels, formative values, correctness, cycle IDs, job names, provider/model names, or internal error details.

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

In Phase 6D2B, if the current active round contains unprocessed substantive evidence, Finish follow-up enqueues a final profile/planning update first. A successful final update activates the final updated profile and decision, closes the round, and does not create a new round. If the final update fails, the previous active profile and decision remain authoritative, the round closes, and teacher review is flagged.

## Save, Exit, Resume

Students may save and exit during follow-up. Server-saved turns remain in the database. If the browser has unsent draft text, the UI asks for confirmation before leaving.

Resume support derives state from the server. It does not create duplicate follow-up rounds or duplicate turns.

## Context Safeguards

There is no pedagogical maximum number of follow-up turns. Technical context safeguards are configured server-side:

```text
FOLLOWUP_CONTEXT_MAX_TURNS
FOLLOWUP_MESSAGE_MAX_CHARS
FOLLOWUP_CONTEXT_MAX_CHARS
FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE
```

The full transcript remains stored. Provider calls receive only bounded recent context.

`FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE` defaults to 3. It is a technical fallback for backend updating when several substantive turns accumulate without an immediate trigger. It is not a pedagogical maximum number of turns.

## Process Interpretation

Prompt-injection-like messages, off-topic redirects, long pauses, and other process events are recorded as process context. They are not misconduct labels, cheating claims, or confirmed GenAI-use claims.

## Verification

Run:

```bash
npm run student:followup-ui-smoke
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
npm run student:followup-update-ui-smoke
```

The smoke tests verify active, updating, and stopped follow-up states; neutral presenter copy; assistant opening display; student message/reply display; review locking; transcript safety; iterative update cycles; final stop updates; absence of profile/planning labels in student payloads; and no OpenAI network calls.

## Phase 6D3 Progression UI

During active follow-up, the student can click `I'm ready to move on`. This preserves the free-text conversational interface and adds neutral choice controls. The UI does not reveal readiness labels, profile labels, formative values, correctness, model/provider names, or workflow job IDs. If recent evidence must be reviewed first, the student sees neutral processing copy.

Additional verification:

```bash
npm run student:progression-ui-smoke
```
