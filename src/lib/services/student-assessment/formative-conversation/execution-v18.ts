import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalMisconceptionClaimIds,
  canonicalMisconceptionIndicatorIds
} from "@/lib/domain/misconception-claim-identity";
import { canonicalStructuredAgentRequestHash } from "@/lib/llm/provider-transport-retry";
import type {
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import {
  FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
  FormativeConversationV18AgentOutputSchema,
  type FormativeConversationV18AgentInput,
  type FormativeConversationV18AgentOutput
} from "./agent-contract-v18";

export const FORMATIVE_CONVERSATION_V18_EXECUTION_POLICY_VERSION =
  "formative-conversation-v18-execution-policy-v1" as const;
export const FORMATIVE_CONVERSATION_V18_SEMANTIC_REGENERATION_VERSION =
  "formative-conversation-v18-semantic-regeneration-v1" as const;
export const FORMATIVE_CONVERSATION_V18_ACCOUNTING_VERSION =
  "formative-conversation-v18-evaluation-accounting-v1" as const;
export const FORMATIVE_CONVERSATION_V18_MAXIMUM_SEMANTIC_REGENERATIONS = 1;
export const FORMATIVE_CONVERSATION_V18_INCOMPLETE_OUTPUT_RECOVERY_CALLS = 0;

export type FormativeConversationV18FailureClass =
  | "transport_failure"
  | "provider_incomplete_structured_output"
  | "syntactic_structured_output_failure"
  | "parsed_semantic_contract_failure";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const FormativeConversationV18SafeInvalidCandidateSchema = z
  .object({
    candidate_hash: HashSchema.nullable(),
    candidate_json: z.unknown().nullable(),
    candidate_text: z.string().max(120_000).nullable(),
    validation_status: z.string().min(1).nullable(),
    validation_issue_paths: z.array(z.string()).max(200)
  })
  .strict();

export const FormativeConversationV18LogicalCallAuditSchema = z
  .object({
    sequence: z.number().int().positive(),
    kind: z.enum(["base", "semantic_regeneration"]),
    logical_call_id: z.string().min(1),
    canonical_request_hash: HashSchema,
    result_status: z.enum(["completed", "refused", "incomplete", "failed"]),
    failure_class: z
      .enum([
        "transport_failure",
        "provider_incomplete_structured_output",
        "syntactic_structured_output_failure",
        "parsed_semantic_contract_failure"
      ])
      .nullable(),
    accepted: z.boolean(),
    logical_call_entered: z.literal(true),
    pre_dispatch_request_rejection_count: z.number().int().nonnegative(),
    http_request_count: z.number().int().nonnegative(),
    provider_response_completed_count: z.number().int().nonnegative(),
    provider_attempt_count: z.number().int().nonnegative(),
    transport_retry_count: z.number().int().nonnegative(),
    parsed_candidate_count: z.number().int().min(0).max(1),
    semantically_accepted_candidate_count: z.number().int().min(0).max(1),
    provider_request_id: z.string().min(1).nullable(),
    provider_response_id: z.string().min(1).nullable(),
    client_request_id: z.string().min(1),
    incomplete_reason: z.string().min(1).nullable(),
    latency_ms: z.number().int().nonnegative(),
    input_tokens: z.number().int().nonnegative().nullable(),
    output_tokens: z.number().int().nonnegative().nullable(),
    total_tokens: z.number().int().nonnegative().nullable(),
    invalid_candidate: FormativeConversationV18SafeInvalidCandidateSchema.nullable()
  })
  .strict();

export const FormativeConversationV18ExecutionAuditSchema = z
  .object({
    policy_version: z.literal(
      FORMATIVE_CONVERSATION_V18_EXECUTION_POLICY_VERSION
    ),
    accounting_version: z.literal(
      FORMATIVE_CONVERSATION_V18_ACCOUNTING_VERSION
    ),
    planned_base_logical_calls: z.literal(1),
    logical_calls_entered: z.number().int().nonnegative(),
    pre_dispatch_request_rejections: z.number().int().nonnegative(),
    http_requests_dispatched: z.number().int().nonnegative(),
    provider_responses_completed: z.number().int().nonnegative(),
    provider_attempts: z.number().int().nonnegative(),
    transport_retries: z.number().int().nonnegative(),
    incomplete_output_recovery_calls: z.literal(0),
    semantic_regeneration_calls: z.number().int().min(0).max(1),
    parsed_candidates: z.number().int().nonnegative(),
    semantically_accepted_candidates: z.number().int().nonnegative(),
    attempts: z
      .array(FormativeConversationV18LogicalCallAuditSchema)
      .min(1)
      .max(2)
  })
  .strict();

export type FormativeConversationV18ExecutionAudit = z.infer<
  typeof FormativeConversationV18ExecutionAuditSchema
>;

export type FormativeConversationV18CandidateValidation = {
  valid: boolean;
  validation_status: string;
  validation_issue_paths: string[];
};

export type FormativeConversationV18LogicalGenerationExecution = {
  result: StructuredAgentResult<FormativeConversationV18AgentOutput>;
  logical_call_id: string;
  canonical_request_hash: string;
  provider_attempt_count: number;
  transport_retry_count: number;
  latency_ms: number;
  pre_dispatch_request_rejection_count?: number;
  http_request_count?: number;
  provider_response_completed_count?: number;
};

export type FormativeConversationV18ExecutionSuccess = {
  result: StructuredAgentResult<FormativeConversationV18AgentOutput> & {
    parsed_output: FormativeConversationV18AgentOutput;
  };
  audit: FormativeConversationV18ExecutionAudit;
  started_at: Date;
  completed_at: Date;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
};

export class FormativeConversationV18ExecutionError extends Error {
  constructor(
    public readonly failure_class: FormativeConversationV18FailureClass,
    public readonly failure_category:
      | "provider_execution_failed"
      | "provider_incomplete_structured_output"
      | "structured_output_invalid"
      | "semantic_regeneration_exhausted",
    public readonly audit: FormativeConversationV18ExecutionAudit,
    public readonly started_at: Date,
    public readonly completed_at: Date,
    public readonly latency_ms: number,
    public readonly input_tokens: number | null,
    public readonly output_tokens: number | null,
    public readonly total_tokens: number | null,
    public readonly last_result: StructuredAgentResult<FormativeConversationV18AgentOutput>
  ) {
    super(`formative_conversation_v18_${failure_category}`);
    this.name = "FormativeConversationV18ExecutionError";
  }
}

function responseOutputText(rawOutput: unknown) {
  if (!rawOutput || typeof rawOutput !== "object" || Array.isArray(rawOutput)) {
    return null;
  }
  const output = (rawOutput as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return null;
  }
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }
      const content = (item as { content?: unknown }).content;
      return Array.isArray(content)
        ? content.flatMap((entry) =>
            entry &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            (entry as { type?: unknown }).type === "output_text" &&
            typeof (entry as { text?: unknown }).text === "string"
              ? [(entry as { text: string }).text]
              : []
          )
        : [];
    })
    .join("") || null;
}

