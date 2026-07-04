# Profile and Formative Value Scenario QA

Phase 28a adds a 100-scenario synthetic matrix for checking profile integration and formative value determination before activity planning is implemented.

This QA layer is not classroom validation. It uses scripted synthetic response packages and process-event profiles to exercise boundary cases across ability evidence, engagement evidence, profile integration, formative value selection, and student choice capture.

## Coverage Goals

The scenario matrix includes 17 core scenarios, 18 original variations, and 65 additional synthetic variations. The matrix covers:

- profile integration patterns: `stable_understanding`, `developing_understanding`, `likely_knowledge_gap`, `likely_misconception`, `mixed_or_conflicting_evidence`, `insufficient_evidence`
- student-facing statuses: `Mostly understood`, `Still developing`, `Needs more work`
- engagement categories: `engaged`, `moderately_engaged`, `disengaged`, `insufficient_evidence`
- AI-assistance context signals: `none_indicated`, `likely_external_assistance_pattern`, `insufficient_evidence`
- formative values: `diagnostic_clarification`, `reasoning_refinement`, `confidence_calibration`, `independent_understanding_verification`, `consolidation_and_transfer`
- student choice states: `not_chosen`, `accepted_recommendation`, `chose_alternative`, `moved_on`

The variation layer exercises concise, detailed, vague, uncertainty, low-information, multilingual, typo-heavy, content-question, procedural-question, move-on, edit/revision, answer-change, confidence-change, rapid-sparse, pause/resume, weak focus/paste, likely external-assistance-pattern, insufficient-AI-signal, accept-recommendation, choose-alternative, and move-on behaviors. It is intentionally not a full cross-product.

## No-Live Scenario Smoke

Run deterministic regression coverage with:

```bash
npm run student:profile-formative-scenario-smoke
```

This command makes no OpenAI calls. It builds ability evidence, engagement evidence, profile integration input, and formative value input from synthetic scripts, then validates expected outcomes, variation coverage, QA rubrics, and safety constraints.

Artifacts are written under:

```text
.data/profile-formative-scenario-smoke/
```

The smoke fails if any required formative value category or other required coverage category is missing, if every core scenario does not have at least one variation, or if the minimum variation coverage counts are not met.

## Paid Live Scenario Trials

Run provider-backed scenario trials intentionally with:

```bash
PROFILE_FORMATIVE_TRIAL_BUDGET_USD=10 \
MAX_LIVE_PROFILE_FORMATIVE_TRIALS=100 \
npm run student:profile-formative-live-trials
```

This command is paid-live by default. It must be run intentionally and only after local live readiness is configured. It prints a paid-call warning, checks readiness, refuses to silently fall back to deterministic mode, and records redacted artifacts under a timestamped run directory:

```text
.data/profile-formative-live-trials/run-<timestamp>-live/
```

Staged live execution is recommended for safety:

```bash
PROFILE_FORMATIVE_TRIAL_BUDGET_USD=10 \
MAX_LIVE_PROFILE_FORMATIVE_TRIALS=10 \
PROFILE_FORMATIVE_TRIAL_CANARY=true \
npm run student:profile-formative-live-trials
```

The 10-scenario canary is a cross-coverage sample across formative values, profile patterns, engagement categories, student choice, multilingual or typo evidence, and process/AI-context evidence. If the canary shows no systemic provider/schema/safety issue, run the full 100-scenario matrix.

Cost and selection controls:

```bash
MAX_LIVE_PROFILE_FORMATIVE_TRIALS=5 \
PROFILE_FORMATIVE_TRIAL_SCENARIOS=knowledge_gap_low_confidence,misconception_with_diagnostic_evidence \
npm run student:profile-formative-live-trials
```

By default, the live command can run the full 100-scenario matrix. The approved budget cap for this QA phase can be set with:

```bash
PROFILE_FORMATIVE_TRIAL_BUDGET_USD=10 npm run student:profile-formative-live-trials
```

Filtering supports stable scenario IDs and variation tags:

```bash
PROFILE_FORMATIVE_TRIAL_VARIATIONS=content_question,edit_revision npm run student:profile-formative-live-trials
```

If token pricing is supplied server-side through `PROFILE_FORMATIVE_TRIAL_INPUT_PRICE_PER_MILLION_USD` and `PROFILE_FORMATIVE_TRIAL_OUTPUT_PRICE_PER_MILLION_USD`, the summary includes an estimated cost and stops when the configured budget cap is reached. If pricing is not supplied, the harness reports token usage and relies on the trial caps. Cost estimates are not invoice-exact.

Dry-run or no-live checks:

```bash
PROFILE_FORMATIVE_TRIAL_DRY_RUN=true npm run student:profile-formative-live-trials
PROFILE_FORMATIVE_TRIAL_NO_LIVE=true npm run student:profile-formative-live-trials
```

The live harness records scenario IDs, variation metadata, expected and actual profile/status/engagement/value outcomes, provider-versus-effective category summaries, agent call status, provider metadata presence, token usage presence, QA rubric results, safety checks, fallback/repair/canonicalization use, safe provider-failure diagnostics, request-shape keys, and redacted transcript-safety summaries. It must not include raw prompts, raw provider outputs, answer keys, distractor metadata, raw process payloads, API keys, or secrets.

