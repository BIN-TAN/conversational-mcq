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

## Phase 30a Framing Note

The MVP should now be understood as a distractor-informed misconception diagnosis prototype. Existing script and artifact names still use implementation-layer terms such as ability evidence, engagement evidence, profile integration, formative value, and formative activity. For dissertation framing:

- ability evidence supports a misconception diagnosis profile and must not be claimed as general ability measurement;
- engagement evidence is evidence-quality context and must not determine misconception by itself;
- profile integration is misconception diagnostic integration;
- formative value determination is distractor-informed diagnostic purpose selection;
- formative activity is misconception/distractor-aware dialogue.

The MVP remains structurally the same. Phase 30a does not change runtime behavior, provider behavior, item content, scoring, UI, or database schema.

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

Under Phase 30a, this packet is a misconception-diagnosis evidence foundation. Its distractor maps, tempting-option evidence, and reasoning analysis are central because they can anchor or reactivate distractor-linked misconception hypotheses.

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

The packet is a profiling foundation, not a confirmed GenAI-use claim, motivation diagnosis, accusation, or student-facing profile. It uses response presence, reasoning length bands, item timing bands, focus-adjusted task timing bands, response-production timing bands, reasoning typing bands, revisions, repair events, focus/visibility events, paste detection, typing activity summaries, pause/inactivity events, and uncertainty markers. Process data are contextual evidence about participation and evidence sufficiency; they do not directly determine ability. The packet includes provisional v1 threshold metadata and item/session decision traces so teacher/research review can see which deterministic rules matched, which did not, and why other categories were not selected. Initial three-item packages with active ultra/extreme rapid timing plus repeated sparse or low-information evidence can support `disengaged`; rapid-warning timing is weaker and requires convergent weak-engagement signals. Reasoning typing time is a supporting process signal only and never classifies disengagement by itself. Completed items remain baseline completion context, observed process events remain data-quality context, and substantive reasoning requires task relevance or quality evidence rather than length alone.

Under Phase 30a, engagement evidence is evidence-quality context. It can lower diagnostic confidence or support independent reconstruction, but it must not directly create a misconception diagnosis or appear as a student-facing label.

For a redacted review artifact and process-data inventory report, run:

```bash
npm run student:engagement-evidence-review
```

The command writes ignored artifacts under `.data/engagement-evidence-review/`. The default artifacts omit raw reasoning, raw process-event payloads, raw conversation turns, answer keys, correct options, distractor metadata, raw provider output, and secrets. They may include threshold names/values, wall-clock/focus-adjusted/response-production/reasoning-typing duration bands, count bands, timing-source labels, safe event type/source/timestamp reconstruction, rule IDs, reason codes, item public IDs, and the session public ID. The AI-assistance signal taxonomy is limited to `none_indicated`, `likely_external_assistance_pattern`, and `insufficient_evidence`; it is behavioral context only and should be compared with future student self-report before stronger interpretation.

## Profile Integration Interpretation Packet

The fixed IRT MVP can build an internal `profile-integration-interpretation-v1` packet from the ability and engagement evidence packets:

```bash
npm run student:profile-integration-smoke
```

This packet interprets current knowledge-state evidence and engagement context. It is not formative value determination, not an activity recommendation, not a final student profile, and not classroom validation. Engagement context can lower interpretation confidence or add limitations, but it does not directly change the ability evidence category.

Under Phase 30a, this packet should be read as misconception diagnostic integration. It integrates distractor-linked evidence, reasoning, confidence, and evidence-quality context. A conceptual entry gap is not a misconception; insufficient or low-reliability evidence should remain uncertain.

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

If a schema-shaped live output fails only because it contains remediable direction/planning language, unsupported integrity/authenticity/external-assistance claims, internal correct-option phrasing, or a high-confidence overclaim, the service may make one repair attempt using the same redacted evidence and safe validation issue metadata only. The invalid output is not included in the repair prompt and is never accepted. The repair candidate may be safety-canonicalized to remove unsupported internal wording before strict validation; if it still fails validation, the path fails closed and writes sanitized live-smoke diagnostics under `.data/profile-integration-live-smoke/failures/`. The profile integration packet treats AI-assistance signals as internal evidence-production context only; no assistance or provenance claim is made when the signal is `insufficient_evidence` or `none_indicated`, and student-facing text never mentions AI assistance, process data, engagement category, integrity, or authenticity.

## Formative Value Determination Packet