function safeInvalidCandidate(input: {
  result: StructuredAgentResult<FormativeConversationV18AgentOutput>;
  validation: FormativeConversationV18CandidateValidation | null;
}) {
  const candidateText =
    responseOutputText(input.result.raw_output) ??
    (input.result.parsed_output === undefined
      ? null
      : JSON.stringify(input.result.parsed_output));
  const candidateHash = candidateText
    ? createHash("sha256").update(candidateText).digest("hex")
    : null;
  const issuePaths = [
    ...new Set([
      ...(input.result.transport_telemetry
        ?.structured_output_validation_issue_paths ?? []),
      ...(input.validation?.validation_issue_paths ?? [])
    ])
  ].sort();
  if (!candidateText) {
    return {
      candidate_hash: null,
      candidate_json: null,
      candidate_text: null,
      validation_status:
        input.validation?.validation_status ??
        input.result.transport_telemetry
          ?.structured_output_validation_status ??
        null,
      validation_issue_paths: issuePaths
    };
  }
  try {
    return {
      candidate_hash: candidateHash,
      candidate_json: JSON.parse(candidateText) as unknown,
      candidate_text: null,
      validation_status:
        input.validation?.validation_status ??
        input.result.transport_telemetry
          ?.structured_output_validation_status ??
        null,
      validation_issue_paths: issuePaths
    };
  } catch {
    return {
      candidate_hash: candidateHash,
      candidate_json: null,
      candidate_text: candidateText.slice(0, 120_000),
      validation_status:
        input.validation?.validation_status ??
        input.result.transport_telemetry
          ?.structured_output_validation_status ??
        null,
      validation_issue_paths: issuePaths
    };
  }
}

