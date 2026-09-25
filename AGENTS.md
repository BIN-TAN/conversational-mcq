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

## Required Change and Deployment Record

After every application change followed by a user-requested push or Render
deployment, update the existing Word record without waiting for another reminder:

- Source ledger: `docs/release-records/releases.json`.
- Word file: `docs/release-records/Conversational_MCQ_Change_and_Deployment_Record.docx`.
- Workflow and rebuild instructions: `docs/release-records/README.md`.

Append a release entry rather than replacing earlier entries. Record the problem,
systemic fix, affected areas, tests and their actual results, research-data impact,
limitations, application commit, and verified deployment evidence. Distinguish
local verification, push, and successful deployment; never infer Live from a push
or an older Render deployment. Preserve failed/deferred checks and follow-up
corrections. Do not include credentials or identifiable student transcripts.

Regenerate the same Word file from the ledger, render it, and inspect every page
before closing the task. Commit and push the ledger and Word artifact when push is
authorized. A documentation-only follow-up commit is not another application
release: retain the deployed application commit in the record and do not create
an endless deployment/documentation loop. These instructions are a task completion
requirement, not a claim that an unattended background service monitors deploys.
