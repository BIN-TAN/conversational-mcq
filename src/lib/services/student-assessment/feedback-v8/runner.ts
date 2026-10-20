import { randomUUID } from "node:crypto";
import { assertNoProhibitedProviderInput } from "@/lib/agents/redaction";
import { getServerEnv } from "@/lib/env";
import { getLlmRuntimeConfig, LlmConfigurationError, resolveOpenAIModelConfigForRole } from "@/lib/llm/config";
import type { AgentModelConfig } from "@/lib/llm/config";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type { LlmProvider, StructuredAgentResult } from "@/lib/llm/providers/types";
import {
  resolveTopicDialogueExecutionPlan,
  type FormativeExecutionMode
} from "@/lib/services/student-assessment/formative-execution-mode";
import { FormativeConversationUnavailableError } from "@/lib/services/student-assessment/formative-conversation/availability";
import {
  FEEDBACK_V8_AGENT_NAME,
  FEEDBACK_V8_AGENT_VERSION,
  FEEDBACK_V8_CONTRACT_VERSION,
  FEEDBACK_V8_CONVERSATION_INSTRUCTIONS,
  FEEDBACK_V8_CONVERSATION_PROMPT_VERSION,
  FEEDBACK_V8_OPENING_INSTRUCTIONS,
  FEEDBACK_V8_OPENING_PROMPT_VERSION,
  FEEDBACK_V8_PROMPT_HASH,
  FeedbackV8OutputSchema,
  type FeedbackV8Input,
  type FeedbackV8Output
} from "./contract";
import { buildLocalTestFeedbackV8 } from "./local-test";
import { validateFeedbackV8Output, type FeedbackIssue } from "./validate";

/**
 * Runner for the opening message and conversation replies (feedback v8). One provider call,
 * regenerated once with the list of problems when the application's checks reject it.
 * Live calls run only when FORMATIVE_FEEDBACK_V8_APPROVED_PROMPT_HASH equals the hash of
 * both prompts and the output schema (the operator's record that they passed validation).
 * Otherwise the runner is unavailable and the student keeps the answer review and the End
 * button (section 11.2).
 */
export const FEEDBACK_V8_MAX_ATTEMPTS = 2;
const PROVIDER_TIMEOUT_MS = 120_000;

export type FeedbackV8RunnerIdentity = {
  agent_name: typeof FEEDBACK_V8_AGENT_NAME;
  agent_version: string;
  model_name: string;
  provider: string;
  prompt_version: string;
  schema_version: typeof FEEDBACK_V8_CONTRACT_VERSION;
  prompt_hash: string;
  reasoning_effort: string | null;
  max_output_tokens: number | null;
  live_call_allowed: boolean;
};

export type FeedbackV8Execution = {
  output: FeedbackV8Output;
  raw_output: unknown;
  generation_source: "live_llm" | "deterministic_test";
  provider_request_id?: string | null;
  provider_response_id?: string | null;
  client_request_id?: string | null;
  retry_count: number;
  latency_ms: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  estimated_cost?: number | null;
  started_at: Date;
  completed_at: Date;
};

export interface FeedbackV8Runner {
  identity: FeedbackV8RunnerIdentity;
  execute(input: { agent_call_db_id: string; invocation_key: string; context: FeedbackV8Input }): Promise<FeedbackV8Execution>;
}

export type FeedbackV8AttemptAudit = {
  attempt: number;
  status: string;
  issues: FeedbackIssue[];
  rejected_output: unknown;
  latency_ms: number;
};

export class FeedbackV8ExecutionError extends Error {
  constructor(
    public readonly failure_class: "validation_failed" | "transport_failure",
    public readonly attempts: FeedbackV8AttemptAudit[],
    public readonly started_at: Date,
    public readonly completed_at: Date,
    public readonly usage: { input_tokens: number | null; output_tokens: number | null; total_tokens: number | null }
  ) {
    super(`feedback_v8_${failure_class}`);
    this.name = "FeedbackV8ExecutionError";
  }
}

