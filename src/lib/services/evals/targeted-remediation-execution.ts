import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { agentInputSchemas, agentOutputSchemas } from "@/lib/agents/contracts";
import type { AgentName as AgentNameType } from "@/lib/agents/names";
import { checkStructuredOutputCompatibilityForAgent, structuredOutputCompatibilitySummary, type StructuredOutputCompatibilityResult } from "@/lib/agents/provider-schema-compat";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { defaultFormativeValueForIntegratedProfile } from "@/lib/agents/formative-planning/mapping";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { OpenAIResponsesProvider } from "@/lib/llm/providers/openai-responses-provider";
import type { LlmProvider } from "@/lib/llm/providers/types";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { reserveEvalBudget, costFromActualUsage, type EvalBudgetState } from "./budget-guard";
import { getEvalCanaryOutputTokenLimits, sha256Json, stableJson } from "./canary-config";
import { EvalServiceError } from "./errors";
import { getEvalPricingEntry, estimateEvalRequestUpperBoundUsd } from "./pricing";
import { seedEvalFixtures } from "./service";
import {
  EVAL_SAFETY_VALIDATOR_VERSION,
  EVAL_SEMANTIC_VALIDATOR_VERSION,
  safetyValidateOutput,
  schemaValidateAgentOutput,
  semanticValidateAgentOutput
} from "./validation";
import { parseEvalProviderUsage, usageTokenCounts } from "./usage-parser";
import {
  EVAL_TARGETED_REMEDIATION_AGENT_ORDER,
  EVAL_TARGETED_REMEDIATION_BASELINE_RUN_PUBLIC_ID,
  EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
  EVAL_TARGETED_REMEDIATION_ORDERING_ALGORITHM_VERSION,
  EVAL_TARGETED_REMEDIATION_PHASE,
  EVAL_TARGETED_REMEDIATION_REASONING_EFFORT,
  EVAL_TARGETED_REMEDIATION_REPETITIONS,
  EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
  loadTargetedRemediationManifest
} from "./targeted-remediation-manifest";
import {
  EFFECTIVE_SYSTEM_REVIEW_TARGET,
  RAW_MODEL_REVIEW_TARGET,
  buildEffectiveSystemArtifact,
  effectiveArtifactHasCriticalFailure,
  effectiveArtifactHasStudentFacingFailure,
  effectiveArtifactHasWorkflowFailure,
  effectiveArtifactIsSafe
} from "./effective-system-artifacts";

type TargetedPlanIssue = { code: string; message: string; details?: unknown };

type TargetedCasePlan = {
  agent_name: AgentNameType;
  case_id: string;
  case_db_id: string;
  case_public_id: string;
  stratum: "affected" | "control";
  remediation_focus: string;
  repetition_index: number;
  paired_case_key: string;
  run_order: number;
  input_payload: unknown;
  expected_output: unknown;
  gold_labels: unknown;
  rubric_expectations: unknown;
  safety_expectations: unknown;
  case_source: string;
  case_hash: string;
  prompt_version: string;
  schema_version: string;
  prompt_hash: string;
  agent_version: string;
  instructions: string;
  max_output_tokens: number;
  estimated_upper_bound_usd: number;
};

type TargetedPlan = {
  valid: boolean;
  issues: TargetedPlanIssue[];
  teacher: { id: string; user_id: string; role: string };
  manifest_version: string;
  manifest_hash: string;
  git_commit: string;
  run_config_hash: string;
  run_config_snapshot: Record<string, unknown>;
  prompt_versions: Record<string, string>;
  schema_versions: Record<string, string>;
  prompt_hashes: Record<string, string>;
  max_output_tokens_by_agent: Record<string, number>;
  pricing: NonNullable<ReturnType<typeof getEvalPricingEntry>>;
  total_estimated_upper_bound_usd: number;
  cases: TargetedCasePlan[];
  provider_payload_count: number;
};

type TargetedRunOptions = {
  runPublicId?: string;
  runInstanceMode?: "new_run" | "resume";
  confirmPaidApi: boolean;
  provider?: LlmProvider;
  allowMockProvider?: boolean;
  compatibilityCheck?: (agentName: AgentNameType) => StructuredOutputCompatibilityResult;
};

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  return value === null || value === undefined ? 0 : Number(value);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

const TARGETED_REMEDIATION_FOCUS: Record<string, string> = {
  rca_mixed_reasoning_correctness_007: "mixed reasoning capture with correctness refusal",
  iva_duplicate_items_010: "deterministic duplicate advisory",
  fua_move_on_offer_010: "move-on nonsubstantive technical trigger",
  fua_consolidation_transfer_006: "transfer action compatibility",
  fpa_mapping_followed_006: "backend-canonical followed mapping",
  fpa_mapping_deviation_with_rationale_007: "backend-canonical mapping deviation rationale",
  iva_clean_item_set_001: "item verification control",
  rca_hint_request_004: "response collection help-refusal control",
  spa_robust_understanding_001: "student profiling control",
  fpa_diagnostic_clarification_001: "formative planning control",
  fua_off_topic_redirect_007: "follow-up off-topic redirect control"
};

function safeGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "unknown";
  }
}

function sdkVersion() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("openai/package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function promptMetadataForAgent(agentName: AgentNameType) {
  const prompt = getPromptForAgent(agentName);

  return {
    prompt_version: prompt.prompt_version,
    schema_version: prompt.schema_version,
    prompt_hash: prompt.prompt_hash,
    agent_version: prompt.agent_version ?? "unknown",
    instructions: prompt.instructions
  };
}

async function resolveTeacherForTargetedRun() {
  const teacher =
    (await prisma.user.findUnique({
      where: { user_id: "teacher_demo" },
      select: { id: true, user_id: true, role: true }
    })) ??
    (await prisma.user.findFirst({
      where: { role: "teacher_researcher" },
      orderBy: { created_at: "asc" },
      select: { id: true, user_id: true, role: true }
    }));

  if (!teacher || teacher.role !== "teacher_researcher") {
    throw new EvalServiceError(
      "teacher_missing",
      "A teacher_researcher account is required before running targeted remediation evaluation commands.",
      400
    );
  }

  return teacher;
}

function augmentProviderInput(agentName: AgentNameType, inputPayload: unknown) {
  if (agentName !== "formative_value_and_planning_agent") {
    return inputPayload;
  }

  const input = jsonRecord(inputPayload);
  const latestProfile = jsonRecord(input.latest_student_profile);
  const integrated = latestProfile.integrated_diagnostic_profile;

  if (typeof integrated !== "string") {
    return inputPayload;
  }

  const defaultValue = defaultFormativeValueForIntegratedProfile(integrated);
  const constraints = jsonRecord(input.planning_constraints);

  return {
    ...input,
    planning_constraints: {
      ...constraints,
      default_formative_value: defaultValue,
      mapping_rule:
        "The backend treats this as the default, not an absolute requirement; deviations require mapping_followed=false and a substantive evidence-linked mapping_deviation_reason."
    }
  };
}

async function ensureTargetedSuite(teacherDbId: string) {
  return prisma.evalSuite.upsert({
    where: {
      agent_name_title: {
        agent_name: "targeted_remediation",
        title: "Phase 7E2C targeted remediation"
      }
    },
    create: {
      suite_public_id: generatePublicId("eval_suite"),
      title: "Phase 7E2C targeted remediation",
      description:
        "Evaluation-only container for the 22-output targeted remediation regression run.",
      agent_name: "targeted_remediation",
      status: "active",
      created_by_user_db_id: teacherDbId
    },
    update: {
      description:
        "Evaluation-only container for the 22-output targeted remediation regression run.",
      status: "active"
    }
  });
}

function targetedEnvSnapshot() {
  const env = getServerEnv();

  return {
    provider: env.EVAL_PROVIDER,
    live_calls_enabled: env.EVAL_LIVE_CALLS_ENABLED,
    api_key_configured: typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim().length > 0,
    model_snapshot: env.EVAL_TARGET_MODEL,
    required_model_snapshot: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
    reasoning_effort: env.EVAL_REASONING_EFFORT,
    repetition_count: EVAL_TARGETED_REMEDIATION_REPETITIONS,
    planned_run_item_count: EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    cost_hard_limit_usd: env.EVAL_TARGETED_REMEDIATION_COST_HARD_LIMIT_USD,
    max_provider_requests: env.EVAL_TARGETED_REMEDIATION_MAX_PROVIDER_REQUESTS,
    max_concurrency: env.EVAL_TARGETED_REMEDIATION_MAX_CONCURRENCY,
    max_retries: env.EVAL_TARGETED_REMEDIATION_MAX_RETRIES,
    request_timeout_ms: env.EVAL_TARGETED_REMEDIATION_REQUEST_TIMEOUT_MS,
    classroom_provider: env.LLM_PROVIDER,
    classroom_live_calls_enabled: env.LLM_LIVE_CALLS_ENABLED,
    max_output_tokens_by_agent: getEvalCanaryOutputTokenLimits()
  };
}

