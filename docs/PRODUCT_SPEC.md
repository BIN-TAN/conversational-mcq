# Product Specification

## Product Goal

This project is a web-based, chat-native conversation-based MCQ formative assessment platform.

Phase 30a narrows the dissertation and system framing to **distractor-informed misconception diagnosis in AI-assisted MCQ assessment**. The platform should be understood as an evidence-centered conversational assessment system that uses distractors as diagnostic representations of plausible but non-target reasoning paths. It is not a general ability profiling product or a broad adaptive tutoring system.

The student experience should feel like a chat between an assessment agent and a student, not like a survey, form, or step-by-step questionnaire. The platform should embed an LLM in backend workflows while preserving application control over assessment state, answer-key protection, persistence, process-data logging, and submission logic.

The MVP uses one fixed IRT item set focused on theta invariance and item parameters. Teacher upload can be added later, but the item-set schema should be designed so teacher-prepared item sets can be added without changing the core assessment architecture.

## Platform Boundary

This is not a Custom GPT implementation.

This is a web platform that uses an LLM in the backend. The application owns user accounts, routes, session state, data capture, validation, logging, answer-key protection, workflow transitions, and research exports.

The LLM can be involved throughout the chat, but only inside application-governed boundaries. It may generate conversational messages, interpret response packages, determine formative need, and conduct matched formative follow-up. It must not directly own authoritative assessment progression, reveal answer keys during protected phases, or bypass backend validation.

## Student Experience

The student UI should use agent messages on the left and student messages on the right.

The student should experience the assessment as a natural sequence of short conversational turns:

- the agent presents the item and asks for an answer;
- the student selects an answer or replies in text;
- the agent asks for reasoning;
- the student explains;
- the agent asks for confidence;
- the student selects confidence;
- the agent asks whether another option was tempting;
- the student responds;
- the app automatically moves to the next appropriate step.

MCQ options and confidence choices can appear as clickable chips inside the chat. Clicking an option or confidence chip should create a student chat bubble and automatically advance to the next step.

The assessment list and session shell should support explicit attempt lifecycle actions. Pause and leave preserves a resumable attempt. End attempt is terminal after confirmation and preserves the prior attempt for audit/research. A student must not have two active or paused attempts for the same assessment at the same time.

The first three-item package must not use:

- Saved messages;
- Continue buttons after every micro-step;
- item-level submit buttons;
- correctness feedback;
- answer-key exposure;
- content hints.

## Application Responsibilities

The application must govern:

- authentication and authorization;
- assessment session state;
- current item and current stage;
- answer-key protection;
- item response persistence;
- process-event logging;
- response-package construction;
- state transitions;
- validation of allowed actions;
- student-safe serialization;
- teacher/researcher audit views;
- export behavior.

The LLM must be treated as a backend service called by the platform, not as the source of truth for state.

## LLM Responsibilities

The LLM may be used for:

- conversational agent messages;
- response-package interpretation;
- distractor-informed misconception diagnostic interpretation;
- distractor-informed diagnostic purpose determination;
- matched misconception/distractor-aware activity generation;
- targeted feedback after protected initial administration;
- follow-up conversation.

The LLM must not:

- reveal correctness during initial administration;
- reveal answer keys during protected phases;
- infer authoritative option or confidence values when the backend owns those fields;
- bypass the state machine;
- fabricate stored research evidence;
- mutate operational records outside validated backend services.

## MVP Scope

The MVP should support:

- one fixed item set on theta invariance and item parameters;
- a three-item initial package;
- answer, reasoning, confidence, and tempting-option collection for each item;
- package-level response construction;
- LLM-supported misconception diagnostic interpretation after the initial package;
- one matched distractor-aware formative activity;
- targeted feedback;
- revision;
- student choice to move forward or try a transfer item;
- complete conversation and process-data logging.

Teacher-prepared item upload can be added later. The data model should remain compatible with imported or teacher-authored item sets.

## Evidence-Centered Teacher Authoring

Assessment management includes one evidence-centered item-design workflow inside each mini test. A teacher defines the section/topic, one or more learning objectives, observable evidence requirements, optional misconception hypotheses, and optional exemplar items. Misconceptions are design hypotheses to probe, not facts assigned to students. Historical item difficulty or a high wrong-answer rate is not sufficient by itself to establish a misconception.

