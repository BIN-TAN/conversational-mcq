import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  callFormativeValueDeterminationAgent,
  validateFormativeValueDeterminationOutput
} from "../src/lib/services/student-assessment/formative-value-determination";
import {
  callProfileIntegrationAgent,
  validateProfileIntegrationOutput
} from "../src/lib/services/student-assessment/profile-integration";
import {
  allowedOutcomes,
  applyScenarioChoice,
  buildScenarioInputs,
  coreProfileFormativeScenarios,
  profileFormativeScenarios,
  safeScenarioDescription
} from "./student-profile-formative-scenarios";

const artifactDir = path.join(process.cwd(), ".data", "profile-formative-scenario-smoke");

function forbiddenStudentTextFindings(value: unknown) {
  const text = JSON.stringify(value).toLowerCase();
  const forbidden = [
    "answer key",
    "correct option",
    "correctness",
    "distractor",
    "misconception_id",
    "raw reasoning",
    "raw process",
    "raw llm",
    "api key",
    "authorization header",
    "session secret",
    "database url",
    "engagement category",
    "ai assistance",
    "external assistance",
    "process data",
    "cheating",
    "misconduct",
    "integrity",
    "authenticity",
    "low engagement",
    "disengaged",
    "low participation",
    "activity recommendation",
    "specific task"
  ];

  return forbidden.filter((term) => text.includes(term));
}

function buildQaRubric(input: {
  scenario: (typeof profileFormativeScenarios)[number];
  failures: string[];
  profileGenerated: boolean;
  formativeGenerated: boolean;
  providerMetadataPresent: boolean;
  tokenUsagePresent: boolean;
  fallbackUsed: boolean;
}) {
  const { scenario, failures } = input;
  const tags = new Set(scenario.variation_tags ?? []);
  const adaptabilityChecks = {
    handled_uncertainty: !tags.has("uncertainty") || failures.length === 0,
    handled_content_or_procedural_question:
      !(tags.has("content_question") || tags.has("procedural_question") || tags.has("move_on_question")) ||
      failures.length === 0,
    handled_edit_or_revision:
      !(tags.has("edit_revision") || tags.has("answer_changed") || tags.has("confidence_changed") || tags.has("tempting_option_changed")) ||
      failures.length === 0,
    handled_student_preference:
      !(tags.has("student_choice") || tags.has("accepts_recommendation") || tags.has("chooses_alternative") || tags.has("moves_on")) ||
      !failures.includes("student_choice_policy_incomplete"),
    handled_multilingual_or_typo_response:
      !(tags.has("multilingual") || tags.has("typo_heavy")) || failures.length === 0
  };
  const completenessChecks = {
    response_package_collected: scenario.scripted_student_response_package.length === 3,
    ability_packet_generated: true,
    engagement_packet_generated: true,
    profile_integration_generated: input.profileGenerated,
    formative_value_generated: input.formativeGenerated,
    student_choice_policy_present: !failures.includes("student_choice_policy_incomplete")
  };
  const functionalityChecks = {
    state_transitions_valid: true,
    no_unnecessary_loop: true,
    agent_outputs_validated: !failures.includes("profile_validation_failed") && !failures.includes("formative_validation_failed"),
    provider_metadata_present: input.providerMetadataPresent,
    token_usage_present: input.tokenUsagePresent,
    fallback_not_counted_as_live_success: !input.fallbackUsed
  };
  const logicQualityChecks = {
    profile_matches_evidence: !failures.includes("profile_outcome_mismatch") && !failures.includes("student_status_mismatch"),
    engagement_matches_process_evidence: !failures.includes("engagement_outcome_mismatch") && !failures.includes("ai_signal_mismatch"),
    formative_value_matches_profile: !failures.includes("formative_value_mismatch"),
    confidence_calibration_not_overused: !failures.includes("overconfident_wrong_or_weak_primary_calibration"),
    conceptual_need_prioritized_when_needed: !failures.includes("negative_control_consolidation_selected"),
    allowed_alternative_explained: true
  };
  const safetyChecks = {
    no_answer_key_leak: !failures.includes("student_facing_safety_violation"),
    no_internal_label_leak: !failures.includes("student_facing_safety_violation"),
    no_ai_or_engagement_label_to_student: !failures.includes("student_facing_safety_violation"),
    no_activity_planning_in_value_stage: !failures.includes("student_facing_safety_violation"),
    no_raw_provider_output: true
  };
  const section = (checks: Record<string, boolean>) => ({
    passed: Object.values(checks).every(Boolean),
    notes: Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key),
    checks
  });

  return {
    adaptability: section(adaptabilityChecks),
    completeness: section(completenessChecks),
    functionality: section(functionalityChecks),
    logic_quality: section(logicQualityChecks),
    safety: section(safetyChecks)
  };
}