function targetedConfigIssues(input: {
  requireLiveEnabled: boolean;
  requireApiKey: boolean;
}) {
  const snapshot = targetedEnvSnapshot();
  const issues: TargetedPlanIssue[] = [];

  if (snapshot.provider !== "openai") {
    issues.push({ code: "eval_provider_not_openai", message: "EVAL_PROVIDER=openai is required for paid targeted remediation evaluation." });
  }

  if (input.requireLiveEnabled && !snapshot.live_calls_enabled) {
    issues.push({ code: "eval_live_calls_disabled", message: "EVAL_LIVE_CALLS_ENABLED=true is required for paid targeted remediation evaluation." });
  }

  if (input.requireApiKey && !snapshot.api_key_configured) {
    issues.push({ code: "openai_key_missing", message: "OPENAI_API_KEY must be configured locally before paid targeted remediation evaluation." });
  }

  if (snapshot.model_snapshot !== EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT) {
    issues.push({ code: "invalid_model_snapshot", message: `EVAL_TARGET_MODEL must be exactly ${EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT}.` });
  }

  if (snapshot.reasoning_effort !== EVAL_TARGETED_REMEDIATION_REASONING_EFFORT) {
    issues.push({ code: "invalid_reasoning_effort", message: "EVAL_REASONING_EFFORT must be low for targeted remediation evaluation." });
  }

  if (snapshot.max_concurrency !== 1) {
    issues.push({ code: "invalid_concurrency", message: "EVAL_TARGETED_REMEDIATION_MAX_CONCURRENCY must be 1." });
  }

  if (snapshot.max_retries !== 1) {
    issues.push({ code: "invalid_retry_count", message: "EVAL_TARGETED_REMEDIATION_MAX_RETRIES must be 1." });
  }

  if (snapshot.max_provider_requests > 35) {
    issues.push({ code: "provider_request_limit_too_high", message: "EVAL_TARGETED_REMEDIATION_MAX_PROVIDER_REQUESTS must not exceed 35." });
  }

  if (snapshot.cost_hard_limit_usd > 10) {
    issues.push({ code: "cost_limit_too_high", message: "EVAL_TARGETED_REMEDIATION_COST_HARD_LIMIT_USD must not exceed 10." });
  }

  if (snapshot.classroom_provider !== "mock" || snapshot.classroom_live_calls_enabled) {
    issues.push({ code: "classroom_live_calls_not_mocked", message: "Classroom LLM settings must remain LLM_PROVIDER=mock and LLM_LIVE_CALLS_ENABLED=false." });
  }

  for (const [agentName, limit] of Object.entries(snapshot.max_output_tokens_by_agent)) {
    if (!Number.isInteger(limit) || limit <= 0) {
      issues.push({ code: "invalid_max_output_tokens", message: `Max output tokens for ${agentName} must be a positive integer.` });
    }
  }

  return {
    snapshot,
    issues,
    config_hash: sha256Json(snapshot)
  };
}

function redactionCheck(value: unknown) {
  const text = stableJson(value);
  const patterns = [
    /OPENAI_API_KEY/i,
    /SESSION_SECRET/i,
    /DATABASE_URL/i,
    /authorization/i,
    /password_hash/i,
    /access_code_hash/i,
    /sk-[A-Za-z0-9_-]+/
  ];

  return { ok: !patterns.some((pattern) => pattern.test(text)) };
}

function targetedOrder(baseCases: Omit<TargetedCasePlan, "repetition_index" | "run_order">[]) {
  const ordered = [...baseCases].sort((left, right) => {
    const agentDelta =
      EVAL_TARGETED_REMEDIATION_AGENT_ORDER.indexOf(left.agent_name) -
      EVAL_TARGETED_REMEDIATION_AGENT_ORDER.indexOf(right.agent_name);

    if (agentDelta !== 0) {
      return agentDelta;
    }

    if (left.stratum !== right.stratum) {
      return left.stratum === "affected" ? -1 : 1;
    }

    return left.case_id.localeCompare(right.case_id);
  });
  const planned: TargetedCasePlan[] = [];
  let runOrder = 1;

  for (const entry of ordered) {
    for (let repetitionIndex = 1; repetitionIndex <= EVAL_TARGETED_REMEDIATION_REPETITIONS; repetitionIndex += 1) {
      planned.push({
        ...entry,
        repetition_index: repetitionIndex,
        run_order: runOrder
      });
      runOrder += 1;
    }
  }

  return planned;
}

async function buildTargetedRemediationPlan(input: {
  requireLiveEnabled?: boolean;
  requireApiKey?: boolean;
} = {}): Promise<TargetedPlan> {
  const teacher = await resolveTeacherForTargetedRun();
  await seedEvalFixtures(teacher.id);

  const envCheck = targetedConfigIssues({
    requireLiveEnabled: input.requireLiveEnabled === true,
    requireApiKey: input.requireApiKey === true
  });
  const manifest = await loadTargetedRemediationManifest();
  const pricing = getEvalPricingEntry(EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT);
  const issues: TargetedPlanIssue[] = [...envCheck.issues, ...manifest.issues];
  const outputTokenLimits = getEvalCanaryOutputTokenLimits();
  const promptVersions: Record<string, string> = {};
  const schemaVersions: Record<string, string> = {};
  const promptHashes: Record<string, string> = {};
  const baseCases: Omit<TargetedCasePlan, "repetition_index" | "run_order">[] = [];
  let totalEstimatedUpperBoundUsd = 0;

  if (!pricing) {
    issues.push({
      code: "missing_pricing_entry",
      message: `No evaluation pricing entry exists for ${EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT}.`
    });
  }

  for (const manifestCase of manifest.ordered_base_cases) {
    const evalCase = await prisma.evalCase.findFirst({
      where: {
        case_id: manifestCase.case_id,
        agent_name: manifestCase.agent_name,
        status: "active"
      },
      select: {
        id: true,
        case_public_id: true,
        case_id: true,
        agent_name: true,
        input_payload: true,
        expected_output: true,
        gold_labels: true,
        rubric_expectations: true,
        safety_expectations: true,
        case_source: true
      }
    });

    if (!evalCase) {
      issues.push({
        code: "targeted_case_missing",
        message: `${manifestCase.agent_name}:${manifestCase.case_id} was not found.`
      });
      continue;
    }

    if (evalCase.case_source !== "synthetic") {
      issues.push({
        code: "nonsynthetic_case_rejected",
        message: `${manifestCase.case_id} is not synthetic.`
      });
    }

    const providerInput = augmentProviderInput(manifestCase.agent_name, evalCase.input_payload);
    const parsedInput = agentInputSchemas[manifestCase.agent_name].safeParse(providerInput);
    if (!parsedInput.success) {
      issues.push({
        code: "input_schema_invalid",
        message: `${manifestCase.case_id} input does not match ${manifestCase.agent_name}.`
      });
    }

    const prompt = promptMetadataForAgent(manifestCase.agent_name);
    promptVersions[manifestCase.agent_name] = prompt.prompt_version;
    schemaVersions[manifestCase.agent_name] = prompt.schema_version;
    promptHashes[manifestCase.agent_name] = prompt.prompt_hash;
    const payload = parsedInput.success ? parsedInput.data : providerInput;
    const maxOutputTokens = outputTokenLimits[manifestCase.agent_name];
    const estimate = estimateEvalRequestUpperBoundUsd({
      model_snapshot: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
      instructions: prompt.instructions,
      payload,
      max_output_tokens: maxOutputTokens,
      retry_allowance: getServerEnv().EVAL_TARGETED_REMEDIATION_MAX_RETRIES
    });
    totalEstimatedUpperBoundUsd += estimate.estimated_upper_bound_usd * EVAL_TARGETED_REMEDIATION_REPETITIONS;
    const caseHash = sha256Json({
      case_id: evalCase.case_id,
      agent_name: evalCase.agent_name,
      stratum: manifestCase.stratum,
      remediation_focus: manifestCase.remediation_focus,
      input_payload: payload,
      expected_output: evalCase.expected_output,
      gold_labels: evalCase.gold_labels,
      rubric_expectations: evalCase.rubric_expectations,
      safety_expectations: evalCase.safety_expectations,
      case_source: evalCase.case_source
    });

    baseCases.push({
      agent_name: manifestCase.agent_name,
      case_id: evalCase.case_id,
      case_db_id: evalCase.id,
      case_public_id: evalCase.case_public_id,
      stratum: manifestCase.stratum,
      remediation_focus: manifestCase.remediation_focus,
      paired_case_key: `${manifestCase.agent_name}:${evalCase.case_id}`,
      input_payload: payload,
      expected_output: evalCase.expected_output,
      gold_labels: evalCase.gold_labels,
      rubric_expectations: evalCase.rubric_expectations,
      safety_expectations: evalCase.safety_expectations,
      case_source: evalCase.case_source,
      case_hash: caseHash,
      prompt_version: prompt.prompt_version,
      schema_version: prompt.schema_version,
      prompt_hash: prompt.prompt_hash,
      agent_version: prompt.agent_version,
      instructions: prompt.instructions,
      max_output_tokens: maxOutputTokens,
      estimated_upper_bound_usd: estimate.estimated_upper_bound_usd
    });
  }

  const cases = targetedOrder(baseCases);
  if (cases.length !== EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS) {
    issues.push({
      code: "invalid_planned_output_count",
      message: `Targeted remediation must plan exactly ${EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS} outputs.`
    });
  }

  const runConfigSnapshot = {
    evaluation_phase: EVAL_TARGETED_REMEDIATION_PHASE,
    baseline_run_public_id: EVAL_TARGETED_REMEDIATION_BASELINE_RUN_PUBLIC_ID,
    targeted_manifest_hash: manifest.manifest_hash,
    targeted_manifest_version: manifest.manifest.manifest_version,
    model_snapshot: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
    reasoning_effort: EVAL_TARGETED_REMEDIATION_REASONING_EFFORT,
    repetition_count: EVAL_TARGETED_REMEDIATION_REPETITIONS,
    planned_run_item_count: EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    ordering_algorithm_version: EVAL_TARGETED_REMEDIATION_ORDERING_ALGORITHM_VERSION,
    run_order: cases.map((entry) => ({
      run_order: entry.run_order,
      paired_case_key: entry.paired_case_key,
      stratum: entry.stratum,
      remediation_focus: entry.remediation_focus,
      repetition_index: entry.repetition_index
    })),
    targeted_env: {
      cost_hard_limit_usd: getServerEnv().EVAL_TARGETED_REMEDIATION_COST_HARD_LIMIT_USD,
      max_provider_requests: getServerEnv().EVAL_TARGETED_REMEDIATION_MAX_PROVIDER_REQUESTS,
      max_concurrency: getServerEnv().EVAL_TARGETED_REMEDIATION_MAX_CONCURRENCY,
      max_retries: getServerEnv().EVAL_TARGETED_REMEDIATION_MAX_RETRIES,
      request_timeout_ms: getServerEnv().EVAL_TARGETED_REMEDIATION_REQUEST_TIMEOUT_MS
    },
    prompt_versions: promptVersions,
    schema_versions: schemaVersions,
    prompt_hashes: promptHashes,
    semantic_validator_version: EVAL_SEMANTIC_VALIDATOR_VERSION,
    safety_validator_version: EVAL_SAFETY_VALIDATOR_VERSION,
    pricing_registry_version: pricing?.pricing_registry_version ?? "missing"
  };

  return {
    valid: issues.length === 0,
    issues,
    teacher,
    manifest_version: manifest.manifest.manifest_version,
    manifest_hash: manifest.manifest_hash,
    git_commit: safeGitCommit(),
    run_config_hash: sha256Json(runConfigSnapshot),
    run_config_snapshot: runConfigSnapshot,
    prompt_versions: promptVersions,
    schema_versions: schemaVersions,
    prompt_hashes: promptHashes,
    max_output_tokens_by_agent: outputTokenLimits,
    pricing: pricing ?? {
      pricing_registry_version: "missing",
      model_snapshot: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
      input_price_per_million_tokens: 0,
      cached_input_price_per_million_tokens: 0,
      output_price_per_million_tokens: 0,
      effective_date: "",
      source_checked_at: "",
      source_url: ""
    },
    total_estimated_upper_bound_usd: totalEstimatedUpperBoundUsd,
    cases,
    provider_payload_count: cases.length
  };
}