Profile-integration live repair outputs may be safety-canonicalized before strict validation when the only problem is unsupported internal wording such as integrity/authenticity/provenance language or internal "correct option" phrasing. The raw provider result remains in audit metadata; only the persisted effective packet is canonicalized and then revalidated.

Formative-value live outputs remain subject to backend precedence. When the profile evidence has an explicit adequate-understanding underconfidence signal, the effective primary value is canonicalized to `confidence_calibration` if the live model selects a weaker adjacent value. Boundary scenarios may declare explicit allowed alternatives for profile/status/value outcomes, but safety and schema failures are never accepted as alternatives.

Live result categories are:

- `direct_live_success`
- `passed_after_repair`
- `passed_after_canonicalization`
- `passed_after_provider_retry`
- `accepted_allowed_alternative`
- `scenario_expectation_updated_after_adjudication`
- `blocked_provider_quota`
- `infrastructure_transient`
- `failed_validation`
- `failed_provider_request`
- `failed_outcome_mismatch`
- `failed_safety`
- `failed_fallback_used`

`blocked_provider_quota` is used only when the provider reports a non-retryable quota block such as HTTP 429 with `insufficient_quota` / `openai_quota_exceeded`. A quota-blocked scenario is infrastructure-blocked, not a profile or formative-value model-quality failure, because no valid provider output exists. When quota exhaustion is detected, the live runner stops immediately, writes skipped records for remaining planned scenarios as `not_run_provider_quota_block`, and marks the run `blocked_provider_quota`. Restore quota or billing before rerunning the full matrix.

Retry behavior is bounded. The live QA runner retries exactly once for retryable provider timeout or network transient failures, records `retry_count`, preserves the first failure, and classifies a successful retry as `passed_after_provider_retry`. It does not retry safety failures, schema/validator failures, quota blocks, semantic outcome mismatches, or fallback-used failures.

Each live run writes:

```text
.data/profile-formative-live-trials/run-<timestamp>-live/<scenario_id>.json
.data/profile-formative-live-trials/run-<timestamp>-live/summary-<timestamp>.json
.data/profile-formative-live-trials/run-<timestamp>-live/error-analysis-<timestamp>.json
```

Dry-run and no-live modes use the same run-directory pattern with `dry-run` or `no-live` in the directory name.

## Offline Trial Review

Run the no-live artifact reviewer with:

```bash
npm run student:profile-formative-trial-review
npm run student:profile-formative-trial-review -- --latest-run
npm run student:profile-formative-trial-review -- --latest-full-run
npm run student:profile-formative-trial-review -- --run-id <run-id>
npm run student:profile-formative-trial-review -- --all-runs
```

By default this reviewer is deterministic and does not call OpenAI. It reads only redacted artifacts and writes a safe review artifact under:

```text
.data/profile-formative-trial-review/
```

By default, the reviewer selects the latest retained live run when one exists and does not mix older retained failures into the current review. `--latest-run` reviews the latest retained live run. `--latest-full-run` reviews the latest retained live run whose summary records exactly 100 live scenarios and exactly 100 scenario IDs, so coverage is calculated within one full matrix run rather than stitched from targeted reruns or no-live artifacts. `--run-id` reviews one retained run. `--all-runs` is the only mode that includes historical retained runs. If no live run exists, the reviewer can fall back to current no-live smoke artifacts. An LLM-based offline reviewer is intentionally disabled unless a later phase explicitly implements and authorizes it.

The reviewer separates quota-blocked and provider-blocked artifacts from model-quality findings. It also recomputes adjudication from redacted expected/actual/effective fields so retained live artifacts do not need to be mutated when a boundary mismatch is later classified as an allowed alternative. A quota-blocked run reports `provider_blocking_findings`, `final_live_qa_acceptance=false`, and `rerun_required_after_quota_restored=true`; it must not be used as final live QA evidence. Safety findings are still reported independently if any artifact contains a student-facing safety violation.

## Interpreting Mismatches

A mismatch must be adjudicated before it is treated as a true system failure. Primary adjudication labels are:

- `true_model_logic_failure`
- `true_system_logic_failure`
- `scenario_expectation_too_rigid`
- `scenario_evidence_does_not_support_target`
- `allowed_alternative_defensible`
- `harness_evaluation_bug`
- `infrastructure_transient`
- `provider_request_failure`
- `safety_failure`
- `validator_failure`

Allowed alternatives should be encoded only where the evidence genuinely supports ambiguity. For example, a profile subtype mismatch may be accepted when the effective formative value and student-facing status remain conservative and safe. Deterministic fallback must not count as live success.

## Adding A Scenario

Add a stable `scenario_id` to `prisma/student-profile-formative-scenarios.ts` with:

- target profile/status/engagement/AI signal/formative value
- explicit allowed alternatives when justified
- optional `variation_id`, `base_scenario_id`, and `variation_tags` when adding targeted conversation/process variations
- synthetic response package
- confidence and tempting-option pattern
- process-event profile
- safety constraints
- rationale

Use scripted responses so scenario intent remains reproducible across no-live and live runs.

## Limits

One live run is diagnostic evidence, not proof of classroom validity. The harness does not implement activity planning, activity generation, teacher upload, or new item content.
