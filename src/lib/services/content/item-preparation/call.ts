import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertNoProhibitedProviderInput, redactForAudit } from "@/lib/agents/redaction";
import { getServerEnv } from "@/lib/env";
import {
  getLlmRuntimeConfig,
  LlmConfigurationError,
  resolveOpenAIModelConfigForRole,
  type AgentModelConfig
} from "@/lib/llm/config";
import { providerAuditMetadata } from "@/lib/llm/providers/audit-metadata";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type { LlmProvider, StructuredAgentResult } from "@/lib/llm/providers/types";
import { toPrismaJson } from "@/lib/services/json";
import {
  ITEM_PREPARATION_AGENT_VERSION,
  ITEM_PREPARATION_INSTRUCTIONS,
  ITEM_PREPARATION_PROMPT_HASH,
  ITEM_PREPARATION_PROMPT_VERSION,
  ITEM_PREPARATION_SCHEMA_VERSION,
  ItemPreparationOutputSchema,
  type ItemPreparationInput,
  type ItemPreparationOutput,
  type ItemPreparationResult,
  type ItemPreparationTask
} from "./contract";
import { buildLocalTestItemPreparation } from "./local-test";
import {
  applyItemPreparationRules,
  validateItemPreparationOutput,
  type ItemPreparationIssue
} from "./rules";

/**
 * One item-preparation call (section 9.2) for any of the three tasks, with one regeneration
 * when the application's checks reject the proposal. Each task keeps the role, model
 * settings and gating of the flow it replaces:
 *
 * - draft_or_adapt: mcq_diagnostic_authoring_assistant_agent (import "Suggest missing notes")
 * - format_imported: mcq_import_formatting_assistant_agent (import "Repair imported layout")
 * - check: item_verification_agent (topic verification before publishing)
 *
 * The item check before publishing also needs ITEM_PREPARATION_V8_APPROVED_PROMPT_HASH to
 * equal this prompt's hash: the operator's record that this exact prompt passed validation.
 * Until then it uses its deterministic fallback. The two import tasks (suggest missing notes,
 * repair the layout) run live like the item builder (release CMCQ-20261020-06): they only
 * suggest, the instructor accepts every suggestion, and each call records this prompt's
 * version and hash. Mock mode uses the labelled local stand-in.
 */
export const ITEM_PREPARATION_MAX_ATTEMPTS = 2;
const PROVIDER_TIMEOUT_MS = 120_000;

export type ItemPreparationRole =
  | "mcq_diagnostic_authoring_assistant_agent"
  | "mcq_import_formatting_assistant_agent"
  | "item_verification_agent";

export const ITEM_PREPARATION_ROLE_BY_TASK: Record<ItemPreparationTask, ItemPreparationRole> = {
  draft_or_adapt: "mcq_diagnostic_authoring_assistant_agent",
  format_imported: "mcq_import_formatting_assistant_agent",
  check: "item_verification_agent"
};

export function itemPreparationApprovalStatus() {
  const configured = process.env.ITEM_PREPARATION_V8_APPROVED_PROMPT_HASH?.trim() || null;
  return {
    approved: configured === ITEM_PREPARATION_PROMPT_HASH,
    prompt_hash: ITEM_PREPARATION_PROMPT_HASH,
    configured_hash: configured
  };
}

export type ItemPreparationPlan =
  | { mode: "local_test"; mock_mode?: string | null }
  | {
      mode: "live_model";
      provider: LlmProvider;
      provider_label: "mock" | "openai";
      model_config: AgentModelConfig;
      timeout_ms: number;
      live_call_allowed: boolean;
    }
  | { mode: "blocked"; reason: string };

export type ItemPreparationProviderOverride = {
  provider: LlmProvider;
  provider_label?: "mock" | "openai";
  model_config?: AgentModelConfig;
};