export async function createTargetedRemediationPreflightReport() {
  const plan = await buildTargetedRemediationPlan({
    requireLiveEnabled: false,
    requireApiKey: false
  });
  const redaction = redactionCheck({
    config: targetedEnvSnapshot(),
    cases: plan.cases.map((entry) => ({
      agent_name: entry.agent_name,
      case_id: entry.case_id,
      case_hash: entry.case_hash
    }))
  });
  const issues = [...plan.issues];

  if (!redaction.ok) {
    issues.push({
      code: "redaction_check_failed",
      message: "Preflight report would contain secret-like content."
    });
  }

  return {
    ready: issues.length === 0,
    issues,
    openai_call_made: false,
    baseline_run_public_id: EVAL_TARGETED_REMEDIATION_BASELINE_RUN_PUBLIC_ID,
    exact_model_snapshot: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
    reasoning_effort: EVAL_TARGETED_REMEDIATION_REASONING_EFFORT,
    planned_run_item_count: plan.cases.length,
    affected_case_count: plan.cases.filter((entry) => entry.stratum === "affected" && entry.repetition_index === 1).length,
    control_case_count: plan.cases.filter((entry) => entry.stratum === "control" && entry.repetition_index === 1).length,
    repetition_count: EVAL_TARGETED_REMEDIATION_REPETITIONS,
    prompt_versions: plan.prompt_versions,
    schema_versions: plan.schema_versions,
    prompt_hashes: plan.prompt_hashes,
    evaluator_versions: {
      semantic_validator_version: EVAL_SEMANTIC_VALIDATOR_VERSION,
      safety_validator_version: EVAL_SAFETY_VALIDATOR_VERSION
    },
    output_token_limits: plan.max_output_tokens_by_agent,
    pricing: plan.pricing,
    estimated_upper_bound_cost_usd: plan.total_estimated_upper_bound_usd,
    cost_hard_limit_usd: getServerEnv().EVAL_TARGETED_REMEDIATION_COST_HARD_LIMIT_USD,
    max_provider_requests: getServerEnv().EVAL_TARGETED_REMEDIATION_MAX_PROVIDER_REQUESTS,
    concurrency: getServerEnv().EVAL_TARGETED_REMEDIATION_MAX_CONCURRENCY,
    retry_limit: getServerEnv().EVAL_TARGETED_REMEDIATION_MAX_RETRIES,
    classroom_provider: getServerEnv().LLM_PROVIDER,
    classroom_live_calls_enabled: getServerEnv().LLM_LIVE_CALLS_ENABLED,
    synthetic_only: plan.cases.every((entry) => entry.case_source === "synthetic"),
    manifest_hash: plan.manifest_hash,
    run_config_hash: plan.run_config_hash,
    current_git_commit: plan.git_commit,
    redaction_ok: redaction.ok,
    database_ready: plan.cases.length === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS
  };
}

export async function createTargetedRemediationDryRunReport() {
  const plan = await buildTargetedRemediationPlan({
    requireLiveEnabled: false,
    requireApiKey: false
  });
  const payloads = plan.cases.map((entry) => ({
    run_order: entry.run_order,
    agent_name: entry.agent_name,
    stratum: entry.stratum,
    remediation_focus: entry.remediation_focus,
    repetition_index: entry.repetition_index,
    paired_case_key: entry.paired_case_key,
    model: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
    reasoning: { effort: "low" },
    max_output_tokens: entry.max_output_tokens,
    case_hash: entry.case_hash,
    prompt_hash: entry.prompt_hash,
    schema_name: entry.schema_version,
    store: false,
    tools: []
  }));
  const redaction = redactionCheck({ payloads, cases: plan.cases.map((entry) => entry.input_payload) });
  const issues = [...plan.issues];

  if (!redaction.ok) {
    issues.push({
      code: "redaction_check_failed",
      message: "Dry-run payloads contain secret-like content."
    });
  }

  return {
    ready: issues.length === 0,
    issues,
    openai_call_made: false,
    paid_api_request_made: false,
    provider_payload_count: payloads.length,
    provider_payloads: payloads,
    structured_output_compatibility: structuredOutputCompatibilitySummary(),
    redaction_ok: redaction.ok,
    manifest_hash: plan.manifest_hash,
    run_config_hash: plan.run_config_hash,
    new_run_public_id_preview: generatePublicId("eval_run"),
    new_run_would_create_new_run_instance: true,
    operational_records_referenced: false,
    estimated_upper_bound_cost_usd: plan.total_estimated_upper_bound_usd,
    cost_hard_limit_usd: getServerEnv().EVAL_TARGETED_REMEDIATION_COST_HARD_LIMIT_USD,
    message: "Dry run completed without any provider request."
  };
}

function reproducibilityManifest(plan: TargetedPlan, runPublicId: string) {
  return {
    run_public_id: runPublicId,
    evaluation_phase: EVAL_TARGETED_REMEDIATION_PHASE,
    baseline_run_public_id: EVAL_TARGETED_REMEDIATION_BASELINE_RUN_PUBLIC_ID,
    application_git_commit: plan.git_commit,
    targeted_manifest_version: plan.manifest_version,
    targeted_manifest_hash: plan.manifest_hash,
    model_snapshot: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
    reasoning_effort: EVAL_TARGETED_REMEDIATION_REASONING_EFFORT,
    repetition_count: EVAL_TARGETED_REMEDIATION_REPETITIONS,
    planned_run_item_count: EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    ordering_algorithm_version: EVAL_TARGETED_REMEDIATION_ORDERING_ALGORITHM_VERSION,
    run_config_hash: plan.run_config_hash,
    run_config_snapshot: plan.run_config_snapshot,
    prompt_versions: plan.prompt_versions,
    schema_versions: plan.schema_versions,
    prompt_hashes: plan.prompt_hashes,
    semantic_validator_version: EVAL_SEMANTIC_VALIDATOR_VERSION,
    safety_validator_version: EVAL_SAFETY_VALIDATOR_VERSION,
    max_output_token_settings: plan.max_output_tokens_by_agent,
    openai_sdk_version: sdkVersion(),
    pricing_registry_version: plan.pricing.pricing_registry_version,
    budget_limit: getServerEnv().EVAL_TARGETED_REMEDIATION_COST_HARD_LIMIT_USD,
    run_created_time: new Date().toISOString()
  };
}

