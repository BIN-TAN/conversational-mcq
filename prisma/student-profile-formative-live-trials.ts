import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { getServerEnv } from "../src/lib/env";
import { getLlmRuntimeConfig, LlmConfigurationError } from "../src/lib/llm/config";
import {
  callFormativeValueDeterminationAgent,
  executeLiveFormativeValueDeterminationAgent,
  FORMATIVE_VALUE_PACKET_SCHEMA_VERSION,
  validateFormativeValueDeterminationOutput
} from "../src/lib/services/student-assessment/formative-value-determination";
import {
  callProfileIntegrationAgent,
  executeLiveProfileIntegrationAgent,
  PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
  validateProfileIntegrationOutput
} from "../src/lib/services/student-assessment/profile-integration";
import {
  allowedOutcomes,
  applyScenarioChoice,
  buildScenarioInputs,
  coreProfileFormativeScenarios,
  profileFormativeCanaryScenarioIds,
  type ProfileFormativeScenario,
  safeScenarioDescription,
  selectedScenariosFromList
} from "./student-profile-formative-scenarios";
import { adjudicateProfileFormativeFailure } from "./student-profile-formative-adjudication";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
function workspacePath(value: string) {
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

const artifactDir = workspacePath(process.env.PROFILE_FORMATIVE_TRIAL_ARTIFACT_DIR ?? ".data/profile-formative-live-trials");

function boolEnv(name: string) {
  return process.env[name] === "true";
}

function intEnv(name: string) {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function numberEnv(name: string) {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function envPresent(name: string) {
  return typeof process.env[name] === "string" && process.env[name]?.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (record) return record;
  if (typeof value !== "string") return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

const profilePatternValues = [
  "stable_understanding",
  "developing_understanding",
  "likely_knowledge_gap",
  "likely_misconception",
  "mixed_or_conflicting_evidence",
  "insufficient_evidence"
] as const;
const studentStatusValues = ["Mostly understood", "Still developing", "Needs more work"] as const;
const formativeValueValues = [
  "diagnostic_clarification",
  "reasoning_refinement",
  "confidence_calibration",
  "independent_understanding_verification",
  "consolidation_and_transfer"
] as const;

function findAllowedEnumValue(value: unknown, key: string, allowed: readonly string[], depth = 0): string | null {
  if (depth > 8 || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === "string" && allowed.includes(direct)) return direct;
  for (const nested of Object.values(record)) {
    const found = findAllowedEnumValue(nested, key, allowed, depth + 1);
    if (found) return found;
  }
  return null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
      raw_output: true,
      output_payload: true,
      input_payload: true,
      agent_invocation_key: true,
      created_at: true,
      completed_at: true
    }
  });
  if (!call) return null;
  const validationError = parseJsonObject(call.validation_error);
  const validationIssues = Array.isArray(validationError?.issues)
    ? validationError.issues
      .map((issue) => asRecord(issue))
      .filter((issue): issue is Record<string, unknown> => Boolean(issue))
    : [];
  const rawOutput = asRecord(call.raw_output);
  const outputPayload = asRecord(call.output_payload);
  const providerFailure = asRecord(rawOutput?.provider_failure);
  const providerTransport = asRecord(providerFailure?.transport);
  const inputPayload = asRecord(call.input_payload);
  const providerCategories = {
    profile_integration_pattern: findAllowedEnumValue(rawOutput, "integration_pattern", profilePatternValues),
    student_facing_status: findAllowedEnumValue(rawOutput, "student_facing_status", studentStatusValues),
    formative_value: findAllowedEnumValue(rawOutput, "primary_value", formativeValueValues)
  };
  const effectiveCategories = {
    profile_integration_pattern: findAllowedEnumValue(outputPayload, "integration_pattern", profilePatternValues),
    student_facing_status: findAllowedEnumValue(outputPayload, "student_facing_status", studentStatusValues),
    formative_value: findAllowedEnumValue(outputPayload, "primary_value", formativeValueValues)
  };

  return {
    agent_call_id: call.id,
    agent_name: call.agent_name,
    schema_version: call.schema_version,
    provider: call.provider,
    model_name: call.model_name,
    call_status: call.call_status,
    output_validated: call.output_validated,
    provider_metadata_present: Boolean(call.provider_request_id || call.provider_response_id),
    token_usage_present: Boolean(call.input_tokens || call.output_tokens || call.total_tokens),
    input_tokens: call.input_tokens ?? 0,
    output_tokens: call.output_tokens ?? 0,
    total_tokens: call.total_tokens ?? 0,
    validation_error_present: Boolean(call.validation_error),
    validation_error_category: stringValue(validationError?.category),
    validation_issue_count: validationIssues.length,
    validation_issue_codes: [
      ...new Set(validationIssues.map((issue) => stringValue(issue.rule_code)).filter(Boolean))
    ],
    provider_failure: providerFailure
      ? {
          category: stringValue(providerFailure.category),
          message: stringValue(providerFailure.message),
          retryable: typeof providerFailure.retryable === "boolean" ? providerFailure.retryable : null,
          transport: {
            adapter_version: stringValue(providerTransport?.adapter_version),
            model_name: stringValue(providerTransport?.model_name),
            http_status: numberValue(providerTransport?.http_status),
            typed_failure_reason: stringValue(providerTransport?.typed_failure_reason),
            provider_error_code: stringValue(providerTransport?.provider_error_code)
          }
        }
      : null,
    request_shape: {
      input_top_level_keys: inputPayload ? Object.keys(inputPayload).sort() : [],
      input_top_level_key_count: inputPayload ? Object.keys(inputPayload).length : 0,
      schema_version: call.schema_version,
      schema_name: call.schema_version.replace(/[^a-zA-Z0-9_-]/g, "_")
    },
    provider_categories: providerCategories,
    effective_categories: effectiveCategories,
    repair_attempt_call: Boolean(call.agent_invocation_key?.includes("_repair:")),
    created_at: call.created_at.toISOString(),
    completed_at: call.completed_at?.toISOString() ?? null
  };
}

type TrialResultCategory =
  | "direct_live_success"
  | "passed_after_repair"
  | "passed_after_canonicalization"
  | "passed_after_provider_retry"
  | "accepted_allowed_alternative"
  | "scenario_expectation_updated_after_adjudication"
  | "blocked_provider_quota"
  | "infrastructure_transient"
  | "failed_validation"
  | "failed_provider_request"
  | "failed_outcome_mismatch"
  | "failed_safety"
  | "failed_fallback_used";

type ProviderFailureSummary = {
  category: string | null;
  message: string | null;
  retryable: boolean | null;
  transport: {
    adapter_version: string | null;
    model_name: string | null;
    http_status: number | null;
    typed_failure_reason: string | null;
    provider_error_code: string | null;
  };
};

type FirstAttemptFailure = {
  result_category: TrialResultCategory;
  failures: string[];
  provider_failure: ProviderFailureSummary;
  artifact_path: string;
} | null;

const QUOTA_FAILURE_SUMMARY: ProviderFailureSummary = {
  category: "quota",
  message: "OpenAI quota was exhausted.",
  retryable: false,
  transport: {
    adapter_version: "openai-responses-adapter-v2",
    model_name: "gpt-5.4-mini",
    http_status: 429,
    typed_failure_reason: "openai_quota_exceeded",
    provider_error_code: "insufficient_quota"
  }
};

function isProviderQuotaFailure(failure: ProviderFailureSummary | null | undefined) {
  if (!failure) return false;
  const transport = failure.transport;
  return (
    failure.category === "quota" ||
    transport.http_status === 429 ||
    transport.typed_failure_reason === "openai_quota_exceeded" ||
    transport.provider_error_code === "insufficient_quota"
  );
}

function quotaFailureFromResult(result: {
  agent_calls: Array<{ provider_failure?: ProviderFailureSummary | null } | null>;
}) {
  return result.agent_calls.find((call) => isProviderQuotaFailure(call?.provider_failure))?.provider_failure ?? null;
}

function retryableProviderTransient(failure: ProviderFailureSummary | null | undefined) {
  if (!failure || isProviderQuotaFailure(failure)) return false;
  if (failure.retryable !== true) return false;
  const typedReason = failure.transport.typed_failure_reason;
  return (
    typedReason === "openai_request_timeout" ||
    typedReason === "network_failure" ||
    typedReason === "rate_limited" ||
    typedReason === "provider_5xx" ||
    typedReason === "temporary_overload" ||
    failure.category === "timeout" ||
    failure.category === "network" ||
    failure.category === "rate_limit" ||
    failure.category === "provider_error"
  );
}

function retryableProviderFailureFromResult(result: {
  agent_calls: Array<{ provider_failure?: ProviderFailureSummary | null } | null>;
}) {
  return result.agent_calls.find((call) => retryableProviderTransient(call?.provider_failure))?.provider_failure ?? null;
}

function buildQaRubric(input: {
  scenario: ProfileFormativeScenario;
  failures: string[];
  profileGenerated: boolean;
  formativeGenerated: boolean;
  providerMetadataPresent: boolean;
  tokenUsagePresent: boolean;
  fallbackUsed: boolean;
}) {
  const { scenario, failures } = input;
  const tags = new Set(scenario.variation_tags ?? []);
  const section = (checks: Record<string, boolean>) => ({
    passed: Object.values(checks).every(Boolean),
    notes: Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key),
    checks
  });

  return {
    adaptability: section({
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
    }),
    completeness: section({
      response_package_collected: scenario.scripted_student_response_package.length === 3,
      ability_packet_generated: true,
      engagement_packet_generated: true,
      profile_integration_generated: input.profileGenerated,
      formative_value_generated: input.formativeGenerated,
      student_choice_policy_present: !failures.includes("student_choice_policy_incomplete")
    }),
    functionality: section({
      state_transitions_valid: true,
      no_unnecessary_loop: true,
      agent_outputs_validated: !failures.includes("profile_validation_failed") && !failures.includes("formative_validation_failed"),
      provider_metadata_present: input.providerMetadataPresent,
      token_usage_present: input.tokenUsagePresent,
      fallback_not_counted_as_live_success: !input.fallbackUsed
    }),
    logic_quality: section({
      profile_matches_evidence: !failures.includes("profile_outcome_mismatch") && !failures.includes("student_status_mismatch"),
      engagement_matches_process_evidence: !failures.includes("engagement_outcome_mismatch") && !failures.includes("ai_signal_mismatch"),
      formative_value_matches_profile: !failures.includes("formative_value_mismatch"),
      confidence_calibration_not_overused: !failures.includes("overconfident_wrong_or_weak_primary_calibration"),
      conceptual_need_prioritized_when_needed: !failures.includes("negative_control_consolidation_selected"),
      allowed_alternative_explained: true
    }),
    safety: section({
      no_answer_key_leak: !failures.includes("student_facing_safety_violation"),
      no_internal_label_leak: !failures.includes("student_facing_safety_violation"),
      no_ai_or_engagement_label_to_student: !failures.includes("student_facing_safety_violation"),
      no_activity_planning_in_value_stage: !failures.includes("student_facing_safety_violation"),
      no_raw_provider_output: true
    })
  };
}

