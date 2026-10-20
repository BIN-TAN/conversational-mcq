import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertNoProhibitedProviderInput, redactForAudit } from "@/lib/agents/redaction";
import { getServerEnv } from "@/lib/env";
import { getLlmRuntimeConfig, LlmConfigurationError, resolveAgentModelConfig } from "@/lib/llm/config";
import type { AgentModelConfig } from "@/lib/llm/config";
import { providerAuditMetadata } from "@/lib/llm/providers/audit-metadata";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type { LlmProvider, StructuredAgentResult } from "@/lib/llm/providers/types";
import { toPrismaJson } from "@/lib/services/json";
import {
  INTERPRETATION_V8_AGENT_NAME,
  INTERPRETATION_V8_AGENT_VERSION,
  INTERPRETATION_V8_PROMPT_HASH,
  INTERPRETATION_V8_PROMPT_VERSION,
  INTERPRETATION_V8_SCHEMA_VERSION,
  type InterpretationInputV8,
  type InterpretationOutputV8
} from "./contract";
import { generateInterpretationV8 } from "./generate";
import { buildLocalTestInterpretationV8 } from "./local-test";

/**
 * One v8 profiling call per submitted mini-test, with one regeneration when the
 * application's checks reject the output (docs/AI_MODULE_REDESIGN_2026-10-19.md, section 5).
 *
 * Live calls run only when INTERPRETATION_V8_APPROVED_PROMPT_HASH equals the hash of the
 * current prompt and schema: the operator's record that this exact prompt passed
 * validation. Until then a submission is interpreted by the fallback (no diagnostic claims).
 * The model and reasoning effort come from the approved student_profiling_agent settings.
 */

export type InterpretationCallResult =
  | { status: "validated"; generation_mode: "live_model" | "local_test"; output: InterpretationOutputV8; agent_call_id: string }
  | { status: "failed" | "blocked"; reason: string; agent_call_id: string | null };

type Plan =
  | { mode: "local_test" }
  | { mode: "live_model"; provider: LlmProvider; model_config: AgentModelConfig }
  | { mode: "blocked"; reason: string };

export function interpretationV8ApprovalStatus() {
  const approved = process.env.INTERPRETATION_V8_APPROVED_PROMPT_HASH?.trim() || null;
  return { approved: approved === INTERPRETATION_V8_PROMPT_HASH, prompt_hash: INTERPRETATION_V8_PROMPT_HASH, configured_hash: approved };
}

/**
 * Mirrors the operational agent modes: disabled (the default) saves the fallback profile,
 * mock uses the labelled local test stand-in, and guarded_live calls the model only when
 * live calls are enabled and this exact prompt is approved.
 */
function plan(providerGenerationAllowed: boolean): Plan {
  try {
    if (!providerGenerationAllowed) return { mode: "blocked", reason: "provider_generation_not_allowed" };
    const mode = getServerEnv().OPERATIONAL_AGENT_MODE;
    if (mode === "disabled") return { mode: "blocked", reason: "operational_agent_mode_disabled" };
    const runtime = getLlmRuntimeConfig();
    if (mode === "mock" || runtime.provider === "mock") return { mode: "local_test" };
    if (!runtime.live_calls_enabled) return { mode: "blocked", reason: "live_calls_disabled" };
    if (!interpretationV8ApprovalStatus().approved) return { mode: "blocked", reason: "interpretation_v8_not_approved" };
    return { mode: "live_model", provider: createLlmProvider(), model_config: resolveAgentModelConfig(INTERPRETATION_V8_AGENT_NAME) };
  } catch (error) {
    if (error instanceof LlmConfigurationError) return { mode: "blocked", reason: `configuration_${error.code}` };
    throw error;
  }
}

function auditUpdate(result: StructuredAgentResult<unknown>) {
  return {
    provider: result.provider,
    ...providerAuditMetadata(result),
    refusal_text: result.status === "refused" ? result.refusal ?? "refused" : null,
    incomplete_reason: result.status === "incomplete" ? result.incomplete_reason ?? "incomplete" : null,
    raw_output: result.raw_output === undefined ? Prisma.JsonNull : toPrismaJson(redactForAudit(result.raw_output)),
    latency_ms: result.latency_ms,
    input_tokens: result.usage?.input_tokens,
    output_tokens: result.usage?.output_tokens,
    total_tokens: result.usage?.total_tokens,
    token_usage: result.usage ? toPrismaJson(result.usage.raw ?? result.usage) : undefined
  };
}

