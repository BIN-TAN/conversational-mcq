import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  AgentInputByName,
  AgentOutputByName,
} from "@/lib/agents/contracts";
import {
  ProductionStudentProfileOutput,
  ProductionStudentProfilingInput
} from "@/lib/agents/contracts";
import { buildProductionAgentRequest } from "@/lib/agents/provider-request";
import { redactForAudit } from "@/lib/agents/redaction";
import { buildInitialStudentProfilingInput } from "@/lib/agents/student-profiling/input-builder";
import { validateStudentProfileOutputSemantics } from "@/lib/agents/student-profiling/semantic-validation";
import { prisma } from "@/lib/db";
import { assertNoRawStudentIdentifiersInProviderPayload } from "@/lib/llm/provider-input-privacy";
import {
  canonicalStructuredAgentRequestHash,
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
import { createCanonicalMisconceptionClaimCatalog } from "@/lib/domain/misconception-claim-identity";
import {
  FORMATIVE_CONVERSATION_AGENT_NAME
} from "@/lib/services/student-assessment/formative-conversation/agent-contract";
import {
  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
  FormativeConversationV18R2AgentOutputSchema
} from "@/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { validateFormativeConversationV18R2CandidateAcceptance } from "@/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";
import {
  executeFormativeConversationV18R2,
  type FormativeConversationV18R2LogicalGenerationExecution
} from "@/lib/services/student-assessment/formative-conversation/execution-v18r2";
import {
  buildFormativeConversationV18R2ProductionRequest,
  FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
  FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION
} from "@/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import type {
  FormativeConversationAgentExecution,
  FormativeConversationV18R2AgentRunner
} from "@/lib/services/student-assessment/formative-conversation/runtime";
import { toPrismaJson } from "@/lib/services/json";
import type {
  FormativeConversationV18Budget,
  FormativeConversationV18ProfilingFixture
} from "./contracts";
import type { FormativeConversationV18Package } from "./package";

type CallKind = "base" | "semantic_regeneration";
type AgentRole = "student_profiling_agent" | "formative_conversation_agent";

