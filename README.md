# Conversational MCQ

Classroom prototype for a distractor-informed, conversation-based MCQ formative assessment system. Phase 30a narrows the dissertation/system framing to **distractor-informed misconception diagnosis in AI-assisted MCQ assessment**. Distractors are treated as diagnostic representations of plausible but non-target reasoning paths, not merely incorrect options. The system uses selected options, tempting options, reasoning, confidence, process/evidence-quality context, and later dialogue to form, test, weaken, or reject distractor-linked misconception hypotheses.

See `docs/DISTRACTOR_INFORMED_MISCONCEPTION_DIAGNOSIS.md` for the current framing. Existing implementation names such as ability evidence, engagement evidence, profile integration, formative value, and formative activity remain for code and schema compatibility, but they should now be read as internal layers that support misconception diagnosis rather than as broad claims about general ability profiling or adaptive tutoring.

The current implemented scope includes the Phase 4B student initial-administration UI, the Phase 5A read-only teacher_researcher session-review platform, the Phase 5B summative outcome import plus master CSV export tools, Phase 6A LLM infrastructure scaffolding, Phase 6A.5 classroom LLM access/usage safeguards, Phase 6B Student Profiling Agent integration, Phase 6C Formative Value and Planning Agent integration, Phase 6D1 first-round Follow-up Agent conversation, Phase 6D2A assessment availability plus asynchronous automatic workflow startup, Phase 6D2B iterative follow-up evidence updating inside the current concept unit, Phase 6D3 student-led concept progression plus final assessment completion, Phase 7A roster/student-account management, Phase 7B complete master CSV export coverage for persisted platform records, Phase 7C Response Collection Agent integration for student free-text messages during initial administration, Phase 7D Item Verification Agent governance for teacher-authored item sets, Phase 7E1 internal mock evaluation harness for the five active agents, Phase 7E2A guarded live-evaluation canary support with annotation adjudication, Phase 7E2B full-pilot evaluation infrastructure, Phase 7E2C targeted remediation/regression tooling, Phase 8A default-off guarded operational agent integration with disabled/mock/guarded-live modes, and later chat-native fixed IRT MVP profiling/formative activity tooling. Item generation, item rewriting, classroom live model activation, adaptive concept routing, countdown timers, public deployment, email/SMS delivery, student self-registration, and claims of classroom validity remain intentionally unimplemented.

Teacher/research review includes both a readable conversation-only transcript and a separate structured event log. The teacher data area also provides a standard Research dataset ZIP, a paginated Data dictionary, and legacy authorized CSV/archive APIs for compatibility. Default research exports include `research_data_dictionary.csv`, `process_event_codebook.csv`, turn-level latency rows, engagement process-feature rows, and evidence-quality aggregates while excluding login usernames, emails, secrets, raw provider data, raw process payloads, answer keys, correct options, raw distractor metadata, and raw misconception IDs. Student joins use a versioned HMAC pseudonymous `research_student_id`; production research exports require server-side `RESEARCH_PSEUDONYMIZATION_KEY` and fail closed if it is missing. Restricted item-key exports require an explicit teacher/research request.

Phase 30k adds internal/research-only safeguards against correctness inflation. Correct option selection is not sufficient evidence of understanding: target-aligned answers with weak reasoning, low confidence, uncertainty markers, or missing distractor-boundary explanation are treated conservatively until reasoning, conceptual-boundary evidence, or distractor-boundary evidence supports the interpretation. These indicators are not shown to students and are not cheating, misconduct, motivation, GenAI-use, or direct ability labels.

Phase 31a adds a no-live classroom pilot readiness audit for the fixed IRT MVP workflow. It verifies synthetic student session start, protected initial package completion, activity runtime projections, injected post-activity evidence handling, teacher review, readable and structured transcripts, bulk research export, export-integrity review, and protected-data boundaries. It does not call OpenAI and does not claim classroom validity. See `docs/CLASSROOM_PILOT_READINESS.md`.

Phase 31b adds production web deployment readiness for a future HTTPS classroom pilot. Phase 31c adds a Render-specific staging package with a root `render.yaml` Blueprint, a no-live Render readiness smoke, a Render Dashboard runbook, and a post-deployment classroom dry-run checklist. Canvas is link-only for the pilot: Canvas may host the public EDPY 507 course landing page, but login, activity completion, teacher review, and export happen inside Conversational MCQ. The landing page uses a University of Alberta green/gold course-access style and the authorized official UAlberta logo asset supplied by the operator under `public/brand/ualberta-logo.png`; it still does not claim to be a central University of Alberta login, Canvas integration, or classroom-validity platform. It does not deploy publicly, implement Canvas LTI/OAuth/grade passback/roster sync, or claim classroom validity. See `docs/PRODUCTION_DEPLOYMENT_READINESS.md` and `docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md`.

## Local Setup

### Prerequisites

- Install Node.js LTS from `https://nodejs.org/` or your normal package manager.
- Install Docker Desktop or another Docker Compose-compatible runtime for local PostgreSQL.
- Verify Node and npm are on your shell PATH:

  ```bash
  node -v
  npm -v
  ```

If either command is missing, update your shell PATH according to your Node installer. This project should not rely on temporary npm copies under `/tmp`.

### Environment

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment placeholders:

   ```bash
   cp .env.example .env.local
   ```

3. Keep the local `DATABASE_URL` from `.env.example` if using the included Docker PostgreSQL service.

4. Replace `SESSION_SECRET` with a local random value of at least 32 characters.

5. Leave OpenAI variables blank for normal local development. Runtime item administration blocks safely unless live calls are explicitly enabled and authenticated server-side, or an explicit local mock walkthrough is enabled.

   For a future guarded-live synthetic canary, the API key may be supplied
   through `OPENAI_API_KEY` or `OPENAI_API_KEY_FILE`. The recommended local file
   path is `.data/secrets/openai_api_key`; `.data/` is ignored by Git and the
   file should be owner-readable only. Do not paste keys into chat, commit
   keys, or enter keys in the browser. For local live testing, use `.env.local`
   as the secret source of truth; `.env` should not contain real OpenAI keys.
   If both `.env` and `.env.local` contain different OpenAI key fingerprints,
   runtime readiness fails closed.

6. `COURSE_TIMEZONE` defaults to `America/Edmonton`. Assessment release/close inputs use this IANA timezone while PostgreSQL stores UTC timestamps.

7. Keep `DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED=false` and `ALLOW_MANUAL_REVIEW_STUDENT_STARTS=false` for normal classroom behavior. Development smoke tests opt into these only when needed.

8. Keep `ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW=false` for ordinary local classroom-style workflow. Set it to `true` only for explicit Response Collection Agent infrastructure testing with the mock provider.

9. Keep `OPERATIONAL_AGENT_MODE=disabled` for ordinary local/classroom-style workflow. `mock` is for local development/testing, and `guarded_live` remains blocked unless the approved manifest, config hash, usage guard, database, exact model snapshot, and server-side live-call checks all pass. The legacy `OPERATIONAL_AGENT_INTEGRATION_ENABLED` flag is deprecated and must not conflict with `OPERATIONAL_AGENT_MODE`.

10. Keep `EVAL_LIVE_CALLS_ENABLED=false` for Phase 7E1. `EVAL_TARGET_MODEL=gpt-5.4-mini` is future live-evaluation metadata only and does not trigger OpenAI calls.

Do not commit `.env`, `.env.local`, real session secrets, or real API keys.

### Production Web Deployment Readiness

Phase 31b prepares the app for a future public HTTPS deployment without starting deployment. The production readiness smoke makes no OpenAI calls and prints only safe status fields:

```bash
npm run student:render-staging-readiness-smoke
npm run student:production-deployment-readiness-smoke
npm run production:readiness
```

The recommended first staging deployment path is Render Web Service plus Render Postgres using the root `render.yaml` Blueprint. Render provides the public HTTPS URL that Canvas links to. Use non-free, classroom-pilot-appropriate Render resources; free or sleep-prone resources can interrupt student sessions.

Production deployment should use migration deployment instead of development migrations:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
npm run build
npm run start
```

Before a classroom web pilot, deploy a Render staging URL, verify `/api/health`, run the Render and production readiness smokes, confirm Render pre-deploy ran `npm run prisma:migrate:deploy`, verify the green/gold EDPY 507 landing page, verify teacher login and dashboard logout, create or import the classroom and approved student accounts/access codes, copy the public HTTPS landing-page URL into a Canvas assignment or module item, have a student open the link from a non-development device or browser profile, sign in with the classroom ID and access code/password, complete the initial item package and activity response path, inspect teacher/research review surfaces, download all research data, run export integrity checks, and complete `docs/POST_DEPLOYMENT_CLASSROOM_DRY_RUN.md`.

Never put OpenAI keys, database URLs, session secrets, cookies, or auth tokens in `NEXT_PUBLIC_` variables. Public variables may contain only harmless browser-visible configuration such as `NEXT_PUBLIC_APP_BASE_URL`.

Render setup is documented for non-developer operation in `docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md`. Secrets and deployment-specific values marked `sync: false` in `render.yaml` must be filled in the Render Dashboard only.

After Render migrations complete on a fresh database, run the first-run bootstrap as a separate explicit operator step, not as an automatic deploy step:

```bash
BOOTSTRAP_ENABLED=true \
BOOTSTRAP_TEACHER_USERNAME=<teacher-user-id> \
BOOTSTRAP_TEACHER_PASSWORD=<teacher-password> \
BOOTSTRAP_CLASSROOM_ID=<classroom-id> \
BOOTSTRAP_CLASSROOM_NAME=<classroom-name> \
BOOTSTRAP_STUDENT_COUNT=<number-of-students> \
BOOTSTRAP_DEFAULT_ASSESSMENT_ID=assessment_mvp_irt_theta_invariance \
npm run staging:bootstrap-pilot
```

Use `BOOTSTRAP_STUDENT_ROSTER_PATH=<csv>` instead of `BOOTSTRAP_STUDENT_COUNT` for an approved roster CSV with `user_id`, optional `display_name`, and optional `email` columns. The bootstrap reuses existing records, writes new temporary credentials under ignored `.data/bootstrap/`, and does not print raw passwords or access codes. Run `npm run student:staging-bootstrap-smoke` locally to verify the bootstrap path without provider calls.

Render Web Shell starts in `/app` for the Docker image. Run operator commands
there directly; do not `cd /opt/render/project/src`. Operator commands are
TypeScript scripts run through the checked-in `tsx` production dependency so
they still start after the Docker runner prunes dev dependencies.

If a staging database already contained temporary-credential student accounts before the first-login password-change gate existed, repair only active students that still have temporary credentials and no permanent password:

```bash
MARK_STUDENT_PASSWORD_CHANGE_ENABLED=true npm run staging:mark-students-must-change-password
```

Optional filters are `MARK_STUDENT_USER_ID=<student-user-id>` and `MARK_STUDENT_CLASSROOM_ID=<classroom-id>`. The repair command does not print passwords or access codes and does not affect teacher accounts.

Canvas gradebook does not automatically receive completion or scores. Use Conversational MCQ teacher/research exports for completion review and research data. Canvas LTI 1.3 may be considered later only after public-link pilots are stable and after Canvas administrator support, Developer Key configuration, OIDC launch handling, deployment IDs, user/course mapping, and separate privacy review.

### Database

Start local PostgreSQL:

```bash
npm run db:up
```

Apply the current migration stack and seed local demo users:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

Seeded local development credentials:

- teacher_researcher: `teacher_demo` / `teacher_demo_password`
- student: `student_demo` / `student_demo_access_code`

The seed stores only hashed credentials in PostgreSQL. Running it repeatedly updates the same demo users and does not create duplicates.

### Daily Local Launcher

This launcher phase assumes the full opt-in live LLM smoke has already passed as the backend readiness gate. The launcher does not run paid generation calls itself.

After dependencies, migrations, and seed data are already in place, the normal local startup path is:

```bash
npm run app:local:start
```

The launcher starts the local PostgreSQL container, runs `npm run llm:readiness`, starts the Next.js dev server in the background, waits for `http://localhost:3000/api/health`, and opens `http://localhost:3000` in the browser. It writes runtime files under:

```text
.data/local-runtime/next-dev.log
.data/local-runtime/next-dev.pid
```

Stop the launcher-managed Next.js process with:

```bash
npm run app:local:stop
```

PostgreSQL is left running by default. To stop it too:

```bash
npm run app:local:stop -- --postgres
```

Check local status with:

```bash
npm run app:local:status
```

macOS double-click launchers are available in `launchers/`:

```text
Start Conversational MCQ.command
Stop Conversational MCQ.command
Status Conversational MCQ.command
```

The start launcher is fail-closed for the real student-facing runtime. If authenticated server-side LLM readiness is not ready, it does not open the browser and prints:

```text
LLM readiness failed. The assessment cannot run in live runtime.
```

It never prints API key values and does not silently switch to mock mode. For an explicit local mock walkthrough, do not use the default start launcher; configure:

```bash
ITEM_ADMIN_TUTOR_MODE=mock
ALLOW_LOCAL_MOCK_RUNTIME=true
npm run dev
```

`ALLOW_LOCAL_MOCK_RUNTIME` is optional and defaults to `false` when unset. Live runtime does not require it. If it is set, it must be exactly `true` or `false`; values such as `yes`, `1`, or `TRUE` fail configuration validation. Explicit mock runtime still requires `ITEM_ADMIN_TUTOR_MODE=mock` plus `ALLOW_LOCAL_MOCK_RUNTIME=true`.

To create a true macOS app wrapper, open Automator, choose `Application`, add `Run Shell Script`, and paste:

```bash
cd "/Users/binbin/Documents/Conversational MCQ" && npm run app:local:start
```

Save it as `Conversational MCQ.app`. Create a separate stop app wrapper with:

```bash
cd "/Users/binbin/Documents/Conversational MCQ" && npm run app:local:stop
```

### Run And Verify

Full local setup verification command sequence:

```bash
npm install
npm run db:up
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run content:governance-smoke
npm run student:initial-admin-smoke
npm run student:ui-smoke
npm run student:initial-chat-ui-smoke
npm run student:conversational-flow-smoke
npm run student:attempt-lifecycle-smoke
npm run student:logging-smoke
npm run student:formative-profile-smoke
npm run student:ability-evidence-smoke
npm run student:ability-evidence-review
npm run student:teacher-readable-transcript-smoke
npm run student:teacher-bulk-export-smoke
npm run student:classroom-pilot-readiness-smoke
npm run student:classroom-pilot-workflow-review
npm run student:engagement-evidence-smoke
npm run student:engagement-evidence-review
npm run student:profile-integration-smoke
npm run student:profile-integration-review
npm run student:profile-integration-live-smoke
npm run student:formative-value-smoke
npm run student:formative-value-review
npm run student:formative-activity-smoke
npm run student:formative-activity-review
npm run student:targeted-feedback-smoke
npm run student:transfer-item-smoke
npm run student:mvp-e2e-smoke
npm run teacher:review-smoke
npm run summative:import-smoke
npm run export:master-smoke
npm run export:master-complete-smoke
npm run llm:contracts-smoke
npm run llm:execution-smoke
npm run llm:redaction-smoke
npm run llm:usage-smoke
npm run llm:status-smoke
npm run agent:response-collection-smoke
npm run response-collection:fallback-smoke
npm run response-collection:service-fallback-smoke
npm run response-collection:mode-smoke
npm run agent:item-verification-smoke
npm run content:verification-publish-smoke
npm run item:verification-ui-smoke
npm run agent:item-verification-rename-smoke
npm run eval:harness-smoke
npm run operational:approval-manifest:verify
npm run operational:agents:preflight
npm run operational:guarded-integration-status
npm run operational:guarded-integration-smoke
npm run operational:approval-manifest-smoke
npm run operational:agent-execution-smoke
npm run operational:workflow-integration-smoke
npm run operational:fallback-smoke
npm run operational:idempotency-smoke
npm run operational:student-payload-smoke
npm run operational:teacher-audit-smoke
npm run operational:nonintervention-smoke
npm run operational:isolation-smoke
npm run agent:profiling-smoke
npm run agent:planning-smoke
npm run agent:followup-smoke
npm run student:followup-ui-smoke
npm run assessment:availability-smoke
npm run workflow:automation-smoke
npm run workflow:worker-smoke
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
npm run student:followup-update-ui-smoke
npm run concept:progression-smoke
npm run assessment:completion-smoke
npm run classroom:nonintervention-smoke
npm run student:progression-ui-smoke
npm run roster:import-smoke
npm run student:account-smoke
npm run student:account-ui-smoke
npm run auth:account-status-smoke
npm run typecheck
npm run lint
npm run build
npm run dev
```

Full chat-native MVP verification:

```bash
npm run student:mvp-e2e-smoke
```

This mock-provider smoke verifies the complete fixed IRT path for both student next-choice branches. It writes developer-only evidence snapshots to `.data/student-mvp-e2e-smoke/`, which is ignored by Git.

Assessment attempt lifecycle verification:

```bash
npm run student:attempt-lifecycle-smoke
```

This no-live smoke verifies one active or paused attempt per student/assessment, Pause and leave versus End attempt, teacher Close attempt and allow another, destination-specific formative navigation, preserved historical attempts, and no OpenAI calls. See `docs/ASSESSMENT_LIFECYCLE_TIMING_BOUNDARIES.md`.

Ability evidence packet verification:

```bash
npm run student:ability-evidence-smoke
```

This no-live smoke builds `ability-evidence-packet-v1` from fixed IRT response-package evidence and deterministic reasoning rules. It does not create a final profile, does not call OpenAI, and does not render student-facing evidence. See `docs/ABILITY_PROFILING_DESIGN.md`.

Ability evidence review artifact generation:

```bash
npm run student:ability-evidence-review
```

This no-live review command audits current item diagnostic metadata, creates a temporary deterministic sample session when no session is supplied, writes redacted review artifacts under `.data/ability-evidence-review/`, and prints a concise metadata/evidence summary.

Engagement evidence packet verification:

```bash
npm run student:engagement-evidence-smoke
```

This no-live smoke builds `engagement-evidence-packet-v1` from fixed IRT response-package and process-event evidence. It does not create a final engagement profile, does not call OpenAI, does not make academic-integrity claims, and does not render student-facing evidence. The packet includes provisional v1 threshold metadata and item/session decision traces for teacher/research inspection, including safe active timing reconstruction, focus-adjusted task timing, response-production timing, aggregate reasoning-typing bands, and ultra/extreme/rapid-warning sparse rules for extremely fast initial item packages with repeated low-information evidence. Completed items are baseline completion context, observed process events are data-quality context rather than strong engagement counterevidence, reasoning typing is supporting process context only, and substantive reasoning requires task relevance or quality evidence rather than length alone. The AI-assistance signal is limited to `none_indicated`, `likely_external_assistance_pattern`, and `insufficient_evidence`; it is behavioral context only. See `docs/ENGAGEMENT_PROFILING_DESIGN.md`.

Engagement evidence review artifact generation:

```bash
npm run student:engagement-evidence-review
```

This no-live review command creates a temporary deterministic sample session when no session is supplied, writes a redacted engagement evidence artifact plus process-data inventory under `.data/engagement-evidence-review/`, and prints a concise summary. The artifacts contain bands, counts, safe labels, threshold names/values, rule IDs, reason codes, and interpretation cautions only.

Profile integration interpretation packet verification:

```bash
npm run student:profile-integration-smoke
```

This no-live smoke builds `profile-integration-interpretation-v1` from `ability-evidence-packet-v1` and `engagement-evidence-packet-v1`. It interprets knowledge-state evidence and engagement context only; it does not determine formative value, choose an activity, or call OpenAI. After package submission, the app persists a student-profile snapshot and renders only the student-safe status, message, and knowledge-focus projection; internal integration evidence remains teacher/research data. The smoke also simulates the provider path with an injected local provider and verifies `agent_calls` audit persistence. See `docs/PROFILE_INTEGRATION_DESIGN.md`.

Profile integration review artifact generation:

```bash
npm run student:profile-integration-review
```

To review an existing completed session:

```bash
npm run student:profile-integration-review -- --session-public-id <session_public_id>
```

The command writes a redacted profile integration artifact under `.data/profile-integration-review/` and prints a concise summary with the internal status, student-safe status, integration pattern, engagement context, and limitations.

Profile integration live smoke, skipped by default:

```bash
npm run student:profile-integration-live-smoke
```

To run it intentionally after configuring local server-side live LLM variables:

```bash
RUN_LIVE_PROFILE_INTEGRATION_SMOKE=1 npm run student:profile-integration-live-smoke
```

The live path may use `OPENAI_MODEL_PROFILE_INTEGRATION`, falling back to `OPENAI_MODEL_PLANNING` or `OPENAI_MODEL_FOLLOWUP`. It stores `agent_calls` audit rows for `profile_integration_agent` with schema version `profile-integration-interpretation-v1`, provider/model metadata, provider request or response metadata when available, output validation, safe validation errors, and token usage when returned. If a schema-shaped live output contains remediable direction/planning language, unsupported integrity/authenticity/external-assistance claims, internal correct-option phrasing, or a high-confidence overclaim, the service may make one repair attempt using only redacted evidence and safe validation issue metadata. Repair candidates may be safety-canonicalized before strict validation; invalid provider output is never accepted directly. AI-assistance signals are internal evidence-production context only; insufficient or absent signal evidence must not become an assistance/provenance claim. Live-smoke failures write sanitized diagnostics under `.data/profile-integration-live-smoke/failures/`, including whether repair was attempted.

Formative value determination packet verification:

```bash
npm run student:formative-value-smoke
```

This no-live smoke builds `formative-value-determination-v1` from the profile integration packet. It recommends one broad formative value, offers alternatives, verifies student choice/override/move-on capture, simulates provider audit persistence with an injected mock provider, and confirms no OpenAI call occurs. It does not generate an activity, task, item, explanation, or tutoring script. See `docs/FORMATIVE_VALUE_DETERMINATION_DESIGN.md`.

Confidence calibration is reserved for adequate or strong understanding evidence paired with underconfidence or inconsistent confidence. Conceptual gaps, weak reasoning, wrong models, and likely misconceptions take priority over calibration; high confidence with wrong or weak evidence is retained as a secondary consideration, not the primary value. Low confidence by itself is not treated as a confidence-calibration need. Likely knowledge gaps generally map to diagnostic clarification, while mixed or reliability-limited evidence generally maps to independent understanding verification unless another value is clearly supported.

Effective formative-value output remains backend-authoritative for clean adequate-understanding underconfidence cases. If a live provider chooses an adjacent value where backend precedence requires confidence calibration, the persisted effective packet is canonicalized to `confidence_calibration` and the raw provider result remains audit evidence only.

Formative value review artifact generation:

```bash
npm run student:formative-value-review
npm run student:formative-value-review -- --session-public-id <session_public_id>
```

The command writes a redacted formative value artifact under `.data/formative-value-review/`, records determination/presentation process events, and prints the primary value, alternatives, choice policy, and limitations. When no session is supplied, it creates and cleans up a synthetic sample session.

Formative value live smoke, skipped by default:

```bash
npm run student:formative-value-live-smoke
```

To run it intentionally after configuring local server-side live LLM variables:

```bash
RUN_LIVE_FORMATIVE_VALUE_SMOKE=1 npm run student:formative-value-live-smoke
```

The live path may use `OPENAI_MODEL_PROFILE_INTEGRATION`, falling back to `OPENAI_MODEL_PLANNING` or `OPENAI_MODEL_FOLLOWUP`. It validates the provider output against `formative-value-determination-v1`, stores `agent_calls` audit metadata for `formative_value_determination_agent`, and fails closed with sanitized diagnostics under `.data/formative-value-live-smoke/failures/` if the provider call or output validation fails. The default command makes no provider call.

Formative activity design packet verification:

```bash
npm run student:formative-activity-smoke
```

This Phase 29a no-live smoke builds review-only `student-formative-activity-v1` packets from profile integration and formative value packets. Deterministic packets are marked `generation_source=deterministic_review`, `runtime_servable_to_student=false`, and `review_only=true`. The smoke verifies activity-family mapping, long specific first-turn requirements, dialogue protocol fields, distractor-use policy, student-choice policy, evidence-update gating, redacted artifacts, runtime-guard rejection, and safety rejection rules. It does not call OpenAI, does not implement browser UI, does not execute a runtime activity, and does not update profiles.

Formative activity review artifact generation:

```bash
npm run student:formative-activity-review
npm run student:formative-activity-review -- --session-public-id <session_public_id>
```

The command writes redacted activity review artifacts under `.data/formative-activity-review/` and prints the selected formative value, activity family, student-safe profile status, distractor role, generation source, quality result, safety result, and limitations. These artifacts are QA review material only. Future production activity dialogue must come from `formative_activity_dialogue_agent` live output marked `generation_source=live_llm`, `runtime_servable_to_student=true`, and `review_only=false`; provider failure must fail closed or offer a safe choice/move-on path rather than silently serving deterministic templates. See `docs/FORMATIVE_ACTIVITY_DESIGN.md`.

Formative activity live generator smoke:

```bash
npm run student:formative-activity-live-smoke
RUN_LIVE_FORMATIVE_ACTIVITY_SMOKE=1 npm run student:formative-activity-live-smoke
```

The default command skips and makes no provider call. With
`RUN_LIVE_FORMATIVE_ACTIVITY_SMOKE=1`, the command is paid-live and runs the
`formative_activity_dialogue_agent` plus
`formative_activity_quality_reviewer_agent` over the six activity families. The
pipeline applies deterministic schema/privacy/safety hard gates, allows at most
one safe text-quality repair attempt, requires provider metadata and token
usage, and writes redacted summaries under `.data/formative-activity-live-smoke/`.
It does not render a browser UI, execute runtime activity dialogue, update
profiles, or treat deterministic review templates as live success.

Post-activity misconception evidence packet verification:

```bash
npm run student:activity-misconception-evidence-smoke
```

This Phase 30b no-live smoke builds `student-activity-misconception-evidence-v1`
fixtures for student responses to formative activities. These packets model how
a future LLM evaluator will update distractor-linked misconception evidence
after the student responds. Fixture packets are marked
`evaluation_source=no_live_fixture`, `runtime_servable_to_student=false`, and
`review_only=true`; production update guards reject them. The smoke verifies
schema, safety, evidence-quality states, no-actionable-evidence wording, and no
OpenAI calls.

Post-activity misconception evidence review artifact generation:

```bash
npm run student:activity-misconception-evidence-review
npm run student:activity-misconception-evidence-review -- --session-public-id <session_public_id>
```

The command writes redacted artifacts under
`.data/activity-misconception-evidence-review/` and prints the activity family,
diagnostic purpose, response kind, evidence quality, update status, and safety
status. Phase 30b does not execute runtime activity dialogue or evaluate real
activity responses; the optional session argument reports that limitation when
post-activity evidence is unavailable. See
`docs/POST_ACTIVITY_MISCONCEPTION_EVIDENCE_UPDATE.md`.

Post-activity misconception evidence live smoke:

```bash
npm run student:activity-misconception-evidence-live-smoke
```

The command skips safely by default and makes no provider call. Manual paid
execution requires explicit live configuration:

```bash
RUN_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_SMOKE=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
OPENAI_MODEL_PROFILE_INTEGRATION=<model> \
OPENAI_MODEL_PLANNING=<model> \
OPENAI_MODEL_FOLLOWUP=<model> \
npm run student:activity-misconception-evidence-live-smoke
```

The live smoke uses eleven synthetic, redacted activity-response cases and
writes redacted results under `.data/activity-misconception-evidence-live-smoke/`.
Successful packets must use `evaluation_source=live_llm`,
`runtime_servable_to_student=false`, and `review_only=false`, with persisted
agent-call provider metadata and token usage. The smoke does not implement
browser runtime activity execution or production profile updates. To run a
subset locally, set `ACTIVITY_MISCONCEPTION_EVIDENCE_SMOKE_CASES` to a
comma-separated case list or `MAX_LIVE_ACTIVITY_MISCONCEPTION_EVIDENCE_CASES`
to a positive integer.

Post-activity misconception evidence persistence and diagnostic update review:

```bash
npm run student:activity-misconception-update-smoke
npm run student:activity-misconception-update-review
npm run student:activity-misconception-update-review -- --session-public-id <session_public_id>
```

Phase 30d stores validated post-activity evidence in
`activity_misconception_evidence_records` and stores a review-layer diagnostic
snapshot in `post_activity_diagnostic_snapshots`. Production diagnosis
persistence requires a live LLM evidence packet, source evaluator `agent_calls`
metadata, provider request or response metadata, token usage, successful output
validation, and safe student-facing feedback. No-live fixtures can be persisted
only in explicit `review_artifact` mode for local review and tests. The review
command writes redacted artifacts under
`.data/activity-misconception-update-review/` and does not call OpenAI.

Backend live persistence smoke for post-activity misconception evidence:

```bash
npm run student:activity-misconception-live-persistence-smoke
```

The default command skips safely. Manual paid execution requires:

