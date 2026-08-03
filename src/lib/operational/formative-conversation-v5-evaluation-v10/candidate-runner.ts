import { createHash } from "node:crypto";
import type { AgentModelConfig } from "@/lib/llm/config";
import {
  executeWithBoundedProviderTransportRetry,
  type ProviderAttemptBudgetSnapshot,
  type ProviderTransportAttemptTrace
} from "@/lib/llm/provider-transport-retry";
import { createLlmProvider } from "@/lib/llm/providers/provider-factory";
import type {
  LlmProvider,
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentInput,
  type FormativeConversationAgentOutput
} from "@/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_INSTRUCTIONS,
  FORMATIVE_CONVERSATION_PROMPT_HASH,
  FORMATIVE_CONVERSATION_PROMPT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/live-runner";
import type {
  FormativeConversationAgentExecution,
  FormativeConversationAgentRunner
} from "@/lib/services/student-assessment/formative-conversation/runtime";
import {
  executeFormativeConversationWithSemanticRegeneration,
  type FormativeConversationLogicalGenerationExecution
} from "@/lib/services/student-assessment/formative-conversation/semantic-regeneration";
import type { FormativeConversationV5Package } from "./package";

type Budget = FormativeConversationV5Package["protocol"]["budget"];

type BudgetReservation = {
  logical_calls_used: number;
  reserved_input_tokens: number;
  reserved_output_tokens: number;
  active_calls: number;
};

export type FormativeConversationV5EvaluationLedger = {
  ledger_version: "formative-conversation-v5-evaluation-ledger-v1";
  evaluation_id: string;
  started_at: string;
  completed_at: string | null;
  logical_calls_used: number;
  adapter_attempts_used: number;
  reserved_input_tokens: number;
  reserved_output_tokens: number;
  actual_input_tokens: number;
  actual_output_tokens: number;
  actual_total_tokens: number;
  estimated_cost_usd: number | null;
  maximum_concurrency_observed: number;
  active_calls: number;
  attempts: ProviderTransportAttemptTrace[];
};