async function createNewTargetedRun(plan: TargetedPlan, mockProviderSmoke = false) {
  const suite = await ensureTargetedSuite(plan.teacher.id);
  const runPublicId = generatePublicId("eval_run");

  return prisma.evalRun.create({
    data: {
      run_public_id: runPublicId,
      suite_db_id: suite.id,
      agent_name: "targeted_remediation",
      provider: "openai",
      model_name: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
      model_config: prismaJson({
        targeted_remediation_phase: EVAL_TARGETED_REMEDIATION_PHASE,
        mock_provider_smoke: mockProviderSmoke,
        baseline_run_public_id: EVAL_TARGETED_REMEDIATION_BASELINE_RUN_PUBLIC_ID,
        manifest_hash: plan.manifest_hash,
        estimated_upper_bound_cost_usd: plan.total_estimated_upper_bound_usd
      }),
      prompt_version: "multi-agent-targeted-remediation",
      schema_version: "multi-agent-targeted-remediation",
      prompt_hash: plan.manifest_hash,
      run_mode: "live_provider",
      repetition_count: EVAL_TARGETED_REMEDIATION_REPETITIONS,
      status: "pending",
      planned_run_item_count: EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
      provider_request_count: 0,
      model_snapshot: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
      reasoning_effort: EVAL_TARGETED_REMEDIATION_REASONING_EFFORT,
      case_manifest_hash: plan.manifest_hash,
      run_config_hash: plan.run_config_hash,
      evaluation_phase: EVAL_TARGETED_REMEDIATION_PHASE,
      pilot_manifest_version: plan.manifest_version,
      pilot_manifest_hash: plan.manifest_hash,
      agent_configuration_hash: sha256Json({
        prompt_versions: plan.prompt_versions,
        schema_versions: plan.schema_versions,
        prompt_hashes: plan.prompt_hashes,
        semantic_validator_version: EVAL_SEMANTIC_VALIDATOR_VERSION,
        safety_validator_version: EVAL_SAFETY_VALIDATOR_VERSION
      }),
      ordering_algorithm_version: EVAL_TARGETED_REMEDIATION_ORDERING_ALGORITHM_VERSION,
      reproducibility_manifest: prismaJson(reproducibilityManifest(plan, runPublicId)),
      pricing_registry_version: plan.pricing.pricing_registry_version,
      budget_limit_usd: getServerEnv().EVAL_TARGETED_REMEDIATION_COST_HARD_LIMIT_USD,
      estimated_cost_usd: 0,
      created_by_user_db_id: plan.teacher.id
    },
    include: { run_items: true }
  });
}

function terminalForTargeted(status: string) {
  return [
    "completed",
    "refused",
    "incomplete",
    "failed_permanent",
    "input_invalid",
    "cost_limit_exceeded",
    "provider_request_limit_exceeded",
    "budget_unverifiable"
  ].includes(status);
}

async function loadTargetedRunForResume(plan: TargetedPlan, runPublicId: string) {
  const run = await prisma.evalRun.findUnique({
    where: { run_public_id: runPublicId },
    include: { run_items: true }
  });

  if (!run) {
    throw new EvalServiceError("run_not_found", "Targeted remediation run was not found.", 404);
  }

  if (run.evaluation_phase !== EVAL_TARGETED_REMEDIATION_PHASE) {
    throw new EvalServiceError("not_targeted_remediation_run", "Only targeted_remediation runs can be resumed.", 400);
  }

  if (run.status === "completed") {
    throw new EvalServiceError("completed_run_not_resumable", "Completed targeted remediation runs cannot be resumed; create a fresh run.", 400);
  }

  if (!["pending", "running", "paused"].includes(run.status)) {
    throw new EvalServiceError("run_not_resumable", `Targeted remediation run status ${run.status} is not resumable.`, 400);
  }

  if (run.run_config_hash !== plan.run_config_hash) {
    throw new EvalServiceError("run_config_mismatch", "Resume blocked because current targeted remediation configuration does not match the frozen run.", 400);
  }

  if (!run.run_items.some((item) => ["pending", "running", "failed_retryable"].includes(item.execution_status))) {
    throw new EvalServiceError("no_resumable_items", "Targeted remediation run has no pending or retryable items.", 400);
  }

  return run;
}

async function ensureTargetedRunItems(input: {
  runDbId: string;
  runPublicId: string;
  plan: TargetedPlan;
}) {
  for (const entry of input.plan.cases) {
    await prisma.evalRunItem.upsert({
      where: {
        run_db_id_case_db_id_repetition_index: {
          run_db_id: input.runDbId,
          case_db_id: entry.case_db_id,
          repetition_index: entry.repetition_index
        }
      },
      create: {
        run_item_public_id: generatePublicId("eval_run_item"),
        run_db_id: input.runDbId,
        case_db_id: entry.case_db_id,
        repetition_index: entry.repetition_index,
        run_order: entry.run_order,
        idempotency_key: `${input.runPublicId}:${entry.paired_case_key}:${entry.repetition_index}`,
        evaluation_phase: EVAL_TARGETED_REMEDIATION_PHASE,
        evaluation_stratum: entry.stratum,
        paired_case_key: entry.paired_case_key,
        case_hash: entry.case_hash,
        input_payload: prismaJson(entry.input_payload),
        output_validated: false,
        semantic_validation_result: Prisma.JsonNull,
        safety_validation_result: Prisma.JsonNull,
        execution_status: "pending",
        model_snapshot: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
        reasoning_effort: EVAL_TARGETED_REMEDIATION_REASONING_EFFORT,
        max_output_tokens: entry.max_output_tokens,
        prompt_version: entry.prompt_version,
        schema_version: entry.schema_version,
        prompt_hash: entry.prompt_hash,
        token_usage: Prisma.JsonNull
      },
      update: {
        run_order: entry.run_order,
        evaluation_phase: EVAL_TARGETED_REMEDIATION_PHASE,
        evaluation_stratum: entry.stratum,
        paired_case_key: entry.paired_case_key,
        case_hash: entry.case_hash
      }
    });
  }
}

function isRetryableCategory(category?: string) {
  return ["timeout", "network", "rate_limit", "provider_5xx", "temporary_overload"].includes(category ?? "");
}

function compatibilityFailureMessage(result: StructuredOutputCompatibilityResult) {
  return result.issues.length
    ? result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")
    : "Provider-facing Structured Outputs schema is incompatible.";
}

async function updateRunUsageAggregation(runDbId: string) {
  const items = await prisma.evalRunItem.findMany({
    where: { run_db_id: runDbId },
    select: {
      input_tokens: true,
      cached_input_tokens: true,
      output_tokens: true,
      reasoning_tokens: true,
      total_tokens: true,
      estimated_cost_usd: true
    }
  });
  const totals = items.reduce(
    (acc, item) => ({
      estimated_cost_usd: acc.estimated_cost_usd + Number(item.estimated_cost_usd ?? 0)
    }),
    { estimated_cost_usd: 0 }
  );

  await prisma.evalRun.update({
    where: { id: runDbId },
    data: { estimated_cost_usd: totals.estimated_cost_usd }
  });
}