The fixed IRT MVP can build a `formative-value-determination-v1` packet from the profile integration interpretation packet:

```bash
npm run student:formative-value-smoke
```

The packet recommends exactly one broad formative value from:

- `diagnostic_clarification`
- `reasoning_refinement`
- `confidence_calibration`
- `independent_understanding_verification`
- `consolidation_and_transfer`

This is value determination only. It does not generate an activity, task, item, explanation, or tutoring script, and it does not advance assessment state. The student choice policy must allow accepting the recommendation, choosing an alternative, or moving on. Confidence calibration may be recommended but cannot be forced.

Under Phase 30a, this layer is distractor-informed diagnostic purpose selection. The central purposes are conceptual entry grounding, distractor misconception probing, reasoning boundary repair, and independent misconception verification. Confidence calibration is a modifier, while consolidation and transfer are exit or extension paths.

Profile integration patterns are decision priors rather than a fixed mapping. Likely knowledge gaps generally support `diagnostic_clarification`; mixed or conflicting evidence generally supports `independent_understanding_verification`; stable understanding generally supports `consolidation_and_transfer`. `confidence_calibration` is reserved for cases where understanding evidence is adequate or strong but the student is underconfident or confidence is inconsistent across adequate evidence. Conceptual gaps, weak reasoning, wrong models, and likely misconceptions take priority over calibration. High confidence with wrong or weak evidence is recorded as a secondary consideration, not as the primary value. Low confidence by itself is not a confidence-calibration need.

The effective formative-value packet follows backend precedence after live output is parsed. In clean adequate-understanding underconfidence cases, a live output that chooses a weaker adjacent value is canonicalized to `confidence_calibration`, with the raw provider result retained in the `agent_calls` audit row.

For a redacted review artifact, run:

```bash
npm run student:formative-value-review
npm run student:formative-value-review -- --session-public-id <session_public_id>
```

The command writes ignored artifacts under `.data/formative-value-review/` and records process events for determination, presentation, and choice when a synthetic sample choice is exercised. Student-facing text hides engagement categories, AI-assistance labels, answer keys, correct options, correctness labels, distractor metadata, raw reasoning, raw process payloads, raw provider output, integrity/authenticity language, and activity planning.

The live formative-value path is opt-in only:

```bash
npm run student:formative-value-live-smoke
```

The command skips safely unless `RUN_LIVE_FORMATIVE_VALUE_SMOKE=1` is set. When intentionally enabled, it requires:

```text
DATABASE_URL
SESSION_SECRET
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPENAI_API_KEY or OPENAI_API_KEY_FILE
OPENAI_MODEL_PROFILE_INTEGRATION or OPENAI_MODEL_PLANNING or OPENAI_MODEL_FOLLOWUP
```

The live formative-value path stores `agent_calls` audit metadata for `formative_value_determination_agent`, including schema version `formative-value-determination-v1`, provider/model metadata, provider request or response metadata when available, output validation status, safe validation errors, and token usage when returned. A deterministic fallback is not treated as live success.

## Profile/Formative Scenario QA

The profile/formative QA harness exercises synthetic response packages and process contexts across profile integration and formative value outcomes:

```bash
npm run student:profile-formative-scenario-smoke
npm run student:profile-formative-trial-review
```

These commands are no-live by default. They write ignored redacted artifacts under:

```text
.data/profile-formative-scenario-smoke/
.data/profile-formative-trial-review/
```

The matrix covers all five formative values, all current profile integration patterns, all student-safe statuses, engagement categories, AI-assistance context signals, and student choice states. It includes 100 scenarios: 17 core scenarios, 18 original variations, and 65 additional synthetic variations for concise, detailed, vague, uncertainty, multilingual/typo-heavy, content/procedural question, edit/revision, rapid-sparse, pause/resume, focus/paste, external-assistance-context, and student-choice behaviors.

The dedicated paid-live trial command is:

```bash
npm run student:profile-formative-live-trials
```

Unlike ordinary smoke tests, this command is paid-live by default. It prints a warning, checks live readiness, refuses silent deterministic fallback, and writes redacted artifacts under timestamped run directories in `.data/profile-formative-live-trials/`. Each run directory contains per-scenario records, a summary artifact, and an error-analysis artifact. Provider failures are recorded with safe model/schema/request-shape and sanitized transport fields only; prompts, raw provider output, headers, API keys, and secrets are not written. The Phase 28a live protocol runs a 10-scenario canary first, then the full 100-scenario matrix when the canary shows no systemic provider/schema/safety issue:

