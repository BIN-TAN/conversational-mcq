# Suggested dissertation text updates (2026-10-17)

These suggestions bring the working draft (Sections 3.1–3.2.1 and Appendix A) in
line with the decisions recorded in `DESIGN_ALIGNMENT_2026-10-17.md`. They are
drafting aids for the author, not quotations of the draft. Section numbers refer to
the 16 October working draft.

## 3.1.1 Item preparation: mini-test size and topic

Current: "Each mini-test is designed to focus on a specific topic and is recommended
to contain three to five MCQs".

Suggested addition: "Each mini-test addresses exactly one topic. The system accepts
three to twelve items per mini-test; three to five is recommended."

## 3.1.2 Item administration: skipping, uncertainty and attempts

Current: "Students may skip an item or individual response prompts and revise their
answers or explanations during the assessment."

Suggested replacement:

> Students are not offered a skip option. When unsure, they can choose "I don't know
> yet" instead of an answer option, give a brief or uncertain justification
> (including stating that they do not know), select a low confidence rating, and
> answer "No" when no other option was tempting. They may revise their answers,
> explanations, confidence ratings and alternative-option reasoning before
> submitting the mini-test.

Suggested addition on attempts: "Students may complete each mini-test up to three
times. Each attempt is recorded separately, and instructors can restore an attempt
lost to a documented technical problem."

Suggested addition on timing (process data): "Item response time is measured from
the moment the item is presented to the student until the item's responses are
complete."

## 3.1.3 Profiling and feedback: who sees the profile

Suggested addition: "Understanding profiles are provided to the formative
conversation module and to instructors through the reporting dashboard. Students
receive tailored feedback and a review of their answers but do not see the profile
itself. When profile generation fails, the system records a conservative technical
fallback that makes no diagnostic claims, and the record is marked as a fallback."

## 3.1.4 Formative conversation: turn limit and ending

Current: "The system permits up to 30 student-authored conversational turns".

Suggested replacement: "The system permits up to 30 student-authored conversational
turns per mini-test. Students may end the conversation at any time, including while
a response is being prepared; messages awaiting a reply remain recorded."

## 3.1.5 Instructor reporting: the reporting LLM

Suggested addition:

> On request, the reporting module's LLM reviews all students' submitted responses
> and conversation transcripts for a mini-test and writes an instructor report. Each
> finding quotes the students' own words, and the system verifies every quotation
> against the stored records before saving the report. Each quotation links to the
> corresponding student record. Participation counts and response distributions on
> the dashboard are calculated directly from the records rather than by the LLM.

Course scope: "The pilot runs as a single course. Support for multiple courses, with
instructor access restricted to their own courses, is planned before the 2027
evaluation."

## 3.1.2 Item administration: typed explanations (D10)

Suggested addition: "Written explanations (the justification for the selected answer
and the explanation of a tempting alternative) must be typed; the interface does not
accept pasted or dropped text in these fields. Attempts to paste are recorded as
process events. External GenAI use is not otherwise restricted."

## Appendix A: models (D9, five-module model policy)

The current table (terra for four modules, luna low for item administration) does not
match the system. Replace Table A1 with the configuration below. In the List of
Tables, change "Table A1. Recorded Model Assignments on 5 October 2026" to "Table A1.
Model Assignments by Module (17 October 2026)".

**Table A1**

*Model Assignments by Module (17 October 2026)*

| Module | Model identifier | Reasoning setting |
| --- | --- | --- |
| Item preparation | gpt-5.6-luna | Medium |
| Item administration | gpt-5.6-luna | Medium |
| Student profiling and feedback generation | gpt-5.6-luna | Medium |
| Formative conversation | gpt-6.1-sol | Medium |
| Instructor reporting | gpt-6.1-sol | Medium |

*Note.* Each module uses one model configuration. Within a module, separate prompts
with their own output checks carry out its sub-tasks (for example, profiling and
feedback writing within the profiling and feedback module). The first four
assignments were verified in seven reviewed synthetic sessions before the 13 October
2026 release; the instructor-reporting assignment was configured on 17 October 2026
and is reviewed on sample reports before use. Model identifiers refer to OpenAI API
models available at that date.

Rationale for the text, if needed: the smaller, faster model (GPT-5.6 Luna) handles
the high-volume tasks that run while students wait and whose outputs are checked
by the application or reviewed by the instructor; the stronger model (GPT-6.1 Sol)
handles the two tasks that synthesise a whole conversation or a whole class, where
an earlier all-Luna configuration failed review. Lower reasoning effort was not used
because a low-effort configuration failed profile validation in testing.