function liveModelPlan(task: ItemPreparationTask): ItemPreparationPlan {
  const runtime = getLlmRuntimeConfig();
  if (runtime.provider !== "openai" || !runtime.live_calls_enabled) {
    return { mode: "blocked", reason: "live_calls_disabled" };
  }
  if (task === "check" && !itemPreparationApprovalStatus().approved) {
    return { mode: "blocked", reason: "item_preparation_v8_not_approved" };
  }
  return {
    mode: "live_model",
    provider: createLlmProvider(),
    provider_label: "openai",
    model_config: resolveOpenAIModelConfigForRole(ITEM_PREPARATION_ROLE_BY_TASK[task]),
    timeout_ms: Math.min(runtime.request_timeout_ms, PROVIDER_TIMEOUT_MS),
    live_call_allowed: true
  };
}

/**
 * Teacher-triggered import assistance (draft/adapt and format), as before: "mock" uses the
 * local stand-in (callers refuse it in production), a test override replaces the provider,
 * and "live" needs LLM_PROVIDER=openai, LLM_LIVE_CALLS_ENABLED=true and the role's model.
 */
export function planTeacherItemPreparation(input: {
  task: Exclude<ItemPreparationTask, "check">;
  mode: "live" | "mock";
  override?: ItemPreparationProviderOverride | null;
}): ItemPreparationPlan {
  if (input.mode === "mock") return { mode: "local_test" };
  if (input.override) {
    return {
      mode: "live_model",
      provider: input.override.provider,
      provider_label: input.override.provider_label ?? "mock",
      model_config: input.override.model_config ?? { model_name: "injected-item-preparation-model", max_output_tokens: 4000 },
      timeout_ms: 60_000,
      live_call_allowed: false
    };
  }
  try {
    return liveModelPlan(input.task);
  } catch (error) {
    if (error instanceof LlmConfigurationError) return { mode: "blocked", reason: `configuration_${error.code}` };
    throw error;
  }
}

/**
 * The item check follows the operational agent modes, as the verification agent did:
 * disabled (the default) blocks the call and the deterministic fallback is used; mock uses
 * the local stand-in; guarded_live calls the model only when live calls are enabled and
 * this exact prompt is approved.
 */
export function planItemCheck(input: { mock_mode?: string | null; override?: ItemPreparationProviderOverride | null } = {}): ItemPreparationPlan {
  try {
    if (input.override) return planTeacherItemPreparation({ task: "draft_or_adapt", mode: "live", override: input.override });
    const mode = getServerEnv().OPERATIONAL_AGENT_MODE;
    if (mode === "disabled") return { mode: "blocked", reason: "operational_agent_mode_disabled" };
    const runtime = getLlmRuntimeConfig();
    if (mode === "mock" || runtime.provider === "mock") return { mode: "local_test", mock_mode: input.mock_mode ?? null };
    return liveModelPlan("check");
  } catch (error) {
    if (error instanceof LlmConfigurationError) return { mode: "blocked", reason: `configuration_${error.code}` };
    throw error;
  }
}

/** Where each attempt is recorded; the default writes agent_calls rows. */
export type ItemPreparationRecorder = {
  start(entry: {
    role: ItemPreparationRole;
    invocation_key: string;
    model_name: string;
    provider: string;
    client_request_id: string | null;
    input_payload: unknown;
    live_call_allowed: boolean;
    retry_count: number;
    model_config: AgentModelConfig | null;
  }): Promise<{ id: string; public_id: string | null }>;
  finish(id: string, entry: {
    status: "succeeded" | "failed" | "invalid_output";
    result?: StructuredAgentResult<unknown>;
    output_payload?: unknown;
    error_category?: string | null;
    validation_error?: string | null;
    blocked_reason?: string | null;
  }): Promise<void>;
};