**New mini test** is the authoring entry for this workflow. The first screen creates only the mini-test shell and scheduling details. The system then opens a persistent teacher-facing authoring conversation where the teacher can paste course material, describe the topic, refine learning objectives and evidence requirements, identify misconception hypotheses, and share exemplar items. The assistant returns structured, versioned updates to the same evidence-centered blueprint; it does not replace the blueprint with untracked prose. A separate review mode exposes every blueprint field for direct teacher editing before draft generation. The assessment library is reserved for managing and organizing existing assessments, including folders, ordering, release state, archiving, restoration, and guarded deletion. Archived mini tests remain read-only until restored.

The authoring conversation and item generation are separate operations. The conversation shapes the blueprint and records focused design questions and changes. Only after the teacher opens review mode and requests generation may the item authoring assistant use the saved blueprint to generate draft MCQ candidates. Generated keys remain proposals. Generated candidates must enter the same teacher review flow as imported items: the teacher reviews and edits the stem and options, confirms the answer key, reviews reasoning and distractor notes, selects candidates, and imports them as drafts. The assistant cannot publish, include, or administer an item automatically.

This workflow implements the evidence-centered sequence:

- claims: section/topic and learning objectives;
- evidence: observable reasoning requirements and misconception-linked response patterns;
- tasks: teacher-reviewed MCQ candidates designed to elicit that evidence;
- assembly: teacher selection across objectives, reasoning demand, and difficulty;
- interpretation: item-level evidence retained beneath an objective- and section-level profile.

Six to nine included items is the recommended authoring starting point, not a psychometric requirement. The current validated runtime supports three to twelve included items and shows the student the current item, total item count, and number remaining. No fixed number of items proves or disproves a misconception.

## Phase 30a Framing Boundary

The main research construct is now the **misconception diagnosis profile**, not a general ability profile. Engagement/process data should be interpreted as evidence-quality context that qualifies the confidence of a diagnosis. Formative value language remains in code for compatibility, but the dissertation framing is a four-purpose distractor-informed diagnostic taxonomy:

- `conceptual_entry_grounding`
- `distractor_misconception_probe`
- `reasoning_boundary_repair`
- `independent_misconception_verification`

Confidence calibration is a modifier. Consolidation and transfer are exit or extension paths. The product must not claim to prove complete learning gain, detect cheating, or prove that no misconceptions exist when no actionable distractor-linked evidence is visible.

## Phase 31al Evidence-Integrated Profile

The post-package profile is not a single global label. The current contract is
`EvidenceIntegratedProfileV2`, which stores scored outcome, assessment-specific
understanding, reasoning quality, confidence calibration, evidence limitations,
item-level evidence, uncertainty, and one evidence-linked growth target as
separate dimensions.

Correctness is strong observed evidence, but not a stable ability estimate,
course-grade prediction, motivation label, or misconduct signal. Concise but
accurate reasoning is treated as a reasoning-depth limitation rather than an
automatic misconception or weak-understanding label. Missing tempting-option
evidence is normally neutral.

The formative route is distractor-first whenever the student has enough
conceptual footing to evaluate, correct, rank, transform, or reason about
administered distractors. Foundational or prerequisite support is used only when
the evidence shows distractor work is not yet accessible.

## Phase 31ao Student Communication and Topic Dialogue

Student-facing package feedback should read as one concise, evidence-linked
tutor message, not as a technical profile report. Structured evidence remains
available to teacher and research views, but the student page should not use a
persistent duplicate profile/results sidebar. Administered answer review appears
once in the tutor chat as "Review your answers" and the conversation continues
from there.

The `student_communication_agent` is fact-locked. It may improve tone,
conciseness, transitions, and student-facing wording, but it must not change
scored facts, answer reveal state, growth target, activity contract, or runtime
destinations.

