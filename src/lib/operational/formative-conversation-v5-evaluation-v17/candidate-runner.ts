import { createHash } from "node:crypto";
import type { AgentOutputByName } from "@/lib/agents/contracts";
import { StudentProfileOutput } from "@/lib/agents/contracts";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { validateStudentProfileOutputSemantics } from "@/lib/agents/student-profiling/semantic-validation";
import {
  createCanonicalMisconceptionClaimCatalog
} from "@/lib/domain/misconception-claim-identity";
import type { AgentModelConfig } from "@/lib/llm/config";
import {
  classifyProviderFailure,
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
import { validateFormativeConversationCandidateAcceptance } from "@/lib/services/student-assessment/formative-conversation/candidate-validation";
import { projectCanonicalMisconceptionClaimCatalog } from "@/lib/services/student-assessment/formative-conversation/misconception-claim-closure-v2";
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
import type {
  FormativeConversationV17Budget,
  FormativeConversationV17ProfilingFixture
} from "./contracts";
import type { FormativeConversationV17Package } from "./package";

type CallKind = "primary" | "semantic_regeneration";
type AgentRole = "student_profiling_agent" | "formative_conversation_agent";

export type FormativeConversationV17EvaluationLedger = {
  ledger_version: "formative-conversation-v17-evaluation-ledger-v1";
  evaluation_id: string;
  started_at: string;
  completed_at: string | null;
  logical_calls_used: number;
  base_profiling_calls_started: number;
  base_profiling_calls_completed: number;
  base_formative_calls_started: number;
  base_formative_calls_completed: number;
  semantic_regeneration_calls_started: number;
  semantic_regeneration_calls_completed: number;
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

export type FormativeConversationV17ProfilingExecution = {
  case_id: string;
  status: "passed" | "failed";
  output: AgentOutputByName["student_profiling_agent"] | null;
  canonical_catalog: ReturnType<
    typeof createCanonicalMisconceptionClaimCatalog
  > | null;
  provider_execution_audit: {
    audit_version: "formative-conversation-v17-profiling-provider-audit-v1";
    logical_generation_call_count: number;
    provider_attempt_count: number;
    transport_retry_count: number;
    semantic_regeneration_count: number;
    attempts: Array<Record<string, unknown>>;
  };
  validation: {
    status: "passed" | "failed";
    issue_codes: string[];
    warnings: string[];
    evidence_consistency: unknown;
    partial_resolution_projection: unknown;
  };
};

function utf8ByteUpperBound(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

class EvaluationBudgetLedger {
  readonly value: FormativeConversationV17EvaluationLedger;
  private readonly startedAtMs: number;

  constructor(
    private readonly budget: FormativeConversationV17Budget,
    evaluationId: string
  ) {
    const now = new Date();
    this.startedAtMs = now.getTime();
    this.value = {
      ledger_version: "formative-conversation-v17-evaluation-ledger-v1",
      evaluation_id: evaluationId,
      started_at: now.toISOString(),
      completed_at: null,
      logical_calls_used: 0,
      base_profiling_calls_started: 0,
      base_profiling_calls_completed: 0,
      base_formative_calls_started: 0,
      base_formative_calls_completed: 0,
      semantic_regeneration_calls_started: 0,
      semantic_regeneration_calls_completed: 0,
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
    if (Date.now() - this.startedAtMs > this.budget.maximum_wall_clock_duration_ms) {
      throw new Error("formative_conversation_v17_wall_clock_budget_exceeded");
    }
  }

  beginLogicalCall(input: {
    request: StructuredAgentRequest<unknown, unknown>;
    role: AgentRole;
    kind: CallKind;
  }) {
    this.assertWallClock();
    const requestedInput = utf8ByteUpperBound({
      instructions: input.request.instructions,
      input: input.request.input
    });
    const requestedOutput = input.request.model_config.max_output_tokens ?? 0;
    if (
      this.value.logical_calls_used + 1 > this.budget.maximum_logical_call_count ||
      this.value.reserved_input_tokens + requestedInput >
        this.budget.maximum_input_token_count ||
      this.value.reserved_output_tokens + requestedOutput >
        this.budget.maximum_output_token_count ||
      this.value.reserved_input_tokens + requestedInput +
          this.value.reserved_output_tokens + requestedOutput >
        this.budget.maximum_total_token_count ||
      this.value.active_calls + 1 > this.budget.maximum_concurrency
    ) {
      throw new Error("formative_conversation_v17_budget_reservation_exceeded");
    }
    this.value.logical_calls_used += 1;
    if (input.kind === "semantic_regeneration") {
      this.value.semantic_regeneration_calls_started += 1;
    } else if (input.role === "student_profiling_agent") {
      this.value.base_profiling_calls_started += 1;
    } else {
      this.value.base_formative_calls_started += 1;
    }
    this.value.reserved_input_tokens += requestedInput;
    this.value.reserved_output_tokens += requestedOutput;
    this.value.active_calls += 1;
    this.value.maximum_concurrency_observed = Math.max(
      this.value.maximum_concurrency_observed,
      this.value.active_calls
    );
  }

  completeLogicalCall(role: AgentRole, kind: CallKind) {
    if (kind === "semantic_regeneration") {
      this.value.semantic_regeneration_calls_completed += 1;
    } else if (role === "student_profiling_agent") {
      this.value.base_profiling_calls_completed += 1;
    } else {
      this.value.base_formative_calls_completed += 1;
    }
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
    const totalTokens = result.usage?.total_tokens ?? inputTokens + outputTokens;
    this.value.actual_input_tokens += inputTokens;
    this.value.actual_output_tokens += outputTokens;
    this.value.actual_total_tokens += totalTokens;
    if (
      this.value.actual_input_tokens > this.budget.maximum_input_token_count ||
      this.value.actual_output_tokens > this.budget.maximum_output_token_count ||
      this.value.actual_total_tokens > this.budget.maximum_total_token_count
    ) {
      throw new Error("formative_conversation_v17_actual_token_budget_exceeded");
    }
  }

  appendAttempts(attempts: ProviderTransportAttemptTrace[]) {
    this.value.attempts.push(...attempts);
  }

  snapshot(): ProviderAttemptBudgetSnapshot {
    return {
      logical_generation_calls_used: this.value.logical_calls_used,
      logical_generation_calls_limit: this.budget.maximum_logical_call_count,
      adapter_attempts_used: this.value.adapter_attempts_used,
      adapter_attempts_limit: this.budget.maximum_provider_attempt_count,
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

export function createFormativeConversationV17DispatchBoundaryGate(
  beforeFirstGenerationRequest: () => Promise<void>
) {
  let authorized = false;
  let authorization: Promise<void> | null = null;
  return {
    async authorizeImmediatelyBeforeFirstGenerationRequest() {
      if (authorized) return;
      authorization ??= beforeFirstGenerationRequest();
      await authorization;
      authorized = true;
    },
    state() {
      return { first_generation_request_authorized: authorized };
    }
  };
}

function safeCandidateEvidence(result: StructuredAgentResult<unknown>) {
  const candidate = result.parsed_output ?? result.raw_output ?? null;
  return {
    candidate_hash:
      candidate === null ? null : createHash("sha256").update(JSON.stringify(candidate)).digest("hex"),
    candidate,
    result_status: result.status
  };
}

export function validateFormativeConversationV17ProfilingCandidate(input: {
  fixture: FormativeConversationV17ProfilingFixture;
  candidate: unknown;
  identity_scope?: string;
}) {
  const parsed = StudentProfileOutput.safeParse(input.candidate);
  if (!parsed.success) {
    return {
      valid: false as const,
      issues: parsed.error.issues.map((issue) =>
        `schema:${issue.path.join(".") || "root"}`
      ),
      warnings: [] as string[],
      evidence_consistency: null,
      output: null,
      catalog: null,
      partial_resolution_projection: null
    };
  }
  const output = parsed.data;
  const identityIssues = [
    ...(output.prompt_version === "student-profiling-v4"
      ? []
      : ["prompt_version_mismatch"]),
    ...(output.schema_version === "student-profile-output-v3"
      ? []
      : ["schema_version_mismatch"])
  ];
  const semantic = validateStudentProfileOutputSemantics({
    providerInput: input.fixture.provider_input,
    output
  });
  let catalog: ReturnType<typeof createCanonicalMisconceptionClaimCatalog> | null = null;
  let catalogIssues: string[] = [];
  try {
    catalog = createCanonicalMisconceptionClaimCatalog({
      identity_scope:
        input.identity_scope ?? input.fixture.catalog_identity_scope_template,
      indicators: output.misconception_indicators.map((indicator) => ({
        ...indicator,
        atomic_claims: indicator.atomic_claims ?? []
      }))
    });
  } catch (error) {
    catalogIssues = [
      error instanceof Error ? error.message : "catalog_construction_failed"
    ];
  }
  const indicatorCount = catalog?.indicators.length ?? 0;
  const claimCount =
    catalog?.indicators.reduce((total, indicator) => total + indicator.claims.length, 0) ?? 0;
  const ids = catalog?.indicators.flatMap((indicator) =>
    indicator.claims.map((claim) => claim.claim_id)
  ) ?? [];
  const expected = input.fixture.expected_catalog;
  const shapeIssues = [
    ...(expected.indicator_count !== null && indicatorCount !== expected.indicator_count
      ? ["indicator_count_mismatch"]
      : []),
    ...(expected.claim_count !== null && claimCount !== expected.claim_count
      ? ["claim_count_mismatch"]
      : []),
    ...(claimCount < expected.minimum_claim_count
      ? ["minimum_claim_count_not_met"]
      : []),
    ...(expected.empty_catalog_required && (indicatorCount !== 0 || claimCount !== 0)
      ? ["empty_catalog_required"]
      : []),
    ...(expected.distinct_claim_ids_required && new Set(ids).size !== ids.length
      ? ["claim_ids_not_unique"]
      : [])
  ];
  const partialResolutionProjection =
    catalog && expected.partial_resolution_projection_required && ids.length >= 2
      ? projectCanonicalMisconceptionClaimCatalog({
          prior_catalog: catalog,
          retained_claim_ids: new Set(ids.slice(1))
        })
      : null;
  const issues = [...identityIssues, ...semantic.issues, ...catalogIssues, ...shapeIssues];
  return {
    valid: issues.length === 0,
    issues,
    warnings: semantic.warnings,
    evidence_consistency: semantic.evidence_consistency,
    output,
    catalog,
    partial_resolution_projection: partialResolutionProjection
  };
}

export function createFormativeConversationV17CandidateRunner(input: {
  loaded: FormativeConversationV17Package;
  evaluation_id: string;
  provider?: LlmProvider;
  before_first_generation_request: () => Promise<void>;
}) {
  const profilingConfig = input.loaded.source_candidate.roles.student_profiling_agent;
  const formativeConfig = input.loaded.source_candidate.roles.formative_conversation_agent;
  if (!profilingConfig || !formativeConfig) {
    throw new Error("formative_conversation_v17_candidate_role_configuration_missing");
  }
  const ledger = new EvaluationBudgetLedger(input.loaded.protocol.budget, input.evaluation_id);
  const provider = new UsageTrackingProvider(
    input.provider ?? createLlmProvider(),
    ledger
  );
  const dispatch = createFormativeConversationV17DispatchBoundaryGate(
    input.before_first_generation_request
  );

  async function executeLogical<TOutput>(call: {
    role: AgentRole;
    kind: CallKind;
    invocation_key: string;
    semantic_sequence: number;
    request: StructuredAgentRequest<unknown, TOutput>;
    accept_result: (result: StructuredAgentResult<TOutput>) => boolean;
  }) {
    ledger.beginLogicalCall({ request: call.request, role: call.role, kind: call.kind });
    await dispatch.authorizeImmediatelyBeforeFirstGenerationRequest();
    const logicalCallSequence = ledger.value.logical_calls_used;
    const logicalCallId = [
      input.evaluation_id,
      call.role,
      "logical",
      String(logicalCallSequence).padStart(2, "0"),
      call.kind,
      createHash("sha256")
        .update(`${call.invocation_key}:${call.semantic_sequence}`)
        .digest("hex")
        .slice(0, 16)
    ].join(":");
    try {
      const transport = await executeWithBoundedProviderTransportRetry({
        provider,
        request: call.request,
        logical_call_id: logicalCallId,
        source_binding_hash: stableHash({
          runtime_candidate_hash: input.loaded.runtime_candidate_hash,
          evaluation_protocol_hash: input.loaded.protocol_hash,
          aggregate_fixture_hash: input.loaded.aggregate_fixture_hash,
          role: call.role,
          invocation_key: call.invocation_key,
          semantic_sequence: call.semantic_sequence,
          request: call.request
        }),
        read_budget: () => ledger.snapshot(),
        reserve_adapter_attempt: () => ledger.reserveAdapterAttempt(),
        source_is_current: () => true,
        accept_result: call.accept_result
      });
      ledger.appendAttempts(transport.attempt_traces);
      const result = transport.accepted_result ?? transport.last_result;
      if (!result) {
        throw new Error(`formative_conversation_v17_provider_${transport.status}`);
      }
      ledger.completeLogicalCall(call.role, call.kind);
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
      };
    } finally {
      ledger.endLogicalCall();
    }
  }

  async function runProfilingCanary(
    fixture: FormativeConversationV17ProfilingFixture
  ): Promise<FormativeConversationV17ProfilingExecution> {
    const prompt = getPromptForAgent("student_profiling_agent");
    const modelConfig: AgentModelConfig = {
      model_name: profilingConfig.model_name,
      reasoning_effort: profilingConfig.reasoning_effort,
      max_output_tokens: profilingConfig.max_output_tokens
    };
    const invocationKey = `${input.evaluation_id}:${fixture.case_id}:profiling`;
    const baseRequest: StructuredAgentRequest<unknown, AgentOutputByName["student_profiling_agent"]> = {
      agent_name: "student_profiling_agent",
      model_config: modelConfig,
      instructions: prompt.instructions,
      input: fixture.provider_input,
      output_schema: StudentProfileOutput,
      schema_name: prompt.schema_version,
      client_request_id: `${invocationKey}:primary`,
      timeout_ms: input.loaded.source_candidate.runtime_policy.provider_timeout_ms,
      metadata: {
        evaluation_id: input.evaluation_id,
        runtime_candidate_hash: input.loaded.runtime_candidate_hash,
        evaluation_protocol_hash: input.loaded.protocol_hash,
        evaluation_runner_version: "formative-conversation-v5-protocol-runner-v17",
        approved_execution_role: "student_profiling_agent"
      }
    };
    const attempts: Array<Record<string, unknown>> = [];
    let request = baseRequest;
    let finalValidation: ReturnType<
      typeof validateFormativeConversationV17ProfilingCandidate
    > | null = null;
    for (let sequence = 1; sequence <= 2; sequence += 1) {
      const kind: CallKind = sequence === 1 ? "primary" : "semantic_regeneration";
      const execution = await executeLogical({
        role: "student_profiling_agent",
        kind,
        invocation_key: invocationKey,
        semantic_sequence: sequence,
        request,
        accept_result: (result) =>
          result.status === "completed" &&
          StudentProfileOutput.safeParse(result.parsed_output).success
      });
      const validation = validateFormativeConversationV17ProfilingCandidate({
        fixture,
        candidate: execution.result.parsed_output,
        identity_scope: fixture.catalog_identity_scope_template.replace(
          "<provider_run_id>",
          input.evaluation_id
        )
      });
      finalValidation = validation;
      attempts.push({
        sequence,
        kind,
        logical_call_id: execution.logical_call_id,
        canonical_request_hash: execution.canonical_request_hash,
        result_status: execution.result.status,
        accepted: validation.valid,
        validation_issue_paths: validation.issues,
        provider_attempt_count: execution.provider_attempt_count,
        transport_retry_count: execution.transport_retry_count,
        latency_ms: execution.latency_ms,
        input_tokens: execution.result.usage?.input_tokens ?? null,
        output_tokens: execution.result.usage?.output_tokens ?? null,
        total_tokens: execution.result.usage?.total_tokens ?? null,
        safe_invalid_output_evidence: validation.valid
          ? null
          : safeCandidateEvidence(execution.result)
      });
      if (validation.valid) break;
      const classification = classifyProviderFailure(execution.result);
      if (
        sequence === 2 ||
        !(
          execution.result.status === "completed" ||
          classification.semantic_regeneration_eligible
        )
      ) {
        break;
      }
      const invalidEvidence = safeCandidateEvidence(execution.result);
      request = {
        ...baseRequest,
        instructions: `${baseRequest.instructions}\n\nThe preceding output failed the frozen student-profiling-v4 acceptance boundary. Produce one fresh complete profile. Preserve evidence-grounded interpretation, but correct every listed schema, semantic, atomic-claim, and catalog-shape issue. Do not invent evidence or assign machine IDs.`,
        input: {
          original_profile_input: fixture.provider_input,
          semantic_regeneration: {
            policy_version: "formative-conversation-v17-profiling-semantic-regeneration-v1",
            invalid_candidate: invalidEvidence.candidate,
            invalid_candidate_hash: invalidEvidence.candidate_hash,
            rejection_category: "profiling_contract_invalid",
            issue_paths: validation.issues,
            canonical_evidence_set: fixture.provider_input.initial_response_package
          }
        },
        client_request_id: `${invocationKey}:semantic-regeneration:1`,
        metadata: {
          ...(baseRequest.metadata ?? {}),
          semantic_regeneration_policy:
            "formative-conversation-v17-profiling-semantic-regeneration-v1",
          semantic_regeneration_attempt: "1"
        }
      };
    }
    const providerAttemptCount = attempts.reduce(
      (total, attempt) => total + Number(attempt.provider_attempt_count ?? 0),
      0
    );
    const transportRetryCount = attempts.reduce(
      (total, attempt) => total + Number(attempt.transport_retry_count ?? 0),
      0
    );
    return {
      case_id: fixture.case_id,
      status: finalValidation?.valid ? "passed" : "failed",
      output: finalValidation?.valid ? finalValidation.output : null,
      canonical_catalog: finalValidation?.valid ? finalValidation.catalog : null,
      provider_execution_audit: {
        audit_version: "formative-conversation-v17-profiling-provider-audit-v1",
        logical_generation_call_count: attempts.length,
        provider_attempt_count: providerAttemptCount,
        transport_retry_count: transportRetryCount,
        semantic_regeneration_count: attempts.length - 1,
        attempts
      },
      validation: {
        status: finalValidation?.valid ? "passed" : "failed",
        issue_codes: finalValidation?.issues ?? ["profiling_result_missing"],
        warnings: finalValidation?.warnings ?? [],
        evidence_consistency: finalValidation?.evidence_consistency ?? null,
        partial_resolution_projection:
          finalValidation?.partial_resolution_projection ?? null
      }
    };
  }

  const formativeModelConfig: AgentModelConfig = {
    model_name: formativeConfig.model_name,
    reasoning_effort: formativeConfig.reasoning_effort,
    max_output_tokens: formativeConfig.max_output_tokens
  };
  const formativeRunner: FormativeConversationAgentRunner = {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: "formative-conversation-runtime-v2",
      model_name: formativeModelConfig.model_name,
      provider: "openai",
      prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
      schema_version: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
      prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
      reasoning_effort: formativeModelConfig.reasoning_effort ?? null,
      max_output_tokens: formativeModelConfig.max_output_tokens ?? null,
      live_call_allowed: true
    },
    async execute({ invocation_key, context }) {
      const request: StructuredAgentRequest<
        FormativeConversationAgentInput,
        FormativeConversationAgentOutput
      > = {
        agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
        model_config: formativeModelConfig,
        instructions: FORMATIVE_CONVERSATION_INSTRUCTIONS,
        input: context,
        output_schema: FormativeConversationAgentOutputSchema,
        schema_name: FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
        client_request_id: `${input.evaluation_id}:${invocation_key}:request`,
        timeout_ms: input.loaded.source_candidate.runtime_policy.provider_timeout_ms,
        metadata: {
          evaluation_id: input.evaluation_id,
          runtime_candidate_hash: input.loaded.runtime_candidate_hash,
          evaluation_protocol_hash: input.loaded.protocol_hash,
          evaluation_runner_version: "formative-conversation-v5-protocol-runner-v17",
          approved_execution_role: FORMATIVE_CONVERSATION_AGENT_NAME
        }
      };
      const semanticExecution =
        await executeFormativeConversationWithSemanticRegeneration({
          base_request: request,
          validate_candidate(output) {
            const validation = validateFormativeConversationCandidateAcceptance({
              candidate: output,
              context
            });
            return {
              valid: validation.valid,
              validation_status: validation.validation_status,
              validation_issue_paths: validation.validation_issue_paths,
              failure_category: validation.valid
                ? undefined
                : "response_local_contract_invalid"
            };
          },
          async execute_logical_generation({ sequence, kind, request }) {
            const execution = await executeLogical({
              role: "formative_conversation_agent",
              kind,
              invocation_key,
              semantic_sequence: sequence,
              request,
              accept_result: (result) =>
                result.status === "completed" &&
                FormativeConversationAgentOutputSchema.safeParse(
                  result.parsed_output
                ).success
            });
            return execution satisfies FormativeConversationLogicalGenerationExecution;
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
    formative_runner: formativeRunner,
    run_profiling_canary: runProfilingCanary,
    ledger: ledger.value,
    dispatch_state: dispatch.state,
    complete() {
      ledger.complete();
      return ledger.value;
    }
  };
}
