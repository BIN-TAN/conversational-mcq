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

## Ability Evidence Packet

The fixed IRT MVP can build an internal `ability-evidence-packet-v1` from the existing response package:

```bash
npm run student:ability-evidence-smoke
```

The packet is a profiling foundation, not a student-facing profile and not a calibrated theta estimate. It uses concept/item metadata, internal correctness evidence, distractor diagnostic notes, reasoning, confidence, tempting-option evidence, timings, and process-data confidence modifiers. Numeric item difficulty and discrimination are optional future calibration fields; missing values do not block packet generation.

Do not expose the full packet to students. If a later phase renders the student-safe projection, it must continue to hide answer keys, correctness labels, distractor metadata, misconception IDs, raw reasoning, raw provider output, and internal evidence traces.

For a redacted review artifact and item diagnostic metadata completeness report, run:

```bash
npm run student:ability-evidence-review
```

The command writes ignored artifacts under `.data/ability-evidence-review/`. The default artifacts are safe for design review because they omit raw item stems, raw reasoning, correct option values, answer keys, distractor diagnostic text, raw misconception IDs in the student projection, raw LLM output, and secrets. Metadata limitations should guide later researcher/teacher metadata cleanup before stronger ability inference.

## Engagement Evidence Packet

The fixed IRT MVP can also build an internal `engagement-evidence-packet-v1` from existing response-package and process-event evidence:

```bash
npm run student:engagement-evidence-smoke
```

The packet is a profiling foundation, not a confirmed GenAI-use claim, motivation diagnosis, accusation, or student-facing profile. It uses response presence, reasoning length bands, timing bands, revisions, repair events, focus/visibility events, paste detection, typing activity summaries, pause/inactivity events, and uncertainty markers. Process data are contextual evidence about participation and evidence sufficiency; they do not directly determine ability.

For a redacted review artifact and process-data inventory report, run:

```bash
npm run student:engagement-evidence-review
```

The command writes ignored artifacts under `.data/engagement-evidence-review/`. The default artifacts omit raw reasoning, raw process-event payloads, raw conversation turns, answer keys, correct options, distractor metadata, raw provider output, and secrets. The AI-assistance signal taxonomy is limited to `none_indicated`, `likely_external_assistance_pattern`, and `insufficient_evidence`; it is behavioral context only and should be compared with future student self-report before stronger interpretation.

## Profile Integration Interpretation Packet

The fixed IRT MVP can build an internal `profile-integration-interpretation-v1` packet from the ability and engagement evidence packets:

```bash
npm run student:profile-integration-smoke
```

This packet interprets current knowledge-state evidence and engagement context. It is not formative value determination, not an activity recommendation, not a final student profile, and not classroom validation. Engagement context can lower interpretation confidence or add limitations, but it does not directly change the ability evidence category.

The teacher/research summary inside the packet is also current-evidence-only. It may summarize what the evidence suggests, what is uncertain, and what should not be overclaimed. It must not recommend next steps, activities, interventions, or tutor actions.

For a redacted review artifact, run:

```bash
npm run student:profile-integration-review
```

To review a specific completed session:

```bash
npm run student:profile-integration-review -- --session-public-id <session_public_id>
```

The command writes ignored artifacts under `.data/profile-integration-review/`. Student-safe output is limited to one of `Mostly understood`, `Still developing`, or `Needs more work`, plus a short message and knowledge-focus statement. The student-safe projection hides engagement labels, AI-assistance labels, answer keys, correct options, correctness labels, distractor metadata, raw reasoning, raw process payloads, raw provider output, formative value direction, and activity recommendations.

After the student submits the three-item package, the app persists a profile-integration snapshot in `student_profiles` and displays only the student-safe status/message/knowledge-focus projection in the learning-profile panel. Internal integrated status, integration pattern, engagement context, evidence rationale, and safety flags remain teacher/research inspection data and are not serialized to student payloads. This persistence does not choose a formative value, recommend an activity, or replace the operational formative-profile record used by follow-up logic.

Profile integration can also exercise the provider-backed path, but only through explicit opt-in commands. Default verification remains no-live:

```bash
npm run student:profile-integration-live-smoke
```

The command skips safely unless `RUN_LIVE_PROFILE_INTEGRATION_SMOKE=1` is set. When intentionally enabled, it requires:

```text
DATABASE_URL
SESSION_SECRET
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPENAI_API_KEY or OPENAI_API_KEY_FILE
OPENAI_MODEL_PROFILE_INTEGRATION or OPENAI_MODEL_PLANNING or OPENAI_MODEL_FOLLOWUP
```

The live profile integration path stores `agent_calls` audit metadata for `profile_integration_agent`, including schema version `profile-integration-interpretation-v1`, provider/model metadata, provider request or response metadata when available, output validation status, safe validation errors, and token usage when returned. It does not choose a formative value or activity.

If a schema-shaped live output fails only because it contains remediable direction/planning language, unsupported integrity/authenticity/external-assistance claims, or a high-confidence overclaim, the service may make one repair attempt using the same redacted evidence and safe validation issue metadata only. The invalid output is not included in the repair prompt and is never accepted. If repair fails, the path fails closed and writes sanitized live-smoke diagnostics under `.data/profile-integration-live-smoke/failures/`. The profile integration packet treats AI-assistance signals as internal evidence-production context only; no assistance or provenance claim is made when the signal is `insufficient_evidence` or `none_indicated`, and student-facing text never mentions AI assistance, process data, engagement category, integrity, or authenticity.

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

The live smoke verifies that the response package reaches the provider path, structured profile and targeted-feedback outputs validate, student-visible text remains safe, and `agent_calls` stores provider metadata plus token usage. A live profile or targeted-feedback call with `invalid_output`, `failed`, missing provider metadata, missing token usage, deterministic fallback use, or `output_validated=false` is a live-smoke failure.

If an opt-in paid live smoke fails, the script must preserve diagnostic evidence before any cleanup:

- failed synthetic sessions are retained by default;
- successful synthetic sessions are cleaned up normally;
- a sanitized JSON artifact is written under `.data/student-live-llm-smoke/failures/`;
- generated artifacts remain ignored by Git and must not be committed.

The failure output includes `diagnostic_artifact_path`, `session_public_id`, `agent_call_id`, `agent_name`, `schema_version`, and `validation_status` when available. The artifact stores only summaries: session state, agent-call statuses, validation issue paths, safe validation rule codes, safe blocked-pattern labels, issue counts, output payload keys, presence flags for raw output/provider metadata/token usage, process-event summary fields, and conversation-turn classifications. It must not include raw prompts, raw provider output values, full student response text, answer keys, distractor metadata, API keys, headers, or secrets.

Use the sanitized diagnostic command after a failure:

```bash
npm run student:live-llm-audit-diagnose -- --agent-call-id <agent_call_id>
npm run student:live-llm-audit-diagnose -- --session-public-id <session_public_id>
npm run student:live-llm-audit-diagnose -- --latest-failure
npm run student:live-llm-audit-diagnose -- --artifact .data/student-live-llm-smoke/failures/<artifact>.json
```

The command inspects the retained DB row first when available and falls back to the sanitized artifact when cleanup or manual deletion has removed the row. If neither exists, it reports what it searched and where artifacts are expected.

After the failure has been inspected, remove retained synthetic live-smoke users, sessions, and artifacts with:

```bash
npm run student:live-llm-smoke:cleanup-failures
```

To preserve artifacts while removing retained synthetic DB rows, pass `-- --keep-artifacts`.

## Item Administration Tutor Runtime

The Item Administration Tutor Agent defaults to `ITEM_ADMIN_TUTOR_MODE=auto`.

In `auto` mode, normal browser/runtime traffic uses the live LLM path only when all server-side live configuration is present and the configured credential authenticates successfully:

```text
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPENAI_API_KEY=<set locally, never commit>
OPENAI_MODEL_ITEM_ADMIN=<model>
```

`OPENAI_API_KEY_FILE=<path>` may be used instead of `OPENAI_API_KEY`; the recommended local path is `.data/secrets/openai_api_key`. If `OPENAI_MODEL_ITEM_ADMIN` is blank, the runtime may fall back to `OPENAI_MODEL_FOLLOWUP=<model>`.

For local live testing, keep the real key in `.env.local` or the ignored credential file. `.env` should not contain real OpenAI keys. If both `.env` and `.env.local` contain different `OPENAI_API_KEY` fingerprints, readiness fails closed instead of choosing one silently. If both contain the same fingerprint, readiness reports a warning but can proceed if every other requirement passes.

Run the readiness check before a browser walkthrough:

```bash
npm run llm:readiness
```