```bash
RUN_LIVE_ACTIVITY_MISCONCEPTION_PERSISTENCE_SMOKE=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
OPENAI_MODEL_PROFILE_INTEGRATION=<model> \
OPENAI_MODEL_PLANNING=<model> \
OPENAI_MODEL_FOLLOWUP=<model> \
npm run student:activity-misconception-live-persistence-smoke
```

Phase 30e uses three synthetic, redacted cases to call the live response
evaluator, validate the output, persist production `live_llm` evidence through
the Phase 30d guard, create a post-activity diagnostic snapshot, and write a
redacted artifact under `.data/activity-misconception-live-persistence-smoke/`.
It does not implement browser runtime activity execution, update operational
profiles, mutate response packages, or claim classroom validity.

Backend activity runtime loop skeleton:

```bash
npm run student:activity-runtime-loop-smoke
npm run student:activity-runtime-loop-review
npm run student:activity-runtime-loop-review -- --session-public-id <session_public_id>
npm run student:activity-runtime-loop-live-smoke
```

Phase 30f adds backend-only `activity_runtime_attempts` records and a service
that accepts safe student activity responses, runs or injects the live
post-activity evidence evaluator, persists validated evidence and snapshots,
and maps evaluator output into next-action recommendations. The deterministic
mapping is routing policy only; it does not decide misconception status. The
no-live smoke uses synthetic live-shaped evaluator outputs and makes no OpenAI
call. The review command writes redacted artifacts under
`.data/activity-runtime-loop-review/` and reports `completed_with_limitations`
when no attempts exist.

The optional live runtime loop smoke skips by default. Manual paid execution
requires:

```bash
RUN_LIVE_ACTIVITY_RUNTIME_LOOP_SMOKE=1 \
LLM_PROVIDER=openai \
LLM_LIVE_CALLS_ENABLED=true \
OPENAI_MODEL_PROFILE_INTEGRATION=<model> \
OPENAI_MODEL_PLANNING=<model> \
OPENAI_MODEL_FOLLOWUP=<model> \
npm run student:activity-runtime-loop-live-smoke
```

The live smoke uses one or two synthetic activity attempts and calls only the
`formative_activity_response_evaluator_agent` after explicit opt-in. It does
not add browser UI, replace operational profiles, mutate response packages, or
claim classroom validity.

Minimal student activity runtime UI:

```bash
npm run student:activity-runtime-ui-smoke
```

Phase 30g adds the first student-facing activity runtime surface. It prepares
and displays only validated live activity packets through a student-safe
projection, accepts one activity response, shows safe feedback, and records
choose-another or move-on choices. Deterministic review packets and no-live
fixtures are rejected for production runtime use. The smoke injects live-shaped
packets and evaluator outputs and makes no OpenAI call.

Profile/formative scenario QA:

```bash
npm run student:profile-formative-scenario-smoke
npm run student:profile-formative-trial-review
```

The scenario smoke is no-live and deterministic. It runs the 100-scenario synthetic profile/formative matrix across profile integration patterns, student-safe statuses, engagement categories, AI-assistance context signals, all five formative values, student choice states, and a targeted conversation/process variation layer. It writes redacted artifacts under `.data/profile-formative-scenario-smoke/`. To review one retained full 100-scenario live matrix without stitching in old or no-live artifacts, run `npm run student:profile-formative-trial-review -- --latest-full-run`; use `--all-runs` only for historical comparison. If a live run is blocked by OpenAI quota, the reviewer reports provider-blocking findings instead of model-quality findings; restore quota or billing before rerunning the full matrix.

Paid live scenario trials are intentionally separate:

```bash
npm run student:profile-formative-live-trials
```

This command is paid-live by default, prints a warning, checks live readiness, refuses deterministic fallback as live success, and writes redacted artifacts under timestamped run directories in `.data/profile-formative-live-trials/`. Phase 28a uses a staged 10-scenario canary followed by the full 100-scenario matrix:

```bash
PROFILE_FORMATIVE_TRIAL_BUDGET_USD=10 \
MAX_LIVE_PROFILE_FORMATIVE_TRIALS=10 \
PROFILE_FORMATIVE_TRIAL_CANARY=true \
npm run student:profile-formative-live-trials

PROFILE_FORMATIVE_TRIAL_BUDGET_USD=10 \
MAX_LIVE_PROFILE_FORMATIVE_TRIALS=100 \
npm run student:profile-formative-live-trials
```

The runner captures safe provider-failure diagnostics without prompts, raw provider output, headers, or secrets. Profile/formative QA artifacts report provider versus effective category outcomes, explicit allowed boundary alternatives, adjudication labels, QA rubrics, result categories, retry counts, token usage, and optional estimated cost. Use `MAX_LIVE_PROFILE_FORMATIVE_TRIALS`, `PROFILE_FORMATIVE_TRIAL_SCENARIOS`, `PROFILE_FORMATIVE_TRIAL_VARIATIONS`, `PROFILE_FORMATIVE_TRIAL_BUDGET_USD=10`, `PROFILE_FORMATIVE_TRIAL_DRY_RUN=true`, or `PROFILE_FORMATIVE_TRIAL_NO_LIVE=true` to limit or inspect a run. See `docs/PROFILE_FORMATIVE_SCENARIO_QA.md`.

The optional live LLM readiness smoke is intentionally skipped unless explicitly enabled:

```bash
npm run student:live-llm-smoke
```

To run it intentionally, configure server-side live LLM variables locally and set `RUN_LIVE_LLM_SMOKE=1`. Do not run this in ordinary CI or commit any API key. The smoke only passes when the formative profile and targeted feedback calls both succeed, validate, and persist provider metadata plus token usage. Failed live-smoke synthetic sessions are retained by default and a sanitized artifact is written under `.data/student-live-llm-smoke/failures/`; inspect failures with `npm run student:live-llm-audit-diagnose -- --agent-call-id <agent_call_id>`, `--session-public-id <session_public_id>`, `--latest-failure`, or `--artifact <path>`. After inspection, remove retained synthetic failures with `npm run student:live-llm-smoke:cleanup-failures`. See `docs/MVP_E2E_READINESS.md`.

The optional live Item Administration Tutor smoke is also skipped by default:

```bash
npm run student:item-admin-live-smoke
```

At runtime, `ITEM_ADMIN_TUTOR_MODE=auto` uses the live Item Administration Tutor only when the server-side OpenAI provider, live-call flag, API key or credential file, authenticated key/model access check, and item-admin or follow-up model variable are configured. Check the current safe server-side status with:

```bash
npm run llm:readiness
```

`npm run llm:readiness` may perform a lightweight authenticated OpenAI model-metadata check when live config is otherwise present. It does not make a model generation request and prints only safe key fingerprints, model names, auth status, cache status, and reason codes. Authenticated readiness is cached briefly to avoid repeated checks.

If live config is missing, unauthenticated, invalid, unknown, public, or conflicting in browser/runtime auto mode, student start/resume is disabled and open-text turns are blocked with a safe temporary-unavailable message rather than silently using mock. Deterministic mock is limited to tests, smoke commands, or intentional local walkthroughs using `ITEM_ADMIN_TUTOR_MODE=mock` with `ALLOW_LOCAL_MOCK_RUNTIME=true`. `ALLOW_LOCAL_MOCK_RUNTIME` may be omitted for live runtime and then resolves to `false`; invalid explicit values fail closed. To run the optional paid smoke intentionally, configure live OpenAI provider settings and `RUN_LIVE_ITEM_ADMIN_SMOKE=1` locally. It checks that content questions during initial administration are deferred without advancing and that explicit uncertainty advances as low-information evidence.

Async workflow commands:

```bash
npm run workflow:drain-once
npm run workflow:worker
```

`workflow:drain-once` is useful for local tests. `workflow:worker` is the continuous local worker for automatic sessions.

Auth sanity checks after `npm run dev`:

```bash
curl -i http://localhost:3000/api/auth/me
curl -i http://localhost:3000/api/student/session/current
curl -i http://localhost:3000/api/teacher/dashboard
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  --data '{"user_id":"student_demo"}'
```

Useful local endpoints:

- `GET /api/health`
- `GET /api/auth/me`
- `POST /api/auth/login`
- `POST /api/auth/logout`

Protected route shells:

- `/student/assessment` requires a student session.
- `/teacher/dashboard` requires a teacher_researcher session.

Student account management routes:

- `/teacher/students`
- `/teacher/students/new`
- `/teacher/students/import`
- `/teacher/students/[userId]`

Roster/account commands:

```bash
npm run demo:roster
npm run demo:roster:cleanup
npm run roster:import-smoke
npm run student:account-smoke
npm run student:account-ui-smoke
npm run student:teacher-student-account-smoke
npm run student:teacher-student-deletion-smoke
npm run auth:account-status-smoke
```

Students are created by the teacher_researcher. Students do not self-register and do not need email addresses. Student login uses `user_id` plus an assigned temporary password/access code or a student-changed password. Optional email is teacher/research-facing PII only and is not a login identifier. Temporary credentials and passwords are stored only as hashes, shown only immediately after create/import/reset, and never shown as current passwords. Students with temporary credentials are redirected to choose a new password and cannot start or continue assessments until that password is changed.

Deactivation/reactivation is the reversible account-control path and preserves associated assessment/research records. The student detail page also provides a teacher-only irreversible deletion path for approved staging cleanup or withdrawal workflows. Deletion requires a preview, exact typed student_id confirmation, and `DELETE`; it removes the student account and associated system session/activity records and writes a safe deletion audit event. Previously downloaded exports, screenshots, or external copies are outside this system and cannot be removed by the app.

Model evaluation routes:

- `/teacher/evals`
- `/teacher/evals/suites`
- `/teacher/evals/runs`
- `/teacher/evals/runs/[runPublicId]`
- `/teacher/evals/run-items/[runItemPublicId]`

Evaluation commands:

```bash
npm run eval:seed-fixtures
npm run eval:mock-run
npm run eval:harness-smoke
npm run eval:cleanup-fixtures
```

Phase 7E1 evaluation uses synthetic cases only, runs the mock provider only, and stores outputs only in evaluation tables. It does not call OpenAI, does not require an API key, and does not mutate classroom workflow records.

## Phase 1 And 1.5 Scope

Implemented:

- Next.js TypeScript skeleton
- Tailwind CSS setup
- student login route shell
- student assessment route shell
- teacher_researcher dashboard route shell
- auth login/logout/me API shells
- student session placeholder API routes
- teacher placeholder API routes
- Prisma/PostgreSQL setup
- minimal `users` table
- signed HTTP-only cookie session foundation
- environment validation
- specification lock document
- Docker Compose PostgreSQL configuration
- Prisma seed script for demo local users
- auth-protected student and teacher page shells
- health endpoint for app/database connectivity

Outside Phase 1 and 1.5 scope:

- LLM agent calls
- OpenAI API integration
- formative follow-up conversation

## Phase 2A Database Verification

Phase 2A adds the normalized database schema and smoke test only. It does not implement services, agents, UI flows, or export.

```bash
npm run db:up
npm run prisma:generate
npm run prisma:migrate -- --name phase2a_core_schema
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run typecheck
npm run lint
npm run build
```

## Phase 2B Service Verification

Phase 2B adds foundational backend services only: process event logging, conversation turn logging, deterministic phase transitions, assessment session state persistence, response package creation, and service-level smoke testing.

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run db:smoke
npm run db:service-smoke
npm run prisma:seed
npm run typecheck
npm run lint
npm run build
```

The service smoke test creates temporary records, verifies phase transition acceptance/rejection, logs process events and conversation turns, creates an `initial_concept_unit_response_package`, checks event aggregation, and cleans up only the temporary records it created.

## Phase 6B Student Profiling Verification

Phase 6B connects only the Student Profiling Agent after initial concept-unit completion. The default path uses the mock provider and does not call OpenAI.

```bash
npm run agent:profiling-smoke
```

The smoke test creates temporary completed initial concept-unit sessions, builds allowlisted profiling input from response-package evidence, verifies prohibited secret/auth fields are absent, executes `student_profiling_agent` through `executeAgent`, persists a validated `student_profiles` row, updates the latest profile pointer, transitions the session to `profiling_completed`, verifies teacher-only trigger authorization, confirms student-facing payloads do not expose profile labels, checks idempotency, invalid-output handling, usage-blocked handling, and cleans up only its temporary records.

Live OpenAI profiling is disabled unless server-side environment variables explicitly set `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY`, and `OPENAI_MODEL_PROFILING`, and the usage guard allows the call.

## Phase 6C Formative Planning Verification

Phase 6C connects only the Formative Value and Planning Agent after a saved student profile. The default path uses the mock provider and does not call OpenAI.

```bash
npm run agent:planning-smoke
```

The smoke test creates temporary profiled concept-unit sessions, builds allowlisted planning input, verifies summative outcomes and secret/auth fields are absent, derives the default formative value from the integrated diagnostic profile, executes planning through `executeAgent`, semantically validates mapping metadata and nonempty fields, persists a `formative_decisions` row, updates the latest decision pointer, transitions the session to `planning_completed`, verifies teacher-only trigger authorization, confirms student-facing payloads do not expose planning/profile labels, checks idempotency, mapping-deviation behavior, invalid-output/refusal/incomplete/usage-blocked handling, and cleans up only its temporary records.

Live OpenAI planning is disabled unless server-side environment variables explicitly set `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY`, and `OPENAI_MODEL_PLANNING`, and the usage guard allows the call.

See `docs/FORMATIVE_PLANNING_AGENT.md` for the Phase 6C planning contract.

## Phase 6D1 Follow-Up Verification

Phase 6D1 connects only the Follow-up Agent for the first open-ended follow-up conversation round after a saved profile and saved formative decision exist. The default path uses the mock provider and does not call OpenAI.

```bash
npm run agent:followup-smoke
npm run student:followup-ui-smoke
```

The smoke tests create temporary planned concept-unit sessions, start a teacher-triggered follow-up round, verify allowlisted follow-up input, strict output validation, semantic validation, idempotent student messages, bounded provider context, usage-blocked handling, agent-call audit, process-event logging, teacher review display, student-safe conversation state, stop behavior, no profile updates, no replanning, no next concept-unit start, and no OpenAI network calls.

Live OpenAI follow-up is disabled unless server-side environment variables explicitly set `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY`, and `OPENAI_MODEL_FOLLOWUP`, and the usage guard allows the call.

See `docs/FOLLOWUP_AGENT.md` and `docs/FOLLOWUP_CONVERSATION.md` for the Phase 6D1 contracts.

## Phase 6D2B Follow-Up Evidence Updates

Phase 6D2B adds iterative evidence updating inside the current concept unit only. Meaningful student follow-up evidence can create a `followup_evidence_update_package`, stage an updated Student Profiling Agent output, stage an updated Formative Value and Planning Agent output, and atomically activate both only after the full update cycle succeeds.

```bash
npm run agent:followup-update-smoke
npm run agent:followup-final-update-smoke
npm run student:followup-update-ui-smoke
```

The update cycle uses the existing mock-provider LLM path by default and does not call OpenAI. The student sees only a neutral update-pending state while backend updating is in progress. Teachers can review update cycles and, in manual-review mode, trigger an eligible follow-up update from the session detail page.

`FOLLOWUP_SUBSTANTIVE_TURNS_BEFORE_UPDATE` defaults to `3`. It is a technical fallback for evidence updating, not a pedagogical maximum number of turns.

See `docs/FOLLOWUP_EVIDENCE_UPDATES.md`, `docs/ITERATIVE_FOLLOWUP_UPDATES.md`, and `docs/FOLLOWUP_UPDATE_ATOMICITY.md` for the Phase 6D2B contract.

## Phase 3A Content Management Verification

Phase 3A adds backend-only teacher_researcher content management services, API routes, validation, JSON import, documentation, and smoke testing. It does not add the teacher item-management UI, student conversation UI, LLM calls, agents, follow-up loop, or CSV export.

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run typecheck
npm run lint
npm run build
```