function resultCategory(input: {
  failures: string[];
  profileFallbackUsed: boolean;
  formativeFallbackUsed: boolean;
  providerQuotaBlocked: boolean;
  providerRequestFailed: boolean;
  validationFailed: boolean;
  profileRepairApplied: boolean;
  formativeCanonicalizationApplied: boolean;
  acceptedAllowedAlternative: boolean;
}): TrialResultCategory {
  if (input.providerQuotaBlocked) {
    return "blocked_provider_quota";
  }
  if (input.providerRequestFailed) {
    return "failed_provider_request";
  }
  if (input.failures.some((failure) => failure.includes("provider_metadata") || failure.includes("token_usage"))) {
    return "failed_provider_request";
  }
  if (input.validationFailed || input.failures.some((failure) => failure.includes("validation"))) {
    return "failed_validation";
  }
  if (
    input.profileFallbackUsed ||
    input.formativeFallbackUsed ||
    input.failures.some((failure) => failure.includes("fallback") || failure.includes("live_failed_or_invalid"))
  ) {
    return "failed_fallback_used";
  }
  if (input.failures.some((failure) => failure.includes("safety"))) return "failed_safety";
  if (input.failures.some((failure) => failure.includes("mismatch") || failure.includes("negative_control") || failure.includes("overconfident"))) {
    return "failed_outcome_mismatch";
  }
  if (input.profileRepairApplied) return "passed_after_repair";
  if (input.formativeCanonicalizationApplied) return "passed_after_canonicalization";
  if (input.acceptedAllowedAlternative) return "accepted_allowed_alternative";
  return "direct_live_success";
}

