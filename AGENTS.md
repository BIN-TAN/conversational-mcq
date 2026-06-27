# Project Guidance for Codex

Before coding, read:

- `docs/PRODUCT_SPEC.md`
- `docs/ASSESSMENT_FLOW.md`
- `docs/DATA_LOGGING_SPEC.md`

Preserve the chat-native assessment architecture. The student flow should feel like a conversation, not a survey or form.

Do not recreate survey-style UI in the student assessment flow. Avoid or remove Saved messages, Continue buttons after micro-steps, and item-level submit behavior during the first three-item package.

Keep the application responsible for assessment state transitions, submission logic, answer-key protection, and process-data logging.

Use the LLM for conversational agent messages, response-package interpretation, formative need determination, and matched formative follow-up. Do not let the LLM own authoritative state transitions or expose answer keys.

When implementing features, add or update relevant tests. Run focused checks such as `npm run typecheck`, `npm run lint`, and student-flow smoke tests when appropriate.

After each task, summarize changed files, verification commands, and any limitations.