export function classifyFormativeConversationV18Result(input: {
  result: StructuredAgentResult<FormativeConversationV18AgentOutput>;
  parsed: boolean;
  semantic_validation: FormativeConversationV18CandidateValidation | null;
}): FormativeConversationV18FailureClass | null {
  if (input.result.status === "completed" && input.parsed) {
    return input.semantic_validation && !input.semantic_validation.valid
      ? "parsed_semantic_contract_failure"
      : null;
  }
  if (input.result.status === "incomplete") {
    return "provider_incomplete_structured_output";
  }
  const telemetry = input.result.transport_telemetry;
  if (
    input.result.status === "failed" &&
    (telemetry?.structured_output_validation_status === "invalid_json" ||
      telemetry?.structured_output_validation_status === "schema_invalid" ||
      telemetry?.structured_output_validation_status === "missing_output_text" ||
      input.result.error?.category === "schema_validation" ||
      input.result.error?.category === "structured_output_schema_incompatible" ||
      input.result.error?.category === "provider_request_schema_invalid")
  ) {
    return "syntactic_structured_output_failure";
  }
  return "transport_failure";
}

function candidateEvaluation(input: {
  result: StructuredAgentResult<FormativeConversationV18AgentOutput>;
  validateCandidate: (
    output: FormativeConversationV18AgentOutput
  ) => FormativeConversationV18CandidateValidation;
}) {
  const parsed = FormativeConversationV18AgentOutputSchema.safeParse(
    input.result.parsed_output
  );
  const validation =
    input.result.status === "completed" && parsed.success
      ? input.validateCandidate(parsed.data)
      : null;
  const accepted = Boolean(validation?.valid);
  return {
    parsed: parsed.success && input.result.status === "completed",
    validation,
    accepted,
    output: parsed.success ? parsed.data : null,
    failure_class: classifyFormativeConversationV18Result({
      result: input.result,
      parsed: parsed.success && input.result.status === "completed",
      semantic_validation: validation
    })
  };
}