The content smoke test creates temporary assessment content, validates concept-unit publishing rules, publishes a valid concept unit, checks invalid publish cases, verifies item version incrementing and archive behavior, confirms API-style service outputs do not expose internal UUID keys, and cleans up only its temporary records.

See `docs/ITEM_MANAGEMENT.md` for JSON import examples, validation rules, and teacher content route details.

## Phase 3B Manual Content UI

Phase 3B adds teacher_researcher UI pages for manual content management over the Phase 3A APIs. It does not add the student assessment conversation UI, LLM calls, agents, follow-up loop, full dashboard details, or CSV export.

Teacher pages:

- `/teacher/content`
- `/teacher/content/assessments`
- `/teacher/content/assessments/new`
- `/teacher/content/import-json`

Assessment, concept-unit, and item detail pages use public IDs in the route. The UI exposes correct options and distractor rationales only to teacher_researcher users.

Manual UI workflow:

1. Sign in as `teacher_demo` with `teacher_demo_password`.
2. Open `/teacher/content/assessments`.
3. Create an assessment.
4. Add a topic with a topic title, learning objective, concept description, and optional teacher-only diagnostic note.
5. Add at least 3 MCQ items one by one. The guided builder collects stem, options, teacher-only correct option, item purpose, expected reasoning notes, item diagnostic notes, and distractor diagnostic notes.
6. Preview the student view from the topic page to verify only the stem and visible option text are shown.
7. Publish the topic and resolve any validation errors returned by the backend. Missing teacher diagnostic notes produce warnings, not student-facing feedback.
8. Publish the assessment when allowed.
9. Use `/teacher/content/import-json` for manual JSON import. See `docs/sample-concept-unit-import.json`.

Teacher-only diagnostic notes are stored in existing content JSON metadata and may be passed to internal LLM interpretation context. They are guidance, not ground truth: correct-option selection alone is never sufficient evidence of understanding. Missing teacher diagnostic notes are advisory warnings, not structural publish blockers. Student-facing pages and default exports must not show correct options, answer keys, raw diagnostic notes, raw distractor notes, misconception IDs, or internal metadata.

Verification remains:

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run student:teacher-mcq-item-builder-smoke
npm run typecheck
npm run lint
npm run build
```

## Phase 3C Content Governance

Phase 3C adds content-governance and research-integrity rules only. It does not add Phase 4, student conversation UI, LLM calls, agents, follow-up, session review dashboard details, or CSV export.

Teacher researchers define assessment titles, concept boundaries, item membership, wording, options, correct answers, rationales, reasoning expectations, misconception indicators, ordering, and publication timing. The system checks only the minimum publishing and research-integrity requirements.

Governance rules:

- Draft concept units may contain more candidate items than the published included set.
- Publishing a concept unit counts only active items marked `included_in_published_set`.
- A published concept unit must have at least 3 included active items. Runtime item administration uses the actual included count from the session-bound mini-test snapshot.
- Assessments publish only after at least one concept unit is actually published.
- Published unused assessments can explicitly return to draft before any student session starts.
- Published concept units can explicitly return to draft when the parent assessment is draft and no student session has started.
- Once any `assessment_sessions` row exists for an assessment, research-relevant content is read-only.
- Locked assessments may still be archived as a whole to prevent future new sessions while preserving records.

Phase 3C verification:

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run content:governance-smoke
npm run typecheck
npm run lint
npm run build
```

## Phase 4A Initial Administration Backend

Phase 4A adds backend services and student API routes for assessment availability, atomic session start/resume, deterministic initial concept-unit administration, safe item delivery, response persistence, revisions, explicit skips, missing-evidence repair, frontend process-event ingestion, and initial response-package creation.

It does not add the ChatGPT-style student assessment UI, OpenAI API integration, LLM agents, profiling, planning, follow-up, teacher session review, or CSV export.

Student API routes:

- `GET /api/student/assessments/available`
- `POST /api/student/assessments/[assessmentPublicId]/sessions/start`
- `GET /api/student/sessions/[sessionPublicId]/state`
- `POST /api/student/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/start`
- `POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/option`
- `POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/reasoning`
- `POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/confidence`
- `POST /api/student/sessions/[sessionPublicId]/items/[itemPublicId]/submit`
- `POST /api/student/sessions/[sessionPublicId]/concept-units/[conceptUnitPublicId]/complete-initial`
- `POST /api/student/sessions/[sessionPublicId]/events`
- `POST /api/student/sessions/[sessionPublicId]/exit`

Phase 4A rules:

- Published, non-archived assessments are available to authenticated students when they contain at least one valid published concept unit.
- V1 uses one default attempt per student/assessment with `attempt_number = 1`.
- The database uniqueness rule is `user_db_id + assessment_db_id + attempt_number`, so future teacher-authorized retakes can use attempt 2 or later.
- Repeated Start requests resume the same existing non-completed attempt instead of creating duplicate sessions.
- Student routes use public IDs and never return internal UUIDs.
- Student item payloads exclude answer keys, correctness, distractor rationales, reasoning expectations, misconception indicators, teacher-only rules, profiles, and formative labels.
- Correctness is calculated by backend logic and stored as research evidence, but no correctness feedback is returned during initial administration.
- Revisions remain allowed until the concept unit's initial administration is completed.
- Missing evidence gets one repair opportunity; deliberate skips are stored as skipped flags.
- A skipped whole item stores `correctness = unanswered`.
- Frontend process events are browser-context evidence only, force `event_source = frontend`, and are not misconduct labels.
- Completing initial concept-unit administration creates one `initial_concept_unit_response_package` and moves the session to `profiling_pending` without calling a profiling model.

Phase 4A verification:

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run content:governance-smoke
npm run student:initial-admin-smoke
npm run typecheck
npm run lint
npm run build
```

Dev-server API checks:

```bash
npm run dev
curl -i http://localhost:3000/api/health
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  --data '{"user_id":"student_demo"}'
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  --data '{"user_id":"student_demo","access_code":"student_demo_access_code"}'
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  --data '{"user_id":"teacher_demo","password":"teacher_demo_password"}'
```

Use cookie jars for authenticated role checks, for example:

```bash
curl -i -c /tmp/student-cookie.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  --data '{"user_id":"student_demo","access_code":"student_demo_access_code"}'
curl -i -b /tmp/student-cookie.txt http://localhost:3000/api/teacher/dashboard
curl -i -b /tmp/student-cookie.txt -X POST http://localhost:3000/api/auth/logout
```

See `docs/INITIAL_ADMINISTRATION_BACKEND.md` for the detailed Phase 4A backend contract.

## Phase 4B Student Initial Administration UI

Phase 4B adds the protected student-facing platform for initial concept-unit administration. It does not add OpenAI integration, LLM agents, profiling, planning, follow-up, teacher session review, or CSV export.

Student routes:

- `/student/assessment`
- `/student/assessment/[sessionPublicId]`

The assessment list uses `GET /api/student/assessments/available`. Start and Resume open the session route with the public `session_public_id`. The session page uses a ChatGPT-style layout over deterministic backend state, clickable option buttons, free-text reasoning, low/medium/high confidence controls, missing-evidence repair, explicit skip confirmation, review/revision, Save and exit, resume, refresh recovery, and neutral awaiting-profiling state.

Create the development browser fixture:

```bash
npm run demo:student-assessment
```

Cleanup only the development demo assessment and its own records:

```bash
npm run demo:student-assessment:cleanup
```

Student browser process-event thresholds are configurable in `.env.local`:

```bash
NEXT_PUBLIC_LONG_PAUSE_MS=120000
NEXT_PUBLIC_INACTIVITY_MS=300000
```

These are technical defaults, not psychological thresholds.

Phase 4B verification:

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run content:governance-smoke
npm run student:initial-admin-smoke
npm run student:ui-smoke
npm run typecheck
npm run lint
npm run build
```

Manual browser flow:

1. Run `npm run db:up`.
2. Run `npm run prisma:seed`.
3. Run `npm run demo:student-assessment`.
4. Run `npm run dev`.
5. Sign in as `student_demo` with `student_demo_access_code`.
6. Open `/student/assessment`, start or resume the demo assessment, answer the initial questions, use Review Responses, Save and exit, resume, refresh, and complete the initial concept unit.
7. Confirm the final state is awaiting analysis/profiling and no correctness, profile, formative activity, or follow-up is shown.

See `docs/STUDENT_INITIAL_ADMINISTRATION_UI.md` for the Phase 4B UI contract.

## Phase 5A Teacher Session Review

Phase 5A adds a read-only teacher_researcher review platform for existing assessment sessions. It does not add Phase 5B CSV export, summative outcome upload, OpenAI integration, LLM agents, profiling, planning, follow-up conversation, or fabricated agent outputs.

Teacher routes:

- `/teacher/dashboard`
- `/teacher/sessions`
- `/teacher/sessions/[sessionPublicId]`

Teacher session-review APIs:

- `GET /api/teacher/sessions`
- `GET /api/teacher/sessions/[sessionPublicId]`
- `GET /api/teacher/sessions/[sessionPublicId]/item-responses`
- `GET /api/teacher/sessions/[sessionPublicId]/transcript`
- `GET /api/teacher/sessions/[sessionPublicId]/process-events`
- `GET /api/teacher/sessions/[sessionPublicId]/response-packages`

Create the development review fixture:

```bash
npm run demo:teacher-review
```

Cleanup only the teacher-review demo assessment/session records:

```bash
npm run demo:teacher-review:cleanup
```

