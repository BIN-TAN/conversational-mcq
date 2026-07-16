# Assessment Flow Specification

## Core Principle

The student assessment should be chat-native. The platform should present the assessment as a conversation while the application controls the state machine, allowed actions, persistence, and answer-key protection.

Phase 30a reframes the purpose of the flow as distractor-informed misconception diagnosis. The flow still collects the same answer, reasoning, confidence, and tempting-option evidence, but the design rationale is now to form, test, weaken, or reject distractor-linked misconception hypotheses rather than to produce a broad ability profile or broad adaptive tutoring path.

## Initial Item Administration

For each of the first three items:

1. Present item stem and options in chat.
2. Ask: "What is your answer?"
3. After the answer, ask: "What is your reason for choosing [answer]?"
4. After the reason, ask: "How confident are you: Low, Medium, or High?"
5. After confidence, ask: "Was another option tempting? If yes, which one, and what made it tempting? You can also say No."
6. If the student gives a tempting option but no reason, ask: "What made that option seem tempting?"
7. Then move automatically to the next item.

The answer and confidence choices may be displayed as clickable chips inside the chat. Selecting a chip should produce a student chat bubble and immediately advance the state.

## Initial Administration Rules

During initial administration:

- do not reveal correctness;
- do not reveal answer keys;
- do not give content hints;
- allow only procedural clarification;
- if the student asks a content question, respond: "I can address that after the three questions. For now, please give your best answer and reasoning.";
- if the student goes off topic, redirect briefly to the current step.

The first three-item package should not use Saved messages, Continue buttons after every micro-step, or item-level submit buttons.

## Assessment State Machine

The application should control these states:

```text
SESSION_START
ITEM_PRESENTED
AWAIT_ANSWER
AWAIT_REASON
AWAIT_CONFIDENCE
AWAIT_TEMPTING_OPTION
AWAIT_TEMPTING_REASON
ITEM_COMPLETE
PACKAGE_REVIEW
PACKAGE_ANALYSIS
FORMATIVE_ACTIVITY
FOLLOWUP_RESPONSE
TARGETED_FEEDBACK
REVISION
NEXT_CHOICE
TRANSFER_ITEM
SESSION_COMPLETE
```

The LLM can generate conversational language inside these states, but it must not own the state machine.

## State Behavior

### SESSION_START

Create or resume the student assessment session. Show a conversational opening and begin the first item when the student starts.

Only one active or paused attempt may exist for a student and assessment. If a resumable attempt exists, the student assessment list shows Resume attempt and End current attempt, not a new Start button. Ending an attempt is terminal and preserves all records; pausing an attempt remains resumable.

Attempt lifecycle projections must be derived through the shared canonical resolver in `src/lib/services/student-assessment/attempt-lifecycle.ts`. The resolver treats `assessment_sessions.status`, `current_phase`, `completed_at`, and resume fields as the authoritative persisted source for resumability, terminality, pause/end eligibility, and whether a new attempt may start. Student list labels, start/resume/end commands, teacher close controls, diagnostics, and repair tooling should use this same resolver rather than independently interpreting status strings. Repeated lifecycle commands should return the already-satisfied canonical state instead of surfacing a generic conflict, and safe reconciliation is limited to non-substantive lifecycle metadata such as stale active-session resume fields.

### ITEM_PRESENTED

Show the item stem and options in chat. The app records that the item was presented and transitions to `AWAIT_ANSWER`.

### AWAIT_ANSWER

Ask: "What is your answer?"

The student may click an option chip or provide an allowed answer action. The app records the answer and transitions to `AWAIT_REASON`.

### AWAIT_REASON

Ask: "What is your reason for choosing [answer]?"

The student provides free-text reasoning. The app records the reasoning and transitions to `AWAIT_CONFIDENCE`.

### AWAIT_CONFIDENCE

Ask: "How confident are you: Low, Medium, or High?"

The student clicks a confidence chip. The app records confidence and transitions to `AWAIT_TEMPTING_OPTION`.

### AWAIT_TEMPTING_OPTION

Ask: "Was another option tempting? If yes, which one, and what made it tempting? You can also say No."

If the student says no, the item can transition to `ITEM_COMPLETE`.

If the student provides a tempting option with a reason, the item can transition to `ITEM_COMPLETE`.

If the student gives a tempting option but no reason, transition to `AWAIT_TEMPTING_REASON`.

### AWAIT_TEMPTING_REASON

Ask: "What made that option seem tempting?"

After the student responds, transition to `ITEM_COMPLETE`.

### ITEM_COMPLETE

Persist the completed item response. If fewer than three initial items are complete, automatically present the next item. If all three are complete, transition to `PACKAGE_REVIEW`.

### PACKAGE_REVIEW

Allow package-level review or edit if supported. Review should be at the package level, not an item-level submit loop. When the package is ready, construct the response package and transition to `PACKAGE_ANALYSIS`.

### PACKAGE_ANALYSIS

Construct a response package from item responses, transcript turns, and process events. Use the LLM to support misconception diagnostic integration after the protected initial item package is complete. Selected options, tempting options, reasoning, and confidence can anchor distractor-linked misconception hypotheses. Process data qualify evidence reliability only and must not become student-facing engagement or misconduct labels.

### FORMATIVE_ACTIVITY

Present one matched misconception/distractor-aware activity dialogue based on the response package and diagnostic purpose. The activity may directly contrast a distractor when misconception evidence warrants it, or it may ground the basic concept or request independent reconstruction when evidence is too weak, mixed, or low reliability.

### FOLLOWUP_RESPONSE