```bash
PROFILE_FORMATIVE_TRIAL_BUDGET_USD=10 \
MAX_LIVE_PROFILE_FORMATIVE_TRIALS=10 \
PROFILE_FORMATIVE_TRIAL_CANARY=true \
npm run student:profile-formative-live-trials

PROFILE_FORMATIVE_TRIAL_BUDGET_USD=10 \
MAX_LIVE_PROFILE_FORMATIVE_TRIALS=100 \
npm run student:profile-formative-live-trials
```

Cost-control flags are `MAX_LIVE_PROFILE_FORMATIVE_TRIALS`, `PROFILE_FORMATIVE_TRIAL_SCENARIOS`, `PROFILE_FORMATIVE_TRIAL_VARIATIONS`, `PROFILE_FORMATIVE_TRIAL_BUDGET_USD=10`, `PROFILE_FORMATIVE_TRIAL_DRY_RUN=true`, and `PROFILE_FORMATIVE_TRIAL_NO_LIVE=true`.

Live artifacts distinguish provider category outputs from effective backend outputs and classify each trial as direct success, passed after repair, passed after canonicalization, passed after one provider retry, accepted allowed alternative, scenario expectation updated after adjudication, provider quota block, infrastructure transient, provider failure, validation failure, outcome mismatch, safety failure, or fallback-used failure. Deterministic fallback is never counted as live success.

If OpenAI returns a non-retryable quota block such as HTTP 429 `insufficient_quota` / `openai_quota_exceeded`, the run is marked `blocked_provider_quota`. The runner stops after the first quota block, writes skipped records for the remaining planned scenarios, and records that the run is not final live QA evidence. Quota-blocked scenarios are infrastructure findings, not model-quality outcome mismatches.

Review the latest retained full 100-case live matrix without stitching in older or no-live artifacts with:

```bash
npm run student:profile-formative-trial-review -- --latest-full-run
```

Use `--all-runs` only for historical comparison across retained runs. The default reviewer and `--latest-run` mode do not mix old retained failures into the current run summary. Outcome mismatches are adjudicated before they count as true failures, and the reviewer can classify a boundary mismatch as an accepted allowed alternative without mutating the paid run artifact. Safety, schema, provider, and fallback-used failures remain blocking.

After restoring quota or billing, rerun the full matrix and then review it again with `--latest-full-run`.

See `docs/PROFILE_FORMATIVE_SCENARIO_QA.md` for scenario definitions, artifact interpretation, and mismatch categories.

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

## Formative Activity Design Readiness

Phase 29a adds a no-live formative activity design layer after profile integration and formative value determination. Phase 29b adds a live-capable first-turn generator and quality-review smoke path. These phases still do not render the activity in the browser, execute the full activity loop, or update profile/formative value after a student response. Deterministic Phase 29a packets are marked `generation_source=deterministic_review`, `runtime_servable_to_student=false`, and `review_only=true`; they are not production student-facing activity output. Live Phase 29b packets must be marked `generation_source=live_llm`, `runtime_servable_to_student=true`, and `review_only=false`.

Use:

```bash
npm run student:formative-activity-smoke
npm run student:formative-activity-review
npm run student:formative-activity-review -- --session-public-id <session_public_id>
npm run student:formative-activity-live-smoke
```

The review command writes redacted artifacts under `.data/formative-activity-review/`. A valid packet includes the selected formative value, activity family, complete-explanation-plus-dialogue protocol, safe first turn, expected student action, distractor-use policy, and an evidence-update plan that requires a later student response. The command also writes a human-readable first-turn sample artifact covering all six activity families and the current real-session review target when available. The artifact quality scan should report `forbidden_hit_count = 0`, non-null student-safe profile status for every sample, concrete distractor descriptions for distractor-using samples, no colon-splice patterns, no internal labels, no fake distractor contrast, and review-only generation flags. Deterministic fallback or no-live packet generation must not be counted as live activity success. Future production activity output must come from `formative_activity_dialogue_agent` live output marked `generation_source=live_llm`; provider failure must fail closed or offer a safe choice/move-on path rather than silently serving deterministic templates.

The live activity smoke skips by default and makes no provider call unless
`RUN_LIVE_FORMATIVE_ACTIVITY_SMOKE=1` is set. When enabled, it calls the live
generator and `formative_activity_quality_reviewer_agent`, applies
deterministic hard gates before and after review or a single repair attempt,
requires provider metadata and token usage, and writes redacted summaries under
`.data/formative-activity-live-smoke/`. A deterministic packet or deterministic
fallback must not count as live activity success.