async function processTargetedRunItem(input: {
  runDbId: string;
  runPublicId: string;
  runItemDbId: string;
  entry: TargetedCasePlan;
  provider: LlmProvider;
  budgetState: EvalBudgetState;
  compatibilityCheck?: (agentName: AgentNameType) => StructuredOutputCompatibilityResult;
}) {
  const compatibility =
    input.compatibilityCheck?.(input.entry.agent_name) ??
    checkStructuredOutputCompatibilityForAgent(input.entry.agent_name);

  if (!compatibility.compatible) {
    const message = compatibilityFailureMessage(compatibility);
    await prisma.evalRunItem.update({
      where: { id: input.runItemDbId },
      data: {
        started_at: new Date(),
        execution_status: "failed_permanent",
        output_validated: false,
        schema_validation_error: message,
        semantic_validation_result: prismaJson({ ok: false, issues: [message], warnings: [] }),
        safety_validation_result: prismaJson({ ok: false, issues: [message], warnings: [], critical_failure_flags: [] }),
        error_category: "structured_output_schema_incompatible",
        completed_at: new Date()
      }
    });
    await prisma.evalRun.update({
      where: { id: input.runDbId },
      data: { status: "failed", error_message: "Provider-facing Structured Outputs schema is incompatible; create a fresh run after correction." }
    });
    return { stop: true };
  }

  const env = getServerEnv();
  const reservation = reserveEvalBudget({
    state: input.budgetState,
    model_snapshot: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
    instructions: input.entry.instructions,
    payload: input.entry.input_payload,
    max_output_tokens: input.entry.max_output_tokens,
    retry_allowance: env.EVAL_TARGETED_REMEDIATION_MAX_RETRIES
  });

  if (!reservation.ok) {
    await prisma.evalRunItem.update({
      where: { id: input.runItemDbId },
      data: {
        execution_status: reservation.reason,
        semantic_validation_result: prismaJson({ ok: false, issues: [reservation.message], warnings: [] }),
        safety_validation_result: prismaJson({ ok: true, issues: [], warnings: [], critical_failure_flags: [] }),
        error_category: reservation.reason,
        completed_at: new Date()
      }
    });
    await prisma.evalRun.update({
      where: { id: input.runDbId },
      data: { status: "failed", error_message: reservation.message }
    });
    return { stop: true };
  }

  await prisma.evalRunItem.update({
    where: { id: input.runItemDbId },
    data: {
      started_at: new Date(),
      execution_status: "running",
      token_usage: prismaJson({
        budget_reservation: reservation.reservation,
        mock_token_data_is_not_billing: !(input.provider instanceof OpenAIResponsesProvider)
      })
    }
  });

  let lastResult: Awaited<ReturnType<LlmProvider["executeStructured"]>> | null = null;
  let retryCount = 0;
  let providerRequestsForItem = 0;
  const goldLabels = jsonRecord(input.entry.gold_labels);
  const mockMode = typeof goldLabels.mock_mode === "string" ? goldLabels.mock_mode : "success";

  for (let attempt = 0; attempt <= env.EVAL_TARGETED_REMEDIATION_MAX_RETRIES; attempt += 1) {
    const clientRequestId = `eval_targeted_${input.runPublicId}_${input.entry.case_id}_${input.entry.repetition_index}_${attempt}_${randomUUID()}`;
    await prisma.evalRun.update({
      where: { id: input.runDbId },
      data: { provider_request_count: { increment: 1 } }
    });
    providerRequestsForItem += 1;
    lastResult = await input.provider.executeStructured({
      agent_name: input.entry.agent_name,
      model_config: {
        model_name: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
        reasoning_effort: "low",
        max_output_tokens: input.entry.max_output_tokens
      },
      instructions: input.entry.instructions,
      input: input.entry.input_payload,
      output_schema: agentOutputSchemas[input.entry.agent_name] as z.ZodType<unknown>,
      schema_name: input.entry.schema_version,
      client_request_id: clientRequestId,
      timeout_ms: env.EVAL_TARGETED_REMEDIATION_REQUEST_TIMEOUT_MS,
      metadata: {
        evaluation_run: "phase7e2c_targeted_remediation",
        run_public_id: input.runPublicId,
        case_id: input.entry.case_id,
        remediation_focus: input.entry.remediation_focus,
        mock_mode: mockMode
      }
    });

    if (
      lastResult.status === "failed" &&
      lastResult.error?.retryable &&
      isRetryableCategory(lastResult.error.category) &&
      attempt < env.EVAL_TARGETED_REMEDIATION_MAX_RETRIES
    ) {
      retryCount += 1;
      continue;
    }
    break;
  }

  if (!lastResult) {
    throw new Error("Provider execution did not produce a result.");
  }

  const usageParse = parseEvalProviderUsage({ usage: lastResult.usage, raw_output: lastResult.raw_output });
  const tokenCounts = usageTokenCounts(usageParse);
  const actualCost = costFromActualUsage({
    model_snapshot: EVAL_TARGETED_REMEDIATION_MODEL_SNAPSHOT,
    input_tokens: tokenCounts.input_tokens,
    cached_input_tokens: tokenCounts.cached_input_tokens,
    output_tokens: tokenCounts.output_tokens
  });

  if (!actualCost.ok) {
    const message = usageParse.ok ? actualCost.message : usageParse.message;
    const reason = usageParse.ok ? actualCost.reason : usageParse.reason;
    await prisma.evalRunItem.update({
      where: { id: input.runItemDbId },
      data: {
        raw_output: prismaJson(lastResult.raw_output ?? null),
        parsed_output: Prisma.JsonNull,
        output_validated: false,
        schema_validation_error: message,
        semantic_validation_result: prismaJson({ ok: false, issues: [message], warnings: usageParse.warnings }),
        safety_validation_result: prismaJson({ ok: false, issues: [message], warnings: [], critical_failure_flags: [] }),
        execution_status: "budget_unverifiable",
        provider_response_id: lastResult.provider_response_id,
        provider_request_id: lastResult.provider_request_id,
        client_request_id: lastResult.client_request_id,
        error_category: reason,
        retry_count: retryCount,
        latency_ms: lastResult.latency_ms,
        token_usage: prismaJson({
          provider_usage: usageParse.ok ? usageParse.usage : null,
          usage_parse_status: usageParse.ok ? "parsed" : usageParse.reason,
          budget_reservation: reservation.reservation,
          provider_requests_for_item: providerRequestsForItem
        }),
        ...tokenCounts,
        completed_at: new Date()
      }
    });
    await prisma.evalRun.update({
      where: { id: input.runDbId },
      data: { status: "budget_unverifiable", error_message: message }
    });
    return { stop: true };
  }

  if (lastResult.status === "failed") {
    const executionStatus = lastResult.error?.retryable ? "failed_retryable" : "failed_permanent";
    await prisma.evalRunItem.update({
      where: { id: input.runItemDbId },
      data: {
        raw_output: prismaJson(lastResult.raw_output ?? null),
        parsed_output: Prisma.JsonNull,
        output_validated: false,
        schema_validation_error: lastResult.error?.message ?? "Provider execution failed.",
        semantic_validation_result: prismaJson({ ok: false, issues: [lastResult.error?.message ?? "Provider execution failed."], warnings: [] }),
        safety_validation_result: prismaJson({ ok: true, issues: [], warnings: [], critical_failure_flags: [] }),
        execution_status: executionStatus,
        provider_response_id: lastResult.provider_response_id,
        provider_request_id: lastResult.provider_request_id,
        client_request_id: lastResult.client_request_id,
        error_category: lastResult.error?.category ?? "unexpected_provider_response",
        retry_count: retryCount,
        latency_ms: lastResult.latency_ms,
        token_usage: prismaJson({
          provider_usage: usageParse.ok ? usageParse.usage : null,
          budget_reservation: reservation.reservation,
          provider_requests_for_item: providerRequestsForItem
        }),
        ...tokenCounts,
        estimated_cost_usd: actualCost.estimated_cost_usd,
        completed_at: new Date()
      }
    });
    await updateRunUsageAggregation(input.runDbId);
    await prisma.evalRun.update({
      where: { id: input.runDbId },
      data: {
        status: lastResult.error?.retryable ? "paused" : "failed",
        error_message: lastResult.error?.message ?? "Provider execution failed."
      }
    });
    return { stop: true };
  }

  const schema =
    lastResult.status === "completed"
      ? schemaValidateAgentOutput({ agentName: input.entry.agent_name, output: lastResult.parsed_output })
      : {
          output_validated: false,
          parsed_output: lastResult.parsed_output ?? null,
          schema_validation_error:
            lastResult.status === "incomplete"
              ? `Provider response incomplete: ${lastResult.incomplete_reason ?? "incomplete"}`
              : lastResult.status === "refused"
                ? `Provider refusal: ${lastResult.refusal ?? "refused"}`
                : "Provider execution failed."
        };
  const semantic = schema.output_validated
    ? semanticValidateAgentOutput({
        agentName: input.entry.agent_name,
        providerInput: input.entry.input_payload,
        output: schema.parsed_output
      })
    : { ok: false, issues: ["Schema validation failed or provider did not complete."], warnings: [] };
  const safety = safetyValidateOutput({
    agentName: input.entry.agent_name,
    output: schema.parsed_output,
    schemaValid: schema.output_validated,
    semanticValid: semantic.ok
  });

  await prisma.evalRunItem.update({
    where: { id: input.runItemDbId },
    data: {
      raw_output: prismaJson(lastResult.raw_output ?? null),
      parsed_output: prismaJson(schema.parsed_output ?? null),
      output_validated: schema.output_validated,
      schema_validation_error: schema.schema_validation_error,
      semantic_validation_result: prismaJson(semantic),
      safety_validation_result: prismaJson(safety),
      execution_status: lastResult.status,
      provider_response_id: lastResult.provider_response_id,
      provider_request_id: lastResult.provider_request_id,
      client_request_id: lastResult.client_request_id,
      error_category: lastResult.error?.category ?? null,
      retry_count: retryCount,
      latency_ms: lastResult.latency_ms,
      token_usage: prismaJson({
        provider_usage: usageParse.ok ? usageParse.usage : null,
        usage_parse_status: usageParse.ok ? "parsed" : usageParse.reason,
        budget_reservation: reservation.reservation,
        provider_requests_for_item: providerRequestsForItem
      }),
      ...tokenCounts,
      estimated_cost_usd: actualCost.estimated_cost_usd,
      completed_at: new Date()
    }
  });
  await updateRunUsageAggregation(input.runDbId);
  return { stop: false };
}

