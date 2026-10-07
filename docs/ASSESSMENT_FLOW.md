# Assessment Flow Specification

## Conversation Closure and Attempt Completion (2026-09-27)

`planning_completed` is the persisted feedback-ready phase, not assessment
completion. Teacher pages label it **Learning conversation**, with a paused or
ended qualifier where the conversation status is available. Initial question
submission counts are labeled separately from completed attempts.

Ending the conversation does not itself end the attempt. A closed conversation
now offers **Finish assessment** when every published, included topic has a
sealed initial package, completed initial administration, a closed conversation,
and saved tutor responses for every receipt. Active conversations, pending or
failed feedback, and platform-failure closures cannot use this completion path.
Students retain Retry/contact-teacher recovery for feedback failures.

Finish is an explicit, owner-authorized, transactionally serialized action.
Concurrent retries create one completion event and preserve the original
completion timestamp. The attempt becomes `completed` / `session_completed`
and read-only. This is workflow completion, not a claim of mastery, improvement,
or a completed final reassessment. It creates no profiles or learning outcomes.
Pause/resume and explicit early termination retain their existing meanings.
Historical paused/ended attempts are not automatically rewritten or backfilled.

## Protected Collection and Learning Summaries (2026-09-26)

Initial and transfer explanation collection uses item-admin tutor v2. The model
classifies a message; the application supplies content-neutral collection text.
No model-authored conceptual hint is displayed during protected collection.
Short, incorrect, option-derived, or uncertain reasons remain evidence, not a
reason to demand repeated rewriting. On-topic difficulty statements are retained
verbatim as limited evidence. One neutral clarification may be requested for an
incomplete fragment; a subsequent fragment is retained as weak evidence rather
than trapping the student. Content/answer requests, procedural requests, edits,
off-topic text, and gibberish do not become reasons merely through repetition.
Provider failures remain recoverable blocked operations, not student deficits.
Letters such as B are never translated into an invented admission of not knowing.

Host v7.9 defaults to a direct answer and focused explanation, expanding when
needed or requested without a hard word limit or truncation. Learning summaries
are conversational waypoints, not automatic completion. They include only
evidence-supported understanding, specific supported progress, and remaining
difficulties when applicable. There is no "Discussed, awaiting confirmation"
section or equivalent placeholder. Progress requires earlier and later student
reasoning; tutor explanations, agreement, or requests for help do not establish
improvement. The tutor can continue correcting misconceptions while turns remain,
respect a pause, or recommend specific teacher support without claiming a teacher
has been notified. Item/key concerns require teacher review, not silent rescoring.

## Teacher Test Preview

- Assessment details include **Preview the test**, which opens `/teacher/content/assessments/[assessmentPublicId]/preview` in a new tab. This standalone, read-only page uses normal document scrolling and a **Return to mini test** link, with full saved wording, options, and active media in topic/item order.
- Included, non-archived items in non-archived topics are shown by default. **All saved items** also shows excluded and archived content, marked as not included. Draft and archived assessments remain previewable.
- Answer keys are hidden initially and can be shown explicitly by the teacher. Reloading or opening a new preview hides them again; the original detail tab and its unsaved edits remain untouched.
- Preview uses the existing authenticated, owner-scoped teacher detail response. It creates no attempt, response, process event, or provider call and changes no publication or content state.

## Core Principle

### Three-Chance Attempt Policy

`assessment-attempt-policy-v2` reserves one of three chances inside the same
serializable transaction that creates a new session. Duplicate concurrent start
requests resume the existing session. The allowance applies across a corrected
assessment family; a resumable attempt in another version blocks a new start.
An existing third attempt can still be resumed with zero new chances remaining.
End attempt remains terminal and consumes its chance. Teacher technical
restoration requires ownership, a terminal attempt and a recorded reason; it is
idempotent and does not reopen or renumber historical sessions. Deletion of a
session is not a restoration. The student history display limit remains three,
independently of research retention.

### Current Free-Text Conversation Limit

