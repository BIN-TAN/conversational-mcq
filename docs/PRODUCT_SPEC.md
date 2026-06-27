# Product Specification

## Product Goal

This project is a web-based, chat-native conversation-based MCQ formative assessment platform.

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
- provisional learning-state interpretation;
- formative need determination;
- matched formative activity generation;
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
- LLM-supported interpretation after the initial package;
- one matched formative activity;
- targeted feedback;
- revision;
- student choice to move forward or try a transfer item;
- complete conversation and process-data logging.

Teacher-prepared item upload can be added later. The data model should remain compatible with imported or teacher-authored item sets.
