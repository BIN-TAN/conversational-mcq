import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { getServerEnv } from "../src/lib/env";
import { getLlmRuntimeConfig, LlmConfigurationError } from "../src/lib/llm/config";
import {
  callFormativeValueDeterminationAgent,
  executeLiveFormativeValueDeterminationAgent,
  validateFormativeValueDeterminationOutput
} from "../src/lib/services/student-assessment/formative-value-determination";
import {
  callProfileIntegrationAgent,
  executeLiveProfileIntegrationAgent,
  validateProfileIntegrationOutput
} from "../src/lib/services/student-assessment/profile-integration";
import {
  allowedOutcomes,
  applyScenarioChoice,
  buildScenarioInputs,
  profileFormativeScenarios,
  safeScenarioDescription,
  selectedScenariosFromList
} from "./student-profile-formative-scenarios";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const artifactDir = path.join(process.cwd(), ".data", "profile-formative-live-trials");

function boolEnv(name: string) {
  return process.env[name] === "true";
}

function intEnv(name: string) {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function envPresent(name: string) {
  return typeof process.env[name] === "string" && process.env[name]?.trim().length > 0;
}

function modelConfigured() {
  return envPresent("OPENAI_MODEL_PROFILE_INTEGRATION") ||
    envPresent("OPENAI_MODEL_PLANNING") ||
    envPresent("OPENAI_MODEL_FOLLOWUP");
}

function liveReadiness() {
  try {
    const runtime = getLlmRuntimeConfig();
    const env = getServerEnv();
    const missing: string[] = [];

    if (runtime.provider !== "openai") missing.push("LLM_PROVIDER");
    if (!runtime.live_calls_enabled) missing.push("LLM_LIVE_CALLS_ENABLED");
    if (!runtime.openai_key_configured) missing.push("OPENAI_API_KEY_OR_FILE");
    if (!modelConfigured()) {
      missing.push("OPENAI_MODEL_PROFILE_INTEGRATION_OR_PLANNING_OR_FOLLOWUP");
    }

    return {
      ready: missing.length === 0,
      provider: runtime.provider,
      live_calls_enabled: runtime.live_calls_enabled,
      credential_configured: runtime.openai_key_configured,
      model_configured: modelConfigured(),
      request_timeout_ms: runtime.request_timeout_ms,
      max_retries: runtime.max_retries,
      configured_model_variable_names: [
        env.OPENAI_MODEL_PROFILE_INTEGRATION ? "OPENAI_MODEL_PROFILE_INTEGRATION" : null,
        env.OPENAI_MODEL_PLANNING ? "OPENAI_MODEL_PLANNING" : null,
        env.OPENAI_MODEL_FOLLOWUP ? "OPENAI_MODEL_FOLLOWUP" : null
      ].filter(Boolean),
      blocking_reasons: missing
    };
  } catch (error) {
    return {
      ready: false,
      provider: process.env.LLM_PROVIDER ?? null,
      live_calls_enabled: process.env.LLM_LIVE_CALLS_ENABLED === "true",
      credential_configured: envPresent("OPENAI_API_KEY") || envPresent("OPENAI_API_KEY_FILE"),
      model_configured: modelConfigured(),
      request_timeout_ms: null,
      max_retries: null,
      configured_model_variable_names: [],
      blocking_reasons: [
        error instanceof LlmConfigurationError ? error.code : "llm_readiness_error"
      ]
    };
  }
}

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

async function writeJson(fileName: string, value: unknown) {
  const outputPath = path.join(artifactDir, fileName);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return outputPath;
}

async function agentCallSummary(agentCallId?: string) {
  if (!agentCallId) return null;
  const call = await prisma.agentCall.findUnique({
    where: { id: agentCallId },
    select: {
      id: true,
      agent_name: true,
      schema_version: true,
      provider: true,
      model_name: true,
      call_status: true,
      output_validated: true,
      provider_request_id: true,
      provider_response_id: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true,
      validation_error: true,
      created_at: true,
      completed_at: true
    }
  });
  if (!call) return null;

  return {
    agent_call_id: call.id,
    agent_name: call.agent_name,
    schema_version: call.schema_version,
    provider: call.provider,
    model_name_present: Boolean(call.model_name),
    call_status: call.call_status,
    output_validated: call.output_validated,
    provider_metadata_present: Boolean(call.provider_request_id || call.provider_response_id),
    token_usage_present: Boolean(call.input_tokens || call.output_tokens || call.total_tokens),
    input_tokens: call.input_tokens ?? 0,
    output_tokens: call.output_tokens ?? 0,
    total_tokens: call.total_tokens ?? 0,
    validation_error_present: Boolean(call.validation_error),
    created_at: call.created_at.toISOString(),
    completed_at: call.completed_at?.toISOString() ?? null
  };
}

async function runScenario(input: {
  scenario: (typeof profileFormativeScenarios)[number];
  live: boolean;
  dryRun: boolean;
  runArtifactDirName: string;
}) {
  const { scenario, live, dryRun, runArtifactDirName } = input;
  const { profile_input, formative_input_from_profile } = buildScenarioInputs(scenario);

  if (dryRun) {
    return {
      scenario_id: scenario.scenario_id,
      passed: true,
      skipped_provider: true,
      failures: [] as string[],
      artifact_path: await writeJson(`${runArtifactDirName}/${scenario.scenario_id}.json`, {
        artifact_type: "profile_formative_live_trial_dry_run",
        artifact_version: "profile-formative-live-trial-v1",
        scenario: safeScenarioDescription(scenario),
        provider_request_made: false
      }),
      actual: null,
      validation_issue_summary: {
        profile_issue_count: 0,
        formative_issue_count: 0,
        profile_issue_codes: [],
        formative_issue_codes: []
      },
      agent_calls: []
    };
  }

  const profileResult = live
    ? await executeLiveProfileIntegrationAgent({ agent_input: profile_input })
    : { status: "succeeded" as const, packet: await callProfileIntegrationAgent(profile_input), validation_issues: [] as [] };
  const profileCall = "agent_call_id" in profileResult
    ? await agentCallSummary(profileResult.agent_call_id)
    : null;
  const failures: string[] = [];

  if (profileResult.status !== "succeeded") {
    failures.push("profile_integration_live_failed_or_invalid");
  }
  const profileResultValidationIssues = "validation_issues" in profileResult
    ? profileResult.validation_issues
    : [];

  const profilePacket = profileResult.status === "succeeded"
    ? profileResult.packet
    : profileResult.fallback_packet;
  const profileValidation = validateProfileIntegrationOutput(profilePacket, profile_input);
  if (!profileValidation.valid) failures.push("profile_validation_failed");

  let formativeResult:
    | Awaited<ReturnType<typeof executeLiveFormativeValueDeterminationAgent>>
    | { status: "succeeded"; packet: Awaited<ReturnType<typeof callFormativeValueDeterminationAgent>>; validation_issues: [] }
    | null = null;
  let formativePacket = null as Awaited<ReturnType<typeof callFormativeValueDeterminationAgent>> | null;
  let formativeCall = null as Awaited<ReturnType<typeof agentCallSummary>>;

  if (profileResult.status === "succeeded") {
    const formativeInput = formative_input_from_profile(profilePacket);
    formativeResult = live
      ? await executeLiveFormativeValueDeterminationAgent({ agent_input: formativeInput })
      : { status: "succeeded", packet: await callFormativeValueDeterminationAgent(formativeInput), validation_issues: [] };
    formativeCall = "agent_call_id" in formativeResult
      ? await agentCallSummary(formativeResult.agent_call_id)
      : null;

    if (formativeResult.status !== "succeeded") {
      failures.push("formative_value_live_failed_or_invalid");
      formativePacket = formativeResult.fallback_packet;
    } else {
      formativePacket = applyScenarioChoice(formativeResult.packet, scenario);
    }
  }
  const formativeResultValidationIssues = formativeResult && "validation_issues" in formativeResult
    ? formativeResult.validation_issues
    : [];

  if (live && profileResult.status !== "succeeded") {
    failures.push("profile_fallback_not_live_success");
  }
  if (live && formativeResult && formativeResult.status !== "succeeded") {
    failures.push("formative_fallback_not_live_success");
  }

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

  if (!expectedProfiles.has(profilePacket.integration_pattern)) failures.push("profile_outcome_mismatch");
  if (!expectedStatuses.has(profilePacket.student_facing_status)) failures.push("student_status_mismatch");
  if (!expectedEngagement.has(profilePacket.engagement_context.engagement_category)) failures.push("engagement_outcome_mismatch");
  if (!expectedAiSignals.has(profilePacket.engagement_context.ai_assistance_signal)) failures.push("ai_signal_mismatch");
  if (formativePacket && !expectedValues.has(formativePacket.primary_value)) failures.push("formative_value_mismatch");
  if (
    formativePacket &&
    scenario.scenario_id.includes("overconfident") &&
    formativePacket.primary_value === "confidence_calibration"
  ) {
    failures.push("overconfident_wrong_or_weak_primary_calibration");
  }

  const studentTextFindings = forbiddenStudentTextFindings({
    profile: profilePacket.student_safe_message,
    formative: formativePacket
      ? {
          message: formativePacket.student_safe_message,
          alternatives: formativePacket.alternative_values,
          summary: formativePacket.rationale.student_safe_summary
        }
      : null
  });
  if (studentTextFindings.length > 0) failures.push("student_facing_safety_violation");

  if (formativePacket) {
    const formativeValidation = validateFormativeValueDeterminationOutput(formativePacket);
    if (!formativeValidation.valid) failures.push("formative_validation_failed");
    if (!formativePacket.student_choice_policy.can_accept_recommendation ||
        !formativePacket.student_choice_policy.can_choose_alternative ||
        !formativePacket.student_choice_policy.can_move_on) {
      failures.push("student_choice_policy_incomplete");
    }
  }

  const artifact = {
    artifact_type: "profile_formative_live_trial_record",
    artifact_version: "profile-formative-live-trial-v1",
    provider_request_made: live,
    scenario: safeScenarioDescription(scenario),
    expected: {
      profile_integration_pattern: scenario.target_profile_integration_pattern,
      student_facing_status: scenario.target_student_facing_status,
      engagement_category: scenario.target_engagement_category,
      ai_assistance_signal: scenario.target_ai_assistance_signal,
      formative_value: scenario.target_formative_value
    },
    actual: {
      profile_integration_pattern: profilePacket.integration_pattern,
      student_facing_status: profilePacket.student_facing_status,
      status_confidence: profilePacket.status_confidence,
      engagement_category: profilePacket.engagement_context.engagement_category,
      ai_assistance_signal: profilePacket.engagement_context.ai_assistance_signal,
      formative_value: formativePacket?.primary_value ?? null,
      formative_value_confidence: formativePacket?.primary_value_confidence ?? null,
      secondary_considerations: formativePacket?.secondary_considerations ?? [],
      student_choice_state: formativePacket?.student_choice_state ?? null
    },
    agent_calls: {
      profile_integration: profileCall,
      formative_value: formativeCall
    },
    validation: {
      profile_valid: profileValidation.valid,
      profile_issues: profileValidation.issues,
      profile_result_status: profileResult.status,
      profile_result_validation_issues: profileResultValidationIssues,
      formative_result_status: formativeResult?.status ?? "not_run",
      formative_result_validation_issues: formativeResultValidationIssues,
      student_text_findings: studentTextFindings
    },
    transcript_safety_summary: {
      scripted_responses_used: true,
      raw_prompt_included: false,
      raw_provider_output_included: false,
      student_safe_profile_message_present: Boolean(profilePacket.student_safe_message),
      formative_value_message_present: Boolean(formativePacket?.student_safe_message)
    },
    fallback_or_repair: {
      profile_fallback_used: profileResult.status !== "succeeded",
      formative_fallback_used: Boolean(formativeResult && formativeResult.status !== "succeeded"),
      repair_detected: false
    },
    validation_issue_summary: {
      profile_issue_count: profileResultValidationIssues.length,
      formative_issue_count: formativeResultValidationIssues.length,
      profile_issue_codes: [...new Set(profileResultValidationIssues.map((issue) => issue.rule_code))],
      formative_issue_codes: [...new Set(formativeResultValidationIssues.map((issue) => issue.rule_code))]
    },
    failures
  };
  const artifactPath = await writeJson(`${runArtifactDirName}/${scenario.scenario_id}.json`, artifact);

  return {
    scenario_id: scenario.scenario_id,
    passed: failures.length === 0,
    failures,
    artifact_path: artifactPath,
    actual: artifact.actual,
    validation_issue_summary: artifact.validation_issue_summary,
    agent_calls: [profileCall, formativeCall].filter(Boolean)
  };
}

function selectedLiveScenarios() {
  const explicit = selectedScenariosFromList(process.env.PROFILE_FORMATIVE_TRIAL_SCENARIOS);
  const max = intEnv("MAX_LIVE_PROFILE_FORMATIVE_TRIALS") ?? (explicit.length > 20 ? 20 : explicit.length);
  return explicit.slice(0, max);
}

type LiveTrialResult = Awaited<ReturnType<typeof runScenario>>;

function coverageFromResults(results: LiveTrialResult[]) {
  return {
    profile_integration_patterns: [...new Set(results.map((result) => result.actual?.profile_integration_pattern).filter(Boolean))].sort(),
    student_facing_statuses: [...new Set(results.map((result) => result.actual?.student_facing_status).filter(Boolean))].sort(),
    engagement_categories: [...new Set(results.map((result) => result.actual?.engagement_category).filter(Boolean))].sort(),
    ai_assistance_signals: [...new Set(results.map((result) => result.actual?.ai_assistance_signal).filter(Boolean))].sort(),
    formative_values: [...new Set(results.map((result) => result.actual?.formative_value).filter(Boolean))].sort(),
    student_choice_states: [...new Set(results.map((result) => result.actual?.student_choice_state?.student_choice).filter(Boolean))].sort()
  };
}

async function main() {
  const dryRun = boolEnv("PROFILE_FORMATIVE_TRIAL_DRY_RUN");
  const noLive = boolEnv("PROFILE_FORMATIVE_TRIAL_NO_LIVE");
  const live = !dryRun && !noLive;
  const scenarios = selectedLiveScenarios();
  const readiness = liveReadiness();
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runModeLabel = live ? "live" : dryRun ? "dry-run" : "no-live";
  const runArtifactDirName = `run-${runTimestamp}-${runModeLabel}`;

  console.log(JSON.stringify({
    status: "starting",
    paid_call_warning:
      live
        ? "This command is authorized to make paid OpenAI calls for profile/formative QA trials."
        : "No provider call will be made because dry-run or no-live mode is enabled.",
    live_mode: live,
    dry_run: dryRun,
    no_live: noLive,
    selected_scenario_count: scenarios.length,
    scenario_ids: scenarios.map((scenario) => scenario.scenario_id),
    readiness: {
      ready: readiness.ready,
      provider: readiness.provider,
      live_calls_enabled: readiness.live_calls_enabled,
      credential_configured: readiness.credential_configured,
      model_configured: readiness.model_configured,
      configured_model_variable_names: readiness.configured_model_variable_names,
      blocking_reasons: readiness.blocking_reasons
    }
  }, null, 2));

  if (live && !readiness.ready) {
    const summary = {
      status: "blocked",
      reason: "live_readiness_failed",
      readiness,
      scenario_count: scenarios.length,
      live_scenarios_run: 0,
      artifact_dir: artifactDir
    };
    await writeJson(`blocked-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, summary);
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const results: LiveTrialResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario({ scenario, live, dryRun, runArtifactDirName }));
  }

  const coverage = coverageFromResults(results);
  const agentCalls = results.flatMap((result) => result.agent_calls);
  const tokenUsage = agentCalls.reduce(
    (acc, call) => ({
      input_tokens: acc.input_tokens + (call?.input_tokens ?? 0),
      output_tokens: acc.output_tokens + (call?.output_tokens ?? 0),
      total_tokens: acc.total_tokens + (call?.total_tokens ?? 0)
    }),
    { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
  );
  const failed = results.filter((result) => !result.passed);
  const errorAnalysis = {
    artifact_type: "profile_formative_live_trial_error_analysis",
    artifact_version: "profile-formative-live-trial-error-analysis-v1",
    total_scenarios: scenarios.length,
    live_scenarios_run: live ? results.length : 0,
    live_rerun_count: 0,
    failures_by_category: {
      outcome_mismatch: results.flatMap((result) => result.failures).filter((failure) => failure.includes("mismatch")).length,
      safety_violation: results.flatMap((result) => result.failures).filter((failure) => failure.includes("safety")).length,
      validator_failure: results.flatMap((result) => result.failures).filter((failure) => failure.includes("validation")).length,
      fallback_or_repair: results.flatMap((result) => result.failures).filter((failure) => failure.includes("fallback")).length
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
      result.failures.includes("formative_validation_failed") ||
      result.validation_issue_summary.profile_issue_count > 0 ||
      result.validation_issue_summary.formative_issue_count > 0
    ).map((result) => ({
      scenario_id: result.scenario_id,
      profile_issue_codes: result.validation_issue_summary.profile_issue_codes,
      formative_issue_codes: result.validation_issue_summary.formative_issue_codes
    })),
    fallback_or_repair_counts: {
      profile_fallback_or_invalid: results.filter((result) =>
        result.failures.includes("profile_integration_live_failed_or_invalid")
      ).length,
      formative_fallback_or_invalid: results.filter((result) =>
        result.failures.includes("formative_value_live_failed_or_invalid")
      ).length
    },
    uncovered_outcome_categories: {},
    scenario_level_recommendations: failed.map((result) => ({
      scenario_id: result.scenario_id,
      classification: "review_live_model_or_scenario_alignment",
      failures: result.failures
    }))
  };
  const errorAnalysisPath = await writeJson(
    `error-analysis-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    errorAnalysis
  );
  const summary = {
    status: failed.length === 0 ? "passed" : "failed",
    scenario_count: scenarios.length,
    live_scenarios_run: live ? results.length : 0,
    live_rerun_count: 0,
    passed_count: results.filter((result) => result.passed).length,
    failed_count: failed.length,
    scenario_ids_run: results.map((result) => result.scenario_id),
    coverage,
    agent_call_statuses: results.map((result) => ({
      scenario_id: result.scenario_id,
      agent_calls: result.agent_calls.map((call) => ({
        agent_name: call?.agent_name,
        call_status: call?.call_status,
        output_validated: call?.output_validated,
        provider_metadata_present: call?.provider_metadata_present,
        token_usage_present: call?.token_usage_present
      }))
    })),
    token_usage: tokenUsage,
    failures: failed.map((result) => ({
      scenario_id: result.scenario_id,
      failures: result.failures,
      artifact_path: result.artifact_path
    })),
    artifact_dir: artifactDir,
    error_analysis_artifact_path: errorAnalysisPath
  };
  await writeJson(`summary-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, summary);
  console.log(JSON.stringify(summary, null, 2));

  await prisma.$disconnect();
  if (summary.status !== "passed") {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