The formative learning conversation permits up to **30 student-authored turns**.
Its counter starts at zero only when the formative phase begins. Initial item
answers, explanations, confidence, alternative-answer evidence, tutor openings,
and retries of the same message do not consume formative turns. Turn 30 is the
final allowed turn; the platform rejects a new turn 31 even across concurrent
tabs. Earlier valid completion and student exit remain available. A longer
limit is not a required number of turns or evidence of learning.

Active or paused conversations use the current 30-turn policy. Closed histories
retain their recorded policy, with a 12-turn fallback for legacy records; they
are not reopened. Accepted student messages and tutor replies record the limit
in their existing structured payloads. Historical frozen evaluation fixtures
continue to compile under their explicit/default 12-turn contract.

The student assessment should be chat-native. The platform should present the assessment as a conversation while the application controls the state machine, allowed actions, persistence, and answer-key protection.

Phase 30a reframes the purpose of the flow as distractor-informed misconception diagnosis. The flow still collects the same answer, reasoning, confidence, and tempting-option evidence, but the design rationale is now to form, test, weaken, or reject distractor-linked misconception hypotheses rather than to produce a broad ability profile or broad adaptive tutoring path.

## Teacher Authoring Flow

**Import items** is the alternative entry for existing JSON or Excel item sets.
JSON stages one draft mini test; Excel inspection shows every visible item sheet
and reference sheet before teachers select which tests to prepare. Selected
sheets create separate draft tests and review batches atomically, with no LLM
call. Each test requires normal item review and key confirmation. Reference
guides remain teacher source material and cannot change student instructions or
phase boundaries. Teachers can resume a saved batch from its mini-test detail
page. See `MINI_TEST_JSON_IMPORT.md` for formats, limits and provenance.

Teacher-created mini tests use this evidence-centered sequence:

`NEW MINI TEST -> AUTHORING CONVERSATION -> BLUEPRINT REVIEW -> DRAFT GENERATION -> ITEM REVIEW AND KEY CONFIRMATION -> DRAFT MINI TEST`

The first step records only the mini-test identity, organization, and availability dates. The item-design assistant then works conversationally from teacher-provided course material, section boundaries, objectives, observable evidence requirements, misconception hypotheses, and source exemplar items. Course material may be pasted or attached as a bounded PDF, DOCX, PNG, JPEG, or WebP file. Every accepted assistant response applies validated structured updates to the versioned blueprint and is retained in the teacher-authoring transcript. Each uploaded source is linked to the teacher turn and must receive a validated teacher-only summary before the exchange is accepted.

The teacher can switch to blueprint review at any time and directly edit every design field, including a cognitive-demand mix of foundational (remembering, understanding, and applying), analyzing, evaluating, and creating. Readiness language from the assistant is advisory only. The platform does not generate items automatically. A teacher-triggered draft request is divided into bounded resumable generation chunks and becomes one review batch only after the complete set passes the saved blueprint contract. Generated candidates cannot enter the mini test until the teacher reviews their wording and rationale and explicitly confirms each answer key. Assessment-library screens manage existing mini tests; they do not own the authoring conversation.

The empty authoring conversation offers editable starter requests for course materials, topic-based planning, misconception hypotheses, and exemplar-question review. Each uses the current item/option target and asks for a design for teacher review, not immediate generation. Selecting or switching a starter preserves teacher-written notes and attachments and never sends a message, saves a blueprint, or generates items automatically.

Published content with no student attempts may be returned to draft. After a student attempt starts, the administered mini-test version remains permanently read-only. If the teacher identifies an error, **Create corrected version** makes a linked draft copy with new public IDs and preserves the prior content hash and correction reason. The teacher edits and reviews that draft through the normal authoring controls. Publishing it archives the preceding version for new starts in the same database transaction. Existing attempts continue and remain reviewable against their original assessment and item records.

## Student Catalog Membership

For students created or imported by a teacher, new starts are limited to assessments owned by that teacher, matching the teacher's assessment library. Publication, scheduling, content validity, and runtime-readiness checks still apply. The list and direct start endpoint enforce the same membership rule; knowing an assessment public ID does not bypass it.