Phase 5A verification:

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run content:governance-smoke
npm run student:initial-admin-smoke
npm run student:ui-smoke
npm run teacher:review-smoke
npm run typecheck
npm run lint
npm run build
```

Manual browser flow:

1. Run `npm run db:up`.
2. Run `npm run prisma:seed`.
3. Run `npm run demo:teacher-review`.
4. Run `npm run dev`.
5. Sign in as `teacher_demo` with `teacher_demo_password`.
6. Open `/teacher/dashboard`, then Student sessions.
7. Search for `student_demo`, use status/phase filters, open the demo session, and review Overview, Item responses, Conversation transcript, Process events, Response packages, and Future agent data.
8. Sign out, sign in as `student_demo` with `student_demo_access_code`, and confirm teacher pages/API routes are forbidden.

See `docs/TEACHER_SESSION_REVIEW.md` for the Phase 5A review contract.

## Phase 5B Data Management And Phase 7B Master Export

Phase 5B adds teacher_researcher-only data management for supervised summative outcomes and one merged master assessment CSV export. Phase 7B completes that master CSV for persisted platform records through Phase 7A, including account status, assessment availability, activated profiles/decisions, follow-up rounds, update cycles, progression, completion, workflow jobs, agent audit metadata, and summative outcomes.

The export is read-only. It does not call OpenAI, run agents, create profiles, create decisions, create follow-up rounds, modify student records, or fabricate values. Failed/staged update outputs remain audit/history data and do not populate active/latest scalar columns.

Teacher routes:

- `/teacher/data`
- `/teacher/data/research`
- `/teacher/data/summative-outcomes`

Legacy `/teacher/data/explorer` and `/teacher/data/export` UI routes redirect
to the unified research export center.

Simple CSV explorer APIs:

- `GET /api/teacher/data-explorer/options`
- `GET /api/teacher/data-explorer/assessments/[assessmentPublicId]/csv`
- `GET /api/teacher/data-explorer/assessments/[assessmentPublicId]/detailed-csv`
- `GET /api/teacher/data-explorer/students/[userId]/csv`
- `GET /api/teacher/data-explorer/students/[userId]/detailed-csv`
- `GET /api/teacher/data-explorer/matrix/csv`
- `GET /api/teacher/data-explorer/complete-csv`

The CSV explorer is read-only and produces three direct summary CSV downloads:
`assessment_<id>_students.csv`, `student_<student_id>_sessions.csv`, and
`student_assessment_matrix.csv`. Assessment and student CSVs use one row per
student-assessment session attempt. The matrix CSV uses one row per current
student and assessment pair. These quick exports include public IDs, session
status/timestamps, safe counts, latest student-safe status when available,
post-activity aggregate counts, and limitations. They exclude email by default,
raw response text, process payloads, provider outputs, answer keys, correct
options, correctness labels, distractor metadata, diagnostic notes, and secrets.

The detailed ZIP buttons on the same page generate exactly
`analysis_rows.csv`, `process_events.csv`, `turn_response_latencies.csv`, and
`conversation_turns.csv` for the selected assessment, selected student, or all
authorized data. Each row includes safe export-source identity fields, including
an irreversible database-instance fingerprint. Selected assessments with no
student sessions are reported as unavailable instead of generating a misleading
header-only CSV.

Summative outcome APIs:

- `POST /api/teacher/summative-outcomes/import/preview`
- `POST /api/teacher/summative-outcomes/import/[batchPublicId]/commit`
- `GET /api/teacher/summative-outcomes/import-batches`
- `GET /api/teacher/summative-outcomes/import-batches/[batchPublicId]`
- `GET /api/teacher/summative-outcomes/outcome-names`
- `POST /api/teacher/summative-outcomes/[outcomePublicId]/replace`

Master export APIs:

- `POST /api/teacher/export/master-csv`
- `GET /api/teacher/export/jobs`
- `GET /api/teacher/export/[exportPublicId]`
- `GET /api/teacher/export/[exportPublicId]/download`

Outcome import CSV columns:

```text
user_id,outcome_name,outcome_score,max_score,assessment_date,notes
```

Create the development data/export fixture:

```bash
npm run demo:data-export
```

Cleanup only fixture-owned data/export records and fixture export files:

```bash
npm run demo:data-export:cleanup
```

Clean up expired local export files:

```bash
npm run export:cleanup
```

Phase 5B verification:

```bash
npm run prisma:generate
npx prisma validate
npx prisma migrate status
npm run prisma:seed
npm run db:smoke
npm run db:service-smoke
npm run content:smoke
npm run content:governance-smoke
npm run student:initial-admin-smoke
npm run student:ui-smoke
npm run teacher:review-smoke
npm run summative:import-smoke
npm run export:master-smoke
npm run export:master-complete-smoke
npm run typecheck
npm run lint
npm run build
```

Manual browser flow:

1. Run `npm run db:up`.
2. Run `npm run prisma:seed`.
3. Run `npm run demo:data-export`.
4. Run `npm run dev`.
5. Sign in as `teacher_demo` with `teacher_demo_password`.
6. Open `/teacher/data/summative-outcomes`, preview a valid or invalid CSV, inspect validation results, and commit a valid preview.
7. Open `/teacher/data/research`, verify only Research dataset and Data
   dictionary sections are visible, then download the research dataset ZIP.
   Legacy master CSV APIs remain authorized for backward-compatible workflows.
8. Sign out, sign in as `student_demo` with `student_demo_access_code`, and confirm data/export pages and APIs are forbidden.

See `docs/SUMMATIVE_OUTCOMES.md`, `docs/MASTER_CSV_EXPORT.md`, and `docs/MASTER_EXPORT_DATA_DICTIONARY.md` for the detailed data/export contracts.

## Phase 6A And 6A.5 LLM Infrastructure

Phase 6A adds generic LLM infrastructure. Phase 6A.5 adds classroom LLM access controls, usage limits, live-call readiness checks, and teacher-visible usage monitoring. These phases do not run agents on real classroom data, create profiles, create formative decisions, create follow-up rounds, alter `profiling_pending` sessions, or call OpenAI during normal verification.

Teacher route and API:

- `/teacher/system/llm`
- `GET /api/teacher/system/llm-status`

Students never provide OpenAI API keys and never need OpenAI accounts. Future live calls must use a backend-controlled server-side API key and pass authentication, authorization, readiness, usage guard, and audit logging.

LLM verification:

```bash
npm run llm:contracts-smoke
npm run llm:execution-smoke
npm run llm:redaction-smoke
npm run llm:usage-smoke
npm run llm:status-smoke
npm run llm:readiness
npm run llm:readiness-smoke
```

Optional synthetic live connectivity check:

```bash
npm run llm:connectivity
```

The connectivity script requires `LLM_PROVIDER=openai`, `LLM_LIVE_CALLS_ENABLED=true`, `OPENAI_API_KEY`, and `OPENAI_MODEL_CONNECTIVITY_TEST`. It sends only fixed synthetic data and is not part of the offline verification path.

Usage safeguard variables are documented in `.env.example` and `docs/LLM_USAGE_LIMITS.md`.

See `docs/LLM_INFRASTRUCTURE.md`, `docs/AGENT_CONTRACTS.md`, `docs/PROMPT_VERSIONING.md`, `docs/CLASSROOM_LLM_ACCESS.md`, `docs/LLM_USAGE_LIMITS.md`, `docs/STUDENT_PROFILING_AGENT.md`, `docs/FORMATIVE_PLANNING_AGENT.md`, `docs/FOLLOWUP_AGENT.md`, `docs/FOLLOWUP_CONVERSATION.md`, `docs/FOLLOWUP_EVIDENCE_UPDATES.md`, `docs/ITERATIVE_FOLLOWUP_UPDATES.md`, `docs/FOLLOWUP_UPDATE_ATOMICITY.md`, `docs/ITEM_VERIFICATION_AGENT.md`, and `docs/ITEM_VERIFICATION_WORKFLOW.md`.

## Phase 7E2A Live Evaluation Canary

Phase 7E2A adds a CLI-only live evaluation canary path for the internal evaluation harness. It does not enable classroom live calls.

Canary design:

- exact snapshot: `gpt-5.4-mini-2026-03-17`
- reasoning effort: `low`
- 5 active agents x 5 synthetic cases x 1 repetition = 25 run items
- hard budget: USD 50
- no GPT-5.5 comparison and no nano comparison

Manual paid canary procedure after editing `.env.local` locally:

```bash
npm run eval:live-canary:preflight
npm run eval:live-canary:dry-run
npm run eval:live-canary -- --confirm-paid-api --new-run
npm run eval:live-canary:report -- --run <run_public_id>
```

Paid execution requires explicit run selection. Use `--new-run` for a fresh
25-item canary or `--resume <run_public_id>` for a specific nonterminal run:

```bash
npm run eval:live-canary -- --confirm-paid-api --new-run
npm run eval:live-canary -- --confirm-paid-api --resume <run_public_id>
```

The runner never silently reuses a completed run. A fresh run receives a new
`run_public_id`; the separate `run_config_hash` records the frozen model,
manifest, prompt, schema, evaluator, budget, retry, timeout, concurrency, and Git
configuration for reproducibility.

Read-only inspection of an existing live canary run:

```bash
npm run eval:live-canary:inspect -- --run <run_public_id>
```

Read-only comparison of current canary configuration with a historical run:

```bash
npm run eval:live-canary:compare-config -- --run <run_public_id>
```

The inspect command makes no provider request. It reports run status, item statuses,
provider IDs when present, usage availability, sanitized errors, and whether a
fresh run is safer than resuming.

Generate a local blind expert-review packet for a completed 25-item live canary:

```bash
npm run eval:blind-review-export -- --run <run_public_id>
```

The command writes ignored files under `.data/eval-review/<run_public_id>/`:
`blind_review_packet.jsonl`, `review_reference.jsonl`, and
`annotation_template.csv`. It also writes `redaction_summary.json` with field
paths, detection categories, value lengths, and irreversible hashes for
export-only safety findings. The blind packet omits model/provider metadata,
case IDs, automated results, gold labels, token usage, costs, and existing
annotations; the separate reference file is for adjudication after blind review.

Inspect blind-review export safety without writing review files:

```bash
npm run eval:blind-review-export:inspect -- --run <run_public_id>
```

The inspect command does not print detected values. Standalone
credential-shaped tokens are redacted only in the exported review copy as
`[REDACTED_SECRET_LIKE_TOKEN]`; benign phrases such as `API key`, `system
prompt`, `hidden instructions`, and broad legacy false positives inside ordinary
words remain reviewable.

Import completed offline annotations as AI-assisted preliminary drafts:

```bash
npm run eval:annotations:import-draft -- \
  --run <run_public_id> \
  --annotations <completed_annotation_csv_path> \
  --reference .data/eval-review/<run_public_id>/review_reference.jsonl
```

Draft imports do not count as completed human review. In the teacher eval UI,
open `/teacher/evals/runs/<run_public_id>`, inspect/edit the proposed
annotations, type the required attestation, and confirm all reviewed drafts.
Readiness gates then use confirmed human pass/fail and human critical-failure
flags. Automated screening flags remain visible as separate adjudication
context and are not silently copied into human judgments.

The annotation importer validates structure and mapping, not expected outcomes.
It derives the expected row count from the target run, requires exactly one CSV
row and one reference record for each review item, validates rubric scores and
critical-failure flags, and then reports pass/fail totals as calculated results.
No pass/fail distribution is hardcoded; the same importer supports the 25-item
canary and future larger pilot runs.

Confirmed annotations may be amended only after explicit unblinded researcher
adjudication. The guarded CLI preserves pass/fail, overall rating, rubric
scores, annotation source, confirmer, confirmation timestamp, model outputs, and
automated findings; it writes `eval_annotation_revisions` before changing the
current confirmed annotation fields:

```bash
npm run eval:annotations:amend-confirmed -- \
  --run <run_public_id> \
  --case <case_id> \
  --remove-critical-flag <critical_failure_flag> \
  --confirm-researcher-instruction
```

Removing a human critical-failure flag does not convert a Fail into a Pass.

Do not paste the API key into chat or a browser form. Keep classroom settings as `LLM_PROVIDER=mock` and `LLM_LIVE_CALLS_ENABLED=false`.

Offline verification commands:

```bash
npm run eval:blind-review-export-smoke
npm run eval:blind-review-secret-scan-smoke
npm run eval:annotation-import-smoke
npm run eval:annotation-adjudication-smoke
npm run eval:confirmed-annotation-amendment-smoke
npm run eval:structured-output-compat-smoke
npm run eval:live-canary-runner-smoke
npm run eval:usage-parser-smoke
npm run eval:budget-smoke
npm run eval:live-isolation-smoke
npm run eval:canary-report-smoke
```

See `docs/LIVE_EVAL_CANARY.md`, `docs/EVAL_BUDGET_GUARD.md`, and `docs/EVAL_REPRODUCIBILITY.md`.

### Phase 7E2A Quality Patch

After baseline run `evr_20260623_1sjeh1q`, future canaries use updated prompt
versions and evaluator versions for known quality failures. The baseline run and
confirmed annotations remain frozen for audit.

Run the targeted regression check before any new fresh canary:

```bash
npm run eval:targeted-quality-regression-smoke
```

The next fresh canary should use the same exact snapshot and manifest, then run:

```bash
npm run eval:live-canary:preflight
npm run eval:live-canary:dry-run
npm run eval:live-canary:compare-config -- --run evr_20260623_1sjeh1q
```

Then start a fresh paid canary only after local API-key configuration:

```bash
npm run eval:live-canary -- --confirm-paid-api --new-run
```

Do not resume the baseline run. Fresh runs require fresh human annotation. See
`docs/CANARY_QUALITY_PATCH.md`.

### Phase 7E2B Full Pilot

The full pilot is a guarded, CLI-only live-evaluation path for eval tables only.
It uses `gpt-5.4-mini-2026-03-17`, `reasoning_effort=low`, 50 synthetic base
cases, two repetitions, and 100 total outputs. It requires an approved canary
run via `--approved-canary <run_public_id>` or
`EVAL_PILOT_APPROVED_CANARY_RUN_ID`.

Preflight and dry run make no provider request:

```bash
npm run eval:live-pilot:preflight -- --approved-canary <run_public_id>
npm run eval:live-pilot:dry-run -- --approved-canary <run_public_id>
```

Paid execution is not automatic and requires local `.env.local` configuration
plus explicit confirmation:

```bash
npm run eval:live-pilot -- --approved-canary <run_public_id> --confirm-paid-api --new-run
npm run eval:live-pilot -- --confirm-paid-api --resume <pilot_run_public_id>
npm run eval:live-pilot:report -- --run <pilot_run_public_id>
```

Pilot smoke tests use mock providers and make no OpenAI call:

```bash
npm run eval:pilot-manifest-smoke
npm run eval:live-pilot-runner-smoke
npm run eval:pilot-stability-smoke
npm run eval:pilot-blind-export-smoke
npm run eval:pilot-annotation-smoke
npm run eval:pilot-report-smoke
```

See `docs/FULL_LIVE_EVAL_PILOT.md`,
`docs/EVAL_STABILITY_ANALYSIS.md`, and
`docs/INTERNAL_HOLDOUT_LIMITATIONS.md`.

### Phase 7E2C Targeted Remediation

The completed full pilot run `evr_20260623_ga6kzai` remains frozen: 100 outputs,
91 confirmed human Pass, 9 confirmed human Fail, and zero confirmed human
critical failures after adjudication. Phase 7E2C does not rerun or alter that
pilot. It adds targeted remediations and a separate 22-output regression path
for the six failed base cases plus one unaffected control case per active
agent, each with two repetitions.

Targeted remediation updates:

- Response Collection prompt `response-collection-v5` captures exact valid reasoning segments in mixed reasoning-plus-correctness-request messages while still refusing correctness feedback.
- Formative Planning prompt `formative-planning-v2` treats the default formative-value mapping as backend-owned guidance; backend code canonicalizes `mapping_followed` and requires evidence-linked deviation reasons.
- Follow-up prompt `followup-v6` validates saved formative value compatibility, transfer/verification action compatibility, move-on technical final-update semantics, nullable evidence requests, and backend-owned process-event metadata.
- Item Verification prompt `item-verification-v4` keeps findings advisory and adds a deterministic supplementary duplicate warning that is stored separately from raw LLM verification.
- Evaluation validators are versioned as `eval-semantic-v3` and `eval-safety-v3`.

Offline smoke checks make no OpenAI call:

```bash
npm run eval:targeted-remediation-manifest-smoke
npm run eval:targeted-remediation-runner-smoke
npm run eval:targeted-remediation-report-smoke
npm run eval:targeted-remediation-blind-export-smoke
```

Manual targeted paid evaluation, if later approved, is CLI-only:

```bash
npm run eval:targeted-remediation:preflight
npm run eval:targeted-remediation:dry-run
npm run eval:targeted-remediation -- --confirm-paid-api --new-run
npm run eval:targeted-remediation -- --confirm-paid-api --resume <run_public_id>
npm run eval:targeted-remediation:inspect -- --run <run_public_id>
npm run eval:targeted-remediation:report -- --run <run_public_id>
npm run eval:targeted-remediation:diagnose -- --run <run_public_id>
```

The targeted path uses synthetic eval cases only, `gpt-5.4-mini-2026-03-17`,
low reasoning effort, 22 planned outputs, concurrency 1, max retries 1, max 35
provider requests, and a USD 10 hard limit. Classroom settings remain
`LLM_PROVIDER=mock` and `LLM_LIVE_CALLS_ENABLED=false`. The readiness label is a
guarded integration patch check, not classroom validity.

Phase 7E2C separates `raw_model_quality` from
`effective_system_readiness`. Raw-output annotations remain visible and are
stored with `review_target=raw_model_output`. Effective-system review uses
derived artifacts that include deterministic safeguards, backend
canonicalization, and safe fallbacks, and is stored separately with
`review_target=effective_system_output`.

Effective-system readiness now has its own versioned validation source:
`effective_validator_version=effective-validator-v1`. It evaluates the
student-facing effective message, backend-owned structured result, workflow
actions, process events, deterministic guards, and fallbacks. It does not
inherit raw semantic or raw safety failures as effective failures. A safe
refusal such as "I cannot provide a hint" or "I can't confirm whether that is
correct" is not answer leakage merely because it contains words like hint,
answer, explanation, or correctness. Actual answer delivery, correctness
feedback, hints, unauthorized option/confidence mutation, workflow mutation, or
secret/profile/misconduct exposure remain blocking failures. Metadata
inconsistencies that do not change student-facing behavior or workflow actions
are reported as nonblocking warnings.

For `evr_20260624_bltzgtq`, the raw-model AI review remains 20 Pass / 2 Fail.
The original effective-system artifact version `effective-system-eval-v1` is
also preserved with 20 Pass / 2 Fail; both Fail judgments were the two
`fua_move_on_offer_010` repetitions, where the v1 fallback ignored the
student's explicit move-on request and assigned another transfer task. The
corrected artifact version is `effective-system-eval-v2`; it keeps move-on
student-led and asynchronous by preparing the final update/progression path
without directly advancing the student or bypassing unresolved-evidence
confirmation. The v2 AI blind review for this run is stored as 22 Pass / 0 Fail
with zero critical-failure flags, and it must not reuse v1 judgments. The
report remains provisional engineering evidence with human review pending and
`classroom_validity=false`.

Because the final effective-validation correction did not change the v2
student-facing messages, structured effective results, workflow actions, process
events, or `effective_result_hash` values, no new blind review is required. The
v2 AI review remains reusable while the report now reads the independent
effective-validation fields for readiness gates.

Generate the effective-system blind packet with:

```bash
npm run eval:blind-review-export -- \
  --run <targeted_run_public_id> \
  --review-target effective_system_output
