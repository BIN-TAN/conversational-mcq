import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalStructuredAgentRequestHash,
  classifyProviderFailure
} from "@/lib/llm/provider-transport-retry";
import type {
  StructuredAgentRequest,
  StructuredAgentResult
} from "@/lib/llm/providers/types";
import {
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentInput,
  type FormativeConversationAgentOutput
} from "./agent-contract";

export const FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_POLICY_VERSION =
  "formative-conversation-semantic-regeneration-v1";
export const FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTION_VERSION =
  "formative-conversation-semantic-regeneration-instruction-v1";
export const FORMATIVE_CONVERSATION_SAFE_INVALID_OUTPUT_EVIDENCE_VERSION =
  "formative-conversation-safe-invalid-output-evidence-v1";
export const FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_ACCOUNTING_VERSION =
  "formative-conversation-semantic-regeneration-accounting-v1";
export const FORMATIVE_CONVERSATION_MAXIMUM_SEMANTIC_REGENERATIONS = 1;

export const FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTIONS = `
The preceding model result for this same conversation turn failed local structured-output
validation. Generate one fresh, complete response from the original formative-conversation
context. Preserve the pedagogically appropriate response, but satisfy every field, enum,
coherence, field-disposition, and evidence-reference requirement in the declared output
contract. Do not discuss this validation event with the student. The prior invalid candidate
is audit evidence only and is not part of the visible conversation. Do not invent evidence,
silently normalize the prior object, or generate deterministic fallback text.
`;

export const FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTION_HASH =
  createHash("sha256")
    .update(FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTIONS)
    .digest("hex");

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const FormativeConversationSafeInvalidOutputEvidenceSchema = z
  .object({
    evidence_version: z.literal(
      FORMATIVE_CONVERSATION_SAFE_INVALID_OUTPUT_EVIDENCE_VERSION
    ),
    output_presence: z.enum(["decoded_json", "text_only", "absent"]),
    candidate_hash: HashSchema.nullable(),
    candidate_json: z.unknown().nullable(),
    candidate_text: z.string().max(50_000).nullable(),
    validation_status: z.string().min(1).nullable(),
    validation_issue_paths: z.array(z.string()).max(100)
  })
  .strict();

export const FormativeConversationLogicalGenerationAuditSchema = z
  .object({
    sequence: z.number().int().positive(),
    kind: z.enum(["primary", "semantic_regeneration"]),
    logical_call_id: z.string().min(1),
    canonical_request_hash: HashSchema,
    result_status: z.enum(["completed", "refused", "incomplete", "failed"]),
    accepted: z.boolean(),
    failure_category: z.string().min(1).nullable(),
    provider_attempt_count: z.number().int().positive(),
    transport_retry_count: z.number().int().nonnegative(),
    provider_request_id: z.string().min(1).nullable(),
    provider_response_id: z.string().min(1).nullable(),
    client_request_id: z.string().min(1),
    latency_ms: z.number().int().nonnegative(),
    input_tokens: z.number().int().nonnegative().nullable(),
    output_tokens: z.number().int().nonnegative().nullable(),
    total_tokens: z.number().int().nonnegative().nullable(),
    safe_invalid_output_evidence:
      FormativeConversationSafeInvalidOutputEvidenceSchema.nullable()
  })
  .strict();

export const FormativeConversationProviderExecutionAuditSchema = z
  .object({
    policy_version: z.literal(
      FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_POLICY_VERSION
    ),
    instruction_version: z.literal(
      FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTION_VERSION
    ),
    instruction_hash: z.literal(
      FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTION_HASH
    ),
    logical_generation_call_count: z.number().int().positive().max(2),
    provider_attempt_count: z.number().int().positive(),
    transport_retry_count: z.number().int().nonnegative(),
    semantic_regeneration_count: z.number().int().min(0).max(1),
    attempts: z
      .array(FormativeConversationLogicalGenerationAuditSchema)
      .min(1)
      .max(2)
  })
  .strict();

export type FormativeConversationProviderExecutionAudit = z.infer<
  typeof FormativeConversationProviderExecutionAuditSchema