The reserved legacy fixture `assessment_mvp_irt_theta_invariance` is not a default classroom assignment. New starts require a student explicitly associated with its owning teacher. The local demo seed associates its synthetic student with its synthetic teacher. No production ownership, publication state, or historical evidence is rewritten by this rule. Teacher-created tests with the same title are ordinary assessments, not filtered by title.

Existing attempts remain resumable or reviewable under the existing lifecycle rules even when their assessment is outside the student's current catalog. Such assessments never offer a new attempt. Records, content snapshots, response evidence, and the three-attempt review limit are preserved.

Compatibility: older student accounts without `created_by_teacher_user_id` keep the existing single-course catalog, excluding the reserved demo. This is not multi-course authorization; any future multi-teacher enrollment model must explicitly assign those legacy accounts rather than treating account creation as course enrollment.

## Initial Item Administration

Current teacher-authored mini tests administer the complete included item set for the section. The validated set size is three to twelve items; six to nine is the recommended authoring starting point. The fixed three-item language below documents the original MVP fixture rather than a requirement that every misconception receive exactly three items. The student UI shows `Item X of N` and the number remaining.

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

The student assessment list shows only tests that can be started, resumed, or opened for prior-attempt review. Tests that are otherwise unavailable are omitted rather than displayed with a disabled unavailable control.

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

Normal tempting-option responses and in-flow edits use the same completion path.
In-flow editing applies only to the current item in an active attempt; paused
attempts must be resumed, and earlier items are edited through package review.
If an answer changes to the previously tempting option, the earlier evidence
remains in the transcript, but the student is asked for a new tempting choice
instead of being blocked. Choosing No after selecting a tempting option is valid.
Repeated start requests preserve the original start time and do not repeat the
first-item presentation. A Retry action preserves the original submission ID
and observation link, including when the first response was saved but its reply
was lost in transit.
When an edit supplies the last missing evidence, completion and its research events
are recorded once, followed by the next included item or package review. A resumed
attempt with complete evidence but a missing submission timestamp automatically
retries completion through the existing authenticated submit endpoint. It does not
require a student-facing submit/continue button or another AI call. Incomplete edits
continue to request missing evidence.

### Formative Misconception Coverage

The formative tutor considers every administered response, including justification
and tempting-option reasoning, and every unresolved misconception claim. It groups
issues only when the student's reasoning supports the connection. Usually one
manageable focus is chosen from the student's request, a blocking prerequisite,
a shared distinction, and evidence specificity. These are flexible considerations,
not a routing algorithm, remediation queue or required sequence. Distinct issues
remain in context and can be revisited without forcing complete coverage.
Wrong answers alone are not proof of a misconception, and correct answers can
contain faulty reasoning. A prerequisite review follows demonstrated need or a
student request, not the number of wrong answers. An overview request can address
several topics directly.

Only supported student evidence resolves a claim. The existing validator rejects
unsupported global understanding and tutor-recommended completion with retained
claims; it does not require students to answer a conversational exercise before
using the existing pause/finish controls. Partial improvement, discussion, agreement
and student departure are distinct from complete conceptual resolution.

### Conversational Application Questions

Host `formative-conversation-host-v7.16` may initiate a brief MCQ when applying an
idea would help, without waiting for a practice request. It is not required after
each explanation. The question and options appear together in the ordinary tutor
message, inviting an option and a brief reason in one reply. There is no required
format, added confidence/tempting-option collection, separate screen, activity,
submission gate, or new structured follow-up record.