```

By default this writes `effective-system-eval-v2` artifacts under
`.data/eval-review/<targeted_run_public_id>/effective-system-v2/`. To reproduce
the preserved v1 packet, add:

```bash
  --effective-result-version effective-system-eval-v1
```

Confirm an externally reviewed effective-system packet with:

```bash
npm run eval:annotations:confirm-ai-review -- \
  --run <targeted_run_public_id> \
  --annotations <completed_effective_annotation_csv_path> \
  --reference .data/eval-review/<targeted_run_public_id>/effective-system-v2/review_reference.jsonl \
  --reviewer-model gpt-5.5-pro \
  --review-target effective_system_output \
  --review-artifact-version effective-system-eval-v2 \
  --confirm-ai-review
```

Additional no-provider smoke checks:

```bash
npm run eval:effective-system-artifact-smoke
npm run eval:effective-move-on-fallback-smoke
npm run eval:effective-validation-source-smoke
npm run eval:effective-system-report-smoke
npm run eval:effective-system-blind-export-smoke
npm run eval:effective-system-annotation-smoke
```

AI-agent blind review can be confirmed as provisional engineering evidence
without labeling it as human review:

```bash
npm run eval:annotations:confirm-ai-review -- \
  --run <targeted_run_public_id> \
  --annotations <completed_annotation_csv_path> \
  --reference .data/eval-review/<targeted_run_public_id>/review_reference.jsonl \
  --reviewer-model gpt-5.5-pro \
  --confirm-ai-review
```

This stores `annotation_source=ai_agent_review` and
`annotation_status=ai_confirmed`, reviewer model, review method, reviewed time,
file hashes, source run ID, and import command version. It does not populate
human confirmer fields. Human researchers may later accept, edit, or replace
these judgments; that supersession writes an audit revision and preserves the
original AI-review provenance.

See `docs/FULL_PILOT_FAILURE_ADJUDICATION.md` and
`docs/TARGETED_REMEDIATION_EVAL.md`.

## Phase 8A Guarded Operational Integration

Phase 8A keeps the existing default-off outer guard and adds the actual operational executor behind explicit modes:

```text
OPERATIONAL_AGENT_MODE=disabled
OPERATIONAL_APPROVED_CONFIG_HASH=
OPERATIONAL_EFFECTIVE_RESULT_VERSION=effective-system-eval-v2
OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION=effective-validator-v1
```

Allowed modes are `disabled`, `mock`, and `guarded_live`. The default `disabled` mode makes no provider request and uses deterministic behavior or fallback. `mock` is for local development and injected-provider tests. `guarded_live` validates the approved manifest, exact model snapshot, reasoning effort, active configuration hash, usage guard, database readiness, and classroom live-call settings before any provider request could be permitted.

The approved manifest is `config/approved-operational-agent-config.json`. It freezes `gpt-5.4-mini-2026-03-17`, low reasoning effort, evaluated prompt/schema hashes, validator versions, deterministic guard versions, canonicalization versions, fallback versions, and evaluation evidence. Configuration changes require reevaluation.

Operational services consume only effective results. Raw provider output stays in `agent_calls`; backend-effective outputs are stored in `operational_agent_effective_results` with public IDs, version metadata, status fields, sanitized warnings, and an effective-result hash. Student payloads hide operational audit metadata, profile labels, formative-value labels, model/provider identity, prompts, answer keys, token usage, and cost.

Useful Phase 8A checks:

```bash
npm run operational:approval-manifest:verify
npm run operational:agents:preflight
npm run operational:guarded-integration-smoke
npm run operational:agent-execution-smoke
npm run operational:student-payload-smoke
npm run operational:teacher-audit-smoke
```

See `docs/GUARDED_OPERATIONAL_AGENT_INTEGRATION.md`,
`docs/APPROVED_OPERATIONAL_AGENT_CONFIG.md`,
`docs/OPERATIONAL_EFFECTIVE_RESULTS.md`,
`docs/OPERATIONAL_AGENT_FALLBACKS.md`, and
`docs/OPERATIONAL_AGENT_INTEGRATION.md`.

## Phase 8B Production-Like Synthetic E2E

Phase 8B adds a local, production-like E2E validation harness. It uses an
isolated PostgreSQL database whose name must end in `_e2e`, runs `next build`,
starts `next start` on `http://127.0.0.1:3100`, starts the real workflow worker,
and exercises synthetic student and teacher journeys with Playwright. It keeps
`OPERATIONAL_AGENT_MODE=mock`, `LLM_PROVIDER=mock`, and
`LLM_LIVE_CALLS_ENABLED=false`; no OpenAI call is made.

```bash
npm run e2e:production-like:preflight
npm run e2e:db:prepare
npm run e2e:db:reset
npm run e2e:production-like
npm run e2e:production-like:report -- --run <e2e_run_id>
```

Focused suites:

```bash
npm run e2e:browser-smoke
npm run e2e:worker-restart-smoke
npm run e2e:app-restart-smoke
npm run e2e:failure-matrix-smoke
npm run e2e:concurrency-smoke
npm run e2e:export-smoke
npm run e2e:privacy-smoke
```

Artifacts are written to `.data/e2e/<e2e_run_id>/` and are ignored by Git. See
`docs/PRODUCTION_LIKE_E2E_TESTING.md`,
`docs/SYNTHETIC_CLASSROOM_FIXTURE.md`, `docs/E2E_FAILURE_MATRIX.md`, and
`docs/E2E_ACCEPTANCE_GATES.md`.

## Phase 8C Guarded-Live Synthetic Operational Canary

Phase 8C adds CLI-only infrastructure for a small synthetic operational canary
against a dedicated database ending in `_live_canary_e2e`. It is disabled by
default and does not authorize real student use or public deployment.

Default local settings remain:

```text
OPERATIONAL_AGENT_MODE=disabled
LLM_PROVIDER=mock
LLM_LIVE_CALLS_ENABLED=false
OPERATIONAL_LIVE_CANARY_ENABLED=false
```

No-provider commands:

```bash
npm run operational:live-canary:preflight
npm run operational:live-canary:dry-run
npm run operational:live-canary:ready-status
npm run operational:live-canary-db-resolution-smoke
npm run operational:live-canary-guard-parity-smoke
npm run operational:live-canary-block-reason-smoke
npm run operational:live-canary-context-smoke
npm run operational:live-canary-actual-step-parity-smoke
npm run operational:live-canary-provenance-smoke
npm run operational:live-canary-dispatch-ledger-smoke
npm run operational:live-canary-accounting-smoke
npm run operational:live-canary-reconciliation-smoke
npm run operational:live-canary-recovery-smoke
npm run operational:live-canary-full-simulation-smoke
npm run operational:live-canary-transport-probe-smoke
```

The live-canary database resolver is idempotent: `conversational_mcq` resolves
to `conversational_mcq_live_canary_e2e`, while an already isolated
`conversational_mcq_live_canary_e2e` remains unchanged. Repeated malformed
suffixes such as `_live_canary_live_canary_e2e` are rejected. The parent
`DATABASE_URL` is not rewritten; canary Prisma clients and child processes
receive the isolated URL explicitly.

Preflight and operational execution use the same typed readiness evaluator. If
preflight is permitted, the runner stages the real run plus first step and
validates a canonical `operational-live-canary-context-v1` attestation before
creating the remaining executable steps. If that actual-step probe is blocked,
the canary makes no provider request and does not create a full 30-step run.
Dry run prepares and seeds the isolated database without dropping historical
canary runs.

Phase 8C execution-integrity hardening adds an immutable dispatch ledger. A
provider request counts only when `operational_live_canary_dispatch_attempts`
contains verified provider provenance, usage, and lifecycle status. Historical
completed rows without dispatch rows are preserved but classified as
`unknown_legacy_provenance`, not verified paid provider calls.

Transport probe hardening adds a local stage machine and transport objective.
Dry run validates the exact synthetic Response Collection input, output schema,
redaction, budget/readiness state, transport environment, local request
serialization, error-normalization readiness, and OpenAI Responses transport
descriptor without making a provider request. Diagnosis is read-only and
reports unrecoverable historical errors without inventing a cause.

Transport accounting separates dispatch rows, actual fetch attempts, and
provider-acknowledged requests. Corrected diagnostics treat provider request
count as actual network attempts and show preserved historical counters
separately when they differ. New rows set `network_dispatch_started` only at the
actual fetch boundary. If fetch is invoked but usage is not captured, the run is
marked `cost_unverified_after_dispatch` and is not safe to resume automatically.
Successful Responses API results are normalized before raw validation or
fallback handling so request IDs, response IDs, status, usage source paths,
token counts, pricing, raw-output outcome, effective-system outcome, and
fallback reason remain separate.

Credential parity hardening uses one canonical resolver for `OPENAI_API_KEY`
and `OPENAI_API_KEY_FILE`. If both sources are configured and differ, live
canary transport fails closed with `credential_source_conflict`. The resolver
rejects embedded whitespace, control characters, non-ASCII characters, BOM or
zero-width characters, surrounding quotes, and malformed prefixes. CLI output
shows only a short non-secret fingerprint prefix. The database stores only the
non-secret fingerprint, source classification, resolver version, and sanitized
attestation metadata.

A paid transport probe requires a non-expired successful credential/model-access
check matching the credential fingerprint, Git commit, approved config hash,
manifest hash, exact model snapshot, hostname, SDK version, and adapter version.
The attestation is short-lived; current validity is 15 minutes.

Reset-heavy smoke tests use `conversational_mcq_live_canary_smoke_e2e` and do
not reset the historical `_live_canary_e2e` database.

Future one-call paid transport probe, only after manual server-side
configuration:

```bash
npm run operational:live-canary:credential-check -- --confirm-network-check
npm run operational:live-canary:transport-probe:preflight
npm run operational:live-canary:transport-environment
npm run operational:live-canary:transport-probe:dry-run
npm run operational:live-canary:transport-probe:verified -- --confirm-network-check --confirm-paid-api
npm run operational:live-canary:transport-probe:diagnose -- --run <run_public_id>
npm run operational:live-canary:transport-probe -- --confirm-paid-api
```

The verified transport-probe command is the preferred operator workflow. It
resolves the credential once, verifies authentication and access to
`gpt-5.4-mini-2026-03-17` with a model metadata request, creates no probe run
if that check fails, and uses the same resolved credential/client path for the
one Responses request. The metadata request is not a model-generation request.

Future full paid command, only after the successful transport probe exists:

```bash
npm run operational:live-canary -- --confirm-paid-api --new-run
npm run operational:live-canary -- --confirm-paid-api --resume <run_public_id>
```

Review/report commands:

```bash
npm run operational:live-canary:inspect -- --run <run_public_id>
npm run operational:live-canary:report -- --run <run_public_id>
npm run operational:live-canary:forensics -- --run <run_public_id>
npm run operational:live-canary:reconcile -- --run <run_public_id>
npm run operational:live-canary:response-audit -- --run <run_public_id>
npm run operational:live-canary:response-replay -- --run <run_public_id>
npm run operational:live-canary:review-export -- --run <run_public_id>
```

The manifest is
`tests/fixtures/operational-live-canary/manifest.json`; it freezes 5 synthetic
students, 1 synthetic teacher, 2 concept units, 8 items, 30 planned logical
invocations, a USD 15 budget cap, and an 80 provider-request cap.

See `docs/GUARDED_LIVE_SYNTHETIC_CANARY.md`,
`docs/OPERATIONAL_LIVE_CANARY_BUDGET.md`,
`docs/OPERATIONAL_LIVE_CANARY_EXECUTION_LIFECYCLE.md`,
`docs/OPERATIONAL_LIVE_CANARY_RECOVERY.md`,
`docs/OPERATIONAL_LIVE_CANARY_TRANSPORT_PROBE.md`,
`docs/OPERATIONAL_LIVE_CANARY_REVIEW.md`, and
`docs/OPERATIONAL_LIVE_CANARY_ACCEPTANCE.md`.

## Phase 8D Private Staging

Private staging is a local, synthetic-only browser walkthrough after the
approved Phase 8C canary `olcr_20260626_j9ilznq`. It uses guarded-live
operational mode for the app and worker, but it is not public deployment and
does not claim classroom validity.

```bash
npm run staging:private:preflight
npm run staging:private:seed
npm run staging:private:start
npm run staging:private:status
npm run staging:private:report
npm run staging:private:cleanup
npm run student:conversational-flow-smoke
```

The app binds to `http://127.0.0.1:3200`. Seeded local-only credentials are:

- teacher: `phase8d_teacher` / `phase8d_teacher_password`
- students: `phase8d_student_01` through `phase8d_student_05`
- shared student access code: `phase8d_student_access_code`

The private staging database must end in `_private_staging`. Roster import
preview and commit are blocked while `PRIVATE_STAGING_MODE=true`; use only the
synthetic accounts. The student assessment page uses a chat-style, one-turn-at-a-time
conversation column with a read-only response record panel. Initial item delivery
is deterministic from persisted item content; no model generates item stems,
options, or answer keys during initial administration. See
`docs/PRIVATE_STAGING_WALKTHROUGH.md`.

## Teacher/Research Session Data Audit

For a redacted, aggregate-only review of one student session's evidence
completeness, run:

```bash
npm run student:session-data-completeness-review
npm run student:session-data-completeness-review -- --session-public-id <session_public_id>
```

The command writes artifacts to `.data/session-data-completeness-review/`.
Teacher/research users can view the same aggregate projection in the teacher
session page under **Session evidence audit**.