When live configuration is otherwise present, this command may perform a lightweight OpenAI model-metadata authentication check. It does not generate model output. It prints only safe diagnostics: provider, model names, key presence, key fingerprint prefix, auth status, auth check time, auth error code, auth cache status, env-file names, safe fingerprint prefixes, and reason codes. It never prints the key value.

If any live requirement is missing, disabled, conflicting, public, invalid, or authentication cannot be confirmed in browser/runtime auto mode, student start/resume is disabled and open-text turns are blocked with a safe temporary-unavailable message rather than silently using mock. `ALLOW_LOCAL_MOCK_RUNTIME` is optional and defaults to `false` when unset; live runtime does not require it. Set `ITEM_ADMIN_TUTOR_MODE=mock` and `ALLOW_LOCAL_MOCK_RUNTIME=true` only for intentional local mock walkthroughs. Invalid explicit values such as `yes`, `1`, or `TRUE` fail closed. Smoke tests may also force deterministic mock without making provider calls.

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

If either live formative output is invalid or unsafe, the runtime fails closed: the student's progress remains saved, no invalid formative activity or targeted feedback is shown, and the student sees the temporary unavailable message. Developer-facing errors use precise codes such as `llm_profile_validation_failed` or `llm_targeted_feedback_validation_failed` while preserving the same student-safe message. Do not treat deterministic fallback output as a successful live formative result.

For a retained failed `agent_calls` row, use the sanitized diagnostic command:

```bash
npm run student:live-llm-audit-diagnose -- --agent-call-id <agent_call_id>
```

The command prints only safe audit fields such as call status, schema version, validation issue paths, validation rule codes, blocked-pattern labels, output payload keys, provider-metadata presence, and token-usage presence. It must not print prompts, raw model output, API keys, headers, or full student text.

Student-facing validation diagnostics use safe rule codes such as `unsafe_student_facing_text`, `rigid_heading_detected`, `internal_label_detected`, `answer_key_leak_detected`, `correctness_label_detected`, `distractor_metadata_detected`, `invalid_learning_status`, `multiple_profile_statuses_detected`, and `missing_required_student_message`. Harmless rigid heading prefixes such as `What you did well:` or `Current focus:` may be removed before validation while preserving the sentence content. Internal labels, answer-key leakage, correctness labels, and distractor metadata remain blocking failures.

Do not record API keys, raw provider payloads, raw model outputs, hidden prompts, answer keys, or full student text in pilot notes.

The live smoke should not run in ordinary local verification or CI. The default development path remains mock/fallback.

## One-Click Local Launcher

The one-click launcher is for daily local use after the full opt-in live LLM smoke has already passed as the backend gate. It does not run paid model-generation smoke tests.

After the project has already been installed, migrated, and seeded, the daily local startup command is:

```bash
npm run app:local:start
```

The start command:

1. checks that `node`, `npm`, and `docker` are available;
2. starts the local PostgreSQL container with `docker compose up -d postgres`;
3. runs `npm run llm:readiness`;
4. refuses to open the app if authenticated live runtime readiness is not ready;
5. starts the Next.js dev server in the background;
6. writes logs to `.data/local-runtime/next-dev.log`;
7. writes the launcher-managed PID to `.data/local-runtime/next-dev.pid`;
8. waits for `http://localhost:3000/api/health`;
9. opens `http://localhost:3000`.

The readiness gate uses the same server-side readiness path documented above. It may perform a lightweight model-metadata authentication check when live configuration is present, but it must not make a model generation request. It prints no API key values. If readiness fails, the launcher prints:

```text
LLM readiness failed. The assessment cannot run in live runtime.
```

and suggests:

```bash
npm run llm:readiness
```

The local launcher must not silently switch to deterministic or mock runtime. Intentional local mock walkthroughs remain explicit:

```bash
ITEM_ADMIN_TUTOR_MODE=mock
ALLOW_LOCAL_MOCK_RUNTIME=true
npm run dev
```

If `ALLOW_LOCAL_MOCK_RUNTIME` is omitted, readiness reports `local_mock_allowed: false`. Missing is not a live-runtime configuration error.

Stop and status commands:

```bash
npm run app:local:stop
npm run app:local:status
```

The stop command leaves PostgreSQL running unless `-- --postgres` is supplied. macOS `.command` launchers are in `launchers/` and provide the same start, stop, and status operations without typing the npm commands.

Full setup after code or schema changes remains separate:

```bash
npm run db:up
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```