Suitable reviewed examples in the supplied context may be used; otherwise the
tutor constructs instructional examples with explicit assumptions and defensible
options. These are not published or independently validated assessment items.
The tutor first identifies a meaningful reasoning decision, rather than only changing
names or numbers in a worked example. It checks the premises, necessary assumptions
and each option for a defensible best answer. Open questions and direct explanations
remain appropriate alternatives. Objections trigger reconsideration of the actual
premises, not automatic agreement or automatic defence of the tutor's answer.
The initial invitation does not reveal the answer. Requested hints, direct answers
and explanations remain available before a student responds. Option-only,
explanation-only, uncertainty, declining, objections and topic changes are normal
conversation. The tutor accounts for prior help when interpreting later reasoning;
success is not automatically independent transfer or retained learning.
A restatement after both answer and explanation were supplied is recognition,
not a new application or automatic claim resolution. A stop-only message after
an existing profile update requires no duplicate profile transition.
The same assistance-aware boundary applies to praise and closing summaries. Summarizing
a study design just supplied by the tutor is not independently designing that study.
A valid complaint about duplicate options is not by itself evidence of the underlying
concept, and an accurate clause followed by endorsement of the original error remains
conflicting evidence. Substantive conceptual objections may support the specific
claim they explain. These are instruction-level safeguards, not guarantees that every
generated semantic judgment is correct.

The persisted context now carries accepted, evidence-linked recognition qualifications
from earlier displayed tutor turns. Interpretation policy v4 rejects a resolved claim
supported only by that previously qualified evidence unless the current output explicitly
justifies reconsidering the earlier interpretation. New substantive student evidence remains
eligible under the existing scope and cutoff checks. This is a consistency safeguard, not
a word-overlap classifier or an independent semantic judge. A student is not required to
provide additional evidence before receiving help, changing topic, pausing or finishing.

Persistent confusion calls for a narrower explanation or a different concrete representation,
without waiting for an explicit request for fewer words. Generated alternatives should have
comparable detail and plausible contrasts; an open question is suitable when balanced options
would add unnecessary complexity. There is no fixed explanation length or enforced sequence.
Versioned participation input constraints distinguish knowledge and expression limitations from participation:
wrong answers, guessing, short English, low confidence or help requests alone do not justify
low engagement. Specific participation evidence and alternative explanations remain necessary.

A flawed conversational example is openly clarified or replaced, and interpretations
depending on it are reconsidered through existing validated updates or teacher review.
Original assessment records and keys are not rewritten. Existing transcript,
operational logging and evidence-based profile mechanisms remain unchanged.

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

## Persistent Formative Conversation Cutover

The result review and live tutor have separate jobs: the review displays observed
answer results, while the tutor supplies the sole conversational opening. Internal
legacy package summaries must not reappear as student dialogue in teacher-readable
projections. Host v7.10 anchors the opening in an actual student statement, preserves
accurate parts of reasoning, clarifies option/reason mismatches without rescoring,
and adapts explanatory depth to the student's request. It adds no provider stage,
mandatory exercise, new turn limit or profile-transition shortcut.

For sessions with a `FormativeConversationSession`, the authoritative
post-profile path is:

`INITIAL PACKAGE -> REVIEW YOUR ANSWERS -> INITIAL LEARNING PROFILE -> FORMATIVE CONVERSATION`

The conversation is not organized around activity cards, activity families, or
a fixed follow-up sequence. A student message is persisted before context
compilation. The backend then compiles the full visible formative transcript,
administered assessment evidence, profile history, observable telemetry
summary, intervention history, and safe teacher guidance; calls
`formative_conversation_agent`; validates the structured response; and persists
one visible tutor turn linked to the agent call.

Refresh and sign-in resume the same conversation and transcript. Duplicate
client message IDs replay the persisted receipt and cannot create a second
provider call or tutor turn. Pause, resume, and end affect the formative
conversation lifecycle without rewriting assessment evidence.

Each persisted student message has an explicit assistant-response lifecycle:
`pending`, `retrying`, `failed`, or `completed`. A failed generation preserves
the student turn, failed `AgentCall`, and safe terminal failure telemetry, but it
does not count as a completed tutor turn. The student may retry that same
persisted message idempotently; retries use a new generation attempt identity
and can create at most one visible tutor turn. Normal failure recovery never
substitutes deterministic teaching text.

