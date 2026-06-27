# Assessment Flow Specification

## Core Principle

The student assessment should be chat-native. The platform should present the assessment as a conversation while the application controls the state machine, allowed actions, persistence, and answer-key protection.

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

Construct a response package from item responses, transcript turns, and process events. Use the LLM to infer a provisional learning state and formative need after the protected initial item package is complete.

### FORMATIVE_ACTIVITY

Present one matched formative activity based on the response package and formative need.

### FOLLOWUP_RESPONSE

Collect the student's response to the formative activity.

### TARGETED_FEEDBACK

Give brief targeted feedback. This feedback occurs after initial administration and should be matched to the student's response package and formative need.

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
