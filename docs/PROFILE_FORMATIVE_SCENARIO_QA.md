# Profile and Formative Value Scenario QA

Phase 28a adds a synthetic scenario matrix for checking profile integration and formative value determination before activity planning is implemented.

This QA layer is not classroom validation. It uses scripted synthetic response packages and process-event profiles to exercise boundary cases across ability evidence, engagement evidence, profile integration, formative value selection, and student choice capture.

## Coverage Goals

The scenario matrix covers:

- profile integration patterns: `stable_understanding`, `developing_understanding`, `likely_knowledge_gap`, `likely_misconception`, `mixed_or_conflicting_evidence`, `insufficient_evidence`
- student-facing statuses: `Mostly understood`, `Still developing`, `Needs more work`
- engagement categories: `engaged`, `moderately_engaged`, `disengaged`, `insufficient_evidence`
- AI-assistance context signals: `none_indicated`, `likely_external_assistance_pattern`, `insufficient_evidence`
- formative values: `diagnostic_clarification`, `reasoning_refinement`, `confidence_calibration`, `independent_understanding_verification`, `consolidation_and_transfer`
- student choice states: `not_chosen`, `accepted_recommendation`, `chose_alternative`, `moved_on`

## No-Live Scenario Smoke

Run deterministic regression coverage with:

```bash
npm run student:profile-formative-scenario-smoke
```

This command makes no OpenAI calls. It builds ability evidence, engagement evidence, profile integration input, and formative value input from synthetic scripts, then validates expected outcomes and safety constraints.

Artifacts are written under:

```text
.data/profile-formative-scenario-smoke/
```

The smoke fails if any required formative value category or other required coverage category is missing.

## Paid Live Scenario Trials

Run provider-backed scenario trials with:

```bash
npm run student:profile-formative-live-trials
```

This command is paid-live by default. It must be run intentionally and only after local live readiness is configured. It prints a paid-call warning, checks readiness, refuses to silently fall back to deterministic mode, and records redacted artifacts under:

```text
.data/profile-formative-live-trials/
```

Cost and selection controls:

```bash
MAX_LIVE_PROFILE_FORMATIVE_TRIALS=5 \
PROFILE_FORMATIVE_TRIAL_SCENARIOS=knowledge_gap_low_confidence,misconception_with_diagnostic_evidence \
npm run student:profile-formative-live-trials
```

Dry-run or no-live checks:

```bash
PROFILE_FORMATIVE_TRIAL_DRY_RUN=true npm run student:profile-formative-live-trials
PROFILE_FORMATIVE_TRIAL_NO_LIVE=true npm run student:profile-formative-live-trials
```

The live harness records scenario IDs, expected and actual profile/status/engagement/value outcomes, agent call status, provider metadata presence, token usage presence, safety checks, fallback/repair use, and redacted transcript-safety summaries. It must not include raw prompts, raw provider outputs, answer keys, distractor metadata, raw process payloads, API keys, or secrets.

## Offline Trial Review

Run the no-live artifact reviewer with:

```bash
npm run student:profile-formative-trial-review
```

By default this reviewer is deterministic and does not call OpenAI. It reads only redacted artifacts and writes a safe review artifact under:

```text
.data/profile-formative-trial-review/
```

An LLM-based offline reviewer is intentionally disabled unless a later phase explicitly implements and authorizes it.

## Interpreting Mismatches

A mismatch should be classified as one of:

- scenario design issue
- evidence packet issue
- engagement classification issue
- profile integration issue
- formative value determination issue
- conversation flow issue
- safety validator issue

Allowed alternatives should be encoded only where the evidence genuinely supports ambiguity. Deterministic fallback must not count as live success.

## Adding A Scenario

Add a stable `scenario_id` to `prisma/student-profile-formative-scenarios.ts` with:

- target profile/status/engagement/AI signal/formative value
- explicit allowed alternatives when justified
- synthetic response package
- confidence and tempting-option pattern
- process-event profile
- safety constraints
- rationale

Use scripted responses so scenario intent remains reproducible across no-live and live runs.

## Limits

One live run is diagnostic evidence, not proof of classroom validity. The harness does not implement activity planning, activity generation, teacher upload, or new item content.