Collect the student's response to the formative activity.

### TARGETED_FEEDBACK

Give brief targeted feedback. This feedback occurs after initial administration and should be matched to the student's response package and distractor-informed diagnostic purpose.

### REVISION

Ask for a natural revision, such as:

- "Now revise your reasoning for Question 2 in one or two sentences."
- "Now update your explanation using this distinction."
- "Now restate the difference in your own words."

### NEXT_CHOICE

Offer:

A. Move to the next concept.

B. Try another question on the same idea.

If A is selected, progress according to the application's concept progression rules.

If B is selected, transition to `TRANSFER_ITEM`.

### TRANSFER_ITEM

Present the transfer item and collect answer, reason, confidence, and tempting option using the same chat flow. The app should preserve answer-key protection until feedback is allowed.

### SESSION_COMPLETE

Mark the session complete when the assessment workflow is finished.

## Backend Authority

The application owns:

- current state;
- allowed student actions;
- response persistence;
- answer-key protection;
- timing and process-event capture;
- package construction;
- LLM call boundaries;
- feedback eligibility;
- completion.

The LLM may produce language and structured interpretations, but backend validation must decide what is stored, shown, and used for progression.

## Phase 30a Loop Policy

The diagnostic loop should be described as continuing until no actionable distractor-linked misconception evidence remains, until the current misconception hypothesis is weakened or unsupported, until evidence becomes insufficient, until the student chooses a destination-specific continue action, or until a runtime guard stops the loop. It should not be described as looping until all misconceptions are eliminated.

## Phase 31al Post-Package State Contract

After the three initial items are complete, the backend constructs the response
package, then produces and persists:

1. `EvidenceIntegratedProfileV2`
2. `PackageFeedbackV2`
3. `NextInteractionV2`

The UI may render package results, profile, feedback, and the next interaction
together, but state ownership remains explicit:

`PACKAGE_COMPLETE -> SHOW_PACKAGE_RESULTS -> SHOW_EVIDENCE_PROFILE -> SHOW_PACKAGE_FEEDBACK -> SHOW_NEXT_INTERACTION -> AWAIT_*_RESPONSE`

Only `NextInteractionV2.prompt` may contain the next actionable student prompt.
Package feedback must not contain a separate quick-check question. While an
await state is active, the UI must not show a "Prepare learning activity" button
or generate a second activity before the student responds, chooses another activity, or selects a destination-specific skip/continue action.

Correctness status is separate from answer-key reveal. The default pilot policy
shows total and item-level correct/incorrect status, the correct option, and a
concise student-facing explanation for each administered initial item
immediately after the initial package is completed. This reveal applies only to
administered initial items. Transfer items or other unadministered items remain
protected.

After this reveal, formative activities must not ask the student to rediscover
which option is correct. They may reference the known correct answer when useful,
but they should require new reasoning, such as identifying a specific distractor
flaw, correcting the inaccurate part of an option, comparing distractors, or
reverse-engineering what the item was testing.

## Phase 31al2 Attempt Lifecycle and Navigation

Attempt lifecycle behavior is defined in `docs/ASSESSMENT_LIFECYCLE_TIMING_BOUNDARIES.md`.

Student-facing controls must distinguish:

- Pause and leave: resumable.
- End attempt: terminal after confirmation.

Teacher-facing review may close a stuck or test attempt and allow another attempt without deleting or overwriting the original attempt. In the formative stage, the student-facing terminal action is **End assessment**, not generic "Move on" wording. Ending from this stage records a specific terminal reason and completes the attempt without showing another activity or transfer item.

## Phase 31ao Post-Activity Topic Dialogue

After the student submits a formative activity response, the backend creates a
`PostActivityLearningDecisionV1` from persisted evidence. The decision, not the
LLM, selects the next runtime path:

- `ready_to_advance`: show valid progression choices.
- `improving_but_incomplete`: enter bounded topic dialogue.
- `specific_misconception_remaining`: enter misconception-focused topic dialogue.
- `foundational_support_needed`: provide bounded scaffolded topic dialogue.
- `insufficient_new_evidence`: ask one low-burden clarification within the topic.

The explicit dialogue states are:

`SHOW_POST_ACTIVITY_FEEDBACK -> SHOW_TOPIC_DIALOGUE_PROMPT -> AWAIT_TOPIC_DIALOGUE_RESPONSE -> EVALUATE_TOPIC_DIALOGUE_RESPONSE -> SHOW_PROGRESSION_CHOICES | SHOW_FINAL_SUPPORT_OPTIONS`

Only one learning prompt may await a response at a time. Refresh and resume must
restore the persisted prompt/response state rather than regenerate dialogue.
The default maximum is eight student dialogue turns, after which the UI offers
final support options and valid progression/end choices.

## Phase 31ap Live Topic Dialogue Boundary

For a new topic-dialogue student message, the backend owns the sequence:

`persist student message -> construct bounded context -> optional live topic dialogue call -> validate output -> persist tutor turn -> return presenter`

The optional live call is server-side only and is enabled by explicit role and
global LLM configuration. Refresh, resume, and idempotent replay reuse persisted
dialogue records and must not create a new provider call. If live output is not
available or fails validation, deterministic fallback can clarify the current
task, redirect off-topic messages, or offer final support options, but it is not
reported as successful live dialogue.

Short nonempty messages during `AWAIT_TOPIC_DIALOGUE_RESPONSE`, including
"what", "why", "about what", and "which item do you mean", are valid
conversation turns. They are classified as clarification or system-use
questions instead of rejected as malformed assessment answers.