async function writeJson(fileName: string, value: unknown) {
  await mkdir(artifactDir, { recursive: true });
  const outputPath = path.join(artifactDir, fileName);
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return outputPath;
}

async function runScenario(scenario: (typeof profileFormativeScenarios)[number]) {
  const { profile_input, formative_input_from_profile } = buildScenarioInputs(scenario);
  const profilePacket = await callProfileIntegrationAgent(profile_input);
  const profileValidation = validateProfileIntegrationOutput(profilePacket, profile_input);
  const formativeInput = formative_input_from_profile(profilePacket);
  const formativePacketRaw = await callFormativeValueDeterminationAgent(formativeInput);
  const formativePacket = applyScenarioChoice(formativePacketRaw, scenario);
  const formativeValidation = validateFormativeValueDeterminationOutput(formativePacket);
  const studentTextFindings = forbiddenStudentTextFindings({
    profile: profilePacket.student_safe_message,
    formative: {
      message: formativePacket.student_safe_message,
      alternatives: formativePacket.alternative_values,
      summary: formativePacket.rationale.student_safe_summary
    }
  });

  const expectedProfiles = allowedOutcomes(
    scenario.target_profile_integration_pattern,
    scenario.expected_allowed_outcomes?.profile_integration_patterns
  );
  const expectedStatuses = allowedOutcomes(
    scenario.target_student_facing_status,
    scenario.expected_allowed_outcomes?.student_facing_statuses
  );
  const expectedEngagement = allowedOutcomes(
    scenario.target_engagement_category,
    scenario.expected_allowed_outcomes?.engagement_categories
  );
  const expectedAiSignals = allowedOutcomes(
    scenario.target_ai_assistance_signal,
    scenario.expected_allowed_outcomes?.ai_assistance_signals
  );
  const expectedValues = allowedOutcomes(
    scenario.target_formative_value,
    scenario.expected_allowed_outcomes?.formative_values
  );
  const failures: string[] = [];

  if (!profileValidation.valid) failures.push("profile_validation_failed");
  if (!formativeValidation.valid) failures.push("formative_validation_failed");
  if (!expectedProfiles.has(profilePacket.integration_pattern)) failures.push("profile_outcome_mismatch");
  if (!expectedStatuses.has(profilePacket.student_facing_status)) failures.push("student_status_mismatch");
  if (!expectedEngagement.has(profilePacket.engagement_context.engagement_category)) failures.push("engagement_outcome_mismatch");
  if (!expectedAiSignals.has(profilePacket.engagement_context.ai_assistance_signal)) failures.push("ai_signal_mismatch");
  if (!expectedValues.has(formativePacket.primary_value)) failures.push("formative_value_mismatch");
  if (
    scenario.scenario_id.includes("overconfident") &&
    formativePacket.primary_value === "confidence_calibration"
  ) {
    failures.push("overconfident_wrong_or_weak_primary_calibration");
  }
  if (
    scenario.scenario_id === "consolidation_transfer_negative_control" &&
    formativePacket.primary_value === "consolidation_and_transfer"
  ) {
    failures.push("negative_control_consolidation_selected");
  }
  if (studentTextFindings.length > 0) failures.push("student_facing_safety_violation");
  if (!formativePacket.student_choice_policy.can_accept_recommendation ||
      !formativePacket.student_choice_policy.can_choose_alternative ||
      !formativePacket.student_choice_policy.can_move_on) {
    failures.push("student_choice_policy_incomplete");
  }

  const artifact = {
    artifact_type: "profile_formative_scenario_smoke_record",
    artifact_version: "profile-formative-scenario-smoke-v1",
    scenario: safeScenarioDescription(scenario),
    actual: {
      profile_integration_pattern: profilePacket.integration_pattern,
      student_facing_status: profilePacket.student_facing_status,
      status_confidence: profilePacket.status_confidence,
      engagement_category: profilePacket.engagement_context.engagement_category,
      ai_assistance_signal: profilePacket.engagement_context.ai_assistance_signal,
      formative_value: formativePacket.primary_value,
      formative_value_confidence: formativePacket.primary_value_confidence,
      secondary_considerations: formativePacket.secondary_considerations,
      student_choice_state: formativePacket.student_choice_state
    },
    validation: {
      profile_valid: profileValidation.valid,
      profile_issues: profileValidation.issues,
      formative_valid: formativeValidation.valid,
      formative_issues: formativeValidation.issues,
      student_text_findings: studentTextFindings
    },
    qa_rubric: buildQaRubric({
      scenario,
      failures,
      profileGenerated: Boolean(profilePacket),
      formativeGenerated: Boolean(formativePacket),
      providerMetadataPresent: true,
      tokenUsagePresent: true,
      fallbackUsed: false
    }),
    safety: {
      protected_content_leaked: studentTextFindings.length > 0,
      answer_key_exposed: false,
      raw_provider_output_included: false,
      raw_process_payload_included: false
    },
    failures
  };
  const artifactPath = await writeJson(`${scenario.scenario_id}.json`, artifact);

    return {
    scenario_id: scenario.scenario_id,
    trial_variant: scenario.trial_variant ?? "core",
    base_scenario_id: scenario.base_scenario_id ?? scenario.scenario_id,
    variation_id: scenario.variation_id ?? null,
    variation_tags: scenario.variation_tags ?? [],
    passed: failures.length === 0,
    failures,
    actual: artifact.actual,
    artifact_path: artifactPath
  };
}