function toAttemptAudit(input: {
  sequence: number;
  kind: "base" | "semantic_regeneration";
  execution: FormativeConversationV18LogicalGenerationExecution;
  evaluation: ReturnType<typeof candidateEvaluation>;
}) {
  const telemetry = input.execution.result.transport_telemetry;
  const fetchInvoked = telemetry?.fetch_invoked === true;
  const providerResponseCompleted =
    telemetry?.response_body_completed === true ||
    telemetry?.response_body_received === true;
  return FormativeConversationV18LogicalCallAuditSchema.parse({
    sequence: input.sequence,
    kind: input.kind,
    logical_call_id: input.execution.logical_call_id,
    canonical_request_hash: input.execution.canonical_request_hash,
    result_status: input.execution.result.status,
    failure_class: input.evaluation.failure_class,
    accepted: input.evaluation.accepted,
    logical_call_entered: true,
    pre_dispatch_request_rejection_count:
      input.execution.pre_dispatch_request_rejection_count ??
      (!fetchInvoked && input.execution.result.status === "failed" ? 1 : 0),
    http_request_count:
      input.execution.http_request_count ?? (fetchInvoked ? 1 : 0),
    provider_response_completed_count:
      input.execution.provider_response_completed_count ??
      (providerResponseCompleted ? 1 : 0),
    provider_attempt_count: input.execution.provider_attempt_count,
    transport_retry_count: input.execution.transport_retry_count,
    parsed_candidate_count: input.evaluation.parsed ? 1 : 0,
    semantically_accepted_candidate_count: input.evaluation.accepted ? 1 : 0,
    provider_request_id:
      input.execution.result.provider_request_id ??
      telemetry?.provider_request_id ??
      null,
    provider_response_id:
      input.execution.result.provider_response_id ??
      telemetry?.provider_response_id ??
      null,
    client_request_id: input.execution.result.client_request_id,
    incomplete_reason: input.execution.result.incomplete_reason ?? null,
    latency_ms: input.execution.latency_ms,
    input_tokens: input.execution.result.usage?.input_tokens ?? null,
    output_tokens: input.execution.result.usage?.output_tokens ?? null,
    total_tokens: input.execution.result.usage?.total_tokens ?? null,
    invalid_candidate: input.evaluation.accepted
      ? null
      : safeInvalidCandidate({
          result: input.execution.result,
          validation: input.evaluation.validation
        })
  });
}

function aggregateAudit(
  attempts: Array<z.infer<typeof FormativeConversationV18LogicalCallAuditSchema>>
) {
  return FormativeConversationV18ExecutionAuditSchema.parse({
    policy_version: FORMATIVE_CONVERSATION_V18_EXECUTION_POLICY_VERSION,
    accounting_version: FORMATIVE_CONVERSATION_V18_ACCOUNTING_VERSION,
    planned_base_logical_calls: 1,
    logical_calls_entered: attempts.length,
    pre_dispatch_request_rejections: attempts.reduce(
      (sum, entry) => sum + entry.pre_dispatch_request_rejection_count,
      0
    ),
    http_requests_dispatched: attempts.reduce(
      (sum, entry) => sum + entry.http_request_count,
      0
    ),
    provider_responses_completed: attempts.reduce(
      (sum, entry) => sum + entry.provider_response_completed_count,
      0
    ),
    provider_attempts: attempts.reduce(
      (sum, entry) => sum + entry.provider_attempt_count,
      0
    ),
    transport_retries: attempts.reduce(
      (sum, entry) => sum + entry.transport_retry_count,
      0
    ),
    incomplete_output_recovery_calls: 0,
    semantic_regeneration_calls: attempts.filter(
      (entry) => entry.kind === "semantic_regeneration"
    ).length,
    parsed_candidates: attempts.reduce(
      (sum, entry) => sum + entry.parsed_candidate_count,
      0
    ),
    semantically_accepted_candidates: attempts.reduce(
      (sum, entry) => sum + entry.semantically_accepted_candidate_count,
      0
    ),
    attempts
  });
}

function aggregateUsage(
  attempts: Array<z.infer<typeof FormativeConversationV18LogicalCallAuditSchema>>
) {
  const sum = (field: "input_tokens" | "output_tokens" | "total_tokens") => {
    const values = attempts.map((entry) => entry[field]);
    return values.every((value) => value === null)
      ? null
      : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  };
  return {
    latency_ms: attempts.reduce((sum, entry) => sum + entry.latency_ms, 0),
    input_tokens: sum("input_tokens"),
    output_tokens: sum("output_tokens"),
    total_tokens: sum("total_tokens")
  };
}

export const FORMATIVE_CONVERSATION_V18_SEMANTIC_REGENERATION_INSTRUCTIONS = `
The prior complete, parsed candidate for this same formative conversation turn failed the local
semantic acceptance contract. Generate one fresh candidate from the same original context. Use only
the supplied canonical misconception claim IDs and eligible evidence IDs. Do not reconstruct an ID
from prose. Correct the stated validation category and issue paths without discussing validation with
the student. The prior invalid candidate is immutable audit evidence and is not a visible turn.
`;