function utf8ByteUpperBound(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function safeFailureCode(status: string) {
  return `formative_conversation_v5_candidate_${status}`;
}

export function assertFormativeConversationV5BudgetReservation(input: {
  budget: Budget;
  current: BudgetReservation;
  requested_input_tokens: number;
  requested_output_tokens: number;
}) {
  const nextLogicalCalls = input.current.logical_calls_used + 1;
  const nextInputTokens =
    input.current.reserved_input_tokens +
    input.requested_input_tokens;
  const nextOutputTokens =
    input.current.reserved_output_tokens +
    input.requested_output_tokens;
  const nextConcurrency = input.current.active_calls + 1;

  if (nextLogicalCalls > input.budget.maximum_logical_call_count) {
    throw new Error(
      "formative_conversation_v5_logical_call_budget_exceeded"
    );
  }
  if (nextInputTokens > input.budget.maximum_input_token_count) {
    throw new Error(
      "formative_conversation_v5_input_token_budget_exceeded"
    );
  }
  if (nextOutputTokens > input.budget.maximum_output_token_count) {
    throw new Error(
      "formative_conversation_v5_output_token_budget_exceeded"
    );
  }
  if (
    nextInputTokens + nextOutputTokens >
    input.budget.maximum_total_token_count
  ) {
    throw new Error(
      "formative_conversation_v5_total_token_budget_exceeded"
    );
  }
  if (nextConcurrency > input.budget.maximum_concurrency) {
    throw new Error(
      "formative_conversation_v5_concurrency_budget_exceeded"
    );
  }
}

class EvaluationBudgetLedger {
  readonly value: FormativeConversationV5EvaluationLedger;
  private readonly startedAtMs: number;

  constructor(
    private readonly budget: Budget,
    evaluationId: string
  ) {
    const now = new Date();
    this.startedAtMs = now.getTime();
    this.value = {
      ledger_version:
        "formative-conversation-v5-evaluation-ledger-v1",
      evaluation_id: evaluationId,
      started_at: now.toISOString(),
      completed_at: null,
      logical_calls_used: 0,
      adapter_attempts_used: 0,
      reserved_input_tokens: 0,
      reserved_output_tokens: 0,
      actual_input_tokens: 0,
      actual_output_tokens: 0,
      actual_total_tokens: 0,
      estimated_cost_usd: null,
      maximum_concurrency_observed: 0,
      active_calls: 0,
      attempts: []
    };
  }

  private assertWallClock() {
    if (
      Date.now() - this.startedAtMs >
      this.budget.maximum_wall_clock_duration_ms
    ) {
      throw new Error(
        "formative_conversation_v5_wall_clock_budget_exceeded"
      );
    }
  }

  assertCanBeginLogicalCall(
    request: StructuredAgentRequest<unknown, FormativeConversationAgentOutput>
  ) {
    this.assertWallClock();
    const reservedInput = utf8ByteUpperBound({
      instructions: request.instructions,
      input: request.input
    });
    const reservedOutput = 3_500;
    assertFormativeConversationV5BudgetReservation({
      budget: this.budget,
      current: this.value,
      requested_input_tokens: reservedInput,
      requested_output_tokens: reservedOutput
    });
    return {
      reserved_input_tokens: reservedInput,
      reserved_output_tokens: reservedOutput
    };
  }

  beginLogicalCall(
    request: StructuredAgentRequest<unknown, FormativeConversationAgentOutput>
  ) {
    const reservation = this.assertCanBeginLogicalCall(request);
    this.value.logical_calls_used += 1;
    this.value.reserved_input_tokens +=
      reservation.reserved_input_tokens;
    this.value.reserved_output_tokens +=
      reservation.reserved_output_tokens;
    this.value.active_calls += 1;
    this.value.maximum_concurrency_observed = Math.max(
      this.value.maximum_concurrency_observed,
      this.value.active_calls
    );
  }

  endLogicalCall() {
    this.value.active_calls = Math.max(0, this.value.active_calls - 1);
  }

  reserveAdapterAttempt() {
    this.assertWallClock();
    if (
      this.value.adapter_attempts_used + 1 >
      this.budget.maximum_provider_attempt_count
    ) {
      return false;
    }
    this.value.adapter_attempts_used += 1;
    return true;
  }

  recordResult(result: StructuredAgentResult<unknown>) {
    const inputTokens = result.usage?.input_tokens ?? 0;
    const outputTokens = result.usage?.output_tokens ?? 0;
    const totalTokens =
      result.usage?.total_tokens ?? inputTokens + outputTokens;
    this.value.actual_input_tokens += inputTokens;
    this.value.actual_output_tokens += outputTokens;
    this.value.actual_total_tokens += totalTokens;
    if (
      this.value.actual_input_tokens >
        this.budget.maximum_input_token_count ||
      this.value.actual_output_tokens >
        this.budget.maximum_output_token_count ||
      this.value.actual_total_tokens >
        this.budget.maximum_total_token_count
    ) {
      throw new Error(
        "formative_conversation_v5_actual_token_budget_exceeded"
      );
    }
  }

  appendAttempts(attempts: ProviderTransportAttemptTrace[]) {
    this.value.attempts.push(...attempts);
  }

  snapshot(): ProviderAttemptBudgetSnapshot {
    return {
      logical_generation_calls_used: this.value.logical_calls_used,
      logical_generation_calls_limit:
        this.budget.maximum_logical_call_count,
      adapter_attempts_used: this.value.adapter_attempts_used,
      adapter_attempts_limit:
        this.budget.maximum_provider_attempt_count,
      input_tokens_used: this.value.actual_input_tokens,
      input_tokens_limit: this.budget.maximum_input_token_count,
      output_tokens_used: this.value.actual_output_tokens,
      output_tokens_limit: this.budget.maximum_output_token_count,
      total_tokens_used: this.value.actual_total_tokens,
      total_tokens_limit: this.budget.maximum_total_token_count,
      estimated_cost_usd: this.value.estimated_cost_usd,
      cost_limit_usd: this.budget.maximum_cost_usd
    };
  }

  complete() {
    this.value.completed_at = new Date().toISOString();
  }
}

class UsageTrackingProvider implements LlmProvider {
  constructor(
    private readonly provider: LlmProvider,
    private readonly ledger: EvaluationBudgetLedger
  ) {}

  async executeStructured<TInput, TOutput>(
    request: StructuredAgentRequest<TInput, TOutput>
  ) {
    const result = await this.provider.executeStructured(request);
    this.ledger.recordResult(result);
    return result;
  }
}

export function createFormativeConversationV5DispatchBoundaryGate(
  beforeFirstGenerationRequest: () => Promise<void>
) {
  let authorized = false;
  let authorization: Promise<void> | null = null;
  return {
    async authorizeImmediatelyBeforeFirstGenerationRequest() {
      if (authorized) {
        return;
      }
      authorization ??= beforeFirstGenerationRequest();
      await authorization;
      authorized = true;
    },
    state() {
      return {
        first_generation_request_authorized: authorized
      };
    }
  };
}

export function createFormativeConversationV5CandidateRunner(input: {
  loaded: FormativeConversationV5Package;
  evaluation_id: string;
  provider?: LlmProvider;
  before_first_generation_request: () => Promise<void>;
}) {
  const roleConfig =
    input.loaded.source_candidate.roles.formative_conversation_agent;
  if (!roleConfig) {
    throw new Error(
      "formative_conversation_v5_candidate_role_configuration_missing"
    );
  }
  const modelConfig: AgentModelConfig = {
    model_name: roleConfig.model_name,
    reasoning_effort: roleConfig.reasoning_effort,
    max_output_tokens: roleConfig.max_output_tokens
  };
  const budgetLedger = new EvaluationBudgetLedger(
    input.loaded.protocol.budget,
    input.evaluation_id
  );
  const provider = new UsageTrackingProvider(
    input.provider ?? createLlmProvider(),
    budgetLedger
  );
  const dispatchBoundary =
    createFormativeConversationV5DispatchBoundaryGate(
      input.before_first_generation_request
    );

  const runner: FormativeConversationAgentRunner = {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: "formative-conversation-runtime-v2",
      model_name: modelConfig.model_name,
      provider: "openai",
      prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
      schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
      reasoning_effort: modelConfig.reasoning_effort ?? null,
      max_output_tokens: modelConfig.max_output_tokens ?? null,
      live_call_allowed: true
    },
    async execute({ invocation_key, context }) {
      const request: StructuredAgentRequest<
        FormativeConversationAgentInput,
        FormativeConversationAgentOutput
      > = {
        agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
        model_config: modelConfig,
        instructions: FORMATIVE_CONVERSATION_INSTRUCTIONS,
        input: context,
        output_schema: FormativeConversationAgentOutputSchema,
        schema_name:
          FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
        client_request_id: `${input.evaluation_id}:${invocation_key}:request`,
        timeout_ms:
          input.loaded.source_candidate.runtime_policy
            ?.provider_timeout_ms ?? 90_000,
        metadata: {
          evaluation_id: input.evaluation_id,
          runtime_candidate_hash:
            input.loaded.runtime_candidate_hash,
          evaluation_protocol_hash: input.loaded.protocol_hash,
          evaluation_runner_version:
            "formative-conversation-v5-protocol-runner-v10",
          approved_execution_role:
            FORMATIVE_CONVERSATION_AGENT_NAME
        }
      };

      const semanticExecution =
        await executeFormativeConversationWithSemanticRegeneration({
          base_request: request,
          async execute_logical_generation({ sequence, kind, request }) {
            budgetLedger.assertCanBeginLogicalCall(request);
            await dispatchBoundary.authorizeImmediatelyBeforeFirstGenerationRequest();
            budgetLedger.beginLogicalCall(request);
            const logicalCallSequence =
              budgetLedger.value.logical_calls_used;
            const logicalCallId = [
              input.evaluation_id,
              "logical",
              String(logicalCallSequence).padStart(2, "0"),
              kind,
              createHash("sha256")
                .update(`${invocation_key}:${sequence}`)
                .digest("hex")
                .slice(0, 16)
            ].join(":");
            const sourceBindingHash = stableHash({
              runtime_candidate_hash:
                input.loaded.runtime_candidate_hash,
              evaluation_protocol_hash: input.loaded.protocol_hash,
              aggregate_fixture_hash:
                input.loaded.aggregate_fixture_hash,
              invocation_key,
              semantic_generation_sequence: sequence,
              semantic_generation_kind: kind,
              request
            });
            try {
              const transport =
                await executeWithBoundedProviderTransportRetry({
                  provider,
                  request,
                  logical_call_id: logicalCallId,
                  source_binding_hash: sourceBindingHash,
                  read_budget: () => budgetLedger.snapshot(),
                  reserve_adapter_attempt: () =>
                    budgetLedger.reserveAdapterAttempt(),
                  source_is_current: () => true,
                  accept_result: (result) =>
                    result.status === "completed" &&
                    FormativeConversationAgentOutputSchema.safeParse(
                      result.parsed_output
                    ).success
                });
              budgetLedger.appendAttempts(transport.attempt_traces);
              const result =
                transport.accepted_result ?? transport.last_result;
              if (!result) {
                throw new Error(safeFailureCode(transport.status));
              }
              return {
                result,
                logical_call_id: logicalCallId,
                canonical_request_hash: transport.canonical_request_hash,
                provider_attempt_count: transport.adapter_attempt_count,
                transport_retry_count: transport.transport_retry_count,
                latency_ms: transport.attempt_traces.reduce(
                  (total, attempt) => total + attempt.latency_ms,
                  0
                )
              } satisfies FormativeConversationLogicalGenerationExecution;
            } finally {
              budgetLedger.endLogicalCall();
            }
          }
        });
      const result = semanticExecution.result;
      return {
          output: result.parsed_output,
          raw_output: {
            accepted_output: result.raw_output,
            provider_execution_audit: semanticExecution.audit
          },
          provider_execution_audit: semanticExecution.audit,
          generation_source: "live_llm",
          provider_request_id:
            result.provider_request_id ??
            result.transport_telemetry?.provider_request_id ??
            null,
          provider_response_id:
            result.provider_response_id ??
            result.transport_telemetry?.provider_response_id ??
            null,
          client_request_id: result.client_request_id,
          retry_count: semanticExecution.audit.transport_retry_count,
          latency_ms: semanticExecution.latency_ms,
          input_tokens: semanticExecution.input_tokens,
          output_tokens: semanticExecution.output_tokens,
          total_tokens: semanticExecution.total_tokens,
          estimated_cost: null,
          started_at: semanticExecution.started_at,
          completed_at: semanticExecution.completed_at
        } satisfies FormativeConversationAgentExecution;
    }
  };

  return {
    runner,
    ledger: budgetLedger.value,
    dispatch_state: dispatchBoundary.state,
    complete() {
      budgetLedger.complete();
      return budgetLedger.value;
    }
  };
}