The `topic_dialogue_agent` is bounded topic support after a formative activity.
It is not unrestricted chat. It may address only the current topic, current
concept, administered items, relevant distractors, the frozen growth target, and
the student's activity response. It must redirect unrelated questions and must
stop at the configured turn limit or when the student is ready to advance. The
agent generates the next student-facing formative turn, while the application
retains authority over activity state, revision, transfer, completion, and
answer visibility. Students do not replace the active activity through a
separate activity-choice control.

## Phase 31ap Live Student Dialogue

Student communication and topic dialogue can use server-side live OpenAI
Responses calls only when the global LLM live configuration and the role-specific
toggles are explicitly enabled. The browser never calls OpenAI directly.
Deterministic dialogue is limited to explicit no-live test mode or a typed
provider, schema-validation, or safety fallback; ordinary clarification does
not select a replacement activity or bypass the topic-dialogue call.

Topic dialogue accepts short clarification and assessment-system questions, such
as "what", "which item do you mean", or "what happens next". The dialogue scope
is limited to the current assessment content and how to use the assessment
interface. It must not expose raw IDs, teacher-only notes, hidden prompts,
unadministered item keys, or operational implementation details.

## Formative Conversation Runtime

After the initial package and learning profile are available, new student
sessions enter one persistent `FormativeConversationSession`. This supersedes
activity-owned controls as the active student experience. Historical activity
and topic-dialogue records remain readable for audit and compatibility.

The `formative_conversation_agent` hosts the learning conversation. It may
explain administered answers, teach directly, work examples, provide hints,
answer follow-up questions, change explanation strategy, and move beyond the
original activity when pedagogically useful. It does not return a fixed
pedagogical action enum.

The platform retains authority over authentication, transcript persistence,
idempotency, privacy, safety, unadministered-item protection, conversation
lifecycle, and validated learning-profile transitions. The approved
`formative_conversation_agent` operational role supplies the model and
live-call boundary. Historical `topic_dialogue_agent` records and routes remain
available for legacy sessions, but they do not own the new conversation.

Tutor generation reliability is tracked per persisted student message. A
student turn remains append-only while its assistant response moves through
`pending`, `retrying`, `failed`, or `completed`. Failed generation is shown as
an incomplete exchange with an idempotent retry action; it is retained for
teacher/research audit and never replaced by deterministic instructional text.

Learning-profile evolution in this phase is append-only. The conversation agent
authors learning observations, evidence interpretation, and any recommended
outcome (`sound`, `largely_improved`, or
`teacher_assistance_recommended`). A terminal recommendation includes one
complete canonical updated profile and field-level provenance that distinguishes
conversation-supported changes from unchanged fields whose earlier evidence
remains valid. The platform must not create an updated profile by copying stale
fields from the prior version. It validates and persists the prior and updated
profiles, source turns, source agent call, evidence references, transition
timestamp, outcome, and initial assessment profile; it does not infer an
outcome from activity completion, conversation status, profile pointers, or
fixed thresholds. Insufficient evidence leaves the conversation active and
records evidence without forcing a profile transition.

Outcome interpretation is qualitative and remains owned by the conversation
agent. `sound` means that the student's own explanation or application supports
clear conceptual understanding. `largely_improved` means that conversation
evidence shows meaningful improvement from the initial assessment evidence
while limitations remain. `teacher_assistance_recommended` means that a
meaningful barrier remains despite supportive interaction and human support may
be useful. These interpretations do not impose turn counts, required
activities, or fixed instructional sequences.

The profile-transition proposed outcome is the authoritative teacher-assistance
decision. Any compatibility field carrying a teacher-assistance recommendation
must mirror that outcome and may not independently create or suppress it.
Conversation lifecycle remains separate; a profile outcome does not
automatically end the conversation.

Teacher review presents this evidence as one readable trajectory: administered
item responses and the initial profile, the visible student/tutor conversation,
and each validated profile transition with its supporting turns. It does not
show hidden prompts, provider payloads, API metadata, routing decisions, or
deterministic workflow labels. Teacher review and research exports read the same
latest persisted transition. When none exists, both report that no validated
profile change exists rather than deriving a learning outcome heuristically.
Research exports retain the phase-separated raw assessment evidence, observable
formative telemetry, safe agent metadata, and append-only transition provenance
needed for reproducible analysis.