export const prismaItemPreparationRecorder: ItemPreparationRecorder = {
  async start(entry) {
    const call = await prisma.agentCall.create({
      data: {
        id: randomUUID(),
        agent_name: entry.role,
        agent_version: ITEM_PREPARATION_AGENT_VERSION,
        prompt_version: ITEM_PREPARATION_PROMPT_VERSION,
        schema_version: ITEM_PREPARATION_SCHEMA_VERSION,
        prompt_hash: ITEM_PREPARATION_PROMPT_HASH,
        model_name: entry.model_name,
        provider: entry.provider,
        client_request_id: entry.client_request_id,
        agent_invocation_key: entry.invocation_key,
        reasoning_effort: entry.model_config?.reasoning_effort ?? null,
        max_output_tokens: entry.model_config?.max_output_tokens ?? null,
        input_payload: toPrismaJson(redactForAudit(entry.input_payload)) ?? Prisma.JsonNull,
        live_call_allowed: entry.live_call_allowed,
        call_status: "started",
        retry_count: entry.retry_count,
        started_at: new Date()
      },
      select: { id: true, client_request_id: true }
    });
    return { id: call.id, public_id: call.client_request_id };
  },
  async finish(id, entry) {
    const result = entry.result;
    await prisma.agentCall.update({
      where: { id },
      data: {
        ...(result
          ? {
              provider: result.provider,
              ...providerAuditMetadata(result),
              raw_output: result.raw_output === undefined ? Prisma.JsonNull : toPrismaJson(redactForAudit(result.raw_output)) ?? Prisma.JsonNull,
              refusal_text: result.refusal ?? null,
              incomplete_reason: result.incomplete_reason ?? null,
              latency_ms: result.latency_ms,
              input_tokens: result.usage?.input_tokens,
              output_tokens: result.usage?.output_tokens,
              total_tokens: result.usage?.total_tokens,
              token_usage: result.usage ? toPrismaJson(result.usage.raw ?? result.usage) : undefined
            }
          : {}),
        output_payload: entry.output_payload === undefined ? undefined : toPrismaJson(entry.output_payload) ?? Prisma.JsonNull,
        output_validated: entry.status === "succeeded",
        call_status: entry.status,
        error_category: entry.error_category ?? null,
        validation_error: entry.validation_error ?? null,
        blocked_reason: entry.blocked_reason ?? null,
        completed_at: new Date()
      }
    });
  }
};

export type ItemPreparationCallResult =
  | {
      status: "succeeded";
      generation_mode: "live_model" | "local_test";
      result: ItemPreparationResult;
      agent_call_id: string | null;
      agent_call_public_id: string | null;
      provider: "mock" | "openai";
      model_name: string;
      repair_attempted: boolean;
      retry_count: number;
      provider_request_id_present: boolean;
      provider_response_id_present: boolean;
      token_usage_present: boolean;
    }
  | {
      status: "failed" | "blocked";
      reason: string;
      agent_call_id: string | null;
      agent_call_public_id: string | null;
    };

function issuesText(issues: ItemPreparationIssue[]) {
  return issues.map((issue) => `${issue.path}: ${issue.code}`).join("; ").slice(0, 4000);
}