export function feedbackV8ApprovalStatus() {
  const configured = process.env.FORMATIVE_FEEDBACK_V8_APPROVED_PROMPT_HASH?.trim() || null;
  return { approved: configured === FEEDBACK_V8_PROMPT_HASH, prompt_hash: FEEDBACK_V8_PROMPT_HASH, configured_hash: configured };
}

type Plan =
  | { mode: "local_test" }
  | { mode: "live_model"; provider: LlmProvider; model_config: AgentModelConfig }
  | { mode: "blocked"; reason: string; retryable: boolean };

export function feedbackV8Plan(executionMode: FormativeExecutionMode = "production"): Plan {
  try {
    if (!resolveTopicDialogueExecutionPlan(executionMode).provider_generation_allowed) {
      return { mode: "blocked", reason: "feedback_v8_generation_not_allowed", retryable: false };
    }
    const operational = getServerEnv().OPERATIONAL_AGENT_MODE;
    if (operational === "disabled") return { mode: "blocked", reason: "feedback_v8_operational_mode_disabled", retryable: false };
    const runtime = getLlmRuntimeConfig();
    if (operational === "mock" || runtime.provider === "mock") {
      return process.env.NODE_ENV === "production"
        ? { mode: "blocked", reason: "feedback_v8_mock_in_production", retryable: false }
        : { mode: "local_test" };
    }
    if (!runtime.live_calls_enabled) return { mode: "blocked", reason: "feedback_v8_live_calls_disabled", retryable: false };
    if (!feedbackV8ApprovalStatus().approved) return { mode: "blocked", reason: "feedback_v8_not_approved", retryable: false };
    return { mode: "live_model", provider: createLlmProvider(), model_config: resolveOpenAIModelConfigForRole(FEEDBACK_V8_AGENT_NAME) };
  } catch (error) {
    if (error instanceof LlmConfigurationError) return { mode: "blocked", reason: `feedback_v8_configuration_${error.code}`, retryable: false };
    throw error;
  }
}

function identity(plan: Exclude<Plan, { mode: "blocked" }>): FeedbackV8RunnerIdentity {
  const live = plan.mode === "live_model";
  return {
    agent_name: FEEDBACK_V8_AGENT_NAME,
    agent_version: FEEDBACK_V8_AGENT_VERSION,
    model_name: live ? plan.model_config.model_name : "local-test-feedback",
    provider: live ? "openai" : "mock",
    prompt_version: `${FEEDBACK_V8_OPENING_PROMPT_VERSION}+${FEEDBACK_V8_CONVERSATION_PROMPT_VERSION}`,
    schema_version: FEEDBACK_V8_CONTRACT_VERSION,
    prompt_hash: FEEDBACK_V8_PROMPT_HASH,
    reasoning_effort: live ? plan.model_config.reasoning_effort ?? null : null,
    max_output_tokens: live ? plan.model_config.max_output_tokens ?? null : null,
    live_call_allowed: live
  };
}

function usageOf(result: StructuredAgentResult<unknown>) {
  return {
    input_tokens: result.usage?.input_tokens ?? null,
    output_tokens: result.usage?.output_tokens ?? null,
    total_tokens: result.usage?.total_tokens ?? null
  };
}