export async function callInterpretationV8(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  response_package_id: string;
  model_input: InterpretationInputV8;
  provider_generation_allowed: boolean;
}): Promise<InterpretationCallResult> {
  const callPlan = plan(input.provider_generation_allowed);
  const invocationBase = `interpretation-v8:${input.concept_unit_session_db_id}:${input.response_package_id}`;
  const common = {
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    agent_name: INTERPRETATION_V8_AGENT_NAME,
    agent_version: INTERPRETATION_V8_AGENT_VERSION,
    prompt_version: INTERPRETATION_V8_PROMPT_VERSION,
    schema_version: INTERPRETATION_V8_SCHEMA_VERSION,
    prompt_hash: INTERPRETATION_V8_PROMPT_HASH
  };

  if (callPlan.mode === "local_test") {
    const output = buildLocalTestInterpretationV8(input.model_input);
    const call = await prisma.agentCall.create({
      data: {
        ...common,
        model_name: "local-test-interpretation",
        provider: "mock",
        agent_invocation_key: `${invocationBase}:local:${randomUUID()}`,
        input_payload: toPrismaJson(input.model_input) ?? Prisma.JsonNull,
        output_payload: toPrismaJson(output) ?? Prisma.JsonNull,
        output_validated: true,
        live_call_allowed: false,
        call_status: "succeeded",
        started_at: new Date(),
        completed_at: new Date()
      }
    });
    return { status: "validated", generation_mode: "local_test", output, agent_call_id: call.id };
  }

  if (callPlan.mode === "blocked") {
    const call = await prisma.agentCall.create({
      data: {
        ...common,
        model_name: "not-called",
        provider: "openai",
        agent_invocation_key: `${invocationBase}:blocked:${randomUUID()}`,
        input_payload: toPrismaJson({ blocked_before_provider_call: true }) ?? Prisma.JsonNull,
        output_validated: false,
        live_call_allowed: false,
        call_status: "failed",
        error_category: "blocked_before_provider_call",
        blocked_reason: callPlan.reason,
        started_at: new Date(),
        completed_at: new Date()
      }
    });
    return { status: "blocked", reason: callPlan.reason, agent_call_id: call.id };
  }

  assertNoProhibitedProviderInput(input.model_input);
  const model = callPlan.model_config;
  let currentCallId: string | null = null;
  let lastCallId: string | null = null;
  const generation = await generateInterpretationV8({
    provider: callPlan.provider,
    model_config: model,
    model_input: input.model_input,
    async on_attempt_start({ attempt, client_request_id, provider_input }) {
      const call = await prisma.agentCall.create({
        data: {
          ...common,
          model_name: model.model_name,
          provider: "openai",
          client_request_id,
          agent_invocation_key: `${invocationBase}:${attempt}:${randomUUID()}`,
          reasoning_effort: model.reasoning_effort ?? null,
          max_output_tokens: model.max_output_tokens ?? null,
          input_payload: toPrismaJson(provider_input) ?? Prisma.JsonNull,
          live_call_allowed: true,
          call_status: "started",
          retry_count: attempt - 1,
          started_at: new Date()
        }
      });
      currentCallId = call.id;
      lastCallId = call.id;
    },
    async on_attempt_end(record) {
      if (!currentCallId) return;
      const id = currentCallId;
      if (record.outcome === "provider_exception") {
        await prisma.agentCall.update({
          where: { id },
          data: { output_validated: false, call_status: "failed", error_category: "provider_exception", completed_at: new Date() }
        });
        return;
      }
      const result = record.result!;
      if (record.outcome === "provider_failure") {
        await prisma.agentCall.update({
          where: { id },
          data: { ...auditUpdate(result), output_validated: false, call_status: "failed",
            error_category: result.error?.category ?? result.status, completed_at: new Date() }
        });
        return;
      }
      if (record.outcome === "invalid_output") {
        await prisma.agentCall.update({
          where: { id },
          data: {
            ...auditUpdate(result),
            output_payload: toPrismaJson({ rejected_output: result.parsed_output, issues: record.issues }),
            output_validated: false,
            call_status: "invalid_output",
            error_category: "semantic_validation",
            validation_error: record.issues.map((issue) => `${issue.path}: ${issue.code}`).join("; ").slice(0, 4000),
            completed_at: new Date()
          }
        });
        return;
      }
      await prisma.agentCall.update({
        where: { id },
        data: { ...auditUpdate(result), output_payload: toPrismaJson(record.output), output_validated: true, call_status: "succeeded", completed_at: new Date() }
      });
    }
  });
  if (generation.status === "validated") {
    return { status: "validated", generation_mode: "live_model", output: generation.output, agent_call_id: lastCallId! };
  }
  return { status: "failed", reason: generation.reason, agent_call_id: lastCallId };
}
