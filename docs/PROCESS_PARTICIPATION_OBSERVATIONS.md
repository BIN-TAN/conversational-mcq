# Pause, participation and session timing

Implemented contracts: `process-data-summary-v8`, `session-timing-v4`,
`participation-observation-v3`. These are deterministic projections of persisted
records, not new learning scores. No migration or historical transcript rewrite
is required. Item timing retains its own separately exported contract.

## What is recorded

- Explicit assessment pause/resume events preserve the current phase. New pauses
  also preserve current topic/item public IDs. Conversation-only pauses and
  resumes are a separate lifecycle. Both preserve the existing attempt.
- Browser visibility, idle observations, navigation, reloads and submitted input
  telemetry remain separate records. Closing a browser is best-effort telemetry,
  not an explicit pause or a guaranteed final event.
- Tutor messages saved, tutor messages partly displayed and student replies are
  distinct facts. `display-ack-v2` requires partial viewport visibility for at
  least 500 ms. It does not measure full reading or understanding.

## Teacher review

Process data includes a Pauses and returns table with scope, phase, timestamp,
student messages before pause, matching return, and observed pause interval.
Learning conversation activity distinguishes no recorded student reply from
no recorded tutor display. No affect, motivation, misconduct, mastery or learning
gain is inferred from these observations.

The attempt time span includes explicit pauses and waiting. The separately named
attempt window excluding explicit pauses is not active study time either: reading,
AI waiting, browser-hidden periods and unobserved inactivity can remain in it.

## Research output and formulas

`pause_episodes.csv` is one row per explicit pause episode. Its accompanying
`pause_episode_data_dictionary.csv` documents every field. Join on
`session_public_id` and, when known, `conversation_public_id` and
`concept_unit_public_id`. Student identifiers remain pseudonymous.

1. A pause opens an episode; consecutive duplicate pauses and legacy aliases do
   not create another episode. The first subsequent resume in the same scope
   closes it. Assessment and conversation scopes are not interchangeable.
2. `pause_duration_ms = resumed_at - paused_at` on server timestamps. An unmatched
   or terminated episode has an empty duration, not zero. `no_resume_recorded`
   means no resume observed by the export snapshot; it is right-censored rather
   than permanent abandonment. Overlapping scopes must not be summed.
   A recorded conversation completion/end also closes an unmatched conversation
   pause when its lifecycle event is missing. Later lifecycle records are excluded
   from that conversation's pause projection; no return time is invented.
3. `student_messages_before_pause` counts persisted student turns at or before the
   pause in the linked conversation. Unknown/ambiguous conversation context is
   empty, not zero. A historical assessment pause links only to a unique eligible
   conversation in a recorded learning-conversation phase.
4. `display_receipt_to_pause_ms = paused_at - last_tutor_display_received_at`
   only when the receipt belongs to the current participation window.
   `participation_window_started_at` is the latest conversation start, assessment
   resume, assessment view-open, or linked conversation resume/reentry at or
   before the pause, using server timestamps. A previous visit's receipt remains
   in `last_tutor_display_received_at`, but the interval is null and
   `display_receipt_scope=earlier_participation_window`. A matching current receipt
   has scope `current_participation_window`; absent receipts use `not_recorded`.
   Both use server-clock observations. Network delivery affects the interval.
   Display acknowledgements must match the conversation and a persisted tutor
   sequence index. Legacy acknowledgements are not upgraded to verified display.
   This interval is not reading time or evidence of dissatisfaction.
5. `formative_conversation_sessions.csv` adds saved/displayed tutor counts, first
   display receipt and first student reply. Counts of displayed replies are
   distinct source tutor turns. Missing acknowledgements do not mean unseen text.
   Numeric and historical numeric-string sequence indexes identify the same turn.

The teacher conversation summary retains `pause_count` and `resume_count` as
conversation-only lifecycle counts. Its separately named `assessment_pause_count`
and `assessment_resume_count` count assessment-scope episodes linked to that
conversation, with the latter restricted to matched returns. Unknown conversation
linkage is null. These scopes can overlap and must not be added together. Public
conversation/topic IDs are included for joins. `conversation_ended_at` is the
earliest recorded conversation completion/end timestamp, not a learning outcome.
Zero student messages remains zero when a student closes the conversation.

Version 1 could report a multi-day display-to-pause interval after a return even
when no display was acknowledged on that visit. Version 2 preserves the earlier
receipt but leaves that interval empty. Older downloads are unchanged; re-exports
identify the new projection. No source timestamps or historical behavior are
backfilled. A new partial-display receipt is not guaranteed on a return, and
missing current-visit display is not evidence that the student did not read.

Raw process events, lifecycle events and conversation turns remain available.
These summary tables are reproducible convenience views, not replacement data.