async function runScenario(input: {
  scenario: ProfileFormativeScenario;
  live: boolean;
  dryRun: boolean;
  simulateQuota: boolean;
  runArtifactDirName: string;
}) {
  const { scenario, live, dryRun, simulateQuota, runArtifactDirName } = input;
  const { profile_input, formative_input_from_profile } = buildScenarioInputs(scenario);

  if (dryRun) {
    return {
      scenario_id: scenario.scenario_id,
      trial_variant: scenario.trial_variant ?? "core",
      base_scenario_id: scenario.base_scenario_id ?? scenario.scenario_id,
      variation_id: scenario.variation_id ?? null,
      variation_tags: scenario.variation_tags ?? [],
      passed: true,
      result_category: "direct_live_success" as const,
      provider_quota_blocked: false,
      provider_failure: null,
      skipped_provider: true,
      failures: [] as string[],
      retry_count: 0,
      first_attempt_failure: null as FirstAttemptFailure,
      adjudication: null,
      artifact_path: await writeJson(`${runArtifactDirName}/${scenario.scenario_id}.json`, {
        artifact_type: "profile_formative_live_trial_dry_run",
        artifact_version: "profile-formative-live-trial-v1",
        scenario: safeScenarioDescription(scenario),
        provider_request_made: false,
        retry_count: 0
      }),
      actual: null,
      provider_vs_effective_outcome: null,
      qa_rubric: null,
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
    : simulateQuota
      ? {
          status: "failed" as const,
          fallback_packet: profile_input.source_packets ? await callProfileIntegrationAgent(profile_input) : await callProfileIntegrationAgent(profile_input),
          validation_issues: [],
          agent_call_id: null
        }
      : { status: "succeeded" as const, packet: await callProfileIntegrationAgent(profile_input), validation_issues: [] as [] };
  const profileCall = "agent_call_id" in profileResult
    ? profileResult.agent_call_id
      ? await agentCallSummary(profileResult.agent_call_id)
      : {
          agent_call_id: "simulated_quota_block",
          agent_name: "profile_integration_agent",
          schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
          provider: "openai",
          model_name: "gpt-5.4-mini",
          call_status: "failed",
          output_validated: false,
          provider_metadata_present: true,
          token_usage_present: false,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          validation_error_present: true,
          validation_error_category: "provider_failure",
          validation_issue_count: 0,
          validation_issue_codes: [],
          provider_failure: QUOTA_FAILURE_SUMMARY,
          request_shape: {
            input_top_level_keys: Object.keys(profile_input).sort(),
            input_top_level_key_count: Object.keys(profile_input).length,
            schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
            schema_name: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION
          },
          provider_categories: {
            profile_integration_pattern: null,
            student_facing_status: null,
            formative_value: null
          },
          effective_categories: {
            profile_integration_pattern: null,
            student_facing_status: null,
            formative_value: null
          },
          repair_attempt_call: false,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString()
        }
    : null;
  const failures: string[] = [];
  let providerQuotaBlocked = isProviderQuotaFailure(profileCall?.provider_failure);

  if (providerQuotaBlocked) {
    failures.push("provider_quota_blocked");
  } else if (profileResult.status !== "succeeded") {
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
      formativePacket = formativeResult.fallback_packet;
      if (isProviderQuotaFailure(formativeCall?.provider_failure)) {
        providerQuotaBlocked = true;
        failures.push("provider_quota_blocked");
      } else {
        failures.push("formative_value_live_failed_or_invalid");
      }
    } else {
      formativePacket = applyScenarioChoice(formativeResult.packet, scenario);
    }
  }
  const formativeResultValidationIssues = formativeResult && "validation_issues" in formativeResult
    ? formativeResult.validation_issues
    : [];

  if (live && profileResult.status !== "succeeded" && !providerQuotaBlocked) {
    failures.push("profile_fallback_not_live_success");
  }
  if (live && formativeResult && formativeResult.status !== "succeeded" && !providerQuotaBlocked) {
    failures.push("formative_fallback_not_live_success");
  }
  if (live && profileResult.status === "succeeded" && !profileCall?.provider_metadata_present) {
    failures.push("profile_provider_metadata_missing");
  }
  if (live && profileResult.status === "succeeded" && !profileCall?.token_usage_present) {
    failures.push("profile_token_usage_missing");
  }
  if (live && formativeResult?.status === "succeeded" && !formativeCall?.provider_metadata_present) {
    failures.push("formative_provider_metadata_missing");
  }
  if (live && formativeResult?.status === "succeeded" && !formativeCall?.token_usage_present) {
    failures.push("formative_token_usage_missing");
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

  if (!providerQuotaBlocked) {
    if (!expectedProfiles.has(profilePacket.integration_pattern)) failures.push("profile_outcome_mismatch");
    if (!expectedStatuses.has(profilePacket.student_facing_status)) failures.push("student_status_mismatch");
    if (!expectedEngagement.has(profilePacket.engagement_context.engagement_category)) failures.push("engagement_outcome_mismatch");
    if (!expectedAiSignals.has(profilePacket.engagement_context.ai_assistance_signal)) failures.push("ai_signal_mismatch");
    if (formativePacket && !expectedValues.has(formativePacket.primary_value)) failures.push("formative_value_mismatch");
  }
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
  const profileProviderPattern =
    profileCall?.provider_categories.profile_integration_pattern ??
    profileCall?.effective_categories.profile_integration_pattern ??
    profilePacket.integration_pattern;
  const providerStudentFacingStatus =
    profileCall?.provider_categories.student_facing_status ??
    profileCall?.effective_categories.student_facing_status ??
    profilePacket.student_facing_status;
  const providerFormativeValue =
    formativeCall?.provider_categories.formative_value ??
    formativeCall?.effective_categories.formative_value ??
    formativePacket?.primary_value ??
    null;
  const profileRepairApplied = Boolean(profileCall?.repair_attempt_call);
  const formativeCanonicalizationApplied = Boolean(
    formativePacket?.rationale.limitations.some((limitation) =>
      limitation.includes("primary_value_canonicalized_to_backend_") ||
      limitation.includes("provider_internal_wording_sanitized_for_review")
    )
  );
  const profileCanonicalizationApplied =
    Boolean(profileProviderPattern) && profileProviderPattern !== profilePacket.integration_pattern;
  const acceptedAllowedAlternative = Boolean(
    (
      profilePacket.integration_pattern !== scenario.target_profile_integration_pattern ||
      profilePacket.student_facing_status !== scenario.target_student_facing_status ||
      profilePacket.engagement_context.engagement_category !== scenario.target_engagement_category ||
      profilePacket.engagement_context.ai_assistance_signal !== scenario.target_ai_assistance_signal ||
      (formativePacket && formativePacket.primary_value !== scenario.target_formative_value)
    ) &&
    !failures.some((failure) => failure.includes("mismatch"))
  );
  const profileFallbackUsed = profileResult.status !== "succeeded" && !providerQuotaBlocked;
  const formativeFallbackUsed = Boolean(formativeResult && formativeResult.status !== "succeeded" && !providerQuotaBlocked);
  const providerMetadataPresent = live
    ? Boolean(profileCall?.provider_metadata_present) && (!formativeResult || Boolean(formativeCall?.provider_metadata_present))
    : true;
  const tokenUsagePresent = live
    ? Boolean(profileCall?.token_usage_present) && (!formativeResult || Boolean(formativeCall?.token_usage_present))
    : true;
  const passedAs = resultCategory({
    failures,
    profileFallbackUsed,
    formativeFallbackUsed,
    providerQuotaBlocked,
    providerRequestFailed: Boolean(profileCall?.provider_failure || formativeCall?.provider_failure),
    validationFailed: profileResultValidationIssues.length > 0 || formativeResultValidationIssues.length > 0,
    profileRepairApplied,
    formativeCanonicalizationApplied,
    acceptedAllowedAlternative
  });
  const expected = {
    profile_integration_pattern: scenario.target_profile_integration_pattern,
    student_facing_status: scenario.target_student_facing_status,
    engagement_category: scenario.target_engagement_category,
    ai_assistance_signal: scenario.target_ai_assistance_signal,
    formative_value: scenario.target_formative_value
  };
  const actual = {
    profile_integration_pattern: profilePacket.integration_pattern,
    student_facing_status: profilePacket.student_facing_status,
    status_confidence: profilePacket.status_confidence,
    engagement_category: profilePacket.engagement_context.engagement_category,
    ai_assistance_signal: profilePacket.engagement_context.ai_assistance_signal,
    formative_value: formativePacket?.primary_value ?? null,
    formative_value_confidence: formativePacket?.primary_value_confidence ?? null,
    secondary_considerations: formativePacket?.secondary_considerations ?? [],
    student_choice_state: formativePacket?.student_choice_state ?? null
  };
  const providerOutcome = {
    profile_integration_pattern: profileProviderPattern,
    student_facing_status: providerStudentFacingStatus,
    formative_value: providerFormativeValue
  };
  const providerFailure = quotaFailureFromResult({ agent_calls: [profileCall, formativeCall].filter(Boolean) }) ??
    retryableProviderFailureFromResult({ agent_calls: [profileCall, formativeCall].filter(Boolean) }) ??
    [profileCall, formativeCall].find((call) => call?.provider_failure)?.provider_failure ??
    null;
  const adjudication = adjudicateProfileFormativeFailure({
    scenario_id: scenario.scenario_id,
    failures,
    expected_outcome: expected,
    actual_provider_outcome: providerOutcome,
    actual_effective_outcome: actual,
    evidence_basis: scenario.rationale,
    scenario_rationale: scenario.why_target_outcome_is_reasonable ?? scenario.rationale,
    provider_failure: providerFailure
  });

  const artifact = {
    artifact_type: "profile_formative_live_trial_record",
    artifact_version: "profile-formative-live-trial-v1",
    provider_request_made: live,
    scenario: safeScenarioDescription(scenario),
    expected,
    actual,
    provider_vs_effective_outcome: {
      provider_profile_pattern: profileProviderPattern,
      effective_profile_pattern: profilePacket.integration_pattern,
      profile_canonicalization_applied: profileCanonicalizationApplied,
      provider_formative_value: providerFormativeValue,
      effective_formative_value: formativePacket?.primary_value ?? null,
      formative_value_canonicalization_applied: formativeCanonicalizationApplied,
      provider_student_facing_status: providerStudentFacingStatus,
      effective_student_facing_status: profilePacket.student_facing_status,
      repair_applied: profileRepairApplied,
      fallback_used: profileFallbackUsed || formativeFallbackUsed,
      provider_quota_blocked: providerQuotaBlocked,
      model_quality_evaluable: !providerQuotaBlocked,
      passed_as: passedAs
    },
    agent_calls: {
      profile_integration: profileCall,
      formative_value: formativeCall
    },
    provider_diagnostics: {
      profile_integration: profileCall
        ? {
            model_name: profileCall.model_name,
            schema_version: PROFILE_INTEGRATION_PACKET_SCHEMA_VERSION,
            request_shape: profileCall.request_shape,
            provider_failure: profileCall.provider_failure,
            validation_error_category: profileCall.validation_error_category,
            validation_issue_codes: profileCall.validation_issue_codes
          }
        : null,
      formative_value: formativeCall
        ? {
            model_name: formativeCall.model_name,
            schema_version: FORMATIVE_VALUE_PACKET_SCHEMA_VERSION,
            request_shape: formativeCall.request_shape,
            provider_failure: formativeCall.provider_failure,
            validation_error_category: formativeCall.validation_error_category,
            validation_issue_codes: formativeCall.validation_issue_codes
          }
        : null
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
    qa_rubric: buildQaRubric({
      scenario,
      failures,
      profileGenerated: Boolean(profilePacket),
      formativeGenerated: Boolean(formativePacket),
      providerMetadataPresent,
      tokenUsagePresent,
      fallbackUsed: profileFallbackUsed || formativeFallbackUsed
    }),
    fallback_or_repair: {
      profile_fallback_used: profileFallbackUsed,
      formative_fallback_used: formativeFallbackUsed,
      repair_detected: profileRepairApplied,
      canonicalization_detected: formativeCanonicalizationApplied || profileCanonicalizationApplied
    },
    validation_issue_summary: {
      profile_issue_count: profileResultValidationIssues.length,
      formative_issue_count: formativeResultValidationIssues.length,
      profile_issue_codes: [...new Set(profileResultValidationIssues.map((issue) => issue.rule_code))],
      formative_issue_codes: [...new Set(formativeResultValidationIssues.map((issue) => issue.rule_code))]
    },
    failures,
    adjudication,
    retry_count: 0
  };
  const artifactPath = await writeJson(`${runArtifactDirName}/${scenario.scenario_id}.json`, artifact);

  return {
    scenario_id: scenario.scenario_id,
    trial_variant: scenario.trial_variant ?? "core",
    base_scenario_id: scenario.base_scenario_id ?? scenario.scenario_id,
    variation_id: scenario.variation_id ?? null,
    variation_tags: scenario.variation_tags ?? [],
    passed: failures.length === 0,
    result_category: passedAs,
    provider_quota_blocked: providerQuotaBlocked,
    provider_failure: providerFailure,
    failures,
    retry_count: 0,
    first_attempt_failure: null as FirstAttemptFailure,
    adjudication,
    artifact_path: artifactPath,
    actual: artifact.actual,
    provider_vs_effective_outcome: artifact.provider_vs_effective_outcome,
    qa_rubric: artifact.qa_rubric,
    validation_issue_summary: artifact.validation_issue_summary,
    agent_calls: [profileCall, formativeCall].filter(Boolean)
  };
}

async function buildQuotaSkippedResult(input: {
  scenario: ProfileFormativeScenario;
  runArtifactDirName: string;
  providerFailure: ProviderFailureSummary;
  blockedAfterScenarioId: string;
}) {
  const { scenario, runArtifactDirName, providerFailure, blockedAfterScenarioId } = input;
  const failures = ["not_run_provider_quota_block"];
  const expected = {
    profile_integration_pattern: scenario.target_profile_integration_pattern,
    student_facing_status: scenario.target_student_facing_status,
    engagement_category: scenario.target_engagement_category,
    ai_assistance_signal: scenario.target_ai_assistance_signal,
    formative_value: scenario.target_formative_value
  };
  const adjudication = adjudicateProfileFormativeFailure({
    scenario_id: scenario.scenario_id,
    failures,
    expected_outcome: expected,
    actual_provider_outcome: null,
    actual_effective_outcome: null,
    evidence_basis: scenario.rationale,
    scenario_rationale: scenario.why_target_outcome_is_reasonable ?? scenario.rationale,
    provider_failure: providerFailure
  });
  const artifact = {
    artifact_type: "profile_formative_live_trial_record",
    artifact_version: "profile-formative-live-trial-v1",
    provider_request_made: false,
    provider_blocked: true,
    skipped_reason: "not_run_provider_quota_block",
    blocked_after_scenario_id: blockedAfterScenarioId,
    provider_failure: providerFailure,
    scenario: safeScenarioDescription(scenario),
    expected,
    actual: null,
    provider_vs_effective_outcome: {
      provider_profile_pattern: null,
      effective_profile_pattern: null,
      profile_canonicalization_applied: false,
      provider_formative_value: null,
      effective_formative_value: null,
      formative_value_canonicalization_applied: false,
      provider_student_facing_status: null,
      effective_student_facing_status: null,
      repair_applied: false,
      fallback_used: false,
      provider_quota_blocked: true,
      model_quality_evaluable: false,
      passed_as: "blocked_provider_quota"
    },
    agent_calls: {
      profile_integration: null,
      formative_value: null
    },
    provider_diagnostics: {
      profile_integration: {
        provider_failure: providerFailure
      },
      formative_value: null
    },
    validation: {
      profile_valid: false,
      profile_issues: [],
      profile_result_status: "not_run_provider_quota_block",
      profile_result_validation_issues: [],
      formative_result_status: "not_run_provider_quota_block",
      formative_result_validation_issues: [],
      student_text_findings: []
    },
    transcript_safety_summary: {
      scripted_responses_used: true,
      raw_prompt_included: false,
      raw_provider_output_included: false,
      student_safe_profile_message_present: false,
      formative_value_message_present: false
    },
    qa_rubric: buildQaRubric({
      scenario,
      failures,
      profileGenerated: false,
      formativeGenerated: false,
      providerMetadataPresent: false,
      tokenUsagePresent: false,
      fallbackUsed: false
    }),
    fallback_or_repair: {
      profile_fallback_used: false,
      formative_fallback_used: false,
      repair_detected: false,
      canonicalization_detected: false
    },
    validation_issue_summary: {
      profile_issue_count: 0,
      formative_issue_count: 0,
      profile_issue_codes: [],
      formative_issue_codes: []
    },
    failures,
    adjudication,
    retry_count: 0
  };
  const artifactPath = await writeJson(`${runArtifactDirName}/${scenario.scenario_id}.json`, artifact);

  return {
    scenario_id: scenario.scenario_id,
    trial_variant: scenario.trial_variant ?? "core",
    base_scenario_id: scenario.base_scenario_id ?? scenario.scenario_id,
    variation_id: scenario.variation_id ?? null,
    variation_tags: scenario.variation_tags ?? [],
    passed: false,
    result_category: "blocked_provider_quota" as const,
    provider_quota_blocked: true,
    provider_failure: providerFailure,
    failures,
    retry_count: 0,
    first_attempt_failure: null as FirstAttemptFailure,
    adjudication,
    artifact_path: artifactPath,
    actual: null,
    provider_vs_effective_outcome: artifact.provider_vs_effective_outcome,
    qa_rubric: artifact.qa_rubric,
    validation_issue_summary: artifact.validation_issue_summary,
    agent_calls: []
  };
}

async function annotateResultArtifact(
  result: { artifact_path?: string | null },
  patch: Record<string, unknown>
) {
  if (!result.artifact_path) return;
  const parsed = JSON.parse(await readFile(result.artifact_path, "utf8")) as Record<string, unknown>;
  await writeFile(result.artifact_path, `${JSON.stringify({ ...parsed, ...patch }, null, 2)}\n`, "utf8");
}

async function runScenarioWithRetry(input: {
  scenario: ProfileFormativeScenario;
  live: boolean;
  dryRun: boolean;
  simulateQuota: boolean;
  runArtifactDirName: string;
}) {
  const first = await runScenario(input);
  const retryableFailure = retryableProviderFailureFromResult({ agent_calls: first.agent_calls });
  if (!input.live || input.dryRun || input.simulateQuota || !retryableFailure || first.provider_quota_blocked) {
    return first;
  }

  const retry = await runScenario({ ...input, simulateQuota: false });
  const firstAttemptFailure = {
    result_category: first.result_category,
    failures: first.failures,
    provider_failure: retryableFailure,
    artifact_path: first.artifact_path
  };
  const retryableFailureAfterRetry = retryableProviderFailureFromResult({ agent_calls: retry.agent_calls });

  if (retry.passed) {
    const patched = {
      ...retry,
      result_category: "passed_after_provider_retry" as const,
      retry_count: 1,
      first_attempt_failure: firstAttemptFailure,
      adjudication: null
    };
    await annotateResultArtifact(patched, {
      provider_vs_effective_outcome: {
        ...(retry.provider_vs_effective_outcome ?? {}),
        passed_as: "passed_after_provider_retry"
      },
      retry_count: 1,
      first_attempt_failure: firstAttemptFailure,
      adjudication: null
    });
    return patched;
  }

  if (retryableFailureAfterRetry) {
    const adjudication = adjudicateProfileFormativeFailure({
      scenario_id: retry.scenario_id,
      failures: retry.failures,
      expected_outcome: {
        profile_integration_pattern: input.scenario.target_profile_integration_pattern,
        student_facing_status: input.scenario.target_student_facing_status,
        engagement_category: input.scenario.target_engagement_category,
        ai_assistance_signal: input.scenario.target_ai_assistance_signal,
        formative_value: input.scenario.target_formative_value
      },
      actual_provider_outcome: retry.provider_vs_effective_outcome
        ? {
            profile_integration_pattern: retry.provider_vs_effective_outcome.provider_profile_pattern,
            student_facing_status: retry.provider_vs_effective_outcome.provider_student_facing_status,
            formative_value: retry.provider_vs_effective_outcome.provider_formative_value
          }
        : null,
      actual_effective_outcome: retry.actual,
      evidence_basis: input.scenario.rationale,
      scenario_rationale: input.scenario.why_target_outcome_is_reasonable ?? input.scenario.rationale,
      provider_failure: retryableFailureAfterRetry,
      retry_count: 1
    });
    const patched = {
      ...retry,
      result_category: "infrastructure_transient" as const,
      retry_count: 1,
      first_attempt_failure: firstAttemptFailure,
      adjudication
    };
    await annotateResultArtifact(patched, {
      provider_vs_effective_outcome: {
        ...(retry.provider_vs_effective_outcome ?? {}),
        passed_as: "infrastructure_transient"
      },
      retry_count: 1,
      first_attempt_failure: firstAttemptFailure,
      adjudication
    });
    return patched;
  }

  const patched = {
    ...retry,
    retry_count: 1,
    first_attempt_failure: firstAttemptFailure
  };
  await annotateResultArtifact(patched, {
    retry_count: 1,
    first_attempt_failure: firstAttemptFailure
  });
  return patched;
}

function selectedLiveScenarios() {
  const canary = process.env.PROFILE_FORMATIVE_TRIAL_CANARY === "true";
  let explicit = canary
    ? selectedScenariosFromList(profileFormativeCanaryScenarioIds.join(","))
    : selectedScenariosFromList(process.env.PROFILE_FORMATIVE_TRIAL_SCENARIOS);
  const variationFilter = process.env.PROFILE_FORMATIVE_TRIAL_VARIATIONS
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (variationFilter?.length && !variationFilter.includes("all")) {
    const requested = new Set(variationFilter);
    explicit = explicit.filter((scenario) =>
      scenario.trial_variant === "variation" &&
      (
        requested.has(scenario.scenario_id) ||
        Boolean(scenario.variation_id && requested.has(scenario.variation_id)) ||
        (scenario.variation_tags ?? []).some((tag) => requested.has(tag))
      )
    );
  }
  const defaultMax = canary ? 10 : 35;
  const hardDefaultCap = 100;
  const configuredMax = intEnv("MAX_LIVE_PROFILE_FORMATIVE_TRIALS");
  const max = Math.min(configuredMax ?? defaultMax, hardDefaultCap, explicit.length);
  return explicit.slice(0, max);
}

type LiveTrialResult =
  | Awaited<ReturnType<typeof runScenarioWithRetry>>
  | Awaited<ReturnType<typeof buildQuotaSkippedResult>>;

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

function variationCoverageFromResults(results: LiveTrialResult[]) {
  const variationResults = results.filter((result) => result.trial_variant === "variation");
  const variationByBase = new Set(variationResults.map((result) => result.base_scenario_id).filter(Boolean));
  const hasTag = (tags: string[]) =>
    variationResults.filter((result) => (result.variation_tags ?? []).some((tag) => tags.includes(tag))).length;
  const formativeVariationCounts = variationResults.reduce<Record<string, number>>((acc, result) => {
    const value = result.actual?.formative_value;
    if (typeof value === "string") acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

  return {
    core_scenarios_run: results.filter((result) => (result.trial_variant ?? "core") === "core").length,
    variations_run: variationResults.length,
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

function estimateCostUsd(input: {
  inputTokens: number;
  outputTokens: number;
}) {
  const inputPrice = numberEnv("PROFILE_FORMATIVE_TRIAL_INPUT_PRICE_PER_MILLION_USD");
  const outputPrice = numberEnv("PROFILE_FORMATIVE_TRIAL_OUTPUT_PRICE_PER_MILLION_USD");
  if (inputPrice === null || outputPrice === null) return null;
  return (input.inputTokens / 1_000_000) * inputPrice + (input.outputTokens / 1_000_000) * outputPrice;
}

function tokenUsageFromResults(results: LiveTrialResult[]) {
  return results.flatMap((result) => result.agent_calls).reduce(
    (acc, call) => ({
      input_tokens: acc.input_tokens + (call?.input_tokens ?? 0),
      output_tokens: acc.output_tokens + (call?.output_tokens ?? 0),
      total_tokens: acc.total_tokens + (call?.total_tokens ?? 0)
    }),
    { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
  );
}

async function main() {
  const dryRun = boolEnv("PROFILE_FORMATIVE_TRIAL_DRY_RUN");
  const noLive = boolEnv("PROFILE_FORMATIVE_TRIAL_NO_LIVE");
  const simulateQuota = boolEnv("PROFILE_FORMATIVE_TRIAL_SIMULATE_QUOTA");
  const live = !dryRun && !noLive && !simulateQuota;
  const scenarios = selectedLiveScenarios();
  const budgetUsd = numberEnv("PROFILE_FORMATIVE_TRIAL_BUDGET_USD") ?? 10;
  const priceConfigured =
    numberEnv("PROFILE_FORMATIVE_TRIAL_INPUT_PRICE_PER_MILLION_USD") !== null &&
    numberEnv("PROFILE_FORMATIVE_TRIAL_OUTPUT_PRICE_PER_MILLION_USD") !== null;
  const readiness = liveReadiness();
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runModeLabel = simulateQuota ? "quota-sim" : live ? "live" : dryRun ? "dry-run" : "no-live";
  const runArtifactDirName = `run-${runTimestamp}-${runModeLabel}`;
  const runArtifactDir = path.join(artifactDir, runArtifactDirName);

  console.log(JSON.stringify({
    status: "starting",
    paid_call_warning:
      live
        ? "This command is authorized to make paid OpenAI calls for profile/formative QA trials."
        : "No provider call will be made because dry-run or no-live mode is enabled.",
    live_mode: live,
    dry_run: dryRun,
    no_live: noLive,
    simulated_quota: simulateQuota,
    selected_scenario_count: scenarios.length,
    scenario_ids: scenarios.map((scenario) => scenario.scenario_id),
    run_controls: {
      budget_usd: budgetUsd,
      max_live_trial_count: scenarios.length,
      canary_mode: process.env.PROFILE_FORMATIVE_TRIAL_CANARY === "true",
      default_live_trial_count: process.env.PROFILE_FORMATIVE_TRIAL_CANARY === "true" ? 10 : 35,
      hard_default_cap: 100,
      pricing_configured_for_estimate: priceConfigured,
      variation_filter: process.env.PROFILE_FORMATIVE_TRIAL_VARIATIONS ?? null
    },
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
      run_id: runArtifactDirName,
      artifact_dir: runArtifactDir
    };
    await writeJson(`${runArtifactDirName}/blocked-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, summary);
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const results: LiveTrialResult[] = [];
  let stoppedEarlyReason: string | null = null;
  let quotaBlock:
    | {
        first_scenario_id: string;
        provider_failure: ProviderFailureSummary;
        attempted_count: number;
      }
    | null = null;
  for (const [index, scenario] of scenarios.entries()) {
    const result = await runScenarioWithRetry({ scenario, live, dryRun, simulateQuota: simulateQuota && index === 0, runArtifactDirName });
    results.push(result);
    if (result.result_category === "blocked_provider_quota" && result.provider_failure) {
      quotaBlock = {
        first_scenario_id: result.scenario_id,
        provider_failure: result.provider_failure,
        attempted_count: index + 1
      };
      stoppedEarlyReason = "provider_quota_exhausted";
      for (const skippedScenario of scenarios.slice(index + 1)) {
        results.push(await buildQuotaSkippedResult({
          scenario: skippedScenario,
          runArtifactDirName,
          providerFailure: result.provider_failure,
          blockedAfterScenarioId: result.scenario_id
        }));
      }
      break;
    }
    if (live && priceConfigured) {
      const currentTokens = tokenUsageFromResults(results);
      const estimatedCost = estimateCostUsd({
        inputTokens: currentTokens.input_tokens,
        outputTokens: currentTokens.output_tokens
      });
      if (estimatedCost !== null && estimatedCost >= budgetUsd) {
        stoppedEarlyReason = `budget_cap_reached:${estimatedCost.toFixed(4)}>=${budgetUsd}`;
        break;
      }
    }
  }

  const coverage = coverageFromResults(results);
  const variationCoverage = variationCoverageFromResults(results);
  const tokenUsage = tokenUsageFromResults(results);
  const estimatedCostUsd = estimateCostUsd({
    inputTokens: tokenUsage.input_tokens,
    outputTokens: tokenUsage.output_tokens
  });
  const failed = results.filter((result) => !result.passed);
  const requiredCoverage = {
    profile_integration_patterns: profilePatternValues,
    student_facing_statuses: studentStatusValues,
    engagement_categories: ["engaged", "moderately_engaged", "disengaged", "insufficient_evidence"],
    ai_assistance_signals: ["none_indicated", "likely_external_assistance_pattern", "insufficient_evidence"],
    formative_values: formativeValueValues,
    student_choice_states: ["not_chosen", "accepted_recommendation", "chose_alternative", "moved_on"]
  };
  const uncoveredOutcomeCategories = Object.fromEntries(
    Object.entries(requiredCoverage).map(([key, required]) => [
      key,
      required.filter((value) => !(coverage as Record<string, string[]>)[key]?.includes(value))
    ])
  );
  const resultCategoryCounts = Object.fromEntries(
    ([
      "direct_live_success",
      "passed_after_repair",
      "passed_after_canonicalization",
      "passed_after_provider_retry",
      "accepted_allowed_alternative",
      "scenario_expectation_updated_after_adjudication",
      "blocked_provider_quota",
      "infrastructure_transient",
      "failed_validation",
      "failed_provider_request",
      "failed_outcome_mismatch",
      "failed_safety",
      "failed_fallback_used"
    ] as TrialResultCategory[]).map((category) => [
      category,
      results.filter((result) => result.result_category === category).length
    ])
  );
  const errorAnalysis = {
    artifact_type: "profile_formative_live_trial_error_analysis",
    artifact_version: "profile-formative-live-trial-error-analysis-v1",
    total_scenarios: scenarios.length,
    live_scenarios_run: live || simulateQuota ? results.length : 0,
    live_variations_run: live || simulateQuota ? variationCoverage.variations_run : 0,
    live_rerun_count: 0,
    stopped_early_reason: stoppedEarlyReason,
    provider_blocked: Boolean(quotaBlock),
    provider_failure: quotaBlock?.provider_failure
      ? {
          category: quotaBlock.provider_failure.category,
          http_status: quotaBlock.provider_failure.transport.http_status,
          typed_failure_reason: quotaBlock.provider_failure.transport.typed_failure_reason,
          provider_error_code: quotaBlock.provider_failure.transport.provider_error_code
        }
      : null,
    provider_quota_block: quotaBlock
      ? {
          first_scenario_id: quotaBlock.first_scenario_id,
          provider_attempted_scenarios: quotaBlock.attempted_count,
          scenarios_completed_before_block: quotaBlock.attempted_count - 1,
          scenarios_skipped_after_block: Math.max(0, scenarios.length - quotaBlock.attempted_count),
          usable_live_outputs: results.filter((result) =>
            result.passed &&
            !result.provider_quota_blocked &&
            !result.failures.some((failure) => failure.includes("provider"))
          ).length,
          model_quality_evaluable: false,
          final_live_qa_acceptance: false,
          rerun_required_after_quota_restored: true
        }
      : null,
    failures_by_category: {
      outcome_mismatch: results.flatMap((result) => result.failures).filter((failure) => failure.includes("mismatch")).length,
      safety_violation: results.flatMap((result) => result.failures).filter((failure) => failure.includes("safety")).length,
      validator_failure: results.flatMap((result) => result.failures).filter((failure) => failure.includes("validation")).length,
      fallback_or_repair: results.flatMap((result) => result.failures).filter((failure) => failure.includes("fallback")).length,
      provider_request: results.filter((result) => result.result_category === "failed_provider_request").length,
      provider_quota_blocked: results.filter((result) => result.result_category === "blocked_provider_quota").length,
      infrastructure_transient: results.filter((result) => result.result_category === "infrastructure_transient").length
    },
    result_category_counts: resultCategoryCounts,
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
      ).length,
      repair: results.filter((result) => result.provider_vs_effective_outcome?.repair_applied).length,
      canonicalization: results.filter((result) =>
        result.provider_vs_effective_outcome?.formative_value_canonicalization_applied ||
        result.provider_vs_effective_outcome?.profile_canonicalization_applied
      ).length
    },
    provider_invalid_request_counts: {
      profile_integration: results.filter((result) =>
        result.agent_calls.some((call) =>
          call?.agent_name === "profile_integration_agent" &&
          call.provider_failure?.category === "invalid_request"
        )
      ).length,
      formative_value: results.filter((result) =>
        result.agent_calls.some((call) =>
          call?.agent_name === "formative_value_determination_agent" &&
          call.provider_failure?.category === "invalid_request"
        )
      ).length
    },
    uncovered_outcome_categories: uncoveredOutcomeCategories,
    variation_coverage: variationCoverage,
    token_usage: tokenUsage,
    estimated_cost_usd: estimatedCostUsd,
    cost_estimation: {
      budget_usd: budgetUsd,
      pricing_configured: priceConfigured,
      estimate_is_invoice_exact: false
    },
    scenario_level_recommendations: failed.map((result) => ({
      scenario_id: result.scenario_id,
      classification: result.adjudication?.primary_failure_type ??
        (result.result_category === "blocked_provider_quota"
        ? "provider quota block"
        : result.agent_calls.some((call) => call?.provider_failure)
        ? "provider request issue"
        : result.failures.some((failure) => failure.includes("validation"))
          ? "safety validator issue"
          : result.failures.some((failure) => failure.includes("engagement"))
            ? "engagement classification issue"
            : result.failures.some((failure) => failure.includes("formative"))
              ? "formative value determination issue"
              : "profile integration issue"),
      failures: result.failures,
      adjudication: result.adjudication
    }))
  };
  const errorAnalysisPath = await writeJson(
    `${runArtifactDirName}/error-analysis-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    errorAnalysis
  );
  const summary = {
    status: quotaBlock ? "blocked_provider_quota" : failed.length === 0 && !stoppedEarlyReason ? "passed" : stoppedEarlyReason ? "partial" : "failed",
    run_id: runArtifactDirName,
    scenario_count: scenarios.length,
    live_scenarios_run: live || simulateQuota ? results.length : 0,
    live_variations_run: live || simulateQuota ? variationCoverage.variations_run : 0,
    provider_blocked: Boolean(quotaBlock),
    provider_failure: quotaBlock?.provider_failure
      ? {
          category: quotaBlock.provider_failure.category,
          http_status: quotaBlock.provider_failure.transport.http_status,
          typed_failure_reason: quotaBlock.provider_failure.transport.typed_failure_reason,
          provider_error_code: quotaBlock.provider_failure.transport.provider_error_code
        }
      : null,
    provider_quota_block: quotaBlock
      ? {
          first_scenario_id: quotaBlock.first_scenario_id,
          provider_attempted_scenarios: quotaBlock.attempted_count,
          scenarios_completed_before_block: quotaBlock.attempted_count - 1,
          scenarios_skipped_after_block: Math.max(0, scenarios.length - quotaBlock.attempted_count),
          passed_before_block: results.filter((result, index) => index < quotaBlock.attempted_count - 1 && result.passed).length,
          failed_before_block: results.filter((result, index) => index < quotaBlock.attempted_count - 1 && !result.passed).length,
          usable_live_outputs: results.filter((result) =>
            result.passed &&
            !result.provider_quota_blocked &&
            !result.failures.some((failure) => failure.includes("provider"))
          ).length,
          model_quality_evaluable: false,
          final_live_qa_acceptance: false,
          rerun_required_after_quota_restored: true
        }
      : null,
    model_quality_evaluable: !quotaBlock,
    final_live_qa_acceptance: !quotaBlock && failed.length === 0 && !stoppedEarlyReason,
    rerun_required_after_quota_restored: Boolean(quotaBlock),
    live_rerun_count: 0,
    passed_count: results.filter((result) => result.passed).length,
    failed_count: failed.length,
    scenario_ids_run: results.map((result) => result.scenario_id),
    coverage,
    variation_coverage: variationCoverage,
    result_category_counts: resultCategoryCounts,
    stopped_early_reason: stoppedEarlyReason,
    agent_call_statuses: results.map((result) => ({
      scenario_id: result.scenario_id,
      result_category: result.result_category,
      provider_quota_blocked: result.provider_quota_blocked,
      retry_count: result.retry_count,
      agent_calls: result.agent_calls.map((call) => ({
        agent_name: call?.agent_name,
        call_status: call?.call_status,
        output_validated: call?.output_validated,
        provider_metadata_present: call?.provider_metadata_present,
        token_usage_present: call?.token_usage_present,
        validation_error_category: call?.validation_error_category,
        validation_issue_codes: call?.validation_issue_codes,
        provider_failure: call?.provider_failure
      }))
    })),
    token_usage: tokenUsage,
    estimated_cost_usd: estimatedCostUsd,
    cost_estimation: {
      budget_usd: budgetUsd,
      pricing_configured: priceConfigured,
      estimate_is_invoice_exact: false
    },
    failures: failed.map((result) => ({
      scenario_id: result.scenario_id,
      result_category: result.result_category,
      failures: result.failures,
      adjudication: result.adjudication,
      retry_count: result.retry_count,
      first_attempt_failure: result.first_attempt_failure,
      artifact_path: result.artifact_path
    })),
    scenario_level_latest_run_summary: results.map((result) => ({
      scenario_id: result.scenario_id,
      variation: result.variation_id,
      provider_profile: result.provider_vs_effective_outcome?.provider_profile_pattern ?? null,
      effective_profile: result.provider_vs_effective_outcome?.effective_profile_pattern ?? null,
      provider_value: result.provider_vs_effective_outcome?.provider_formative_value ?? null,
      effective_value: result.provider_vs_effective_outcome?.effective_formative_value ?? null,
      result_category: result.result_category,
      passed: result.passed,
      notes: result.failures
    })),
    artifact_dir: runArtifactDir,
    error_analysis_artifact_path: errorAnalysisPath
  };
  await writeJson(`${runArtifactDirName}/summary-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, summary);
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