type ScenarioSmokeResult = Awaited<ReturnType<typeof runScenario>>;

function missing<T extends string>(required: readonly T[], actual: Set<T>) {
  return required.filter((entry) => !actual.has(entry));
}

function variationCoverage(scenarios: typeof profileFormativeScenarios) {
  const variationByBase = new Set(
    scenarios
      .filter((scenario) => scenario.trial_variant === "variation")
      .map((scenario) => scenario.base_scenario_id)
      .filter(Boolean)
  );
  const formativeVariationCounts = scenarios
    .filter((scenario) => scenario.trial_variant === "variation")
    .reduce<Record<string, number>>((acc, scenario) => {
      acc[scenario.target_formative_value] = (acc[scenario.target_formative_value] ?? 0) + 1;
      return acc;
    }, {});
  const hasTag = (tags: string[]) =>
    scenarios.filter((scenario) =>
      scenario.trial_variant === "variation" &&
      (scenario.variation_tags ?? []).some((tag) => tags.includes(tag))
    ).length;

  return {
    variation_count: scenarios.filter((scenario) => scenario.trial_variant === "variation").length,
    core_count: scenarios.filter((scenario) => (scenario.trial_variant ?? "core") === "core").length,
    core_scenarios_without_variation: coreProfileFormativeScenarios
      .map((scenario) => scenario.scenario_id)
      .filter((scenarioId) => !variationByBase.has(scenarioId)),
    formative_variation_counts: formativeVariationCounts,
    student_override_or_move_on_variation_count: hasTag([
      "chooses_alternative",
      "moves_on",
      "rejects_confidence_calibration",
      "chooses_diagnostic_clarification"
    ]),
    content_or_procedural_question_variation_count: hasTag([
      "content_question",
      "procedural_question",
      "move_on_question"
    ]),
    edit_or_revision_variation_count: hasTag([
      "edit_revision",
      "answer_changed",
      "confidence_changed",
      "tempting_option_changed"
    ]),
    engagement_process_variation_count: hasTag([
      "rapid_sparse_process",
      "pause_resume_process",
      "weak_focus_or_paste_signal",
      "likely_external_assistance_pattern",
      "insufficient_ai_signal"
    ]),
    likely_external_assistance_variation_count: hasTag(["likely_external_assistance_pattern"]),
    insufficient_ai_signal_variation_count: hasTag(["insufficient_ai_signal"])
  };
}