## Post-Activity Misconception Evidence Readiness

Phase 30b adds a no-live design contract for evaluating the student's response
to a formative activity:

```bash
npm run student:activity-misconception-evidence-smoke
npm run student:activity-misconception-evidence-review
npm run student:activity-misconception-evidence-review -- --session-public-id <session_public_id>
```

The packet schema is `student-activity-misconception-evidence-v1`. The future
production evaluator is `formative_activity_response_evaluator_agent` with
schema `formative-activity-response-evaluation-v1`. Phase 30b fixtures are
no-live review artifacts only: `evaluation_source=no_live_fixture`,
`runtime_servable_to_student=false`, and `review_only=true`. They must not be
used as production misconception updates or student-facing runtime activity
content.

The review command writes redacted artifacts under
`.data/activity-misconception-evidence-review/`. Artifacts include safe response
summaries, evidence-elicitation targets, evidence quality, update status,
student-safe feedback, and safety flags. They must not include raw student
responses, answer keys, correct option values, correctness labels, raw
distractor metadata, raw misconception IDs, raw process payloads, raw provider
output, prompts, headers, API keys, or secrets.

Phase 30c adds a live-capable smoke for the post-activity response evaluator:

```bash
npm run student:activity-misconception-evidence-live-smoke
```

It skips by default and makes no provider call. Manual paid execution requires:

```bash
RUN_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_SMOKE=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
OPENAI_MODEL_PROFILE_INTEGRATION=<model> \
OPENAI_MODEL_PLANNING=<model> \
OPENAI_MODEL_FOLLOWUP=<model> \
npm run student:activity-misconception-evidence-live-smoke
```

The live smoke uses eleven synthetic, redacted activity-response cases and writes
a redacted artifact under `.data/activity-misconception-evidence-live-smoke/`.
Success requires `evaluation_source=live_llm`, a valid
`student-activity-misconception-evidence-v1` packet, persisted `agent_calls`
audit metadata, provider request or response metadata, token usage, and no
protected leakage. It does not implement runtime activity execution or profile
updates.

Conceptual-entry boundary cases are split into no usable distinction, partial
improvement, and ready-for-probe cases. A provider/schema-valid output outside a
case's allowed status set is reported as `outcome_mismatch`.

Production post-activity update remains future work. It must use the future
LLM evaluator for substantive diagnostic judgment. Deterministic code may
validate schema, safety, privacy, audit, and fail-closed behavior only.

Phase 30d persists post-activity misconception evidence and review snapshots:

```bash
npm run student:activity-misconception-update-smoke
npm run student:activity-misconception-update-review
npm run student:activity-misconception-update-review -- --session-public-id <session_public_id>
```

Production persistence requires a live LLM evidence packet with evaluator
`agent_calls` audit metadata, provider request or response metadata, token
usage, successful output validation, and safe student-facing feedback. No-live
fixtures and deterministic review packets are allowed only in explicit
`review_artifact` mode and must not count as production diagnosis.

The review command writes redacted artifacts under
`.data/activity-misconception-update-review/`. The persisted snapshot is a
review-layer diagnostic update only; it does not overwrite response packages,
replace the operational profile, or claim classroom validity.

Phase 30e adds a backend-only live persistence smoke:

```bash
npm run student:activity-misconception-live-persistence-smoke
```

The default command skips and makes no provider call. Manual paid execution
requires `RUN_LIVE_ACTIVITY_MISCONCEPTION_PERSISTENCE_SMOKE=1` plus live
provider configuration. When enabled, it runs three synthetic, redacted cases,
persists only allowed `live_llm` evaluator outputs through the production
guard, creates post-activity diagnostic snapshots, and writes redacted artifacts
under `.data/activity-misconception-live-persistence-smoke/`.

The smoke is not a browser-runtime loop. It does not update operational
profiles, mutate response packages, change item content or scoring, or claim
classroom validity.

## Activity Runtime Loop Skeleton

Phase 30f adds the backend runtime loop skeleton that will later sit behind the
student activity UI:

```bash
npm run student:activity-runtime-loop-smoke
npm run student:activity-runtime-loop-review
npm run student:activity-runtime-loop-live-smoke
```