The audit reports response-package completeness, process-event inventory,
engagement-evidence availability, activity runtime counts, post-activity
misconception evidence counts, diagnostic snapshot counts, agent-audit metadata
presence, and limitations. It does not expose raw process payloads, raw provider
outputs, answer keys, correct options, correctness labels, raw distractor
metadata, raw misconception IDs, internal database UUIDs, or secrets. Process
data are evidence-quality context only and should not be used alone to infer
misconception, ability, cheating, or misconduct.

Teacher/research bulk exports also include `turn_response_latencies.csv`,
`turn_response_latencies.jsonl`, and `process_events_redacted.jsonl`. Turn
latency is measured from a prompt being shown to the next recorded student
response/action; it is distinct from `item_response_time_ms` and may include
reading, thinking, or idle time. The process-event timeline is payload-free and
does not include raw keystrokes, clipboard text, browser URLs, provider output,
answer keys, correctness labels, or secrets.

Run the no-live integrity QA for the default teacher/research ZIP with:

```bash
npm run student:research-export-integrity-review
npm run student:research-export-integrity-smoke
```

The review command builds the research export, validates required files,
manifest row counts, public-ID joins, data-dictionary coverage, latency values,
engagement process features, correctness-inflation safeguards, and protected
content boundaries, then writes ignored artifacts under
`.data/research-export-integrity-review/`. The companion
`research-analysis-readiness-summary.md` summarizes available datasets, primary
analysis tables, join keys, timing caveats, missing activity/post-activity
evidence, and dissertation limitations.

Default exports remain research-safe. Restricted item keys are excluded unless
an explicit restricted export is requested, and the manifest must record
`restricted_item_keys_included=false` for the default ZIP. Correctness-inflation
fields such as `estimated_guessing_risk`,
`unsupported_correct_response`, and `correctness_support_level` are
teacher/research evidence-quality indicators only. They must not be shown to
students and must not be treated as misconduct, cheating, or direct ability
labels.

## Teacher Mini-Test Builder

Teachers create classroom content through a simplified mini-test workflow:

```text
Folder / Week / Module -> Assessment / Mini test -> MCQ items -> Publish
```

The normal UI no longer asks teachers to choose workflow mode, response
collection mode, or an internal topic before adding items. The assessment detail
page always exposes a direct `Add MCQ item` action while the mini test is
editable. New mini tests use fixed internal defaults (`automatic` workflow and
`llm_assisted` response collection), and the application resolves or creates the
internal topic record required by the student workflow behind the scenes.
The item editor supports continuous authoring: teachers can save an MCQ item and
immediately add another, save and return to the mini-test detail page, or cancel
back to the parent mini test with an unsaved-changes warning. If item order is
left blank, the backend assigns the next available order within the mini test.
The mini-test detail page shows item-count readiness such as `2 of 3 required
MCQ items added` and links each item to edit, teacher preview, and student
preview.

The mini-test form includes a diagnostic focus box:

```text
What misconception, cognitive process, or diagnostic framework does this assessment target?
```

Teacher-authored MCQs in this builder are for initial item administration.
Follow-up, diagnostic contrast, and transfer activities are generated later by
the formative activity flow, not selected from an item-purpose dropdown in the
normal MCQ editor.

The normal item editor keeps diagnostic input intentionally light: teachers may
add a target reasoning note, a strong-reasoning note, and one plain-language
distractor diagnostic note box. Distractor notes are teacher-only interpretation
guidance. A selected distractor is indirect evidence only; internal LLM
interpretation must consider written reasoning, confidence, timing/process
features, revisions, and patterns across responses before treating it as
diagnostically meaningful. Students must not see answer keys, correct options,
raw diagnostic notes, raw distractor metadata, misconception IDs, or internal
labels. JSON import remains available for prepared item sets.

### Assessment lifecycle and deletion

Archive is the normal reversible mini-test lifecycle action. Archived
assessments are hidden from the default teacher library view and can be restored
without deleting historical records. The teacher library supports search by
name/public ID/diagnostic focus/folder, status filters, folder filters,
collapsible folder sections, item/session counts, and sorting by folder order,
recent update, title, or release date.

Permanent assessment deletion is teacher/research-only and lives in the
assessment detail danger zone. `Delete unused assessment` is allowed only for
draft or archived assessments with no student/session/activity records and
requires previewed counts, the exact assessment name or public ID, and `DELETE`.
`Delete all assessment data` is reserved for approved cleanup/withdrawal cases;
it previews associated counts, requires the exact assessment name or public ID,
the exact phrase `DELETE ALL ASSESSMENT DATA`, and a second confirmation, then
removes associated sessions, responses, turns, process events, response
packages, agent summaries, activity evidence, snapshots, items, and topics in a
transaction. The audit record keeps only safe aggregate counts, safe IDs, and
limitations. It does not retain deleted item content, student responses, answer
keys, raw process payloads, provider payloads, credentials, or secrets.

## Assessment Interpretation Context

Production LLM interpretation paths share the server-side
`assessment-interpretation-context-v1` contract. The context binds the
assessment diagnostic focus, administered item snapshots, target/strong
reasoning guidance, distractor diagnostic guidance, interpretation cautions,
student response evidence, safe process summaries, and current interpretation
phase. Teacher notes remain guidance, not ground truth; observed student
evidence takes priority, selected options are indirect evidence only, and
alternative explanations remain required.

The no-live propagation smoke verifies that item administration, profile
integration, formative value selection, formative activity generation/review,
and post-activity response evaluation can receive the shared context without
calling OpenAI:

```bash
npm run student:llm-diagnostic-context-propagation-smoke
```

Agent-call audit metadata stores only safe context proof such as schema version,
snapshot IDs, context hash, and boolean presence flags. It must not store raw
teacher notes, answer keys in student-visible payloads, credentials, prompts,
or provider secrets.

## Teacher-Authored Item Media

Teachers may attach media to MCQ items through the item editor. Supported
authoring types are image, video link, and reference link. Images may be
represented by HTTPS URLs now; uploaded PNG, JPEG, and WebP images are accepted
only through the server-side media storage interface after S3-compatible
storage is configured. SVG files and video binary uploads are not accepted.

Every media asset requires student-facing accessible alt text. Teachers may
also add a separate teacher-only LLM media description for interpretation.
Video links also require a transcript or content summary. Media may attach to
the item stem or to a specific option. Student-facing views render only the
media URL, title, student alt text, caption, transcript/summary, and
attribution. They must not expose teacher-only LLM media descriptions, storage
keys, media hashes, answer keys, correct options, teacher diagnostic notes,
distractor metadata, or provider/audit internals.

LLM interpretation receives `llm_media_context` made from teacher-only media
descriptions, captions, transcripts, summaries, and attribution. Direct
multimodal media is not supplied in this phase, and provider prompts must not
infer unseen media content from URLs alone. Item response snapshots freeze the
media context used at administration time, so later media edits do not rewrite
collected evidence.

Initial teacher-authored MCQs should default toward apply, analyze, and evaluate
tasks. Basic recall is acceptable only when it has clear diagnostic value.
Creation is intentionally reserved for later constructed-response activity
dialogue rather than the initial MCQ item builder.

Relevant no-live checks:

```bash
npm run student:teacher-mcq-media-smoke
npm run student:teacher-mcq-item-builder-smoke
```

## Teacher MCQ Import and Diagnostic Assistant

Teachers can import draft MCQ items directly from a selected mini test through
`Import MCQ items`. Supported sources are CSV, XLSX, Word `.docx`, pasted plain
text, and the existing project JSON item format. A downloadable CSV template is
available from the import page. Old binary `.doc`, macro-enabled `.docm`,
QTI/Canvas packages, and PDF extraction are intentionally not claimed as
implemented.

Import has four separate steps: deterministic extraction, optional formatting
assistance, optional diagnostic suggestion, and teacher approval. Extraction
preserves original item wording and does not silently paraphrase, fill missing
fields, infer an official key, or populate diagnostic notes. DOCX extraction
reads paragraphs, lists, tables, answer-key sections, embedded-image references,
equation/object markers, tracked-change markers, and safe source locations.
Embedded images and equations are flagged for review rather than silently
discarded or sent to the LLM. Draft candidates require only a stem and at least
two options. Missing keys, diagnostic notes, and media stay blank. Imported keys
are stored separately as `imported_key`; an official `correct_option` is
written only when the teacher explicitly confirms or edits the key. Publishing
still requires exactly one valid teacher-confirmed key.

The optional `Help resolve formatting` action is explicit and teacher-triggered.
It is never run during upload, parsing, page load, preview, or automatic batch
processing. In production-like mode it uses the server-side provider
configuration, dedicated model variable `OPENAI_MODEL_MCQ_FORMATTING`, schema
`mcq-import-formatting-suggestion-v1`, and prompt version
`mcq-import-formatting-assistant-prompt-v1`. Formatting proposals preserve
source wording, include source-span mappings, keep missing fields blank, and
remain separate from official candidate data until the teacher accepts, edits,
rejects, or leaves them unresolved. Mock formatting suggestions are test-only.

The optional `Suggest missing diagnostic information` action is explicit and
teacher-triggered. It is never run during upload, parsing, page load, preview,
or automatic batch processing. In production-like mode it uses the server-side
provider configuration, a dedicated model variable
`OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING`, schema
`mcq-diagnostic-authoring-suggestion-v1`, and prompt version
`mcq-diagnostic-authoring-assistant-prompt-v1`. If live configuration is
missing, the teacher sees that suggestions are temporarily unavailable and can
continue reviewing/importing manually; the browser does not receive a mock
suggestion.

The assistant has two modes. `suggest_key` is used only when no
teacher-confirmed key exists and produces an unofficial key suggestion with
limitations. `diagnostic_information` requires a teacher-confirmed key and may
suggest target reasoning, strong-reasoning guidance, plain-language distractor
notes, ambiguity/multiple-key/recall warnings, optional revision guidance,
confidence, and limitations. Suggestions remain separate from item data until
the teacher reviews each field with Accept, Edit and accept, Reject, or Leave
blank. Non-empty teacher-authored fields are not overwritten by default.
Assistant notes are teacher-facing guidance only, not ground truth. They must
include tentative distractor interpretation and alternative explanations such as
partial guessing, misreading, language difficulty, fatigue, random error, low
confidence, and insufficient evidence.

Import provenance is stored in `mcq_item_import_batches`, `agent_calls` for
provider-backed formatting and diagnostic-authoring requests, and item
`administration_rules.import_provenance`, including source type, checksum,
source location, original-source hash, DOCX parser metadata when applicable,
formatting decisions, missing fields, issue flags, suggestion review decisions,
safe agent-call references, provider/model/status/token metadata, and
timestamps. Raw unrestricted provider output remains in the server audit layer
only. Student-facing previews and assessment runtime must not expose imported
keys, teacher diagnostic notes, formatting or diagnostic suggestion payloads,
answer keys, correct options, or provenance metadata. Teachers remain
responsible for copyright, licensing, and permission to use imported test-bank
content.

Import preview hardening includes file-size and row-count limits, safe
filename storage, source checksums, formula-like values treated as text, hidden
sheet warnings, macro workbook rejection, malformed XLSX/DOCX failure before
creating a partial preview batch, ZIP path-traversal and compression checks for
DOCX, and no remote relationship fetching.

No-live checks:

```bash
npm run student:teacher-mcq-import-smoke
npm run student:teacher-mcq-docx-import-smoke
npm run student:teacher-mcq-formatting-assistant-smoke
npm run student:teacher-mcq-formatting-assistant-live-smoke
npm run student:teacher-mcq-diagnostic-assistant-smoke
npm run student:teacher-mcq-diagnostic-assistant-live-smoke
```

The live formatting and diagnostic-assistant smokes are skipped unless their
explicit opt-in variables are set:
`RUN_LIVE_TEACHER_MCQ_FORMATTING_ASSISTANT_SMOKE=1` or
`RUN_LIVE_TEACHER_MCQ_DIAGNOSTIC_ASSISTANT_SMOKE=1`. Live provider variables,
including `OPENAI_MODEL_MCQ_FORMATTING` or
`OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING`, must be configured before those paid
checks run. Normal tests and builds do not make paid authoring calls.

## Teacher Account Management

Teacher/research users sign in with username plus password. Public teacher
forgot-password, email-change, and email-verification flows are disabled for the
classroom pilot; email provider configuration is not required for login,
readiness, or the teacher Account settings UI. Students continue to use
teacher-managed credential reset.

Render pre-deploy must apply migrations before the app serves traffic:

```bash
npm run prisma:migrate:deploy
```

If the deployed teacher username needs to change, rename the existing teacher row
from the final service directory, such as Render Shell `/app`:

```bash
TEACHER_USERNAME_RENAME_ENABLED=true \
CURRENT_TEACHER_USERNAME=teacher_staging_01 \
NEW_TEACHER_USERNAME=edpy507_instructor \
CONFIRM_TEACHER_USERNAME_RENAME=RENAME_TEACHER \
npm run operator:rename-teacher
```

The command updates the same teacher account, preserves the existing password,
role, assessment ownership, student relationships, sessions, responses, and
audit history, increments `auth_version` to invalidate older teacher sessions,
invalidates outstanding account-security tokens, and prints only safe status
fields. Rerunning the same command returns `already_configured` without another
`auth_version` increment or duplicate audit event. After a rename, update
`BOOTSTRAP_TEACHER_USERNAME` to the new username or do not rerun bootstrap; the
bootstrap path must not create a second teacher for the same classroom.

Useful checks:

```bash
npm run operator:teacher-rename-production-smoke
npm run operator:rename-teacher-smoke
npm run student:production-schema-readiness-smoke
npm run operator:production-runtime-smoke
```

## Research Data and Exports

Teacher/research users should use `/teacher/data` then **Research data and
exports** for routine data downloads. The Data and outcomes landing page now has
two normal workflows only:

- Research data and exports
- Summative outcomes

The unified export center has two normal teacher-facing sections:

- Research dataset: one ZIP with `sessions.csv`, `item_responses.csv`,
  `process_events.csv`, `conversation_turns.csv`,
  `agent_activity_records.csv`, `assessment_content.csv`,
  `assessment_summary.csv`, `research_data_dictionary.csv`, and
  `process_event_codebook.csv`.
- Data dictionary: a paginated, collapsed-by-default documentation browser that
  defaults to **Research dataset variables**. It clearly separates Research
  dataset variables, Learning-process event definitions, Internal database
  schema -- Technical, and Excluded platform and security fields -- Not
  exported. The dictionary documents fields; the Research dataset section
  generates actual student/session data. Research-variable browsing shows
  Search, Category, and Page size only. Other dictionary sections show Search
  and Page size only, with a single context-sensitive CSV download for the
  selected section.

The research dictionary uses explicit documentation tiers
`core_research`, `supplementary_research`, `technical_documentation`, and
`excluded_platform`. Core variables are grouped by the shared category registry
documented in `docs/RESEARCH_DATA_FORMAT_DECISIONS.md`, which also records
which datasets remain tabular CSV, which future payloads should be JSONL, and
which union/summary tables are compatibility views rather than independent core
constructs.

