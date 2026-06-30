# MVP End-to-End Readiness

This note covers the fixed IRT chat-native MVP path:

```text
session start
-> three protected initial items
-> package review
-> response package
-> formative profile/activity
-> targeted feedback
-> revision
-> next choice
-> optional transfer item
-> session complete
```

## Mock E2E Smoke

Run the default full-path smoke with:

```bash
npm run student:mvp-e2e-smoke
```

The smoke uses synthetic accounts, the fixed IRT demo assessment, and the mock LLM provider. It verifies both:

- Path A: the student chooses to move on after revision and the session completes without a transfer item.
- Path B: the student chooses another question, completes the transfer item, and then the session completes.

The smoke verifies that the initial response package contains exactly the three included initial items and excludes the transfer item. It also checks that protected initial-administration text does not reveal correctness, answer keys, hints, or internal profile labels.

## Evidence Export

The mock E2E smoke writes developer-only evidence snapshots under:

```text
.data/student-mvp-e2e-smoke/
```

These files are ignored by Git. Each snapshot includes:

- session summary;
- item responses;
- transfer response when present;
- conversation turns;
- process events;
- response package payload;
- formative profile and decision records;
- follow-up round records;
- targeted feedback, revision, and next-choice turns;
- LLM/mock agent-call audit records.

The export is for local development and audit checks only. It is not student-facing UI and should not be committed.

## Opt-In Live LLM Smoke

Live LLM readiness is intentionally opt-in. The script loads local Next.js env files with `@next/env`, then exits without a provider call unless this flag is set:

```bash
RUN_LIVE_LLM_SMOKE=1
```

Required variable names:

```text
DATABASE_URL
SESSION_SECRET
RUN_LIVE_LLM_SMOKE
LLM_PROVIDER
LLM_LIVE_CALLS_ENABLED
OPENAI_API_KEY
OPENAI_MODEL_PLANNING
OPENAI_MODEL_FOLLOWUP
```

Keep secrets in ignored local env files such as `.env.local`, or in a secure shell environment. Do not commit `.env`, `.env.local`, credential files, or generated evidence files.

The default check is safe and should report a skipped result:

```bash
npm run student:live-llm-smoke
```

When explicitly enabled, configure live calls server-side before running. Use placeholders in documentation and real values only in ignored local env files or the shell:

```bash
RUN_LIVE_LLM_SMOKE=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
OPENAI_API_KEY=<set locally, never commit> \
OPENAI_MODEL_PLANNING=<model> \
OPENAI_MODEL_FOLLOWUP=<model> \
npm run student:live-llm-smoke
```

Do not paste API keys into chat. Do not commit `.env`, `.env.local`, or credential files.

If `RUN_LIVE_LLM_SMOKE=1` is set but required configuration is missing, the script prints only missing or invalid variable names. It never prints variable values.

The live smoke verifies that the response package reaches the provider path, structured outputs are schema-shaped, unsafe or invalid outputs are blocked or replaced with deterministic fallback, student-visible text remains safe, and `agent_calls` stores provider metadata plus validation status.

## Item Administration Tutor Runtime

The Item Administration Tutor Agent defaults to `ITEM_ADMIN_TUTOR_MODE=auto`.

In `auto` mode, normal browser/runtime traffic uses the live LLM path only when all server-side live configuration is present:

```text
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPENAI_API_KEY=<set locally, never commit>
OPENAI_MODEL_ITEM_ADMIN=<model>
```

`OPENAI_API_KEY_FILE=<path>` may be used instead of `OPENAI_API_KEY`; the recommended local path is `.data/secrets/openai_api_key`. If `OPENAI_MODEL_ITEM_ADMIN` is blank, the runtime may fall back to `OPENAI_MODEL_FOLLOWUP=<model>`.

Run the no-network readiness check before a browser walkthrough:

```bash
npm run llm:readiness
```

If any live requirement is missing, disabled, conflicting, public, or invalid in browser/runtime auto mode, student start/resume is disabled and open-text turns are blocked with a safe temporary-unavailable message rather than silently using mock. Set `ITEM_ADMIN_TUTOR_MODE=mock` and `ALLOW_LOCAL_MOCK_RUNTIME=true` only for intentional local mock walkthroughs. Smoke tests may also force deterministic mock without making provider calls.

Backend audit payloads record `item_admin_tutor_source` for open-text administration turns:

```text
live_llm
deterministic_mock
safe_block_after_live_failure
configuration_blocked
```

These values are developer/teacher audit evidence only and are not shown in the student UI.

The optional live Item Administration Tutor smoke must skip without a provider call by default:

```bash
npm run student:item-admin-live-smoke
```

To run it manually, configure live calls only in an ignored local env file or secure shell environment:

```bash
RUN_LIVE_ITEM_ADMIN_SMOKE=1 \
ITEM_ADMIN_TUTOR_MODE=auto \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
OPENAI_API_KEY=<set locally, never commit> \
OPENAI_MODEL_ITEM_ADMIN=<model> \
npm run student:item-admin-live-smoke
```

If `OPENAI_MODEL_ITEM_ADMIN` is not set, the smoke may use `OPENAI_MODEL_FOLLOWUP=<model>` as the server-side fallback model variable. The script prints only missing or invalid variable names, never secret values. It verifies that a content question such as “What is theta?” is classified as `content_question`, does not advance to confidence, stores a deferred concern, and that explicit uncertainty is accepted as low-information evidence.

For pilot-readiness notes, record only status fields and pass/fail observations. After a successful manual live run, confirm:

```text
profile_call_status = succeeded
profile_output_validated = true
targeted_call_status = succeeded
targeted_output_validated = true
```

Do not record API keys, raw provider payloads, raw model outputs, hidden prompts, answer keys, or full student text in pilot notes.

The live smoke should not run in ordinary local verification or CI. The default development path remains mock/fallback.