>;

export type FormativeConversationLogicalGenerationExecution = {
  result: StructuredAgentResult<FormativeConversationAgentOutput>;
  logical_call_id: string;
  canonical_request_hash: string;
  provider_attempt_count: number;
  transport_retry_count: number;
  latency_ms: number;
};

export type FormativeConversationSemanticRegenerationSuccess = {
  result: StructuredAgentResult<FormativeConversationAgentOutput> & {
    parsed_output: FormativeConversationAgentOutput;
  };
  audit: FormativeConversationProviderExecutionAudit;
  started_at: Date;
  completed_at: Date;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
};

export class FormativeConversationSemanticRegenerationError extends Error {
  constructor(
    public readonly failure_category:
      | "provider_execution_failed"
      | "semantic_regeneration_not_permitted"
      | "semantic_regeneration_exhausted",
    public readonly audit: FormativeConversationProviderExecutionAudit,
    public readonly started_at: Date,
    public readonly completed_at: Date,
    public readonly latency_ms: number,
    public readonly input_tokens: number | null,
    public readonly output_tokens: number | null,
    public readonly total_tokens: number | null,
    public readonly last_result: StructuredAgentResult<FormativeConversationAgentOutput>
  ) {
    super(`formative_conversation_${failure_category}`);
    this.name = "FormativeConversationSemanticRegenerationError";
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
  const textParts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const entry of content) {
      if (
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        (entry as { type?: unknown }).type === "output_text" &&
        typeof (entry as { text?: unknown }).text === "string"
      ) {
        textParts.push((entry as { text: string }).text);
      }
    }
  }
  return textParts.length > 0 ? textParts.join("") : null;
}

function safeInvalidOutputEvidence(
  result: StructuredAgentResult<FormativeConversationAgentOutput>
): z.infer<typeof FormativeConversationSafeInvalidOutputEvidenceSchema> {
  const candidateText = responseOutputText(result.raw_output);
  const validationStatus =
    result.transport_telemetry?.structured_output_validation_status ?? null;
  const issuePaths = [
    ...new Set(
      result.transport_telemetry?.structured_output_validation_issue_paths ?? []
    )
  ].sort();
  if (candidateText === null) {
    return {
      evidence_version:
        FORMATIVE_CONVERSATION_SAFE_INVALID_OUTPUT_EVIDENCE_VERSION,
      output_presence: "absent",
      candidate_hash: null,
      candidate_json: null,
      candidate_text: null,
      validation_status: validationStatus,
      validation_issue_paths: issuePaths
    };
  }

  const candidateHash = createHash("sha256").update(candidateText).digest("hex");
  try {
    return {
      evidence_version:
        FORMATIVE_CONVERSATION_SAFE_INVALID_OUTPUT_EVIDENCE_VERSION,
      output_presence: "decoded_json",
      candidate_hash: candidateHash,
      candidate_json: JSON.parse(candidateText) as unknown,
      candidate_text: null,
      validation_status: validationStatus,
      validation_issue_paths: issuePaths
    };
  } catch {
    return {
      evidence_version:
        FORMATIVE_CONVERSATION_SAFE_INVALID_OUTPUT_EVIDENCE_VERSION,
      output_presence: "text_only",
      candidate_hash: candidateHash,
      candidate_json: null,
      candidate_text: candidateText.slice(0, 50_000),
      validation_status: validationStatus,
      validation_issue_paths: issuePaths
    };
  }
}

function acceptedOutput(
  result: StructuredAgentResult<FormativeConversationAgentOutput>
): result is StructuredAgentResult<FormativeConversationAgentOutput> & {
  parsed_output: FormativeConversationAgentOutput;
} {
  return (
    result.status === "completed" &&
    FormativeConversationAgentOutputSchema.safeParse(result.parsed_output).success
  );
}