export function buildFormativeConversationV18SemanticRegenerationRequest(input: {
  base_request: StructuredAgentRequest<
    FormativeConversationV18AgentInput,
    FormativeConversationV18AgentOutput
  >;
  invalid_attempt: z.infer<
    typeof FormativeConversationV18LogicalCallAuditSchema
  >;
  client_request_id: string;
}) {
  return {
    ...input.base_request,
    instructions: `${input.base_request.instructions}\n\n${FORMATIVE_CONVERSATION_V18_SEMANTIC_REGENERATION_INSTRUCTIONS}`,
    input: {
      original_context: input.base_request.input,
      semantic_regeneration: {
        policy_version:
          FORMATIVE_CONVERSATION_V18_SEMANTIC_REGENERATION_VERSION,
        contract_version: FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
        rejection_category: input.invalid_attempt.failure_class,
        issue_paths:
          input.invalid_attempt.invalid_candidate?.validation_issue_paths ?? [],
        invalid_candidate_hash:
          input.invalid_attempt.invalid_candidate?.candidate_hash ?? null,
        invalid_candidate:
          input.invalid_attempt.invalid_candidate?.candidate_json ??
          input.invalid_attempt.invalid_candidate?.candidate_text ??
          null,
        canonical_misconception_claim_catalog:
          input.base_request.input.allowed_misconception_claim_catalog,
        allowed_indicator_ids: canonicalMisconceptionIndicatorIds(
          input.base_request.input.allowed_misconception_claim_catalog
        ),
        allowed_claim_ids: canonicalMisconceptionClaimIds(
          input.base_request.input.allowed_misconception_claim_catalog
        ),
        canonical_eligible_evidence_catalog:
          input.base_request.input.allowed_evidence_catalog,
        allowed_evidence_ids:
          input.base_request.input.allowed_evidence_catalog.evidence.map(
            (entry) => entry.evidence_id
          )
      }
    },
    client_request_id: input.client_request_id,
    metadata: {
      ...(input.base_request.metadata ?? {}),
      semantic_regeneration_policy:
        FORMATIVE_CONVERSATION_V18_SEMANTIC_REGENERATION_VERSION,
      semantic_regeneration_attempt: "1"
    }
  } satisfies StructuredAgentRequest<unknown, FormativeConversationV18AgentOutput>;
}

function executionError(input: {
  failureClass: FormativeConversationV18FailureClass;
  audit: FormativeConversationV18ExecutionAudit;
  startedAt: Date;
  completedAt: Date;
  lastResult: StructuredAgentResult<FormativeConversationV18AgentOutput>;
}) {
  const usage = aggregateUsage(input.audit.attempts);
  const category =
    input.failureClass === "provider_incomplete_structured_output"
      ? "provider_incomplete_structured_output"
      : input.failureClass === "syntactic_structured_output_failure"
        ? "structured_output_invalid"
        : input.failureClass === "parsed_semantic_contract_failure" &&
            input.audit.semantic_regeneration_calls > 0
          ? "semantic_regeneration_exhausted"
          : "provider_execution_failed";
  return new FormativeConversationV18ExecutionError(
    input.failureClass,
    category,
    input.audit,
    input.startedAt,
    input.completedAt,
    usage.latency_ms,
    usage.input_tokens,
    usage.output_tokens,
    usage.total_tokens,
    input.lastResult
  );
}