The no-live smoke creates synthetic live-shaped activity attempts, submits safe
student activity responses through an injected evaluator result, persists
validated evidence and snapshots, checks next-action routing, confirms
operational profiles and response packages are unchanged, and cleans up
temporary database rows. It makes no OpenAI call.

The review command inspects `activity_runtime_attempts`,
`activity_misconception_evidence_records`, and
`post_activity_diagnostic_snapshots`, then writes a redacted artifact under:

```text
.data/activity-runtime-loop-review/
```

If no attempts exist, the review completes with limitations rather than
failing. The optional live smoke is skipped by default. Manual paid execution
requires:

```text
RUN_LIVE_ACTIVITY_RUNTIME_LOOP_SMOKE=1
LLM_PROVIDER=openai
LLM_LIVE_CALLS_ENABLED=true
OPENAI_API_KEY or OPENAI_API_KEY_FILE
OPENAI_MODEL_PROFILE_INTEGRATION or OPENAI_MODEL_PLANNING or OPENAI_MODEL_FOLLOWUP
```

The live smoke uses synthetic activity attempts and calls the live
`formative_activity_response_evaluator_agent` only after explicit opt-in. It
does not add browser UI, replace operational profiles, mutate response
packages, or claim classroom validity.

## Phase 30g Minimal Activity Runtime UI

Phase 30g adds a minimal browser-facing surface for the Phase 30f activity
runtime loop. When the session is in `FORMATIVE_ACTIVITY`, the state payload may
include `activity_runtime`, a student-safe projection containing:

- a safe focus label;
- the live activity first-turn message;
- the expected response prompt;
- response length limit and allowed actions;
- safe post-response feedback and next-action labels.

The projection is deliberately not the raw activity packet. It hides internal
activity-family names, diagnostic-purpose enum labels, misconception status,
evidence-quality labels, engagement/AI labels, provider metadata, raw process
payloads, raw distractor metadata, answer keys, correct options, correctness
labels, and raw LLM output.

Runtime start still requires a source activity packet with
`generation_source=live_llm`, `runtime_servable_to_student=true`, and
`review_only=false`. Deterministic review packets and no-live evaluator
fixtures remain non-runtime QA artifacts. Evaluator failure or unsafe
student-facing feedback fails closed with a safe message and choices to try
again, choose another activity, or move on.

No-live UI/service smoke:

```bash
npm run student:activity-runtime-ui-smoke
```

The smoke uses injected live-shaped packets/evaluator outputs and makes no
OpenAI call. The optional paid live smokes remain skipped by default unless
their explicit `RUN_LIVE_*` variables are set.

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

## Session Data Completeness Review

Teacher/research process-data visibility is available without live provider
calls:

```bash
npm run student:session-data-completeness-review
npm run student:session-data-completeness-review -- --session-public-id <session_public_id>
npm run student:teacher-session-data-audit-smoke
```

The review writes redacted artifacts under:

```text
.data/session-data-completeness-review/
```

The teacher session-review page includes **Session evidence audit**. It shows
response-package completeness, process-event inventory, engagement-evidence
availability, activity runtime state counts, post-activity misconception
evidence counts, diagnostic snapshot counts, agent-audit metadata presence, and
limitations. It intentionally hides raw process payloads, raw provider outputs,
answer keys, correct options, correctness labels, raw distractor metadata, raw
misconception IDs, internal database UUIDs, and secrets.

Process data are evidence-quality context. They should not be used alone to
infer misconception, ability, cheating, or misconduct.

## Teacher/Research Readable Transcript And Bulk Export

Teacher/research session review now separates:

- **Readable transcript**: conversation-only view with speaker, timestamp,
  safe phase/context labels, and message text.
- **Structured event log**: the existing audit view with redacted structured
  payload blocks.

Per-session downloads:

```bash
/api/teacher/sessions/<session_public_id>/readable-transcript/download
/api/teacher/sessions/<session_public_id>/research-export
```

Bulk all-session research ZIP:

```bash
/api/teacher/research-export
```

Default research ZIP exports include a manifest, README, data dictionary,
students, sessions, item responses, readable transcripts, redacted structured
turns, response-package summaries, process summaries/counts, engagement/profile
and formative summaries, activity runtime/evidence/snapshot summaries,
agent-call summaries, completeness audits, and limitations. Restricted item
keys are excluded by default.

No OpenAI call is made by export or transcript commands. Verify locally with:

```bash
npm run student:teacher-readable-transcript-smoke
npm run student:teacher-bulk-export-smoke
```