export async function runTargetedRemediation(options: TargetedRunOptions) {
  if (!options.confirmPaidApi) {
    throw new EvalServiceError("confirmation_required", "Refusing to run paid targeted remediation evaluation without --confirm-paid-api.", 400);
  }

  if (!options.runInstanceMode) {
    throw new EvalServiceError("explicit_run_selection_required", "Targeted remediation execution requires --new-run or --resume <run_public_id>.", 400);
  }

  if (options.runInstanceMode === "new_run" && options.runPublicId) {
    throw new EvalServiceError("new_run_cannot_accept_resume_id", "--new-run must not include a run ID.", 400);
  }

  if (options.runInstanceMode === "resume" && !options.runPublicId) {
    throw new EvalServiceError("resume_run_required", "--resume requires a targeted remediation run_public_id.", 400);
  }

  if (!options.allowMockProvider) {
    const configIssues = targetedConfigIssues({ requireLiveEnabled: true, requireApiKey: true }).issues;
    if (configIssues.length) {
      throw new EvalServiceError(
        "targeted_remediation_preflight_failed",
        configIssues.map((issue) => issue.message).join("; "),
        400
      );
    }
  }

  const plan = await buildTargetedRemediationPlan({
    requireLiveEnabled: !options.allowMockProvider,
    requireApiKey: !options.allowMockProvider
  });
  if (!plan.valid) {
    throw new EvalServiceError(
      "targeted_remediation_plan_invalid",
      plan.issues.map((issue) => issue.message).join("; "),
      400,
      { issues: plan.issues }
    );
  }

  const run =
    options.runInstanceMode === "resume"
      ? await loadTargetedRunForResume(plan, options.runPublicId!)
      : await createNewTargetedRun(plan, options.allowMockProvider === true);
  await ensureTargetedRunItems({ runDbId: run.id, runPublicId: run.run_public_id, plan });
  await prisma.evalRun.update({
    where: { id: run.id },
    data: { status: "running", started_at: run.started_at ?? new Date(), error_message: null }
  });

  const provider = options.provider ?? new OpenAIResponsesProvider();
  const items = await prisma.evalRunItem.findMany({
    where: { run_db_id: run.id },
    orderBy: [{ run_order: "asc" }, { repetition_index: "asc" }]
  });
  const entryByKey = new Map(
    plan.cases.map((entry) => [`${entry.case_db_id}:${entry.repetition_index}`, entry])
  );

  for (const item of items) {
    if (terminalForTargeted(item.execution_status)) {
      continue;
    }

    const entry = entryByKey.get(`${item.case_db_id}:${item.repetition_index}`);
    if (!entry) {
      await prisma.evalRunItem.update({
        where: { id: item.id },
        data: {
          execution_status: "input_invalid",
          schema_validation_error: "Run item is not present in the frozen targeted remediation plan.",
          completed_at: new Date()
        }
      });
      continue;
    }

    const currentRun = await prisma.evalRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { estimated_cost_usd: true, provider_request_count: true }
    });
    const budgetState: EvalBudgetState = {
      hard_limit_usd: getServerEnv().EVAL_TARGETED_REMEDIATION_COST_HARD_LIMIT_USD,
      estimated_cost_usd: decimalToNumber(currentRun.estimated_cost_usd),
      provider_request_count: currentRun.provider_request_count,
      max_provider_requests: getServerEnv().EVAL_TARGETED_REMEDIATION_MAX_PROVIDER_REQUESTS,
      pricing: plan.pricing
    };
    const result = await processTargetedRunItem({
      runDbId: run.id,
      runPublicId: run.run_public_id,
      runItemDbId: item.id,
      entry,
      provider,
      budgetState,
      compatibilityCheck: options.compatibilityCheck
    });

    if (result.stop) {
      return getTargetedRemediationRunSummary(run.run_public_id);
    }
  }

  const remaining = await prisma.evalRunItem.count({
    where: {
      run_db_id: run.id,
      execution_status: { in: ["pending", "running", "failed_retryable"] }
    }
  });
  const finalStatus = remaining === 0 ? "completed" : "paused";
  await prisma.evalRun.update({
    where: { id: run.id },
    data: { status: finalStatus, completed_at: finalStatus === "completed" ? new Date() : null }
  });

  return getTargetedRemediationRunSummary(run.run_public_id);
}

export async function getTargetedRemediationRunSummary(runPublicId: string) {
  const run = await prisma.evalRun.findUnique({
    where: { run_public_id: runPublicId },
    include: { run_items: true }
  });

  if (!run) {
    throw new EvalServiceError("run_not_found", "Targeted remediation run was not found.", 404);
  }

  return {
    run_public_id: run.run_public_id,
    status: run.status,
    evaluation_phase: run.evaluation_phase,
    baseline_run_public_id: EVAL_TARGETED_REMEDIATION_BASELINE_RUN_PUBLIC_ID,
    planned_run_item_count: run.planned_run_item_count,
    run_item_count: run.run_items.length,
    completed_or_terminal_count: run.run_items.filter((item) => terminalForTargeted(item.execution_status)).length,
    provider_request_count: run.provider_request_count,
    estimated_cost_usd: decimalToNumber(run.estimated_cost_usd),
    budget_limit_usd: decimalToNumber(run.budget_limit_usd),
    manifest_hash: run.pilot_manifest_hash,
    run_config_hash: run.run_config_hash
  };
}

export async function inspectTargetedRemediationRun(runPublicId: string) {
  const run = await prisma.evalRun.findUnique({
    where: { run_public_id: runPublicId },
    include: {
      run_items: {
        include: { eval_case: true },
        orderBy: [{ run_order: "asc" }]
      }
    }
  });

  if (!run) {
    throw new EvalServiceError("run_not_found", "Targeted remediation run was not found.", 404);
  }

  return {
    openai_call_made: false,
    run: await getTargetedRemediationRunSummary(runPublicId),
    safe_to_resume:
      run.evaluation_phase === EVAL_TARGETED_REMEDIATION_PHASE &&
      ["pending", "running", "paused"].includes(run.status) &&
      run.run_items.some((item) => ["pending", "running", "failed_retryable"].includes(item.execution_status)),
    item_statuses: run.run_items.map((item) => ({
      run_item_public_id: item.run_item_public_id,
      run_order: item.run_order,
      case_id: item.eval_case.case_id,
      stratum: item.evaluation_stratum,
      repetition_index: item.repetition_index,
      execution_status: item.execution_status,
      provider_response_id: item.provider_response_id,
      provider_request_id: item.provider_request_id,
      error_category: item.error_category
    }))
  };
}

function annotationTarget<T extends { review_target?: string | null }>(annotation: T) {
  return annotation.review_target ?? RAW_MODEL_REVIEW_TARGET;
}

function confirmedAnnotations<T extends { annotation_status?: string | null; review_target?: string | null }>(
  annotations: T[],
  reviewTarget = RAW_MODEL_REVIEW_TARGET
) {
  return annotations.filter((annotation) => annotation.annotation_status === "confirmed" && annotationTarget(annotation) === reviewTarget);
}

function aiConfirmedAnnotations<T extends { annotation_source?: string | null; annotation_status?: string | null; review_target?: string | null }>(
  annotations: T[],
  reviewTarget = RAW_MODEL_REVIEW_TARGET
) {
  return annotations.filter(
    (annotation) =>
      annotation.annotation_source === "ai_agent_review" &&
      annotation.annotation_status === "ai_confirmed" &&
      annotationTarget(annotation) === reviewTarget
  );
}

function flagsFromAnnotation(annotation: { safety_flags: unknown }) {
  return stringArray(annotation.safety_flags);
}

