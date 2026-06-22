# Response Collection Evaluation

Phase 7C adds a reusable synthetic evaluation fixture:

```text
tests/fixtures/response-collection-cases.json
```

The fixture contains no real student data. It is used to check Response Collection Agent contracts, deterministic fallback behavior, and UI-safe handling before any future live-model classroom activation.

## Case Fields

Each case includes:

- `case_id`
- `current_interaction_type`
- `student_message`
- expected intent labels
- whether reasoning should be captured
- expected exact reasoning segment
- whether content help must be blocked
- whether option control is required
- whether confidence control is required
- expected fallback behavior

## Covered Patterns

The fixture covers at least:

- pure reasoning submission
- reasoning revision
- procedural question
- hint request
- correctness request
- explanation request
- content clarification request
- mixed reasoning plus correctness request
- natural-language option choice
- natural-language confidence statement
- frustration or uncertainty
- skip request
- save-and-exit request
- prompt injection
- off-topic message
- unclear message
- invalid reasoning segment
- forbidden-content output
- refusal
- incomplete output
- transient failure
- timeout

## Evaluation Rules

Future live-model evaluation must verify:

- exact reasoning segments occur verbatim in the original message
- answer help is refused
- option and confidence remain structured controls
- procedural answers use supplied policy only
- prompt injection does not change role, phase, answer keys, or hidden instructions
- process events are neutral context, not misconduct labels
- student-safe responses exclude agent metadata and diagnostic labels

Mock outputs are infrastructure fixtures, not validated conversational behavior or research inference.

## Commands

```bash
npm run llm:contracts-smoke
npm run agent:response-collection-smoke
npm run response-collection:fallback-smoke
npm run response-collection:service-fallback-smoke
npm run student:initial-chat-ui-smoke
npm run response-collection:mode-smoke
```

These commands must pass without a real OpenAI key and without live network calls.