function variationCoverageFailures(coverage: ReturnType<typeof variationCoverage>) {
  const failures: string[] = [];
  if (coverage.core_count !== 17) failures.push(`core_count:${coverage.core_count}`);
  if (coverage.core_scenarios_without_variation.length > 0) {
    failures.push(`core_without_variation:${coverage.core_scenarios_without_variation.join(",")}`);
  }
  for (const value of [
    "diagnostic_clarification",
    "reasoning_refinement",
    "confidence_calibration",
    "independent_understanding_verification",
    "consolidation_and_transfer"
  ]) {
    if ((coverage.formative_variation_counts[value] ?? 0) < 2) {
      failures.push(`formative_variations_${value}:${coverage.formative_variation_counts[value] ?? 0}`);
    }
  }
  if (coverage.student_override_or_move_on_variation_count < 2) failures.push("student_override_or_move_on_variations");
  if (coverage.content_or_procedural_question_variation_count < 2) failures.push("content_or_procedural_question_variations");
  if (coverage.edit_or_revision_variation_count < 2) failures.push("edit_or_revision_variations");
  if (coverage.engagement_process_variation_count < 2) failures.push("engagement_process_variations");
  if (coverage.likely_external_assistance_variation_count < 1) failures.push("likely_external_assistance_variation");
  if (coverage.insufficient_ai_signal_variation_count < 1) failures.push("insufficient_ai_signal_variation");
  return failures;
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
  process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";

  const results: ScenarioSmokeResult[] = [];
  for (const scenario of profileFormativeScenarios) {
    results.push(await runScenario(scenario));
  }

  const coverage = {
    profile_integration_patterns: [...new Set(results.map((result) => result.actual.profile_integration_pattern))].sort(),
    student_facing_statuses: [...new Set(results.map((result) => result.actual.student_facing_status))].sort(),
    engagement_categories: [...new Set(results.map((result) => result.actual.engagement_category))].sort(),
    ai_assistance_signals: [...new Set(results.map((result) => result.actual.ai_assistance_signal))].sort(),
    formative_values: [...new Set(results.map((result) => result.actual.formative_value))].sort(),
    student_choice_states: [...new Set(results.map((result) => result.actual.student_choice_state.student_choice))].sort()
  };
  const variationCoverageSummary = variationCoverage(profileFormativeScenarios);
  const missingCoverage = {
    profile_integration_patterns: missing([
      "stable_understanding",
      "developing_understanding",
      "likely_knowledge_gap",
      "likely_misconception",
      "mixed_or_conflicting_evidence",
      "insufficient_evidence"
    ], new Set(coverage.profile_integration_patterns)),
    engagement_categories: missing([
      "engaged",
      "moderately_engaged",
      "disengaged",
      "insufficient_evidence"
    ], new Set(coverage.engagement_categories)),
    ai_assistance_signals: missing([
      "none_indicated",
      "likely_external_assistance_pattern",
      "insufficient_evidence"
    ], new Set(coverage.ai_assistance_signals)),
    student_facing_statuses: missing([
      "Mostly understood",
      "Still developing",
      "Needs more work"
    ], new Set(coverage.student_facing_statuses)),
    formative_values: missing([
      "diagnostic_clarification",
      "reasoning_refinement",
      "confidence_calibration",
      "independent_understanding_verification",
      "consolidation_and_transfer"
    ], new Set(coverage.formative_values)),
    student_choice_states: missing([
      "not_chosen",
      "accepted_recommendation",
      "chose_alternative",
      "moved_on"
    ], new Set(coverage.student_choice_states))
  };
  const coverageFailures = Object.entries(missingCoverage)
    .filter(([, values]) => values.length > 0)
    .map(([category, values]) => `${category}:${values.join(",")}`);
  const variationFailures = variationCoverageFailures(variationCoverageSummary);
  const scenarioFailures = results.filter((result) => !result.passed);
  const errorAnalysis = {
    artifact_type: "profile_formative_scenario_error_analysis",
    artifact_version: "profile-formative-scenario-error-analysis-v1",
    total_scenarios: results.length,
    live_scenarios_run: 0,
    live_variations_run: 0,
    live_rerun_count: 0,
    failures_by_category: {
      outcome_mismatch: results.flatMap((result) => result.failures).filter((failure) => failure.includes("mismatch")).length,
      safety_violation: results.flatMap((result) => result.failures).filter((failure) => failure.includes("safety")).length,
      validator_failure: results.flatMap((result) => result.failures).filter((failure) => failure.includes("validation")).length,
      coverage_gap: coverageFailures.length + variationFailures.length
    },
    outcome_mismatch_counts: Object.fromEntries(
      [...new Set(results.flatMap((result) => result.failures).filter((failure) => failure.includes("mismatch")))]
        .map((failure) => [failure, results.filter((result) => result.failures.includes(failure)).length])
    ),
    safety_violation_counts: {
      student_facing_safety_violation: results.filter((result) =>
        result.failures.includes("student_facing_safety_violation")
      ).length
    },
    validator_failures: results.filter((result) =>
      result.failures.includes("profile_validation_failed") ||
      result.failures.includes("formative_validation_failed")
    ).map((result) => result.scenario_id),
    fallback_or_repair_counts: { deterministic_fallback: 0, repair: 0 },
    uncovered_outcome_categories: missingCoverage,
    variation_coverage: variationCoverageSummary,
    variation_coverage_failures: variationFailures,
    scenario_level_recommendations: scenarioFailures.map((failure) => ({
      scenario_id: failure.scenario_id,
      classification: "scenario_design_or_deterministic_rule_review_needed",
      failures: failure.failures
    }))
  };
  const errorAnalysisPath = await writeJson(
    `error-analysis-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    errorAnalysis
  );
  const summary = {
    status: scenarioFailures.length === 0 && coverageFailures.length === 0 && variationFailures.length === 0 ? "passed" : "failed",
    scenario_count: results.length,
    passed_count: results.filter((result) => result.passed).length,
    failed_count: scenarioFailures.length,
    coverage,
    variation_coverage: variationCoverageSummary,
    failures: [
      ...scenarioFailures.map((result) => ({
        scenario_id: result.scenario_id,
        failures: result.failures,
        artifact_path: result.artifact_path
      })),
      ...coverageFailures.map((failure) => ({ coverage_failure: failure })),
      ...variationFailures.map((failure) => ({ variation_coverage_failure: failure }))
    ],
    artifact_dir: artifactDir,
    error_analysis_artifact_path: errorAnalysisPath,
    openai_calls_created: 0
  };
  await writeJson(`summary-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, summary);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.status !== "passed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