export async function runItemPreparation(input: {
  model_input: ItemPreparationInput;
  plan: ItemPreparationPlan;
  invocation_key_base: string;
  record_local_test?: boolean;
  recorder?: ItemPreparationRecorder;
}): Promise<ItemPreparationCallResult> {
  const recorder = input.recorder ?? prismaItemPreparationRecorder;
  const role = ITEM_PREPARATION_ROLE_BY_TASK[input.model_input.task];
  const plan = input.plan;

  if (plan.mode === "blocked") {
    return { status: "blocked", reason: plan.reason, agent_call_id: null, agent_call_public_id: null };
  }

  if (plan.mode === "local_test") {
    const output = buildLocalTestItemPreparation(input.model_input, plan.mock_mode);
    const issues = validateItemPreparationOutput(input.model_input, output);
    const result = applyItemPreparationRules(input.model_input, output);
    let call: { id: string; public_id: string | null } | null = null;
    if (input.record_local_test) {
      call = await recorder.start({
        role,
        invocation_key: `${input.invocation_key_base}:local:${randomUUID()}`,
        model_name: "local-test-item-preparation",
        provider: "mock",
        client_request_id: null,
        input_payload: input.model_input,
        live_call_allowed: false,
        retry_count: 0,
        model_config: null
      });
      await recorder.finish(call.id, issues.length
        ? { status: "invalid_output", output_payload: { rejected_output: output, issues }, error_category: "semantic_validation", validation_error: issuesText(issues) }
        : { status: "succeeded", output_payload: { output, result } });
    }
    if (issues.length) return { status: "failed", reason: "validation_failed", agent_call_id: call?.id ?? null, agent_call_public_id: call?.public_id ?? null };
    return {
      status: "succeeded",
      generation_mode: "local_test",
      result,
      agent_call_id: call?.id ?? null,
      agent_call_public_id: call?.public_id ?? null,
      provider: "mock",
      model_name: "local-test-item-preparation",
      repair_attempted: false,
      retry_count: 0,
      provider_request_id_present: false,
      provider_response_id_present: false,
      token_usage_present: false
    };
  }

  assertNoProhibitedProviderInput(input.model_input);
  let previousIssues: ItemPreparationIssue[] = [];
  let lastReason = "provider_failure";
  let last: { id: string; public_id: string | null } | null = null;
  for (let attempt = 1; attempt <= ITEM_PREPARATION_MAX_ATTEMPTS; attempt += 1) {
    const clientRequestId = `item_prep_v8_${randomUUID()}`;
    const providerInput = previousIssues.length
      ? { ...input.model_input, previous_attempt_rejected_for: previousIssues.slice(0, 30) }
      : input.model_input;
    const call = await recorder.start({
      role,
      invocation_key: `${input.invocation_key_base}:${attempt}:${randomUUID()}`,
      model_name: plan.model_config.model_name,
      provider: plan.provider_label,
      client_request_id: clientRequestId,
      input_payload: providerInput,
      live_call_allowed: plan.live_call_allowed,
      retry_count: attempt - 1,
      model_config: plan.model_config
    });
    last = call;
    let result: StructuredAgentResult<ItemPreparationOutput>;
    try {
      result = await plan.provider.executeStructured({
        agent_name: role,
        model_config: plan.model_config,
        instructions: ITEM_PREPARATION_INSTRUCTIONS,
        input: providerInput,
        output_schema: ItemPreparationOutputSchema,
        schema_name: ITEM_PREPARATION_SCHEMA_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_"),
        client_request_id: clientRequestId,
        timeout_ms: plan.timeout_ms,
        metadata: {
          purpose: `item_preparation_${input.model_input.task}`,
          prompt_version: ITEM_PREPARATION_PROMPT_VERSION,
          attempt: String(attempt)
        }
      });
    } catch {
      lastReason = "provider_exception";
      await recorder.finish(call.id, { status: "failed", error_category: "provider_exception" });
      continue;
    }
    if (result.status !== "completed" || !result.parsed_output) {
      lastReason = result.error?.category ?? result.status;
      await recorder.finish(call.id, { status: "failed", result, error_category: lastReason });
      if (result.error?.retryable === false) break;
      continue;
    }
    const parsed = ItemPreparationOutputSchema.safeParse(result.parsed_output);
    const issues = parsed.success
      ? validateItemPreparationOutput(input.model_input, parsed.data)
      : [{ path: "$", code: "schema_mismatch", message: "The output did not match the required format." }];
    if (!parsed.success || issues.length > 0) {
      previousIssues = issues;
      lastReason = "validation_failed";
      await recorder.finish(call.id, {
        status: "invalid_output",
        result,
        output_payload: { rejected_output: result.parsed_output, issues },
        error_category: "semantic_validation",
        validation_error: issuesText(issues)
      });
      continue;
    }
    const prepared = applyItemPreparationRules(input.model_input, parsed.data);
    await recorder.finish(call.id, { status: "succeeded", result, output_payload: { output: parsed.data, result: prepared } });
    const ids = providerAuditMetadata(result);
    return {
      status: "succeeded",
      generation_mode: "live_model",
      result: prepared,
      agent_call_id: call.id,
      agent_call_public_id: call.public_id,
      provider: result.provider,
      model_name: plan.model_config.model_name,
      repair_attempted: attempt > 1,
      retry_count: attempt - 1,
      provider_request_id_present: Boolean(ids.provider_request_id),
      provider_response_id_present: Boolean(ids.provider_response_id),
      token_usage_present: Boolean(result.usage)
    };
  }
  return { status: "failed", reason: lastReason, agent_call_id: last?.id ?? null, agent_call_public_id: last?.public_id ?? null };
}