### Boundary regression corrections

Version 3 chooses the canonical assessment pause/resume record over its legacy
alias when their server timestamps match, before resolving topic context. This
keeps a multi-topic pause linked to the same conversation regardless of database
row order. Unmatched aliases remain in the readable timeline. Repeated pauses
without a resume form one episode, including aliases delivered later.

In process summary v8, the core assessment pause count equals the number of
assessment-scope episodes, and its resume count equals the number with a matched
return. Orphan resumes and post-termination events are not counted as matched
returns. The timeline and raw archive retain their source records. Historical
conversation-only raw counters retain their separately documented meaning.

Display references accept positive safe integers or digit-only numeric strings;
booleans, arrays, decimals and exponent strings are not turn IDs. A receipt must
match a tutor turn in the same conversation and cannot precede its creation or
the conversation start on the server clock. The timeline preserves valid legacy
numeric-string joins. Missing or rejected receipt evidence is not unseen text.

The teacher summary now consistently uses recorded server timestamps for its
additional conversation activity, including its compatibility input without a
full observation object. It no longer reintroduces raw browser-clock dates into
the session endpoint after the shared timing function has normalized them.
Raw event timestamps and student records remain unchanged.

## Corrected session endpoint

For a completed attempt, completion (or a recorded terminal event) is the cutoff.
Late browser acknowledgements cannot extend that attempt. For an open attempt,
the endpoint is the latest of assessment last activity, process-event server
receipt/recorded timestamp, conversation start/end/activity, persisted turn dates,
and conversation lifecycle dates. Administrative `updated_at` is only a fallback
when no activity endpoint exists; the fallback is explicitly marked.
For frontend events, the timestamp priority is explicit `server_received_at`,
then database `created_at`, then legacy `occurred_at` when receipt data is absent.
Backend events retain their recorded `occurred_at`. Original client timestamps
remain unchanged; a skewed browser clock cannot override an available receipt.

`session_wall_clock_elapsed_ms = session_observation_end_at - started_at`
(session creation is the start fallback). `elapsed_session_time_ms` is the same
calculation, retained as a compatibility alias. Endpoint and source are exported.
The teacher view and research export use the same function. Paired hidden
intervals are intersected with session bounds; overlapping idle intervals are
unioned before intersecting resumable lifecycle windows. Unknown active
interaction remains empty. Client/server clocks are preserved separately.

Earlier exported files are unchanged. Re-exporting recalculates summaries from
the existing records, including later conversation activity previously clipped
by a stale assessment `last_activity_at`.

## Item and turn identity

Readable item labels and research `process_events.item_position` use the stored
`item_presented.payload.item_position`, not mutable authoring order. Conflicting
or missing positions remain unknown; teacher tables label fallback values as
authoring items. `authoring_item_order` is retained separately in process events.

Readable transcripts retain their display `turn_index` and add the persisted
`source_turn_sequence_index`, matching display acknowledgements and research
conversation rows within the same session. Public item IDs remain available for
joins. These references appear only in teacher/research views, not student chat.

## Interpreting pauses

Pauses can guide questions for the end-of-term experience survey. They can also
reflect time constraints, reading, interruptions, technical trouble, or a plan
to return. Keep the behavioral facts and any later self-reported experience as
separate data sources. This change introduces no mandatory survey, repeated
clarification prompts, pause penalty, or automatic profile downgrade.

## Verification

- `node --import tsx prisma/participation-observations-smoke-test.ts`
- `node --import tsx prisma/process-data-summary-smoke-test.ts`
- `node --import tsx prisma/student-resumed-session-timing-smoke-test.ts`
- `node --import tsx prisma/student-visibility-timing-smoke-test.ts`
- `node --import tsx prisma/student-item-timing-contract-smoke-test.ts`
- `node --import tsx prisma/student-data-dictionary-timing-smoke-test.ts`
- `node --import tsx prisma/student-teacher-readable-transcript-smoke-test.ts`
- `node --import tsx prisma/student-research-export-integrity-smoke-test.ts`
- `node --import tsx prisma/participation-ui-smoke-test.ts`

Fixtures are synthetic and make no provider calls. Transcript/export integration
tests use the local test database; the integrity test explicitly scopes its export
to its own fixture. Browser checks cover 1440 px and 390 px, timeline filtering,
downloaded pause data, page overflow and browser errors. Production export
verification and deployment are separate checks, not implied by local tests.

Local verification on 2026-10-02: the checks above passed, as did type checking,
changed-file lint, item timing, visibility timing and Markdown rendering checks.
The full-repository lint run still reports six pre-existing errors in ignored
`.data/grant-demo-*` scripts and five pre-existing unused-variable warnings.
The first legacy export run identified missing definitions for the new transcript
reference fields; both definitions were added before the passing rerun.