function toAttemptAudit(input: {
  sequence: number;
  kind: "primary" | "semantic_regeneration";
  execution: FormativeConversationLogicalGenerationExecution;
}): z.infer<typeof FormativeConversationLogicalGenerationAuditSchema> {
  const classification = acceptedOutput(input.execution.result)
    ? null
    : classifyProviderFailure(input.execution.result);
  return {
    sequence: input.sequence,
    kind: input.kind,
    logical_call_id: input.execution.logical_call_id,
    canonical_request_hash: input.execution.canonical_request_hash,
    result_status: input.execution.result.status,
    accepted: acceptedOutput(input.execution.result),
    failure_category: classification?.category ?? null,
    provider_attempt_count: input.execution.provider_attempt_count,
    transport_retry_count: input.execution.transport_retry_count,
    provider_request_id:
      input.execution.result.provider_request_id ??
      input.execution.result.transport_telemetry?.provider_request_id ??
      null,
    provider_response_id:
      input.execution.result.provider_response_id ??
      input.execution.result.transport_telemetry?.provider_response_id ??
      null,
    client_request_id: input.execution.result.client_request_id,
    latency_ms: input.execution.latency_ms,
    input_tokens: input.execution.result.usage?.input_tokens ?? null,
    output_tokens: input.execution.result.usage?.output_tokens ?? null,
    total_tokens: input.execution.result.usage?.total_tokens ?? null,
    safe_invalid_output_evidence: acceptedOutput(input.execution.result)
      ? null
      : safeInvalidOutputEvidence(input.execution.result)
  };
}

function aggregateAudit(
  attempts: Array<z.infer<typeof FormativeConversationLogicalGenerationAuditSchema>>
): FormativeConversationProviderExecutionAudit {
  return FormativeConversationProviderExecutionAuditSchema.parse({
    policy_version:
      FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_POLICY_VERSION,
    instruction_version:
      FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTION_VERSION,
    instruction_hash:
      FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTION_HASH,
    logical_generation_call_count: attempts.length,
    provider_attempt_count: attempts.reduce(
      (sum, attempt) => sum + attempt.provider_attempt_count,
      0
    ),
    transport_retry_count: attempts.reduce(
      (sum, attempt) => sum + attempt.transport_retry_count,
      0
    ),
    semantic_regeneration_count: attempts.some(
      (attempt) => attempt.kind === "semantic_regeneration"
    )
      ? 1
      : 0,
    attempts
  });
}

function aggregateUsage(
  attempts: Array<z.infer<typeof FormativeConversationLogicalGenerationAuditSchema>>
) {
  const sum = (field: "input_tokens" | "output_tokens" | "total_tokens") => {
    const values = attempts.map((attempt) => attempt[field]);
    return values.every((value) => value === null)
      ? null
      : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  };
  return {
    latency_ms: attempts.reduce((sum, attempt) => sum + attempt.latency_ms, 0),
    input_tokens: sum("input_tokens"),
    output_tokens: sum("output_tokens"),
    total_tokens: sum("total_tokens")
  };
}

export function buildFormativeConversationSemanticRegenerationRequest(input: {
  base_request: StructuredAgentRequest<
    FormativeConversationAgentInput,
    FormativeConversationAgentOutput
  >;
  invalid_attempt: z.infer<
    typeof FormativeConversationLogicalGenerationAuditSchema
  >;
  client_request_id: string;
}) {
  const evidence = input.invalid_attempt.safe_invalid_output_evidence;
  const request: StructuredAgentRequest<unknown, FormativeConversationAgentOutput> = {
    ...input.base_request,
    instructions: `${input.base_request.instructions}\n\n${FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_INSTRUCTIONS}`,
    input: {
      original_context: input.base_request.input,
      semantic_regeneration: {
        policy_version:
          FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_POLICY_VERSION,
        validation_failure_category:
          input.invalid_attempt.failure_category,
        validation_issue_paths:
          evidence?.validation_issue_paths ?? [],
        prior_invalid_candidate_hash: evidence?.candidate_hash ?? null,
        prior_invalid_candidate:
          evidence?.candidate_json ?? evidence?.candidate_text ?? null
      }
    },
    client_request_id: input.client_request_id,
    metadata: {
      ...(input.base_request.metadata ?? {}),
      semantic_regeneration_policy:
        FORMATIVE_CONVERSATION_SEMANTIC_REGENERATION_POLICY_VERSION,
      semantic_regeneration_attempt: "1"
    }
  };
  return request;
}