export type FormativeConversationV18EvaluationLedger = {
  ledger_version: "formative-conversation-v18r2-evaluation-ledger-v1";
  evaluation_id: string;
  started_at: string;
  completed_at: string | null;
  planned_base_logical_calls: number;
  logical_calls_entered: number;
  base_profiling_calls_started: number;
  base_profiling_calls_completed: number;
  base_formative_calls_started: number;
  base_formative_calls_completed: number;
  pre_dispatch_request_rejections: number;
  http_requests_dispatched: number;
  provider_responses_completed: number;
  transport_retries: number;
  incomplete_or_truncated_outputs: number;
  parsed_candidates: number;
  semantic_regeneration_calls_started: number;
  semantic_regeneration_calls_completed: number;
  semantically_accepted_candidates: number;
  persisted_transitions: number;
  provider_attempts_used: number;
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

export type FormativeConversationV18ProfilingExecution = {
  case_id: string;
  status: "passed" | "failed";
  output: AgentOutputByName["student_profiling_agent"] | null;
  canonical_catalog: ReturnType<
    typeof createCanonicalMisconceptionClaimCatalog
  > | null;
  provider_execution_audit: {
    audit_version: "formative-conversation-v18r2-profiling-provider-audit-v1";
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

function prismaJson(value: unknown) {
  return (toPrismaJson(value) ?? Prisma.JsonNull) as Prisma.InputJsonValue;
}

function utf8ByteUpperBound(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function resultMilestones(result: StructuredAgentResult<unknown>) {
  const telemetry = result.transport_telemetry;
  return {
    pre_dispatch_request_rejections:
      result.status === "failed" && telemetry?.fetch_invoked !== true ? 1 : 0,
    http_requests_dispatched: telemetry?.fetch_invoked === true ? 1 : 0,
    provider_responses_completed:
      telemetry?.response_body_completed === true ||
      telemetry?.response_body_received === true
        ? 1
        : 0,
    incomplete_or_truncated_outputs: result.status === "incomplete" ? 1 : 0,
    parsed_candidates:
      result.status === "completed" && result.parsed_output !== undefined ? 1 : 0
  };
}

class EvaluationBudgetLedger {
  readonly value: FormativeConversationV18EvaluationLedger;
  private readonly startedAtMs = Date.now();

  constructor(
    private readonly budget: FormativeConversationV18Budget,
    evaluationId: string
  ) {
    this.value = {
      ledger_version: "formative-conversation-v18r2-evaluation-ledger-v1",
      evaluation_id: evaluationId,
      started_at: new Date(this.startedAtMs).toISOString(),
      completed_at: null,
      planned_base_logical_calls: budget.expected_logical_call_count,
      logical_calls_entered: 0,
      base_profiling_calls_started: 0,
      base_profiling_calls_completed: 0,
      base_formative_calls_started: 0,
      base_formative_calls_completed: 0,
      pre_dispatch_request_rejections: 0,
      http_requests_dispatched: 0,
      provider_responses_completed: 0,
      transport_retries: 0,
      incomplete_or_truncated_outputs: 0,
      parsed_candidates: 0,
      semantic_regeneration_calls_started: 0,
      semantic_regeneration_calls_completed: 0,
      semantically_accepted_candidates: 0,
      persisted_transitions: 0,
      provider_attempts_used: 0,
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
      throw new Error("formative_conversation_v18r2_wall_clock_budget_exceeded");
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
      this.value.logical_calls_entered + 1 > this.budget.maximum_logical_call_count ||
      this.value.reserved_input_tokens + requestedInput >
        this.budget.maximum_input_token_count ||
      this.value.reserved_output_tokens + requestedOutput >
        this.budget.maximum_output_token_count ||
      this.value.reserved_input_tokens + requestedInput +
          this.value.reserved_output_tokens + requestedOutput >
        this.budget.maximum_total_token_count ||
      this.value.active_calls + 1 > this.budget.maximum_concurrency
    ) {
      throw new Error("formative_conversation_v18r2_budget_reservation_exceeded");
    }
    this.value.logical_calls_entered += 1;
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

  recordSemanticAcceptance() {
    this.value.semantically_accepted_candidates += 1;
  }

  endLogicalCall() {
    this.value.active_calls = Math.max(0, this.value.active_calls - 1);
  }

  reserveProviderAttempt() {
    this.assertWallClock();
    if (
      this.value.provider_attempts_used + 1 >
      this.budget.maximum_provider_attempt_count
    ) {
      return false;
    }
    this.value.provider_attempts_used += 1;
    return true;
  }

  recordResult(result: StructuredAgentResult<unknown>) {
    const inputTokens = result.usage?.input_tokens ?? 0;
    const outputTokens = result.usage?.output_tokens ?? 0;
    const totalTokens = result.usage?.total_tokens ?? inputTokens + outputTokens;
    this.value.actual_input_tokens += inputTokens;
    this.value.actual_output_tokens += outputTokens;
    this.value.actual_total_tokens += totalTokens;
    const milestones = resultMilestones(result);
    this.value.pre_dispatch_request_rejections +=
      milestones.pre_dispatch_request_rejections;
    this.value.http_requests_dispatched += milestones.http_requests_dispatched;
    this.value.provider_responses_completed +=
      milestones.provider_responses_completed;
    this.value.incomplete_or_truncated_outputs +=
      milestones.incomplete_or_truncated_outputs;
    this.value.parsed_candidates += milestones.parsed_candidates;
    if (
      this.value.actual_input_tokens > this.budget.maximum_input_token_count ||
      this.value.actual_output_tokens > this.budget.maximum_output_token_count ||
      this.value.actual_total_tokens > this.budget.maximum_total_token_count
    ) {
      throw new Error("formative_conversation_v18r2_actual_token_budget_exceeded");
    }
  }

  appendAttempts(attempts: ProviderTransportAttemptTrace[]) {
    this.value.attempts.push(...attempts);
    this.value.transport_retries += attempts.filter(
      (attempt) => attempt.adapter_attempt_index > 1
    ).length;
  }

  recordPersistedTransition() {
    this.value.persisted_transitions += 1;
  }

  snapshot(): ProviderAttemptBudgetSnapshot {
    return {
      logical_generation_calls_used: this.value.logical_calls_entered,
      logical_generation_calls_limit: this.budget.maximum_logical_call_count,
      adapter_attempts_used: this.value.provider_attempts_used,
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

export function createFormativeConversationV18DispatchBoundaryGate(
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

function candidateHash(candidate: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(candidate))
    .digest("hex");
}

function validateProfilingCandidate(input: {
  provider_input: AgentInputByName["student_profiling_agent"];
  candidate: unknown;
  identity_scope: string;
  expected_catalog?: FormativeConversationV18ProfilingFixture["expected_catalog"];
}) {
  const parsed = ProductionStudentProfileOutput.safeParse(input.candidate);
  if (!parsed.success) {
    return {
      valid: false as const,
      issues: parsed.error.issues.map(
        (issue) => `schema:${issue.path.join(".") || "root"}`
      ),
      warnings: [] as string[],
      output: null,
      catalog: null,
      evidence_consistency: null,
      partial_resolution_projection: null
    };
  }
  const semantic = validateStudentProfileOutputSemantics({
    providerInput: input.provider_input,
    output: parsed.data
  });
  let catalog: ReturnType<typeof createCanonicalMisconceptionClaimCatalog> | null = null;
  const catalogIssues: string[] = [];
  try {
    catalog = createCanonicalMisconceptionClaimCatalog({
      identity_scope: input.identity_scope,
      indicators: parsed.data.misconception_indicators
    });
  } catch (error) {
    catalogIssues.push(
      error instanceof Error ? error.message : "catalog_construction_failed"
    );
  }
  const indicatorCount = catalog?.indicators.length ?? 0;
  const claimCount =
    catalog?.indicators.reduce(
      (total, indicator) => total + indicator.claims.length,
      0
    ) ?? 0;
  const claimIds =
    catalog?.indicators.flatMap((indicator) =>
      indicator.claims.map((claim) => claim.claim_id)
    ) ?? [];
  const expected = input.expected_catalog;
  const shapeIssues = expected
    ? [
        ...(expected.indicator_count !== null &&
        indicatorCount !== expected.indicator_count
          ? ["indicator_count_mismatch"]
          : []),
        ...(expected.claim_count !== null && claimCount !== expected.claim_count
          ? ["claim_count_mismatch"]
          : []),
        ...(claimCount < expected.minimum_claim_count
          ? ["minimum_claim_count_not_met"]
          : []),
        ...(expected.empty_catalog_required && claimCount !== 0
          ? ["empty_catalog_required"]
          : []),
        ...(new Set(claimIds).size !== claimIds.length
          ? ["claim_ids_not_unique"]
          : [])
      ]
    : [];
  const issues = [...semantic.issues, ...catalogIssues, ...shapeIssues];
  return {
    valid: issues.length === 0,
    issues,
    warnings: semantic.warnings,
    output: parsed.data,
    catalog,
    evidence_consistency: semantic.evidence_consistency,
    partial_resolution_projection:
      expected?.partial_resolution_projection_required &&
      catalog &&
      claimIds.length >= 2
        ? {
            retained_claim_ids: claimIds.slice(1),
            resolved_claim_ids: claimIds.slice(0, 1)
          }
        : null
  };
}

function profilingRegenerationRequest(input: {
  base_request: StructuredAgentRequest<
    AgentInputByName["student_profiling_agent"],
    AgentOutputByName["student_profiling_agent"]
  >;
  invalid_candidate: unknown;
  issues: string[];
}) {
  return {
    ...input.base_request,
    instructions: `${input.base_request.instructions}\n\nThe prior complete, parsed profile failed the frozen V18 semantic contract. Generate one fresh complete student-profile-output-v4 object from the same original context. Preserve all evidence and use only evidence_id values from allowed_evidence_catalog. Correct the listed issue paths. Do not assign machine claim or indicator IDs.`,
    input: {
      original_context: input.base_request.input,
      semantic_regeneration: {
        policy_version: "formative-conversation-v18r2-profiling-semantic-regeneration-v1",
        contract_version: "student-profile-output-v4",
        invalid_candidate: input.invalid_candidate,
        invalid_candidate_hash: candidateHash(input.invalid_candidate),
        rejection_category: "parsed_semantic_contract_failure",
        issue_paths: input.issues,
        canonical_eligible_evidence_catalog:
          input.base_request.input.allowed_evidence_catalog
      }
    },
    client_request_id: `${input.base_request.client_request_id}:semantic-regeneration:1`,
    metadata: {
      ...(input.base_request.metadata ?? {}),
      semantic_regeneration_policy:
        "formative-conversation-v18r2-profiling-semantic-regeneration-v1",
      semantic_regeneration_attempt: "1"
    }
  } satisfies StructuredAgentRequest<unknown, AgentOutputByName["student_profiling_agent"]>;
}

export function createFormativeConversationV18R2CandidateRunner(input: {
  loaded: FormativeConversationV18Package;
  evaluation_id: string;
  provider?: LlmProvider;
  before_first_generation_request: () => Promise<void>;
}) {
  const profilingConfig =
    input.loaded.source_candidate.roles.student_profiling_agent;
  const formativeConfig =
    input.loaded.source_candidate.roles.formative_conversation_agent;
  if (!profilingConfig || !formativeConfig) {
    throw new Error(
      "formative_conversation_v18r2_candidate_role_configuration_missing"
    );
  }
  const ledger = new EvaluationBudgetLedger(
    input.loaded.protocol.budget,
    input.evaluation_id
  );
  const provider = new UsageTrackingProvider(
    input.provider ?? createLlmProvider(),
    ledger
  );
  const dispatch = createFormativeConversationV18DispatchBoundaryGate(
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
    ledger.beginLogicalCall({
      request: call.request,
      role: call.role,
      kind: call.kind
    });
    const logicalCallId = [
      input.evaluation_id,
      call.role,
      "logical",
      String(ledger.value.logical_calls_entered).padStart(2, "0"),
      call.kind,
      createHash("sha256")
        .update(`${call.invocation_key}:${call.semantic_sequence}`)
        .digest("hex")
        .slice(0, 16)
    ].join(":");
    try {
      assertNoRawStudentIdentifiersInProviderPayload({
        input: call.request.input,
        metadata: call.request.metadata ?? null
      });
      const canonicalRequestHash =
        canonicalStructuredAgentRequestHash(call.request);
      await dispatch.authorizeImmediatelyBeforeFirstGenerationRequest();
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
          request_hash: canonicalRequestHash
        }),
        expected_canonical_request_hash: canonicalRequestHash,
        logical_idempotency_key: logicalCallId,
        read_budget: () => ledger.snapshot(),
        reserve_adapter_attempt: () => ledger.reserveProviderAttempt(),
        source_is_current: () => true,
        accept_result: call.accept_result
      });
      ledger.appendAttempts(transport.attempt_traces);
      const result = transport.accepted_result ?? transport.last_result;
      if (!result) {
        throw new Error(
          `formative_conversation_v18r2_provider_${transport.status}`
        );
      }
      const accepted = call.accept_result(result);
      ledger.completeLogicalCall(call.role, call.kind);
      return {
        result,
        accepted,
        logical_call_id: logicalCallId,
        canonical_request_hash: transport.canonical_request_hash,
        provider_attempt_count: transport.adapter_attempt_count,
        transport_retry_count: transport.transport_retry_count,
        latency_ms: transport.attempt_traces.reduce(
          (total, attempt) => total + attempt.latency_ms,
          0
        ),
        pre_dispatch_request_rejection_count:
          transport.attempt_traces.filter(
            (attempt) => attempt.transport_milestones?.fetch_invoked === false
          ).length,
        http_request_count: transport.attempt_traces.filter(
          (attempt) => attempt.transport_milestones?.fetch_invoked === true
        ).length,
        provider_response_completed_count:
          transport.attempt_traces.filter(
            (attempt) =>
              attempt.transport_milestones?.response_body_completed === true ||
              attempt.transport_milestones?.response_body_received === true
          ).length
      };
    } finally {
      ledger.endLogicalCall();
    }
  }

  async function executeProfiling(inputExecution: {
    provider_input: AgentInputByName["student_profiling_agent"];
    invocation_key: string;
    identity_scope: string;
    expected_catalog?: FormativeConversationV18ProfilingFixture["expected_catalog"];
  }) {
    const parsedInput = ProductionStudentProfilingInput.parse(
      inputExecution.provider_input
    );
    const baseRequest = buildProductionAgentRequest({
      agent_name: "student_profiling_agent",
      model_config: {
        model_name: profilingConfig.model_name,
        reasoning_effort: profilingConfig.reasoning_effort,
        max_output_tokens: profilingConfig.max_output_tokens
      },
      input: parsedInput,
      client_request_id: `${input.evaluation_id}:${inputExecution.invocation_key}:base`,
      timeout_ms: input.loaded.source_candidate.runtime_policy.provider_timeout_ms,
      metadata: {
        evaluation_id: input.evaluation_id,
        runtime_candidate_hash: input.loaded.runtime_candidate_hash,
        evaluation_protocol_hash: input.loaded.protocol_hash,
        evaluation_runner_version:
          "formative-conversation-v5-protocol-runner-v18r2",
        approved_execution_role: "student_profiling_agent"
      }
    });
    const attempts: Array<Record<string, unknown>> = [];
    let request: StructuredAgentRequest<
      unknown,
      AgentOutputByName["student_profiling_agent"]
    > = baseRequest;
    let validation: ReturnType<typeof validateProfilingCandidate> | null = null;
    for (let sequence = 1; sequence <= 2; sequence += 1) {
      const kind: CallKind =
        sequence === 1 ? "base" : "semantic_regeneration";
      const execution = await executeLogical({
        role: "student_profiling_agent",
        kind,
        invocation_key: inputExecution.invocation_key,
        semantic_sequence: sequence,
        request,
        accept_result: (result) =>
          result.status === "completed" &&
          ProductionStudentProfileOutput.safeParse(result.parsed_output).success
      });
      validation = validateProfilingCandidate({
        provider_input: parsedInput,
        candidate: execution.result.parsed_output,
        identity_scope: inputExecution.identity_scope,
        expected_catalog: inputExecution.expected_catalog
      });
      attempts.push({
        sequence,
        kind,
        logical_call_id: execution.logical_call_id,
        canonical_request_hash: execution.canonical_request_hash,
        result_status: execution.result.status,
        provider_attempt_count: execution.provider_attempt_count,
        transport_retry_count: execution.transport_retry_count,
        parsed_candidate:
          execution.result.status === "completed" &&
          execution.result.parsed_output !== undefined,
        semantically_accepted: validation.valid,
        validation_issue_paths: validation.issues,
        invalid_candidate:
          validation.valid || execution.result.parsed_output === undefined
            ? null
            : {
                candidate_hash: candidateHash(
                  execution.result.parsed_output
                ),
                candidate: execution.result.parsed_output
              },
        input_tokens: execution.result.usage?.input_tokens ?? null,
        output_tokens: execution.result.usage?.output_tokens ?? null,
        total_tokens: execution.result.usage?.total_tokens ?? null,
        latency_ms: execution.latency_ms
      });
      if (validation.valid) {
        ledger.recordSemanticAcceptance();
        break;
      }
      if (
        sequence === 2 ||
        execution.result.status !== "completed" ||
        execution.result.parsed_output === undefined
      ) {
        break;
      }
      request = profilingRegenerationRequest({
        base_request: baseRequest,
        invalid_candidate: execution.result.parsed_output,
        issues: validation.issues
      });
    }
    return { validation, attempts };
  }

  async function runProfilingCanary(
    fixture: FormativeConversationV18ProfilingFixture
  ): Promise<FormativeConversationV18ProfilingExecution> {
    const executed = await executeProfiling({
      provider_input: fixture.provider_input,
      invocation_key: `${fixture.case_id}:profiling`,
      identity_scope: fixture.catalog_identity_scope_template.replace(
        "<provider_run_id>",
        input.evaluation_id
      ),
      expected_catalog: fixture.expected_catalog
    });
    const validation = executed.validation;
    return {
      case_id: fixture.case_id,
      status: validation?.valid ? "passed" : "failed",
      output: validation?.valid ? validation.output : null,
      canonical_catalog: validation?.valid ? validation.catalog : null,
      provider_execution_audit: {
        audit_version: "formative-conversation-v18r2-profiling-provider-audit-v1",
        logical_generation_call_count: executed.attempts.length,
        provider_attempt_count: executed.attempts.reduce(
          (total, attempt) =>
            total + Number(attempt.provider_attempt_count ?? 0),
          0
        ),
        transport_retry_count: executed.attempts.reduce(
          (total, attempt) =>
            total + Number(attempt.transport_retry_count ?? 0),
          0
        ),
        semantic_regeneration_count: Math.max(0, executed.attempts.length - 1),
        attempts: executed.attempts
      },
      validation: {
        status: validation?.valid ? "passed" : "failed",
        issue_codes: validation?.issues ?? ["profiling_result_missing"],
        warnings: validation?.warnings ?? [],
        evidence_consistency: validation?.evidence_consistency ?? null,
        partial_resolution_projection:
          validation?.partial_resolution_projection ?? null
      }
    };
  }

  async function prepareLiveInitialProfile(profileInput: {
    subject_id: string;
    concept_unit_session_db_id: string;
    assessment_session_db_id: string;
    invocation_reason: string;
  }) {
    const responsePackage = await prisma.responsePackage.findFirstOrThrow({
      where: {
        concept_unit_session_db_id:
          profileInput.concept_unit_session_db_id,
        package_type: "initial_concept_unit_response_package"
      },
      orderBy: { created_at: "desc" },
      select: { id: true }
    });
    const built = await buildInitialStudentProfilingInput(
      profileInput.concept_unit_session_db_id,
      responsePackage.id
    );
    const parsedInput = ProductionStudentProfilingInput.parse(built.input);
    const invocationKey = `${built.agent_invocation_key}:v18r2:${input.evaluation_id}`;
    const existing = await prisma.agentCall.findUnique({
      where: { agent_invocation_key: invocationKey }
    });
    if (existing?.call_status === "succeeded" && existing.output_payload) {
      const output = ProductionStudentProfileOutput.parse(
        existing.output_payload
      );
      return {
        output,
        based_on_agent_call_db_id: existing.id,
        idempotent_replay: true as const
      };
    }
    if (existing) {
      throw new Error(
        "formative_conversation_v18r2_profiling_invocation_not_replayable"
      );
    }
    const prompt = input.loaded.runtime_manifest.student_profiling_role as {
      agent_version?: string;
      prompt_version: string;
      prompt_hash: string;
      schema_version: string;
    };
    const startedAt = new Date();
    const agentCall = await prisma.agentCall.create({
      data: {
        id: randomUUID(),
        assessment_session_db_id:
          profileInput.assessment_session_db_id,
        concept_unit_session_db_id:
          profileInput.concept_unit_session_db_id,
        agent_name: "student_profiling_agent",
        agent_version: prompt.agent_version ?? "6b-draft",
        model_name: profilingConfig.model_name,
        provider: "openai",
        agent_invocation_key: invocationKey,
        prompt_hash: prompt.prompt_hash,
        reasoning_effort: profilingConfig.reasoning_effort,
        max_output_tokens: profilingConfig.max_output_tokens,
        prompt_version: prompt.prompt_version,
        schema_version: prompt.schema_version,
        input_payload: prismaJson(redactForAudit(parsedInput)),
        live_call_allowed: true,
        call_status: "started",
        started_at: startedAt
      }
    });
    try {
      const executed = await executeProfiling({
        provider_input: parsedInput,
        invocation_key: invocationKey,
        identity_scope: [
          profileInput.concept_unit_session_db_id,
          agentCall.id,
          "initial"
        ].join(":")
      });
      const validation = executed.validation;
      const finalAttempt = executed.attempts.at(-1);
      if (!validation?.valid || !validation.output) {
        await prisma.agentCall.update({
          where: { id: agentCall.id },
          data: {
            call_status: "invalid_output",
            output_validated: false,
            validation_error:
              validation?.issues.join("; ") ?? "profiling_result_missing",
            error_category: "semantic_validation",
            retry_count: Math.max(0, executed.attempts.length - 1),
            completed_at: new Date()
          }
        });
        throw new Error(
          `formative_conversation_v18r2_profiling_semantic_rejected:${
            validation?.issues.join(",") ?? "profiling_result_missing"
          }`
        );
      }
      await prisma.agentCall.update({
        where: { id: agentCall.id },
        data: {
          call_status: "succeeded",
          output_validated: true,
          output_payload: prismaJson(validation.output),
          raw_output: prismaJson({
            accepted_candidate_hash: candidateHash(validation.output),
            provider_execution_audit: executed.attempts
          }),
          retry_count: Math.max(0, executed.attempts.length - 1),
          latency_ms: Number(finalAttempt?.latency_ms ?? 0),
          input_tokens:
            finalAttempt?.input_tokens === null ||
            finalAttempt?.input_tokens === undefined
              ? null
              : Number(finalAttempt.input_tokens),
          output_tokens:
            finalAttempt?.output_tokens === null ||
            finalAttempt?.output_tokens === undefined
              ? null
              : Number(finalAttempt.output_tokens),
          total_tokens:
            finalAttempt?.total_tokens === null ||
            finalAttempt?.total_tokens === undefined
              ? null
              : Number(finalAttempt.total_tokens),
          completed_at: new Date()
        }
      });
      return {
        output: validation.output,
        based_on_agent_call_db_id: agentCall.id,
        idempotent_replay: false as const
      };
    } catch (error) {
      await prisma.agentCall.updateMany({
        where: { id: agentCall.id, call_status: "started" },
        data: {
          call_status: "failed",
          output_validated: false,
          validation_error:
            error instanceof Error ? error.message : "profiling_evaluation_failed",
          error_category: "evaluation_execution",
          completed_at: new Date()
        }
      });
      throw error;
    }
  }

  const formativeRunner: FormativeConversationV18R2AgentRunner = {
    identity: {
      agent_name: FORMATIVE_CONVERSATION_AGENT_NAME,
      agent_version: "formative-conversation-runtime-v3",
      model_name: formativeConfig.model_name,
      provider: "openai",
      prompt_version: FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION,
      schema_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
      prompt_hash: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
      reasoning_effort: formativeConfig.reasoning_effort,
      max_output_tokens: formativeConfig.max_output_tokens,
      live_call_allowed: true
    },
    async execute({ invocation_key, context }) {
      const baseRequest = buildFormativeConversationV18R2ProductionRequest({
        context,
        model_config: {
          model_name: formativeConfig.model_name,
          reasoning_effort: formativeConfig.reasoning_effort,
          max_output_tokens: formativeConfig.max_output_tokens
        },
        client_request_id: `${input.evaluation_id}:${invocation_key}:base`,
        timeout_ms: input.loaded.source_candidate.runtime_policy.provider_timeout_ms,
        invocation_key
      });
      const semanticExecution = await executeFormativeConversationV18R2({
        base_request: baseRequest,
        validate_candidate(output) {
          const validation =
            validateFormativeConversationV18R2CandidateAcceptance({
              candidate: output,
              context
            });
          return {
            valid: validation.valid,
            validation_status: validation.validation_status,
            validation_issue_paths: validation.validation_issue_paths
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
              FormativeConversationV18R2AgentOutputSchema.safeParse(
                result.parsed_output
              ).success
          });
          return execution satisfies FormativeConversationV18R2LogicalGenerationExecution;
        }
      });
      ledger.recordSemanticAcceptance();
      const result = semanticExecution.result;
      const output = FormativeConversationV18R2AgentOutputSchema.parse(
        result.parsed_output
      );
      return {
        output,
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
        retry_count: semanticExecution.audit.transport_retries,
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
    prepare_live_initial_profile: prepareLiveInitialProfile,
    run_profiling_canary: runProfilingCanary,
    ledger: ledger.value,
    dispatch_state: dispatch.state,
    record_persisted_transition: () => ledger.recordPersistedTransition(),
    complete() {
      ledger.complete();
      return ledger.value;
    }
  };
}
