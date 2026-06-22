# Student Initial Administration UI

Phase 4B implements the protected student-facing platform for initial concept-unit administration. Phase 6D1 extends the same student session page with first-round follow-up conversation after planning completes. The student UI does not call OpenAI directly, fabricate profiles, expose profile/planning labels, add teacher session review, or create CSV export.

## Routes

```text
/student/assessment
/student/assessment/[sessionPublicId]
```

`/student/assessment` lists student-safe available assessments. `/student/assessment/[sessionPublicId]` renders the ChatGPT-style initial administration session. Both routes require student authentication. Teacher researchers are redirected away from student pages.

## Assessment List

The list calls:

```text
GET /api/student/assessments/available
```

Students see title, description, availability status, existing session status, Start, Resume, Completed, or Unavailable. The UI does not show public IDs as the main label and does not expose answer keys or teacher-only metadata.

Start calls:

```text
POST /api/student/assessments/[assessmentPublicId]/sessions/start
```

Repeated Start resumes the existing attempt. Completed attempts do not show a new Start button.

## Conversation Frame Contract

The UI uses `StudentConversationFrame`:

```ts
{
  assistant_message: string;
  interaction_type:
    | "assessment_intro"
    | "concept_unit_intro"
    | "present_item"
    | "request_reasoning"
    | "request_confidence"
    | "missing_evidence_repair"
    | "confirm_skip"
    | "item_completed"
    | "concept_unit_completed"
    | "awaiting_profiling"
    | "followup_active"
    | "followup_updating"
    | "followup_stopped"
    | "session_paused"
    | "error";
  allowed_actions: string[];
  current_item: StudentSafeItem | null;
  missing_fields: Array<"answer" | "reasoning" | "confidence">;
  can_review_responses: boolean;
  can_exit: boolean;
  can_continue: boolean;
}
```

The backend orchestrator determines state and allowed actions. The deterministic presenter generates temporary safe wording. A future Response Collection Agent may generate natural wording inside this contract, but it must not control phase transitions, correctness, answer keys, evidence requirements, or no-feedback rules.

## Interaction Behavior

Option selection uses buttons with option label and text. Selecting or revising an option calls the Phase 4A option endpoint with a client idempotency key. The UI never infers or shows correctness.

Reasoning uses free text only when reasoning is relevant. The UI sends reasoning only when the student saves it. It does not send keystrokes, score reasoning, classify reasoning, summarize reasoning, or critique reasoning.

Confidence uses exactly `low`, `medium`, and `high`, displayed as low, medium, and high confidence. It does not provide calibration feedback.

## Missing Evidence And Skips

When the backend returns `missing_evidence_repair_required`, the UI lists missing answer, reasoning, or confidence evidence. Students can add missing information or continue without it.

Explicit skip actions are deliberate clicks:

- Skip reasoning
- Skip confidence
- Skip this item

Skip copy explains that the system will have less evidence. The UI does not invent responses, shame the student, or mark skipped evidence as visibly incorrect.

## Review And Revision

The Review Responses panel shows only student-safe fields:

- item number
- item stem
- selected option
- reasoning
- confidence
- submitted/incomplete state
- missing fields

Before concept-unit completion, students can revise option, reasoning, and confidence through the same backend APIs. After completion, review is read-only and attempted edits are rejected by the backend with `initial_response_locked_after_concept_completion`.

## Save, Exit, Resume, Refresh

Save and exit calls:

```text
POST /api/student/sessions/[sessionPublicId]/exit
```

The UI confirms before discarding unsaved local reasoning text. Exiting preserves server-saved responses and returns to the assessment list, where the session appears as resumable.

On session page load, the UI fetches server state, transcript, and review data. Browser refresh does not create a new session or submit duplicate responses. Refresh recovery is logged as an approved frontend process event when detectable.

## Process Events

The UI logs only approved frontend event types:

- `page_hidden`
- `page_visible`
- `long_pause`
- `inactivity_detected`
- `navigation_event`
- `refresh_recovery`

Thresholds are configurable:

```text
NEXT_PUBLIC_LONG_PAUSE_MS
NEXT_PUBLIC_INACTIVITY_MS
```

These are technical defaults, not psychological thresholds. The UI does not log clipboard contents, keystrokes, external browsing history, or claims about GenAI use. Process data remain engagement and evidence-sufficiency context, not misconduct evidence.

## Awaiting Analysis

After initial concept-unit completion, the UI shows a neutral awaiting-analysis state. It does not fabricate ability, engagement, integrated diagnostic, evidence-sufficiency, confidence-alignment, formative-value, or follow-up content.

In Phase 6D2A automatic sessions, the same student page may show neutral asynchronous workflow states:

- profiling preparation: progress saved and reviewing initial responses
- planning preparation: progress saved and preparing the next support step
- follow-up opening preparation: progress saved and preparing the follow-up conversation
- workflow failure: progress saved and the system is having trouble preparing the next step

These states do not show workflow job names, provider names, model names, token or cost details, profile labels, formative values, correctness, or internal error details.

After Phase 6B profiling completes, the same student-safe interaction state shows:

```text
Your initial responses have been reviewed. The system is preparing the next support step.
```

While Phase 6C planning is running or queued, the student-safe state may show:

```text
The next support step is being prepared. Your progress has been saved.
```

After Phase 6C planning completes and before the teacher starts follow-up, the student-safe state may show:

```text
A support plan has been prepared. Interactive follow-up is not available yet in this prototype.
```

After Phase 6D1 follow-up starts, the student-safe state shows an active open-ended conversation area. Students can send submitted free-text messages, review locked initial responses, save and exit, or stop the follow-up round. After stopping, the state shows neutral stopped copy and disables further sends for that round.

In Phase 6D2B, when meaningful follow-up evidence triggers backend profile/planning updating, the student-safe state uses `followup_updating`. The composer is disabled and the UI shows neutral saved-progress copy:

```text
I’m reviewing your latest response so the next step can be better matched to your current understanding. Your progress has been saved.
```

Students may still save/exit, review locked responses, or request stop while the update is pending. The UI does not show cycle IDs, job stages, model/provider names, profile labels, formative values, correctness, or internal error details.

The student UI still does not show profile labels, evidence sufficiency, independence interpretability, correctness, diagnostic rationale, formative value, action plans, target evidence, success criteria, answer keys, hidden prompts, or teacher-only diagnostic metadata.

## Demo Fixture

Create a local browser-testing fixture:

```bash
npm run demo:student-assessment
```

Cleanup only the demo assessment and its own records:

```bash
npm run demo:student-assessment:cleanup
```

The fixture uses development credentials only and does not call OpenAI.

## Verification

Run:

```bash
npm run student:ui-smoke
```

The smoke test verifies availability, deterministic conversation frames, option/reasoning/confidence action wiring, missing-evidence repair rendering, skip confirmation, awaiting-analysis rendering, review locking, safe transcript output, and absence of forbidden student-facing fields. Phase 6B adds `npm run agent:profiling-smoke` to verify that post-profiling student payloads remain profile-free. Phase 6C adds `npm run agent:planning-smoke` to verify that post-planning student payloads remain profile-free and planning-label-free. Phase 6D1 adds `npm run student:followup-ui-smoke` to verify active/stopped follow-up UI state, follow-up transcript safety, review locking, and absence of profile/planning labels. Phase 6D2B adds `npm run student:followup-update-ui-smoke` to verify the neutral update-pending state and disabled composer.