export async function executeFormativeConversationV18(input: {
  base_request: StructuredAgentRequest<
    FormativeConversationV18AgentInput,
    FormativeConversationV18AgentOutput
  >;
  execute_logical_generation: (input: {
    sequence: number;
    kind: "base" | "semantic_regeneration";
    request: StructuredAgentRequest<unknown, FormativeConversationV18AgentOutput>;
  }) => Promise<FormativeConversationV18LogicalGenerationExecution>;
  validate_candidate: (
    output: FormativeConversationV18AgentOutput
  ) => FormativeConversationV18CandidateValidation;
  now?: () => Date;
}): Promise<FormativeConversationV18ExecutionSuccess> {
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const attempts: Array<
    z.infer<typeof FormativeConversationV18LogicalCallAuditSchema>
  > = [];
  const primary = await input.execute_logical_generation({
    sequence: 1,
    kind: "base",
    request: input.base_request
  });
  const primaryEvaluation = candidateEvaluation({
    result: primary.result,
    validateCandidate: input.validate_candidate
  });
  const primaryAudit = toAttemptAudit({
    sequence: 1,
    kind: "base",
    execution: primary,
    evaluation: primaryEvaluation
  });
  attempts.push(primaryAudit);
  if (
    primaryEvaluation.accepted &&
    primaryEvaluation.output &&
    primary.result.status === "completed"
  ) {
    const completedAt = now();
    const audit = aggregateAudit(attempts);
    return {
      result: {
        ...primary.result,
        parsed_output: primaryEvaluation.output
      },
      audit,
      started_at: startedAt,
      completed_at: completedAt,
      ...aggregateUsage(attempts)
    };
  }

  if (primaryEvaluation.failure_class !== "parsed_semantic_contract_failure") {
    const completedAt = now();
    const audit = aggregateAudit(attempts);
    throw executionError({
      failureClass:
        primaryEvaluation.failure_class ?? "transport_failure",
      audit,
      startedAt,
      completedAt,
      lastResult: primary.result
    });
  }

  const regenerationRequest =
    buildFormativeConversationV18SemanticRegenerationRequest({
      base_request: input.base_request,
      invalid_attempt: primaryAudit,
      client_request_id: `${input.base_request.client_request_id}:semantic-regeneration:1`
    });
  const regeneration = await input.execute_logical_generation({
    sequence: 2,
    kind: "semantic_regeneration",
    request: regenerationRequest
  });
  const regenerationEvaluation = candidateEvaluation({
    result: regeneration.result,
    validateCandidate: input.validate_candidate
  });
  attempts.push(
    toAttemptAudit({
      sequence: 2,
      kind: "semantic_regeneration",
      execution: regeneration,
      evaluation: regenerationEvaluation
    })
  );
  if (
    !regenerationEvaluation.accepted ||
    !regenerationEvaluation.output ||
    regeneration.result.status !== "completed"
  ) {
    const completedAt = now();
    const audit = aggregateAudit(attempts);
    throw executionError({
      failureClass:
        regenerationEvaluation.failure_class ??
        "parsed_semantic_contract_failure",
      audit,
      startedAt,
      completedAt,
      lastResult: regeneration.result
    });
  }
  const completedAt = now();
  const audit = aggregateAudit(attempts);
  return {
    result: {
      ...regeneration.result,
      parsed_output: regenerationEvaluation.output
    },
    audit,
    started_at: startedAt,
    completed_at: completedAt,
    ...aggregateUsage(attempts)
  };
}

export function createSingleAttemptFormativeConversationV18Execution(input: {
  logical_call_id: string;
  request: StructuredAgentRequest<unknown, FormativeConversationV18AgentOutput>;
  result: StructuredAgentResult<FormativeConversationV18AgentOutput>;
}): FormativeConversationV18LogicalGenerationExecution {
  const telemetry = input.result.transport_telemetry;
  return {
    result: input.result,
    logical_call_id: input.logical_call_id,
    canonical_request_hash: canonicalStructuredAgentRequestHash(input.request),
    provider_attempt_count: 1,
    transport_retry_count: 0,
    latency_ms: input.result.latency_ms,
    pre_dispatch_request_rejection_count:
      telemetry?.fetch_invoked === false && input.result.status === "failed"
        ? 1
        : 0,
    http_request_count: telemetry?.fetch_invoked ? 1 : 0,
    provider_response_completed_count:
      telemetry?.response_body_completed || telemetry?.response_body_received
        ? 1
        : 0
  };
}