Legacy `FORMATIVE_ACTIVITY`, topic-dialogue, revision, and next-choice records
remain available for historical sessions. They are not the active UX when a
formative conversation session exists.

## Backend Authority

### Help after initial feedback failure

After a failed initial-preparation job, **Try again** reuses the sealed responses.
The failure screen offers teacher-contact guidance instead of **End attempt**,
including hiding the usual header end control in this state. **Pause and leave**
remains available. Reading the guidance or reloading does not end the attempt,
consume another chance or notify the teacher automatically. Source-integrity
conflicts require teacher help rather than another unsafe retry. The retired
continue-without-feedback API returns HTTP 410, including to old browser tabs.

The ordinary confirmed end API remains available outside this recovery screen
and to old clients; it does not advance to another topic or count as successful
completion. Retry and end serialize on the session; end cancels runnable work,
and repeated end requests are idempotent. Background work cannot revive it.

If that ordinary end action is explicitly requested, the failed job and its calls
remain failed. The topic's follow-up is `incomplete`,
without a fabricated completion timestamp or new profile; the teacher review flag
records the operational problem. The attempt becomes `student_exited`, without
a completion timestamp. Existing chances are not automatically refunded; teachers
can restore one using the technical-problem waiver. All students receive an
approved 30,000 output-token allowance per initial-feedback call. Other agent
limits and all output validation remain unchanged. A detected `max_output_tokens` failure stops automatic
retries instead of spending the same budget repeatedly; explicit retry stays
available. Other transient failures retain the existing bounded retry policy.

Provider credit exhaustion and account quota failures also stop automatic initial
preparation retries. The student retains the saved answers, **Try again**, and
teacher-contact guidance; no attempt is ended or marked complete by this failure.
Account/billing diagnostics appear only in the teacher's LLM status view and
restricted technical records, never in student conversation messages.

Temporary HTTP 429 responses use at most three transport attempts with 2-second
and 8-second base delays. A provider's `Retry-After` (seconds or HTTP date) or
`retry-after-ms` is a minimum, with up to 500 ms of rate-limit jitter. Inline
retries wait at most 30 seconds each (60 seconds total); a longer provider delay
is deferred, not shortened. Initial-preparation jobs honor that persisted delay
before a background retry. Credit/quota failures are not temporary traffic limits
and do not consume these automatic transport retries.

The application owns:

- current state;
- allowed student actions;
- response persistence;
- answer-key protection;
- timing and process-event capture;
- package construction;
- LLM call boundaries and safety validation;
- feedback eligibility;
- conversation lifecycle and completion.

During assessment, backend validation decides what is stored, shown, and used
for progression. During formative conversation, the LLM owns teaching content
and conversational strategy while the backend validates safety, persistence,
and any recommended profile transition.

A terminal profile recommendation from `formative_conversation_agent` appends a
new profile version from the agent's complete canonical profile recommendation.
Each field is identified either as updated from cited conversation evidence or
as unchanged because its existing evidence remains valid. The platform must not
blindly clone stale understanding, evidence-sufficiency, confidence-alignment,
or misconception fields. The transition records the prior and updated profiles,
supporting student and tutor turns, source agent call, conversation evidence
references, timestamp, outcome, and initial assessment-profile provenance. A
recommendation to continue records evidence but does not force an outcome or
append a profile version. No activity-completion rule, fixed threshold, legacy
topic-dialogue route, conversation status, or current-profile pointer determines
the formative learning outcome.

The conversation agent interprets terminal outcomes qualitatively from
observable student evidence. Sound understanding requires a supported
explanation or application; largely improved understanding reflects meaningful
change with remaining limitations; teacher assistance may be recommended when a
meaningful barrier persists despite supportive interaction and human support
may be useful. These interpretations do not require a minimum number of turns,
an activity sequence, or a fixed instructional path. The profile-transition
proposed outcome is authoritative, and any teacher-assistance compatibility
field must agree with it.

Teacher and research projections use the same latest persisted transition as
the authoritative formative result. If no transition exists, the displayed
state is `No validated profile change yet`; projections must not infer
`sound` or `largely_improved` from narrative text or runtime state.

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