export function createFeedbackV8Runner(executionMode: FormativeExecutionMode = "production"): FeedbackV8Runner {
  const plan = feedbackV8Plan(executionMode);
  if (plan.mode === "blocked") throw new FormativeConversationUnavailableError(plan.reason, plan.retryable);

  if (plan.mode === "local_test") {
    return {
      identity: identity(plan),
      async execute({ context }) {
        const startedAt = new Date();
        const output = buildLocalTestFeedbackV8(context);
        const issues = validateFeedbackV8Output(context, output);
        if (issues.length) {
          throw new FeedbackV8ExecutionError("validation_failed", [{ attempt: 1, status: "invalid", issues, rejected_output: output, latency_ms: 0 }],
            startedAt, new Date(), { input_tokens: null, output_tokens: null, total_tokens: null });
        }
        return {
          output,
          raw_output: { adapter: "local_test_feedback_v8" },
          generation_source: "deterministic_test",
          retry_count: 0,
          latency_ms: 1,
          estimated_cost: 0,
          started_at: startedAt,
          completed_at: new Date(startedAt.getTime() + 1)
        };
      }
    };
  }

  return {
    identity: identity(plan),
    async execute({ invocation_key, context }) {
      assertNoProhibitedProviderInput(context);
      const startedAt = new Date();
      const attempts: FeedbackV8AttemptAudit[] = [];
      let previousIssues: FeedbackIssue[] = [];
      let lastUsage = { input_tokens: null as number | null, output_tokens: null as number | null, total_tokens: null as number | null };
      let transportFailures = 0;
      for (let attempt = 1; attempt <= FEEDBACK_V8_MAX_ATTEMPTS; attempt += 1) {
        const clientRequestId = `feedback_v8_${randomUUID()}`;
        const providerInput = previousIssues.length ? { ...context, previous_attempt_rejected_for: previousIssues.slice(0, 20) } : context;
        let result: StructuredAgentResult<FeedbackV8Output>;
        try {
          result = await plan.provider.executeStructured({
            agent_name: FEEDBACK_V8_AGENT_NAME,
            model_config: plan.model_config,
            instructions: context.mode === "opening" ? FEEDBACK_V8_OPENING_INSTRUCTIONS : FEEDBACK_V8_CONVERSATION_INSTRUCTIONS,
            input: providerInput,
            output_schema: FeedbackV8OutputSchema,
            schema_name: FEEDBACK_V8_CONTRACT_VERSION.replace(/[^a-zA-Z0-9_-]/g, "_"),
            client_request_id: clientRequestId,
            timeout_ms: PROVIDER_TIMEOUT_MS,
            metadata: { purpose: `feedback_v8_${context.mode}`, invocation_key, attempt: String(attempt) }
          });
        } catch {
          transportFailures += 1;
          attempts.push({ attempt, status: "provider_exception", issues: [], rejected_output: null, latency_ms: 0 });
          continue;
        }
        lastUsage = usageOf(result);
        if (result.status !== "completed" || !result.parsed_output) {
          transportFailures += 1;
          attempts.push({ attempt, status: result.error?.category ?? result.status, issues: [], rejected_output: null, latency_ms: result.latency_ms });
          if (result.error?.retryable === false) break;
          continue;
        }
        const parsed = FeedbackV8OutputSchema.safeParse(result.parsed_output);
        const issues = parsed.success
          ? validateFeedbackV8Output(context, parsed.data)
          : [{ path: "$", code: "schema_mismatch", message: "The output did not match the required format." }];
        if (!parsed.success || issues.length) {
          previousIssues = issues;
          attempts.push({ attempt, status: "invalid", issues, rejected_output: result.parsed_output, latency_ms: result.latency_ms });
          continue;
        }
        const completedAt = new Date();
        return {
          output: parsed.data,
          raw_output: { accepted_output: result.raw_output ?? result.parsed_output, rejected_attempts: attempts },
          generation_source: "live_llm",
          provider_request_id: result.provider_request_id ?? null,
          provider_response_id: result.provider_response_id ?? null,
          client_request_id: clientRequestId,
          retry_count: attempt - 1,
          latency_ms: Math.max(0, completedAt.getTime() - startedAt.getTime()),
          ...lastUsage,
          started_at: startedAt,
          completed_at: completedAt
        };
      }
      const failureClass = attempts.some((entry) => entry.status === "invalid") && transportFailures < attempts.length
        ? "validation_failed" : "transport_failure";
      throw new FeedbackV8ExecutionError(failureClass, attempts, startedAt, new Date(), lastUsage);
    }
  };
}