export async function executeFormativeConversationWithSemanticRegeneration(input: {
  base_request: StructuredAgentRequest<
    FormativeConversationAgentInput,
    FormativeConversationAgentOutput
  >;
  execute_logical_generation: (input: {
    sequence: number;
    kind: "primary" | "semantic_regeneration";
    request: StructuredAgentRequest<unknown, FormativeConversationAgentOutput>;
  }) => Promise<FormativeConversationLogicalGenerationExecution>;
  now?: () => Date;
}): Promise<FormativeConversationSemanticRegenerationSuccess> {
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const attemptAudits: Array<
    z.infer<typeof FormativeConversationLogicalGenerationAuditSchema>
  > = [];

  const primary = await input.execute_logical_generation({
    sequence: 1,
    kind: "primary",
    request: input.base_request
  });
  const primaryAudit = toAttemptAudit({
    sequence: 1,
    kind: "primary",
    execution: primary
  });
  attemptAudits.push(primaryAudit);

  if (acceptedOutput(primary.result)) {
    const completedAt = now();
    const usage = aggregateUsage(attemptAudits);
    return {
      result: primary.result,
      audit: aggregateAudit(attemptAudits),
      started_at: startedAt,
      completed_at: completedAt,
      ...usage
    };
  }

  const primaryClassification = classifyProviderFailure(primary.result);
  const semanticRegenerationPermitted =
    primaryClassification.semantic_regeneration_eligible &&
    (primaryClassification.category === "response_schema_invalid" ||
      primaryClassification.category === "response_missing_required_fields");
  if (!semanticRegenerationPermitted) {
    const completedAt = now();
    const usage = aggregateUsage(attemptAudits);
    throw new FormativeConversationSemanticRegenerationError(
      primaryClassification.domain === "model_result"
        ? "semantic_regeneration_not_permitted"
        : "provider_execution_failed",
      aggregateAudit(attemptAudits),
      startedAt,
      completedAt,
      usage.latency_ms,
      usage.input_tokens,
      usage.output_tokens,
      usage.total_tokens,
      primary.result
    );
  }

  const regenerationRequest =
    buildFormativeConversationSemanticRegenerationRequest({
      base_request: input.base_request,
      invalid_attempt: primaryAudit,
      client_request_id: `${input.base_request.client_request_id}:semantic-regeneration:1`
    });
  const regeneration = await input.execute_logical_generation({
    sequence: 2,
    kind: "semantic_regeneration",
    request: regenerationRequest
  });
  attemptAudits.push(
    toAttemptAudit({
      sequence: 2,
      kind: "semantic_regeneration",
      execution: regeneration
    })
  );

  if (!acceptedOutput(regeneration.result)) {
    const completedAt = now();
    const usage = aggregateUsage(attemptAudits);
    throw new FormativeConversationSemanticRegenerationError(
      "semantic_regeneration_exhausted",
      aggregateAudit(attemptAudits),
      startedAt,
      completedAt,
      usage.latency_ms,
      usage.input_tokens,
      usage.output_tokens,
      usage.total_tokens,
      regeneration.result
    );
  }

  const completedAt = now();
  const usage = aggregateUsage(attemptAudits);
  return {
    result: regeneration.result,
    audit: aggregateAudit(attemptAudits),
    started_at: startedAt,
    completed_at: completedAt,
    ...usage
  };
}

export function createSingleAttemptLogicalGenerationExecution(input: {
  logical_call_id: string;
  request: StructuredAgentRequest<unknown, FormativeConversationAgentOutput>;
  result: StructuredAgentResult<FormativeConversationAgentOutput>;
}): FormativeConversationLogicalGenerationExecution {
  return {
    result: input.result,
    logical_call_id: input.logical_call_id,
    canonical_request_hash: canonicalStructuredAgentRequestHash(input.request),
    provider_attempt_count: 1,
    transport_retry_count: 0,
    latency_ms: input.result.latency_ms
  };
}