After the student submits a formative activity response, the backend persists
the student turn, reconstructs the complete visible formative transcript and
evidence context, and creates a `PostActivityLearningDecisionV1`. The decision,
not the LLM, authorizes the next runtime path:

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

`persist student message -> construct bounded context -> topic_dialogue_agent call -> validate structured output -> apply platform action gate -> persist tutor turn -> return presenter`

The live call is server-side only and is enabled by explicit role and global LLM
configuration. No-live tests use the explicit deterministic adapter. Refresh,
resume, and idempotent replay reuse persisted dialogue records and must not
create a new provider call. Runtime fallback is allowed only for a provider
failure, schema-validation failure, or safety failure and is never reported as
successful live dialogue.

Short nonempty messages during `AWAIT_TOPIC_DIALOGUE_RESPONSE`, including
"what", "why", "about what", and "which item do you mean", are valid
conversation turns. They are classified as clarification or system-use
questions instead of rejected as malformed assessment answers.
The student UI does not expose a `Choose another activity` action. Clarification
and requests for an example are handled as turns within the same activity
attempt.

## Content validity and student dialogue boundary

The active formative host v7.11 reviews explicit questions in the initial
reasoning, tempting-option rationale and visible conversation, separately from
endorsed misconceptions. It responds to the current request and returns to
other unanswered questions without requiring a new quiz or treating a question
as a false belief. Internal observations document coverage; students see only
natural instructional dialogue.

Authoring, initial semantic review and formative teaching share
`assessment-content-validity-v1`. The separately approved canonical profiling
and advisory item-verification prompts remain unchanged in this release; extending
this policy to those agents requires a separately verified approval amendment.
A plausible challenge
to an ambiguous key is not automatically a student misconception. Explanations
must state relevant definitions and assumptions rather than invent premises to
defend a key. In particular, formal CTT true score is expected observed score
over defined replications, not necessarily construct-pure ability. Stable
irrelevant influences can affect that expectation and validity; averaging
random errors does not eliminate stable bias. See Livingston (2018), *Test
Reliability--Basic Concepts*, ETS RM-18-01, pp. 9-11:
https://www.ets.org/Media/Research/pdf/RM-18-01.pdf.

A disputed administered item must be reviewed by a teacher. The application
continues to protect sealed item snapshots and historical responses. Corrected
content uses the existing linked draft/revision workflow, not silent rescoring.
Publishing a correction is separate from deploying this software policy.

Student-message validation screens known internal field names, evidence/session
identifiers and operational terminology before display. Collection and initial
feedback use their existing safe failure/repair paths; formative conversation
uses its bounded regeneration/retry path. The screen does not filter student
responses or modify historical transcripts. It is a defense in depth, not a
guarantee that arbitrary model prose cannot leak information. Provider inputs
must still exclude secrets and unrelated student data. Requests for internal
information receive a brief neutral refusal and appropriate instructional help.

## Student continuity and completion (October 2026)

Unsent text in the main conversation composers is retained in session storage
for up to 12 hours, scoped to the attempt and response context. This supports
refresh and return in the same browser tab; it is not cross-device storage and
does not submit an answer. Accepted text is cleared. Logout and read-only review
clear retained response drafts. If storage is unavailable, or an answer-edit
panel has unfinished changes, leaving prompts a warning instead of silently
discarding those changes.

Alternative-option choices include their wording and associated media. Keyboard
navigation moves to the next response control. Long tutor replies open at their
beginning, while returning to the same reply restores the reading position.
An arriving reply offers a navigation action when the student is reading above
the end of the conversation, rather than forcing the page to scroll.

During a learning conversation, the header has one reversible `Pause and leave`
action. Finishing the final conversation uses one `Finish assessment`
confirmation. The client requests conversation end, then assessment completion
only when the server authorizes it; these remain separate persisted events.
Interrupted completion can be retried. Non-final topics finish only their own
conversation. Any unsent message is explicitly excluded from submission.