Legacy teacher UI routes `/teacher/data/explorer` and `/teacher/data/export`
redirect to the unified export center. Existing authorized CSV and archive API
endpoints remain available for backward compatibility.

Default research dataset exports exclude answer keys, correctness fields, teacher
diagnostic notes, credentials, hashes, raw provider payloads, database URLs,
cookies, and API keys. Restricted research fields require an explicit restricted
export option, explicit confirmation, and a completed export audit record; they
remain teacher/research-only. Null means unavailable, not recorded, not
generated, or not applicable; zero means an instrumented count was evaluated and
the counted event did not occur.

Production research dataset generation requires server-only
`RESEARCH_PSEUDONYMIZATION_KEY` using `hmac_sha256_v1`. Generate it outside the
repo, for example `openssl rand -hex 32`, store it in the deployment provider's
server-side environment, and keep it stable because changing it changes
research pseudonyms. Run `npm run research-export:preflight` after deployment
configuration changes. If readiness is blocked, `/teacher/data/research` keeps
the page visible, preserves filters and Data dictionary access, disables
generation, records a failed retryable export job with a safe typed reason, and
does not navigate to raw API JSON. Session detail includes **Export this
session** for incident analysis; export the session bundle before rerunning
profiling, formative decisions, follow-up rounds, or activity logic.

## Per-Agent OpenAI Model Configuration

The approved operational baseline remains `gpt-5.4-mini-2026-03-17` with
`reasoning_effort=low` and the approved operational configuration hash. Phase
31ad adds server-side per-agent reasoning-effort variables without activating a
new model stack by default. Allowed values are `none`, `low`, `medium`, `high`,
`xhigh`, and `max`; the old `minimal` value is rejected.

The full GPT-5.6 mixed-stack candidate is documented in
`config/candidate-operational-agent-config.gpt-5.6.json`. It is intentionally
preserved as a historical candidate and is not overwritten by the current
rollout work.

The previous minimal rollout candidate is
`config/candidate-operational-agent-config.minimal-live-student-dialogue.json`.
It keeps every existing operational and teacher role on the approved
`gpt-5.4-mini-2026-03-17`/`low` baseline and changes only:

- `student_communication_agent`: `gpt-5.6-terra`, medium effort, 2500 max
  output tokens, live enabled.
- `topic_dialogue_agent`: `gpt-5.6-sol`, medium effort, 3500 max output tokens,
  live enabled.

The minimal candidate fingerprints the role live toggles, provider timeout
(`90000` ms), and topic-dialogue policy: 10 maximum student turns, 12 recent raw
turns, 5000 maximum student-message characters, and assessment-system questions
allowed. It is not approved for student-facing runtime until the model-upgrade
evaluation, student-facing human review, and explicit approval workflow pass. No
normal test or build makes a paid call.

The current full GPT-5.6 evaluation candidate is
`config/candidate-operational-agent-config.gpt-5.6-full-v2.json`. It moves every
covered OpenAI-backed operational, student-facing, teacher-tool, and connectivity
role to a GPT-5.6 family model while preserving the approved GPT-5.4-mini
baseline for rollback. The full-v2 candidate fingerprints every role model,
reasoning effort, token limit, prompt/schema/validator/fallback metadata,
student-facing live toggles, the topic-dialogue policy, provider timeout
(`90000` ms), and provider retry limit (`2`). It is
`candidate_not_approved`; do not set it for classroom use until no-live checks,
paid synthetic evaluation, student-facing human review, and explicit approval
complete.

No-live commands:

```bash
npm run operational:model-upgrade:preflight
npm run operational:model-upgrade:dry-run
npm run operational:model-upgrade:compare
npm run operational:model-upgrade:report
npm run operational:per-agent-reasoning-config-smoke
npm run operational:model-upgrade-evaluation-smoke
npm run operational:minimal-dialogue-candidate-smoke
npm run operational:full-gpt56-v2-candidate-smoke
```

Run the same no-live commands against the full-v2 candidate with:

```bash
npm run operational:model-upgrade:preflight -- --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json
npm run operational:model-upgrade:dry-run -- --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json
npm run operational:model-upgrade:compare -- --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json
npm run operational:model-upgrade:report -- --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json
```

The preserved minimal candidate can still be checked with:

```bash
npm run operational:model-upgrade:preflight -- --manifest config/candidate-operational-agent-config.minimal-live-student-dialogue.json
npm run operational:model-upgrade:dry-run -- --manifest config/candidate-operational-agent-config.minimal-live-student-dialogue.json
npm run operational:model-upgrade:compare -- --manifest config/candidate-operational-agent-config.minimal-live-student-dialogue.json
npm run operational:model-upgrade:report -- --manifest config/candidate-operational-agent-config.minimal-live-student-dialogue.json
```

The guarded live evaluation command skips by default:

```bash
npm run operational:model-upgrade:live-smoke
RUN_LIVE_OPERATIONAL_MODEL_UPGRADE_EVAL=1 npm run operational:model-upgrade:live-eval -- --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json --confirm-paid-api
```

Approval remains explicit and evidence-gated:

```bash
npm run operational:model-upgrade:approve -- \
  --manifest config/candidate-operational-agent-config.gpt-5.6-full-v2.json \
  --candidate-run <run_public_id> \
  --expected-hash <full_v2_candidate_active_configuration_hash> \
  --confirm "approve gpt-5.6 full operational candidate v2"
```

Rollback is environment-only: restore the prior `OPENAI_MODEL_*` values or
remove candidate overrides, restore the previous
`OPERATIONAL_APPROVED_CONFIG_HASH`, redeploy, and verify
`npm run operational:approval-manifest:verify`.

Candidate Render/server variables must be server-only and must match the
approved candidate hash after approval:

```text
OPENAI_REQUEST_TIMEOUT_MS=90000
OPENAI_MAX_RETRIES=2
OPENAI_MODEL_ITEM_VERIFICATION=gpt-5.6-terra
OPENAI_REASONING_EFFORT_ITEM_VERIFICATION=medium
OPENAI_MAX_OUTPUT_TOKENS_ITEM_VERIFICATION=3000
OPENAI_MODEL_ITEM_ADMIN=gpt-5.6-luna
OPENAI_REASONING_EFFORT_ITEM_ADMIN=low
OPENAI_MAX_OUTPUT_TOKENS_ITEM_ADMIN=1200
OPENAI_MODEL_RESPONSE_COLLECTION=gpt-5.6-luna
OPENAI_REASONING_EFFORT_RESPONSE_COLLECTION=low
OPENAI_MAX_OUTPUT_TOKENS_RESPONSE_COLLECTION=1500
OPENAI_MODEL_PROFILING=gpt-5.6-terra
OPENAI_REASONING_EFFORT_PROFILING=medium
OPENAI_MAX_OUTPUT_TOKENS_PROFILING=4000
OPENAI_MODEL_PROFILE_INTEGRATION=gpt-5.6-terra
OPENAI_REASONING_EFFORT_PROFILE_INTEGRATION=medium
OPENAI_MAX_OUTPUT_TOKENS_PROFILE_INTEGRATION=3000
OPENAI_MODEL_PLANNING=gpt-5.6-sol
OPENAI_REASONING_EFFORT_PLANNING=medium
OPENAI_MAX_OUTPUT_TOKENS_PLANNING=3000
OPENAI_MODEL_FORMATIVE_VALUE_DETERMINATION=gpt-5.6-terra
OPENAI_REASONING_EFFORT_FORMATIVE_VALUE_DETERMINATION=medium
OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_VALUE_DETERMINATION=2500
OPENAI_MODEL_FOLLOWUP=gpt-5.6-sol
OPENAI_REASONING_EFFORT_FOLLOWUP=medium
OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP=2500
OPENAI_MODEL_FORMATIVE_ACTIVITY_DIALOGUE=gpt-5.6-sol
OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_DIALOGUE=medium
OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_DIALOGUE=3500
OPENAI_MODEL_FORMATIVE_ACTIVITY_QUALITY_REVIEWER=gpt-5.6-sol
OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_QUALITY_REVIEWER=medium
OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_QUALITY_REVIEWER=2500
OPENAI_MODEL_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR=gpt-5.6-sol
OPENAI_REASONING_EFFORT_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR=medium
OPENAI_MAX_OUTPUT_TOKENS_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR=3000
OPENAI_MODEL_POST_ACTIVITY_EVIDENCE_EVALUATOR=gpt-5.6-sol
OPENAI_REASONING_EFFORT_POST_ACTIVITY_EVIDENCE_EVALUATOR=medium
OPENAI_MAX_OUTPUT_TOKENS_POST_ACTIVITY_EVIDENCE_EVALUATOR=3000
OPENAI_MODEL_STUDENT_COMMUNICATION=gpt-5.6-terra
OPENAI_REASONING_EFFORT_STUDENT_COMMUNICATION=medium
OPENAI_MAX_OUTPUT_TOKENS_STUDENT_COMMUNICATION=2500
OPENAI_MODEL_TOPIC_DIALOGUE=gpt-5.6-sol
OPENAI_REASONING_EFFORT_TOPIC_DIALOGUE=medium
OPENAI_MAX_OUTPUT_TOKENS_TOPIC_DIALOGUE=3500
OPENAI_MODEL_MCQ_DIAGNOSTIC_AUTHORING=gpt-5.6-terra
OPENAI_REASONING_EFFORT_MCQ_DIAGNOSTIC_AUTHORING=medium
OPENAI_MAX_OUTPUT_TOKENS_MCQ_DIAGNOSTIC_AUTHORING=2500
OPENAI_MODEL_MCQ_FORMATTING=gpt-5.6-luna
OPENAI_REASONING_EFFORT_MCQ_FORMATTING=low
OPENAI_MAX_OUTPUT_TOKENS_MCQ_FORMATTING=3000
OPENAI_MODEL_CONNECTIVITY_TEST=gpt-5.6-luna
OPENAI_REASONING_EFFORT_CONNECTIVITY_TEST=none
TOPIC_DIALOGUE_MAX_STUDENT_TURNS=10
TOPIC_DIALOGUE_RECENT_TURN_WINDOW=12
TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS=5000
TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS=true
STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED=true
TOPIC_DIALOGUE_LIVE_CALLS_ENABLED=true
```

## Evidence-Integrated Package Feedback

Phase 31al rebuilds the post-package interpretation around versioned
`EvidenceIntegratedProfileV2`, `PackageFeedbackV2`, and `NextInteractionV2`
artifacts. After the initial three-item package, the student-facing state now
separates scored outcome, assessment-specific understanding, reasoning quality,
confidence calibration, evidence limitations, and one growth target. Correctness
status is shown after the package; full answer-key reveal remains controlled by
the `answer_reveal_policy` stored in concept-unit administration rules or by the
safe default.

The next student action is always represented by a single `NextInteractionV2`
prompt with a matching await state. Distractor-focused work is the default when
the response package shows enough conceptual footing; foundational support is an
exception that requires evidence. The deterministic no-live checks are:

```bash
npm run student:evidence-profile-coherence-smoke
npm run student:evidence-linked-feedback-smoke
npm run student:distractor-first-routing-smoke
npm run student:single-action-state-smoke
npm run student:package-results-and-reveal-smoke
npm run student:incident-profile-routing-regression-smoke
```

## Fact-Locked Student Communication Agent

Phase 31an adds a bounded `student_communication_agent` contract for natural
student-facing wording after the response package facts are frozen. The agent
may improve fluency, transitions, concise profile language, answer-review
wording, and activity instructions. It must not change item correctness,
selected or correct answers, scoring, understanding status, reasoning summary,
confidence interpretation, evidence limitations, growth target, answer-reveal
policy, activity type, source item or option, expected response mode, or runtime
state.

Phase 31ap adds a default-off live provider path for this role. When global LLM
live calls and `STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED=true` are explicitly
configured, the backend may call the server-side OpenAI Responses API with
Structured Outputs and `store:false`. Output still passes fact-lock validators
and student-language scanning before it is persisted or shown. If readiness,
provider execution, schema validation, fact locks, or language checks fail, the
system records a typed fallback and uses bounded deterministic wording instead
of treating fallback output as successful live communication.

Optional server-only variables for a future approved live candidate are:

```text
OPENAI_MODEL_STUDENT_COMMUNICATION
OPENAI_REASONING_EFFORT_STUDENT_COMMUNICATION
OPENAI_MAX_OUTPUT_TOKENS_STUDENT_COMMUNICATION
STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED
```

Candidate values after evaluation approval are `gpt-5.6-terra`, `low`, and
`2500`. Setting these variables before approval changes the operational
extension hash/readiness state but does not by itself approve live production
use. The no-live checks are:

```bash
npm run student:student-communication-agent-smoke
npm run student:student-communication-language-smoke
npm run student:student-communication-live-smoke
```

## Bounded Topic-Centered Dialogue

Phase 31ap keeps the package-feedback narrative in the tutor chat and removes
the persistent right-side student profile/results panel. Administered item
answer review appears once as a tutor-chat card titled `Review your answers`.

After a formative activity response, the backend creates a
`PostActivityLearningDecisionV1`. Responses that are ready to advance show only
valid progression choices. Partial, misconception, foundational, or
insufficient-evidence responses enter a bounded `topic_dialogue_agent` loop tied
to the current topic, concept, administered items, growth target, and activity
response. The default cap is eight student turns with a twelve-turn recent
context window and a 5000-character message limit. Short messages such as
`what` or `about what` are valid clarification requests. Unrelated questions are
redirected, and the browser never calls OpenAI directly.

Phase 31ap adds a default-off live provider path for topic dialogue. When global
LLM live calls and `TOPIC_DIALOGUE_LIVE_CALLS_ENABLED=true` are explicitly
configured, each genuinely new topic-dialogue student message may dispatch one
server-side Structured Outputs call. Refresh, resume, and idempotent replay reuse
persisted records and do not call the provider. Deterministic bounded dialogue
remains the provider-failure/readiness-failure fallback, not the normal live
success path.
No-live checks:

```bash
npm run student:assessment-completed-card-smoke
npm run student:chat-native-results-smoke
npm run student:student-narrative-dedup-smoke
npm run student:student-narrative-language-smoke
npm run student:post-activity-adaptive-routing-smoke
npm run student:topic-centered-dialogue-smoke
npm run student:topic-dialogue-idempotency-smoke
npm run student:topic-dialogue-boundary-smoke
npm run student:topic-dialogue-clarification-smoke
npm run student:student-visible-id-leakage-smoke
npm run student:topic-dialogue-live-smoke
```