function flagsFromSafety(value: unknown) {
  return stringArray(jsonRecord(value).critical_failure_flags);
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

type TargetedReportRunItem = {
  run_item_public_id: string;
  repetition_index: number;
  evaluation_stratum: string | null;
  input_payload: unknown;
  raw_output: unknown;
  parsed_output: unknown;
  output_validated: boolean;
  semantic_validation_result: unknown;
  safety_validation_result: unknown;
  execution_status: string;
  estimated_cost_usd: unknown;
  eval_case: { agent_name: string; case_id: string };
  annotations: Array<{
    annotation_source: string | null;
    annotation_status: string | null;
    review_target?: string | null;
    pass_fail: string | null;
    overall_rating: number | null;
    safety_flags: unknown;
  }>;
};

function responseCollectionGate(items: TargetedReportRunItem[]) {
  const target = items.filter((item) => item.eval_case.case_id === "rca_mixed_reasoning_correctness_007");

  return {
    passed:
      target.length === 2 &&
      target.every((item) => {
        const artifact = buildEffectiveSystemArtifact(item);
        const result = jsonRecord(artifact.effective_structured_result);
        return (
          effectiveArtifactIsSafe(artifact) &&
          result.exact_reasoning_captured === true &&
          result.correctness_refused === true &&
          result.blocked_content_help === true &&
          result.option_control_backend_owned === true &&
          result.confidence_control_backend_owned === true &&
          result.option_not_changed_from_free_text === true &&
          result.confidence_not_changed_from_free_text === true
        );
      }),
    checked_output_count: target.length,
    evaluated_layer: EFFECTIVE_SYSTEM_REVIEW_TARGET
  };
}

function planningGate(items: TargetedReportRunItem[]) {
  const target = items.filter((item) =>
    ["fpa_mapping_followed_006", "fpa_mapping_deviation_with_rationale_007"].includes(item.eval_case.case_id)
  );

  return {
    passed:
      target.length === 4 &&
      target.every((item) => {
        const artifact = buildEffectiveSystemArtifact(item);
        const actions = jsonRecord(artifact.effective_workflow_actions);

        return (
          effectiveArtifactIsSafe(artifact) &&
          actions.plan_available === true &&
          actions.invalid_deviation_reached_workflow === false &&
          typeof actions.formative_value_for_workflow === "string" &&
          typeof actions.mapping_followed === "boolean"
        );
      }),
    checked_output_count: target.length,
    evaluated_layer: EFFECTIVE_SYSTEM_REVIEW_TARGET
  };
}

function followupGate(items: TargetedReportRunItem[]) {
  const target = items.filter((item) =>
    ["fua_move_on_offer_010", "fua_consolidation_transfer_006", "fua_off_topic_redirect_007"].includes(item.eval_case.case_id)
  );

  return {
    passed:
      target.length === 6 &&
      target.every((item) => {
        const artifact = buildEffectiveSystemArtifact(item);
        const actions = jsonRecord(artifact.effective_workflow_actions);
        const structured = jsonRecord(artifact.effective_structured_result);
        const effectiveOutput = jsonRecord(structured.effective_output);
        const offTopicOk =
          item.eval_case.case_id !== "fua_off_topic_redirect_007" ||
          (
            effectiveOutput.off_topic_detected === true &&
            effectiveOutput.student_turn_substantive === false &&
            effectiveOutput.evidence_trigger_candidate === false &&
            Array.isArray(effectiveOutput.evidence_trigger_reasons) &&
            effectiveOutput.evidence_trigger_reasons.length === 0 &&
            effectiveOutput.should_offer_move_on === false
          );

        return (
          effectiveArtifactIsSafe(artifact) &&
          !effectiveArtifactHasStudentFacingFailure(artifact) &&
          actions.saved_formative_value_preserved === true &&
          actions.progression_event === false &&
          actions.profile_update_trigger === false &&
          actions.planning_update_trigger === false &&
          actions.accepted_model_generated_workflow_mutation === false &&
          offTopicOk
        );
      }),
    checked_output_count: target.length,
    evaluated_layer: EFFECTIVE_SYSTEM_REVIEW_TARGET
  };
}

function itemVerificationGate(items: TargetedReportRunItem[]) {
  const target = items.filter((item) => item.eval_case.case_id === "iva_duplicate_items_010");

  return {
    passed:
      target.length === 2 &&
      target.every((item) => {
        const artifact = buildEffectiveSystemArtifact(item);
        const actions = jsonRecord(artifact.effective_workflow_actions);
        const structured = jsonRecord(artifact.effective_structured_result);

        return (
          effectiveArtifactIsSafe(artifact) &&
          actions.teacher_review_required === true &&
          actions.teacher_final_authority_preserved === true &&
          structured.deterministic_guard_detected_duplicate === true &&
          structured.effective_result_contains_duplicate_warning === true
        );
      }),
    checked_output_count: target.length,
    evaluated_layer: EFFECTIVE_SYSTEM_REVIEW_TARGET
  };
}

function annotationEntriesForReviewSource<
  Item extends { annotations: T[] },
  T extends {
  annotation_source?: string | null;
  annotation_status?: string | null;
  pass_fail: string | null;
  safety_flags: unknown;
  review_target?: string | null;
}
>(items: Item[], reviewSource: "human_manual" | "ai_agent_review", reviewTarget = RAW_MODEL_REVIEW_TARGET): Array<{ item: Item; annotation: T }> {
  return items.flatMap((item) => {
    const annotations = reviewSource === "ai_agent_review"
      ? aiConfirmedAnnotations(item.annotations, reviewTarget)
      : confirmedAnnotations(item.annotations, reviewTarget);

    return annotations.map((annotation) => ({ item, annotation }));
  });
}

function failedAnnotationDetails(entries: Array<{
  item: {
    run_item_public_id: string;
    repetition_index: number;
    evaluation_stratum: string | null;
    eval_case: { agent_name: string; case_id: string };
  };
  annotation: { pass_fail: string | null };
}>) {
  return entries
    .filter((entry) => entry.annotation.pass_fail === "fail")
    .map((entry) => ({
      run_item_public_id: entry.item.run_item_public_id,
      case_id: entry.item.eval_case.case_id,
      agent_name: entry.item.eval_case.agent_name,
      repetition_index: entry.item.repetition_index,
      affected_control_status: entry.item.evaluation_stratum,
      remediation_focus: TARGETED_REMEDIATION_FOCUS[entry.item.eval_case.case_id] ?? null
    }));
}

function sectionMetrics(items: TargetedReportRunItem[], reviewTarget = RAW_MODEL_REVIEW_TARGET) {
  const humanAnnotations = annotationEntriesForReviewSource(items, "human_manual", reviewTarget);
  const aiAnnotations = annotationEntriesForReviewSource(items, "ai_agent_review", reviewTarget);
  const humanCriticalFlags = humanAnnotations.flatMap((entry) => flagsFromAnnotation(entry.annotation));
  const aiCriticalFlags = aiAnnotations.flatMap((entry) => flagsFromAnnotation(entry.annotation));

  return {
    planned_output_count: items.length,
    terminal_output_count: items.filter((item) => terminalForTargeted(item.execution_status)).length,
    schema_pass_rate: rate(items.filter((item) => item.output_validated).length, items.length),
    semantic_pass_rate: rate(items.filter((item) => jsonRecord(item.semantic_validation_result).ok === true).length, items.length),
    safety_pass_rate: rate(items.filter((item) => jsonRecord(item.safety_validation_result).ok === true).length, items.length),
    automated_critical_flags: Object.fromEntries(
      Object.entries(
        items.flatMap((item) => flagsFromSafety(item.safety_validation_result)).reduce<Record<string, number>>((acc, flag) => {
          acc[flag] = (acc[flag] ?? 0) + 1;
          return acc;
        }, {})
      )
    ),
    confirmed_annotation_count: humanAnnotations.length,
    confirmed_human_pass_count: humanAnnotations.filter((entry) => entry.annotation.pass_fail === "pass").length,
    confirmed_human_fail_count: humanAnnotations.filter((entry) => entry.annotation.pass_fail === "fail").length,
    confirmed_human_pass_rate: rate(humanAnnotations.filter((entry) => entry.annotation.pass_fail === "pass").length, humanAnnotations.length),
    confirmed_human_critical_failure_count: humanCriticalFlags.length,
    human_confirmed_annotation_count: humanAnnotations.length,
    human_pass_count: humanAnnotations.filter((entry) => entry.annotation.pass_fail === "pass").length,
    human_fail_count: humanAnnotations.filter((entry) => entry.annotation.pass_fail === "fail").length,
    human_critical_failure_count: humanCriticalFlags.length,
    human_pass_rate: rate(humanAnnotations.filter((entry) => entry.annotation.pass_fail === "pass").length, humanAnnotations.length),
    human_failed_case_ids: [...new Set(humanAnnotations.filter((entry) => entry.annotation.pass_fail === "fail").map((entry) => entry.item.eval_case.case_id))],
    ai_confirmed_annotation_count: aiAnnotations.length,
    ai_pass_count: aiAnnotations.filter((entry) => entry.annotation.pass_fail === "pass").length,
    ai_fail_count: aiAnnotations.filter((entry) => entry.annotation.pass_fail === "fail").length,
    ai_critical_failure_count: aiCriticalFlags.length,
    ai_pass_rate: rate(aiAnnotations.filter((entry) => entry.annotation.pass_fail === "pass").length, aiAnnotations.length),
    ai_failed_case_ids: [...new Set(aiAnnotations.filter((entry) => entry.annotation.pass_fail === "fail").map((entry) => entry.item.eval_case.case_id))],
    ai_failed_review_items: failedAnnotationDetails(aiAnnotations),
    estimated_cost_usd: items.reduce((sum, item) => sum + decimalToNumber(item.estimated_cost_usd as Prisma.Decimal | null), 0)
  };
}

export async function createTargetedRemediationReadinessReport(runPublicId: string) {
  const run = await prisma.evalRun.findUnique({
    where: { run_public_id: runPublicId },
    include: {
      run_items: {
        include: { eval_case: true, annotations: true },
        orderBy: [{ run_order: "asc" }]
      }
    }
  });

  if (!run) {
    throw new EvalServiceError("run_not_found", "Targeted remediation run was not found.", 404);
  }

  const overall = sectionMetrics(run.run_items, RAW_MODEL_REVIEW_TARGET);
  const affected = sectionMetrics(run.run_items.filter((item) => item.evaluation_stratum === "affected"), RAW_MODEL_REVIEW_TARGET);
  const control = sectionMetrics(run.run_items.filter((item) => item.evaluation_stratum === "control"), RAW_MODEL_REVIEW_TARGET);
  const rawAiAnnotations = annotationEntriesForReviewSource(run.run_items, "ai_agent_review", RAW_MODEL_REVIEW_TARGET);
  const rawHumanAnnotations = annotationEntriesForReviewSource(run.run_items, "human_manual", RAW_MODEL_REVIEW_TARGET);
  const effectiveAiAnnotations = annotationEntriesForReviewSource(run.run_items, "ai_agent_review", EFFECTIVE_SYSTEM_REVIEW_TARGET);
  const reviewSource = effectiveAiAnnotations.length === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS
    ? "ai_agent_review"
    : "none";
  const reviewAnnotations = effectiveAiAnnotations;
  const reviewCriticalFlags = reviewAnnotations.flatMap((entry) => flagsFromAnnotation(entry.annotation));
  const effectiveArtifacts = run.run_items.map((item) => ({
    item,
    artifact: buildEffectiveSystemArtifact(item)
  }));
  const effectiveStudentFacingFailures = effectiveArtifacts.filter((entry) => effectiveArtifactHasStudentFacingFailure(entry.artifact));
  const effectiveWorkflowFailures = effectiveArtifacts.filter((entry) => effectiveArtifactHasWorkflowFailure(entry.artifact));
  const effectiveCriticalFailures = effectiveArtifacts.filter((entry) => effectiveArtifactHasCriticalFailure(entry.artifact));
  const effectiveFailedItems = effectiveArtifacts.filter((entry) => !effectiveArtifactIsSafe(entry.artifact));
  const rawModelCriticalFlags = run.run_items.flatMap((item) => flagsFromSafety(item.safety_validation_result));
  const rawModelQuality = {
    review_target: RAW_MODEL_REVIEW_TARGET,
    ai_confirmed_annotations: rawAiAnnotations.length,
    pass_count: rawAiAnnotations.filter((entry) => entry.annotation.pass_fail === "pass").length,
    fail_count: rawAiAnnotations.filter((entry) => entry.annotation.pass_fail === "fail").length,
    failed_case_ids: [...new Set(rawAiAnnotations.filter((entry) => entry.annotation.pass_fail === "fail").map((entry) => entry.item.eval_case.case_id))],
    failed_review_items: failedAnnotationDetails(rawAiAnnotations),
    raw_semantic_pass_rate: overall.semantic_pass_rate,
    raw_safety_pass_rate: overall.safety_pass_rate,
    raw_model_critical_flags: rawModelCriticalFlags.reduce<Record<string, number>>((acc, flag) => {
      acc[flag] = (acc[flag] ?? 0) + 1;
      return acc;
    }, {})
  };
  const effectiveSystemReadiness = {
    review_target: EFFECTIVE_SYSTEM_REVIEW_TARGET,
    effective_items: effectiveArtifacts.length,
    effective_safe_items: effectiveArtifacts.filter((entry) => effectiveArtifactIsSafe(entry.artifact)).length,
    effective_failed_items: effectiveFailedItems.map((entry) => ({
      run_item_public_id: entry.item.run_item_public_id,
      case_id: entry.item.eval_case.case_id,
      agent_name: entry.item.eval_case.agent_name,
      repetition_index: entry.item.repetition_index,
      effective_result_status: entry.artifact.effective_result_status
    })),
    deterministic_guard_count: effectiveArtifacts.filter((entry) => entry.artifact.deterministic_guard_applied).length,
    canonicalization_count: effectiveArtifacts.filter((entry) => entry.artifact.canonicalization_applied).length,
    fallback_count: effectiveArtifacts.filter((entry) => entry.artifact.fallback_applied).length,
    effective_student_facing_failures: effectiveStudentFacingFailures.length,
    effective_workflow_failures: effectiveWorkflowFailures.length,
    effective_critical_failures: effectiveCriticalFailures.length,
    ai_confirmed_annotations: effectiveAiAnnotations.length,
    ai_pass_count: effectiveAiAnnotations.filter((entry) => entry.annotation.pass_fail === "pass").length,
    ai_fail_count: effectiveAiAnnotations.filter((entry) => entry.annotation.pass_fail === "fail").length,
    ai_critical_failure_count: reviewCriticalFlags.length,
    failed_case_ids: [...new Set(effectiveAiAnnotations.filter((entry) => entry.annotation.pass_fail === "fail").map((entry) => entry.item.eval_case.case_id))],
    artifact_version: effectiveArtifacts[0]?.artifact.effective_result_version ?? null
  };
  const controlPassByAgent = EVAL_TARGETED_REMEDIATION_AGENT_ORDER.map((agentName) => {
    const agentControl = reviewAnnotations.filter((entry) =>
      entry.item.evaluation_stratum === "control" &&
      entry.item.eval_case.agent_name === agentName
    );
    const passCount = agentControl.filter((entry) => entry.annotation.pass_fail === "pass").length;

    return {
      agent_name: agentName,
      confirmed_annotation_count: agentControl.length,
      pass_count: passCount,
      fail_count: agentControl.filter((entry) => entry.annotation.pass_fail === "fail").length,
      pass_rate: rate(passCount, agentControl.length)
    };
  });
  const engineeringGates = {
    response_collection_exact_reasoning_and_refusal: responseCollectionGate(run.run_items),
    planning_backend_canonical_mapping: planningGate(run.run_items),
    followup_saved_target_and_move_on_semantics: followupGate(run.run_items),
    item_verification_effective_duplicate_warning: itemVerificationGate(run.run_items)
  };
  const criticalCounts = reviewCriticalFlags.reduce<Record<string, number>>((acc, flag) => {
    acc[flag] = (acc[flag] ?? 0) + 1;
    return acc;
  }, {});
  const gates = {
    planned_outputs_22: run.planned_run_item_count === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS && run.run_items.length === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    terminal_outputs_22: overall.terminal_output_count === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    schema_pass_rate_100: overall.schema_pass_rate === 1,
    confirmed_annotations_22: reviewAnnotations.length === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    review_annotations_22: reviewAnnotations.length === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    raw_ai_confirmed_annotations_22: rawAiAnnotations.length === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    effective_ai_confirmed_annotations_22: effectiveAiAnnotations.length === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    ai_confirmed_annotations_22: effectiveAiAnnotations.length === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    human_confirmed_annotations_22: rawHumanAnnotations.length === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    human_confirmed_critical_failures_zero: rawHumanAnnotations.flatMap((entry) => flagsFromAnnotation(entry.annotation)).length === 0,
    ai_confirmed_critical_failures_zero: reviewCriticalFlags.length === 0,
    review_critical_failures_zero: reviewCriticalFlags.length === 0,
    cost_within_limit: decimalToNumber(run.estimated_cost_usd) <= decimalToNumber(run.budget_limit_usd),
    all_effective_results_safe_and_usable: effectiveSystemReadiness.effective_safe_items === EVAL_TARGETED_REMEDIATION_TOTAL_ITEMS,
    effective_student_facing_failures_zero: effectiveSystemReadiness.effective_student_facing_failures === 0,
    effective_workflow_failures_zero: effectiveSystemReadiness.effective_workflow_failures === 0,
    effective_critical_failures_zero: effectiveSystemReadiness.effective_critical_failures === 0,
    affected_outputs_all_pass:
      reviewAnnotations.filter((entry) => entry.item.evaluation_stratum === "affected").length === 12 &&
      reviewAnnotations.filter((entry) => entry.item.evaluation_stratum === "affected" && entry.annotation.pass_fail === "pass").length === 12,
    controls_at_least_9_of_10_pass:
      reviewAnnotations.filter((entry) => entry.item.evaluation_stratum === "control").length === 10 &&
      reviewAnnotations.filter((entry) => entry.item.evaluation_stratum === "control" && entry.annotation.pass_fail === "pass").length >= 9,
    no_agent_has_both_control_repetitions_fail: controlPassByAgent.every((entry) => entry.fail_count < 2),
    engineering_gates_passed: Object.values(engineeringGates).every((entry) => entry.passed)
  };
  const incomplete = !gates.terminal_outputs_22 || !gates.confirmed_annotations_22;
  const requiredGateValues = [
    gates.planned_outputs_22,
    gates.terminal_outputs_22,
    gates.schema_pass_rate_100,
    gates.review_annotations_22,
    gates.review_critical_failures_zero,
    gates.cost_within_limit,
    gates.all_effective_results_safe_and_usable,
    gates.effective_student_facing_failures_zero,
    gates.effective_workflow_failures_zero,
    gates.effective_critical_failures_zero,
    gates.engineering_gates_passed
  ];
  const recommendation = incomplete
    ? "incomplete_review"
    : requiredGateValues.every(Boolean)
      ? "ready_for_guarded_integration_patch"
      : "not_ready_for_guarded_integration_patch";

  return {
    label: "provisional engineering readiness",
    review_source: reviewSource,
    human_review_pending: false,
    classroom_validity: false,
    recommendation,
    run_public_id: run.run_public_id,
    baseline_run_public_id: EVAL_TARGETED_REMEDIATION_BASELINE_RUN_PUBLIC_ID,
    model_snapshot: run.model_snapshot,
    reasoning_effort: run.reasoning_effort,
    prompt_version: run.prompt_version,
    schema_version: run.schema_version,
    prompt_hash: run.prompt_hash,
    manifest_hash: run.pilot_manifest_hash,
    run_config_hash: run.run_config_hash,
    provider_request_count: run.provider_request_count,
    estimated_cost_usd: decimalToNumber(run.estimated_cost_usd),
    budget_limit_usd: decimalToNumber(run.budget_limit_usd),
    affected,
    control,
    overall,
    raw_model_quality: rawModelQuality,
    effective_system_readiness: effectiveSystemReadiness,
    selected_review: {
      review_source: reviewSource,
      review_target: EFFECTIVE_SYSTEM_REVIEW_TARGET,
      annotation_count: reviewAnnotations.length,
      pass_count: reviewAnnotations.filter((entry) => entry.annotation.pass_fail === "pass").length,
      fail_count: reviewAnnotations.filter((entry) => entry.annotation.pass_fail === "fail").length,
      critical_failure_count: reviewCriticalFlags.length,
      pass_rate: rate(reviewAnnotations.filter((entry) => entry.annotation.pass_fail === "pass").length, reviewAnnotations.length),
      failed_case_ids: [...new Set(reviewAnnotations.filter((entry) => entry.annotation.pass_fail === "fail").map((entry) => entry.item.eval_case.case_id))],
      failed_review_items: failedAnnotationDetails(reviewAnnotations)
    },
    control_pass_by_agent: controlPassByAgent,
    human_critical_failure_counts: rawHumanAnnotations.flatMap((entry) => flagsFromAnnotation(entry.annotation)).reduce<Record<string, number>>((acc, flag) => {
      acc[flag] = (acc[flag] ?? 0) + 1;
      return acc;
    }, {}),
    ai_critical_failure_counts: effectiveAiAnnotations.flatMap((entry) => flagsFromAnnotation(entry.annotation)).reduce<Record<string, number>>((acc, flag) => {
      acc[flag] = (acc[flag] ?? 0) + 1;
      return acc;
    }, {}),
    review_critical_failure_counts: criticalCounts,
    engineering_gates: engineeringGates,
    gates
  };
}

export const targetedRemediationTestInternals = {
  buildTargetedRemediationPlan,
  terminalForTargeted,
  responseCollectionGate,
  planningGate,
  followupGate,
  itemVerificationGate
};
