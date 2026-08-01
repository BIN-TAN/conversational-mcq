import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertNoProhibitedProviderInput, redactForAudit } from "@/lib/agents/redaction";
import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/services/json";
import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_AGENT_NAME,
  FORMATIVE_CONVERSATION_CONTEXT_VERSION,
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAdministeredItem,
  type FormativeConversationAgentInput,
  type FormativeConversationAgentOutput,
  type FormativeConversationAssessmentProcessEvidence,
  type FormativeConversationAssessmentResponseEvidence,
  type FormativeConversationAssessmentSpecification,
  type FormativeConversationProfileEvidence
} from "./agent-contract";
import { formativeConversationUnavailableFromConfiguration } from "./availability";
import { compilePersistedFormativeConversationContext } from "./context";
import { recordFormativeConversationProfileEvidenceReferences } from "./evidence-references";
import {
  FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
  FORMATIVE_CONVERSATION_OPENING_VERSION,
  validateFormativeConversationOpeningOutput
} from "./opening-contract";
import { validateFormativeConversationAgentOutputForContext } from "./output-format";
import {
  FormativeConversationPersistenceError,
  formativeConversationPersistenceError
} from "./persistence-errors";
import { executeFormativeConversationProviderOutsidePersistence } from "./provider-persistence-boundary";
import {
  FormativeConversationProfileTransitionError,
  recordFormativeConversationProfileTransitionRecommendation,
  recordFormativeConversationProfileTransitionRejection
} from "./profile-update";
import {
  persistFormativeConversationAssistantMessage,
  prepareFormativeConversationAssistantResponseAttempt,
  recordFormativeConversationAssistantResponseFailure,
  recordFormativeConversationOpeningFailure,
  reserveFormativeConversationOpening,
  reserveAndPersistFormativeConversationStudentMessage
} from "./service";
import {
  FormativeConversationTelemetryError,
  recordFormativeConversationInputTelemetry,
  recordFormativeConversationLifecycleEvent,
  recordFormativeConversationTurnTelemetry
} from "./telemetry";

const FormativeConversationAgentIdentitySchema = z
  .object({
    agent_name: z.literal(FORMATIVE_CONVERSATION_AGENT_NAME),
    agent_version: z.string().min(1),
    model_name: z.string().min(1),
    provider: z.string().min(1),
    prompt_version: z.string().min(1),
    schema_version: z.literal(FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION),
    prompt_hash: z.string().min(1),
    reasoning_effort: z.string().min(1).nullable().optional(),
    max_output_tokens: z.number().int().positive().nullable().optional(),
    live_call_allowed: z.boolean()
  })
  .strict();

const FormativeConversationAgentExecutionSchema = z
  .object({
    output: z.unknown(),
    raw_output: z.unknown().optional(),
    generation_source: z.string().min(1),
    provider_request_id: z.string().min(1).nullable().optional(),
    provider_response_id: z.string().min(1).nullable().optional(),
    client_request_id: z.string().min(1).nullable().optional(),
    retry_count: z.number().int().nonnegative(),
    latency_ms: z.number().int().nonnegative(),
    input_tokens: z.number().int().nonnegative().nullable().optional(),
    output_tokens: z.number().int().nonnegative().nullable().optional(),
    total_tokens: z.number().int().nonnegative().nullable().optional(),
    estimated_cost: z.number().nonnegative().nullable().optional(),
    started_at: z.coerce.date(),
    completed_at: z.coerce.date()
  })
  .strict()
  .refine((value) => value.completed_at >= value.started_at, {
    message: "completed_at must not precede started_at",
    path: ["completed_at"]
  });

export type FormativeConversationAgentIdentity = z.infer<
  typeof FormativeConversationAgentIdentitySchema
>;
export type FormativeConversationAgentExecution = z.input<
  typeof FormativeConversationAgentExecutionSchema
>;

export interface FormativeConversationAgentRunner {
  identity: FormativeConversationAgentIdentity;
  execute(input: {
    agent_call_db_id: string;
    invocation_key: string;
    context: FormativeConversationAgentInput;
  }): Promise<FormativeConversationAgentExecution>;
}

export type FormativeConversationRuntimeContextSeed = {
  assessment_public_id: string;
  concept_unit_public_id: string;
  administered_items: FormativeConversationAdministeredItem[];
  assessment_specification?: FormativeConversationAssessmentSpecification | null;
  assessment_response_evidence?: FormativeConversationAssessmentResponseEvidence[];
  assessment_process_evidence?: FormativeConversationAssessmentProcessEvidence[];
  initial_profile: FormativeConversationProfileEvidence;
  current_profile: FormativeConversationProfileEvidence;
};

export type FormativeConversationObservableInputTelemetry = {
  turn_started_at?: Date | null;
  submitted_at: Date;
  response_time_ms?: number | null;
  typing_started_at?: Date | null;
  typing_ended_at?: Date | null;
  typing_duration_ms?: number | null;
  typing_duration_method?:
    | "active_intervals"
    | "elapsed_first_input_to_submit"
    | null;
  edit_count: number;
  backspace_count: number;
  paste_event_count: number;
  paste_character_count: number;
};

export class FormativeConversationRuntimeError extends Error {
  constructor(
    public readonly code:
      | "agent_call_in_progress"
      | "agent_call_failed"
      | "agent_output_invalid"
      | "opening_requires_empty_transcript",
    message: string,
    public readonly reason_code: string | null = null
  ) {
    super(message);
    this.name = "FormativeConversationRuntimeError";
  }
}

export class FormativeConversationResponseGenerationError extends Error {
  constructor(
    public readonly response_status: "failed" | "pending" | "retrying",
    public readonly receipt_public_id: string,
    public readonly retryable: boolean
  ) {
    super(
      response_status === "failed"
        ? "The tutor response could not be generated."
        : "The tutor response is still being generated."
    );
    this.name = "FormativeConversationResponseGenerationError";
  }
}

function prismaJson(value: unknown): Prisma.InputJsonValue {
  return (toPrismaJson(value) ?? {}) as Prisma.InputJsonValue;
}

export function formativeConversationInvocationKey(
  conversationPublicId: string,
  clientMessageId: string,
  attemptIndex = 1
) {
  const attemptIdentity =
    attemptIndex > 1 ? `:attempt:${attemptIndex}` : "";
  const digest = createHash("sha256")
    .update(`${conversationPublicId}:${clientMessageId}${attemptIdentity}`)
    .digest("hex");
  return `formative_conversation:${digest}`;
}

function eventId(
  clientMessageId: string,
  eventType: string,
  attemptIndex?: number
) {
  const identity =
    attemptIndex === undefined
      ? clientMessageId
      : `${clientMessageId}:attempt:${attemptIndex}`;
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  return `${eventType}:${digest}`;
}

function asObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

async function persistAgentProfileEvidence(input: {
  conversation_public_id: string;
  source_agent_call_db_id: string;
  source_tutor_turn_db_id: string;
  output: FormativeConversationAgentOutput;
}) {
  const evidence =
    await recordFormativeConversationProfileEvidenceReferences({
      conversation_public_id: input.conversation_public_id,
      source_agent_call_db_id: input.source_agent_call_db_id,
      source_tutor_turn_db_id: input.source_tutor_turn_db_id,
      evidence_observations: input.output.evidence_observations
    });
  let profileTransition = null;
  let profileTransitionRejection = null;
  if (input.output.profile_transition_recommendation) {
    try {
      profileTransition =
        await recordFormativeConversationProfileTransitionRecommendation({
          conversation_public_id: input.conversation_public_id,
          source_agent_call_db_id: input.source_agent_call_db_id,
          source_tutor_turn_db_id: input.source_tutor_turn_db_id,
          agent_evidence_observations: input.output.evidence_observations,
          recommendation:
            input.output.profile_transition_recommendation
        });
    } catch (error) {
      if (!(error instanceof FormativeConversationProfileTransitionError)) {
        throw error;
      }
      profileTransitionRejection =
        await recordFormativeConversationProfileTransitionRejection({
          conversation_public_id: input.conversation_public_id,
          source_agent_call_db_id: input.source_agent_call_db_id,
          source_tutor_turn_db_id: input.source_tutor_turn_db_id,
          proposed_outcome:
            input.output.profile_transition_recommendation
              .proposed_outcome,
          error
        });
    }
  }

  return {
    evidence,
    profile_transition: profileTransition,
    profile_transition_rejection: profileTransitionRejection
  };
}

async function recordRuntimeEvent(input: {
  conversation_public_id: string;
  client_message_id: string;
  event_type:
    | "student_message_persisted"
    | "agent_call_started"
    | "agent_call_completed"
    | "agent_call_failed"
    | "assistant_response_failed"
    | "tutor_message_persisted";
  event_source: "backend" | "agent";
  occurred_at: Date;
  attempt_index?: number;
  agent_call_db_id?: string | null;
  agent_name?: string | null;
  failure_category?: string | null;
  retry_count?: number | null;
}) {
  try {
    return await recordFormativeConversationLifecycleEvent({
      conversation_public_id: input.conversation_public_id,
      client_event_id: eventId(
        input.client_message_id,
        input.event_type,
        input.attempt_index
      ),
      event_type: input.event_type,
      event_source: input.event_source,
      agent_call_db_id: input.agent_call_db_id ?? null,
      agent_name: input.agent_name ?? null,
      failure_category: input.failure_category ?? null,
      retry_count: input.retry_count ?? null,
      observed_interval_duration_ms: null,
      client_instance_id: null,
      occurred_at: input.occurred_at
    });
  } catch (error) {
    if (
      error instanceof FormativeConversationTelemetryError ||
      error instanceof FormativeConversationPersistenceError
    ) {
      throw error;
    }
    throw formativeConversationPersistenceError(
      error,
      "lifecycle_persistence"
    );
  }
}

async function loadRuntimeIdentity(conversationPublicId: string) {
  return prisma.formativeConversationSession.findUniqueOrThrow({
    where: { conversation_public_id: conversationPublicId },
    select: {
      id: true,
      assessment_session_db_id: true,
      concept_unit_session_db_id: true,
      current_student_profile_db_id: true
    }
  });
}

async function createStartedAgentCall(input: {
  session: Awaited<ReturnType<typeof loadRuntimeIdentity>>;
  message_receipt_db_id: string;
  invocation_key: string;
  context: FormativeConversationAgentInput;
  runner: FormativeConversationAgentRunner;
}) {
  const identity = FormativeConversationAgentIdentitySchema.parse(input.runner.identity);
  const existing = await prisma.agentCall.findUnique({
    where: { agent_invocation_key: input.invocation_key }
  });
  if (existing) {
    if (
      existing.formative_conversation_message_receipt_db_id &&
      existing.formative_conversation_message_receipt_db_id !==
        input.message_receipt_db_id
    ) {
      throw new FormativeConversationRuntimeError(
        "agent_call_failed",
        "The formative conversation AgentCall belongs to another message receipt."
      );
    }
    const bound =
      existing.formative_conversation_message_receipt_db_id
        ? existing
        : await prisma.agentCall.update({
            where: { id: existing.id },
            data: {
              formative_conversation_message_receipt_db_id:
                input.message_receipt_db_id
            }
          });
    return { agent_call: bound, created: false };
  }

  try {
    const agentCall = await prisma.agentCall.create({
      data: {
        assessment_session_db_id: input.session.assessment_session_db_id,
        concept_unit_session_db_id: input.session.concept_unit_session_db_id,
        formative_conversation_session_db_id: input.session.id,
        formative_conversation_message_receipt_db_id:
          input.message_receipt_db_id,
        formative_conversation_context_version:
          FORMATIVE_CONVERSATION_CONTEXT_VERSION,
        agent_name: identity.agent_name,
        agent_version: identity.agent_version,
        model_name: identity.model_name,
        provider: identity.provider,
        agent_invocation_key: input.invocation_key,
        prompt_hash: identity.prompt_hash,
        reasoning_effort: identity.reasoning_effort ?? null,
        max_output_tokens: identity.max_output_tokens ?? null,
        prompt_version: identity.prompt_version,
        schema_version: identity.schema_version,
        input_payload: prismaJson(redactForAudit(input.context)),
        live_call_allowed: identity.live_call_allowed,
        call_status: "started",
        started_at: new Date()
      }
    });
    return { agent_call: agentCall, created: true };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const agentCall = await prisma.agentCall.findUniqueOrThrow({
        where: { agent_invocation_key: input.invocation_key }
      });
      if (
        agentCall.formative_conversation_message_receipt_db_id &&
        agentCall.formative_conversation_message_receipt_db_id !==
          input.message_receipt_db_id
      ) {
        throw new FormativeConversationRuntimeError(
          "agent_call_failed",
          "The formative conversation AgentCall belongs to another message receipt."
        );
      }
      const bound =
        agentCall.formative_conversation_message_receipt_db_id
          ? agentCall
          : await prisma.agentCall.update({
              where: { id: agentCall.id },
              data: {
                formative_conversation_message_receipt_db_id:
                  input.message_receipt_db_id
              }
            });
      return { agent_call: bound, created: false };
    }
    throw error;
  }
}

async function executeOrResumeAgentCall(input: {
  conversation_public_id: string;
  client_message_id: string;
  message_receipt_db_id: string;
  context: FormativeConversationAgentInput;
  runner: FormativeConversationAgentRunner;
  attempt_index?: number;
}) {
  const session = await loadRuntimeIdentity(input.conversation_public_id);
  const key = formativeConversationInvocationKey(
    input.conversation_public_id,
    input.client_message_id,
    input.attempt_index
  );
  const started = await createStartedAgentCall({
    session,
    message_receipt_db_id: input.message_receipt_db_id,
    invocation_key: key,
    context: input.context,
    runner: input.runner
  });

  if (!started.created) {
    if (
      started.agent_call.call_status === "succeeded" &&
      started.agent_call.output_validated &&
      started.agent_call.output_payload
    ) {
      const output = FormativeConversationAgentOutputSchema.parse(
        started.agent_call.output_payload
      );
      const contextualValidation =
        validateFormativeConversationAgentOutputForContext({
          output,
          context: input.context
        });
      if (!contextualValidation.valid) {
        throw new FormativeConversationRuntimeError(
          "agent_output_invalid",
          "The resumed formative conversation output failed canonical validation.",
          contextualValidation.issues[0]?.code ?? null
        );
      }
      await recordRuntimeEvent({
        conversation_public_id: input.conversation_public_id,
        client_message_id: input.client_message_id,
        event_type: "agent_call_started",
        event_source: "agent",
        attempt_index: input.attempt_index ?? 1,
        agent_call_db_id: started.agent_call.id,
        agent_name: started.agent_call.agent_name,
        retry_count: started.agent_call.retry_count,
        occurred_at:
          started.agent_call.started_at ?? started.agent_call.created_at
      });
      return {
        agent_call: started.agent_call,
        output,
        generation_source:
          typeof asObject(started.agent_call.usage_guard_snapshot)
            .generation_source === "string"
            ? (asObject(started.agent_call.usage_guard_snapshot)
                .generation_source as string)
            : started.agent_call.provider === "mock"
              ? "deterministic_test"
              : "live_llm",
        resumed: true
      };
    }
    if (started.agent_call.call_status === "started") {
      throw new FormativeConversationRuntimeError(
        "agent_call_in_progress",
        "The formative conversation agent call is already in progress."
      );
    }
    throw new FormativeConversationRuntimeError(
      "agent_call_failed",
      "The existing formative conversation agent call did not succeed."
    );
  }

  await recordRuntimeEvent({
    conversation_public_id: input.conversation_public_id,
    client_message_id: input.client_message_id,
    event_type: "agent_call_started",
    event_source: "agent",
    attempt_index: input.attempt_index ?? 1,
    agent_call_db_id: started.agent_call.id,
    agent_name: started.agent_call.agent_name,
    retry_count: started.agent_call.retry_count,
    occurred_at: started.agent_call.started_at ?? started.agent_call.created_at
  });

  let execution: z.infer<typeof FormativeConversationAgentExecutionSchema>;
  try {
    execution = FormativeConversationAgentExecutionSchema.parse(
      await executeFormativeConversationProviderOutsidePersistence({
        execute: () =>
          input.runner.execute({
            agent_call_db_id: started.agent_call.id,
            invocation_key: key,
            context: input.context
          })
      })
    );
  } catch (error) {
    await prisma.agentCall.update({
      where: { id: started.agent_call.id },
      data: {
        call_status: "failed",
        output_validated: false,
        error_category: "formative_conversation_agent_execution",
        completed_at: new Date()
      }
    });
    throw error;
  }

  const parsedOutput = FormativeConversationAgentOutputSchema.safeParse(
    execution.output
  );
  if (!parsedOutput.success) {
    await prisma.agentCall.update({
      where: { id: started.agent_call.id },
      data: {
        provider_request_id: execution.provider_request_id ?? null,
        provider_response_id: execution.provider_response_id ?? null,
        client_request_id: execution.client_request_id ?? null,
        raw_output: prismaJson(
          redactForAudit(execution.raw_output ?? execution.output)
        ),
        output_validated: false,
        validation_error: JSON.stringify({
          category: "schema_validation",
          issue_count: parsedOutput.error.issues.length,
          field_paths: parsedOutput.error.issues.map((issue) =>
            issue.path.join(".")
          )
        }),
        call_status: "invalid_output",
        latency_ms: execution.latency_ms,
        retry_count: execution.retry_count,
        input_tokens: execution.input_tokens ?? null,
        output_tokens: execution.output_tokens ?? null,
        total_tokens: execution.total_tokens ?? null,
        completed_at: execution.completed_at
      }
    });
    throw new FormativeConversationRuntimeError(
      "agent_output_invalid",
      "The formative conversation agent output failed schema validation."
    );
  }

  const contextualValidation =
    validateFormativeConversationAgentOutputForContext({
      output: parsedOutput.data,
      context: input.context
    });
  if (!contextualValidation.valid) {
    await prisma.agentCall.update({
      where: { id: started.agent_call.id },
      data: {
        provider_request_id: execution.provider_request_id ?? null,
        provider_response_id: execution.provider_response_id ?? null,
        client_request_id: execution.client_request_id ?? null,
        raw_output: prismaJson(
          redactForAudit(execution.raw_output ?? execution.output)
        ),
        output_validated: false,
        validation_error: JSON.stringify({
          category: "formative_conversation_output_contract",
          validator_version:
            "formative-conversation-output-context-validation-v1",
          issue_count: contextualValidation.issues.length,
          issues: contextualValidation.issues
        }),
        error_category: "formative_conversation_output_contract",
        call_status: "invalid_output",
        latency_ms: execution.latency_ms,
        retry_count: execution.retry_count,
        input_tokens: execution.input_tokens ?? null,
        output_tokens: execution.output_tokens ?? null,
        total_tokens: execution.total_tokens ?? null,
        completed_at: execution.completed_at
      }
    });
    throw new FormativeConversationRuntimeError(
      "agent_output_invalid",
      "The formative conversation agent output failed canonical validation.",
      contextualValidation.issues[0]?.code ?? null
    );
  }

  const agentCall = await prisma.agentCall.update({
    where: { id: started.agent_call.id },
    data: {
      provider_request_id: execution.provider_request_id ?? null,
      provider_response_id: execution.provider_response_id ?? null,
      client_request_id: execution.client_request_id ?? null,
      raw_output: prismaJson(
        redactForAudit(execution.raw_output ?? execution.output)
      ),
      output_payload: prismaJson(parsedOutput.data),
      output_validated: true,
      validation_error: null,
      usage_guard_snapshot: prismaJson({
        generation_source: execution.generation_source
      }),
      retry_count: execution.retry_count,
      call_status: "succeeded",
      latency_ms: execution.latency_ms,
      input_tokens: execution.input_tokens ?? null,
      output_tokens: execution.output_tokens ?? null,
      total_tokens: execution.total_tokens ?? null,
      token_usage: prismaJson({
        input_tokens: execution.input_tokens ?? null,
        output_tokens: execution.output_tokens ?? null,
        total_tokens: execution.total_tokens ?? null
      }),
      estimated_cost: execution.estimated_cost ?? null,
      started_at: execution.started_at,
      completed_at: execution.completed_at
    }
  });
  await recordRuntimeEvent({
    conversation_public_id: input.conversation_public_id,
    client_message_id: input.client_message_id,
    event_type: "agent_call_completed",
    event_source: "agent",
    attempt_index: input.attempt_index ?? 1,
    agent_call_db_id: agentCall.id,
    agent_name: agentCall.agent_name,
    retry_count: agentCall.retry_count,
    occurred_at: execution.completed_at
  });

  return {
    agent_call: agentCall,
    output: parsedOutput.data,
    generation_source: execution.generation_source,
    resumed: false
  };
}

function safeAssistantResponseFailureCategory(error: unknown) {
  if (formativeConversationUnavailableFromConfiguration(error)) {
    return "configuration_unavailable";
  }
  if (error instanceof FormativeConversationRuntimeError) {
    if (error.code === "agent_output_invalid") {
      return "agent_output_validation_failure";
    }
    if (error.code === "agent_call_failed") {
      return "agent_execution_failure";
    }
  }
  if (error instanceof z.ZodError) {
    return "agent_output_validation_failure";
  }
  return "agent_execution_failure";
}

async function persistTerminalAssistantResponseFailure(input: {
  conversation_public_id: string;
  client_message_id: string;
  receipt_public_id: string;
  attempt_index: number;
  retry_count: number;
  failure_category: string;
  agent_call?: {
    id: string;
    agent_name: string;
    call_status: string;
    completed_at: Date | null;
    updated_at: Date;
  } | null;
}) {
  const failedAt =
    input.agent_call?.completed_at ??
    input.agent_call?.updated_at ??
    new Date();
  await recordFormativeConversationAssistantResponseFailure({
    conversation_public_id: input.conversation_public_id,
    client_message_id: input.client_message_id,
    failure_category: input.failure_category,
    failed_at: failedAt
  });
  await recordRuntimeEvent({
    conversation_public_id: input.conversation_public_id,
    client_message_id: input.client_message_id,
    event_type:
      input.agent_call &&
      ["failed", "invalid_output", "blocked"].includes(
        input.agent_call.call_status
      )
        ? "agent_call_failed"
        : "assistant_response_failed",
    event_source: input.agent_call ? "agent" : "backend",
    attempt_index: input.attempt_index,
    agent_call_db_id: input.agent_call?.id ?? null,
    agent_name:
      input.agent_call?.agent_name ??
      FORMATIVE_CONVERSATION_AGENT_NAME,
    failure_category: input.failure_category,
    retry_count: input.retry_count,
    occurred_at: failedAt
  });
  return new FormativeConversationResponseGenerationError(
    "failed",
    input.receipt_public_id,
    true
  );
}

export async function processFormativeConversationOpening(
  input: {
    conversation_public_id: string;
    context: FormativeConversationRuntimeContextSeed;
  },
  dependencies: {
    runner?: FormativeConversationAgentRunner;
    runner_factory?: () => FormativeConversationAgentRunner;
  }
) {
  const reservation = await reserveFormativeConversationOpening(
    input.conversation_public_id
  );

  if (reservation.receipt.assistant_turn) {
    const assistantPayload = asObject(
      reservation.receipt.assistant_turn.structured_payload
    );
    const agentCallDbId =
      typeof assistantPayload.agent_call_db_id === "string"
        ? assistantPayload.agent_call_db_id
        : null;
    const existingCall = agentCallDbId
      ? await prisma.agentCall.findUnique({ where: { id: agentCallDbId } })
      : await prisma.agentCall.findUnique({
          where: {
            agent_invocation_key: formativeConversationInvocationKey(
              input.conversation_public_id,
              FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
              reservation.opening_attempt
            )
          }
        });
    return {
      receipt: reservation.receipt,
      tutor_turn: reservation.receipt.assistant_turn,
      agent_call: existingCall,
      replayed: true,
      resumed: false
    };
  }

  let runner: FormativeConversationAgentRunner;
  try {
    runner =
      dependencies.runner ??
      dependencies.runner_factory?.() ??
      (() => {
        throw new FormativeConversationRuntimeError(
          "agent_call_failed",
          "The formative conversation opening runner is unavailable."
        );
      })();
  } catch (error) {
    const unavailable =
      formativeConversationUnavailableFromConfiguration(error);
    if (unavailable) {
      await recordFormativeConversationOpeningFailure({
        conversation_public_id: input.conversation_public_id,
        failure_code: unavailable.reason_code,
        retryable: unavailable.retryable
      });
      throw unavailable;
    }
    await recordFormativeConversationOpeningFailure({
      conversation_public_id: input.conversation_public_id,
      failure_code: "formative_conversation_opening_runner_failed",
      retryable: true
    });
    throw error;
  }

  let compiled: Awaited<
    ReturnType<typeof compilePersistedFormativeConversationContext>
  >;
  try {
    compiled = await compilePersistedFormativeConversationContext({
      conversation_public_id: input.conversation_public_id,
      ...input.context
    });
    if (
      compiled.context.latest_student_message !== null ||
      compiled.context.visible_transcript.length > 0
    ) {
      throw new FormativeConversationRuntimeError(
        "opening_requires_empty_transcript",
        "The formative conversation opening must precede all student and tutor turns."
      );
    }
    assertNoProhibitedProviderInput(compiled.context);
  } catch (error) {
    const requiresEmptyTranscript =
      error instanceof FormativeConversationRuntimeError &&
      error.code === "opening_requires_empty_transcript";
    await recordFormativeConversationOpeningFailure({
      conversation_public_id: input.conversation_public_id,
      failure_code: requiresEmptyTranscript
        ? error.code
        : "formative_conversation_opening_context_invalid",
      retryable: !requiresEmptyTranscript
    });
    throw error;
  }

  let agentResult: Awaited<ReturnType<typeof executeOrResumeAgentCall>>;
  try {
    agentResult = await executeOrResumeAgentCall({
      conversation_public_id: input.conversation_public_id,
      client_message_id: FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
      message_receipt_db_id: reservation.receipt.id,
      context: compiled.context,
      runner,
      attempt_index: reservation.opening_attempt
    });
  } catch (error) {
    const unavailable =
      formativeConversationUnavailableFromConfiguration(error);
    await recordFormativeConversationOpeningFailure({
      conversation_public_id: input.conversation_public_id,
      failure_code:
        unavailable?.reason_code ??
        (error instanceof FormativeConversationRuntimeError
          ? error.code
          : "formative_conversation_opening_generation_failed"),
      retryable: unavailable?.retryable ?? true
    });
    throw unavailable ?? error;
  }
  if (agentResult.resumed) {
    await recordRuntimeEvent({
      conversation_public_id: input.conversation_public_id,
      client_message_id: FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
      event_type: "agent_call_completed",
      event_source: "agent",
      attempt_index: reservation.opening_attempt,
      agent_call_db_id: agentResult.agent_call.id,
      agent_name: agentResult.agent_call.agent_name,
      retry_count: agentResult.agent_call.retry_count,
      occurred_at:
        agentResult.agent_call.completed_at ?? agentResult.agent_call.updated_at
    });
  }

  const openingValidation = validateFormativeConversationOpeningOutput(
    agentResult.output
  );
  if (!openingValidation.valid || !openingValidation.output) {
    await prisma.agentCall.update({
      where: { id: agentResult.agent_call.id },
      data: {
        output_validated: false,
        validation_error: JSON.stringify({
          category: "formative_conversation_opening_validation",
          issue_count: openingValidation.issue_codes.length,
          issue_codes: openingValidation.issue_codes
        }),
        error_category: "formative_conversation_opening_validation",
        call_status: "invalid_output"
      }
    });
    await recordFormativeConversationOpeningFailure({
      conversation_public_id: input.conversation_public_id,
      failure_code: "formative_conversation_opening_validation_failed",
      retryable: true
    });
    throw new FormativeConversationRuntimeError(
      "agent_output_invalid",
      "The formative conversation opening failed student-facing validation."
    );
  }

  let tutorMessage: Awaited<
    ReturnType<typeof persistFormativeConversationAssistantMessage>
  >;
  try {
    tutorMessage = await persistFormativeConversationAssistantMessage({
      conversation_public_id: input.conversation_public_id,
      client_message_id: FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
      message_text: openingValidation.output.student_visible_message,
      generation_source: agentResult.generation_source,
      validator_status: "opening_validated",
      agent_call_db_id: agentResult.agent_call.id,
      fallback_used: false,
      message_type: "formative_conversation_opening",
      opening_version: FORMATIVE_CONVERSATION_OPENING_VERSION
    });
  } catch (error) {
    await recordFormativeConversationOpeningFailure({
      conversation_public_id: input.conversation_public_id,
      failure_code: "formative_conversation_opening_persistence_failed",
      retryable: true
    });
    throw error;
  }
  await recordFormativeConversationTurnTelemetry({
    conversation_public_id: input.conversation_public_id,
    conversation_turn_db_id: tutorMessage.assistant_turn.id,
    agent_call_db_id: agentResult.agent_call.id,
    turn_started_at: agentResult.agent_call.started_at,
    turn_submitted_at: agentResult.agent_call.completed_at,
    response_time_ms: agentResult.agent_call.latency_ms,
    message_length_chars: tutorMessage.assistant_turn.message_text?.length ?? 0,
    input_token_count: agentResult.agent_call.input_tokens,
    output_token_count: agentResult.agent_call.output_tokens
  });
  await recordRuntimeEvent({
    conversation_public_id: input.conversation_public_id,
    client_message_id: FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID,
    event_type: "tutor_message_persisted",
    event_source: "backend",
    occurred_at: tutorMessage.assistant_turn.created_at
  });

  return {
    receipt: tutorMessage.receipt,
    tutor_turn: tutorMessage.assistant_turn,
    agent_call: agentResult.agent_call,
    replayed: false,
    resumed: agentResult.resumed
  };
}

export async function processFormativeConversationStudentMessage(
  input: {
    conversation_public_id: string;
    client_message_id: string;
    message_text: string;
    context: FormativeConversationRuntimeContextSeed;
    observable_input_telemetry?: FormativeConversationObservableInputTelemetry;
  },
  dependencies: {
    runner?: FormativeConversationAgentRunner;
    runner_factory?: () => FormativeConversationAgentRunner;
  }
) {
  const reservation =
    await reserveAndPersistFormativeConversationStudentMessage({
      conversation_public_id: input.conversation_public_id,
      client_message_id: input.client_message_id,
      message_text: input.message_text
    });
  const studentTurn = reservation.receipt.student_turn;
  if (!studentTurn) {
    throw new Error("formative_conversation_student_turn_missing");
  }

  await recordRuntimeEvent({
    conversation_public_id: input.conversation_public_id,
    client_message_id: input.client_message_id,
    event_type: "student_message_persisted",
    event_source: "backend",
    occurred_at: studentTurn.created_at
  });
  const submittedAt =
    input.observable_input_telemetry?.submitted_at ?? studentTurn.created_at;
  const existingTurnTelemetry =
    await prisma.formativeConversationTurnTelemetry.findUnique({
      where: { conversation_turn_db_id: studentTurn.id },
      select: { id: true }
    });
  if (!existingTurnTelemetry) {
    await recordFormativeConversationTurnTelemetry({
      conversation_public_id: input.conversation_public_id,
      conversation_turn_db_id: studentTurn.id,
      turn_started_at:
        input.observable_input_telemetry?.turn_started_at ?? null,
      turn_submitted_at: submittedAt,
      response_time_ms:
        input.observable_input_telemetry?.response_time_ms ?? null,
      message_length_chars: studentTurn.message_text?.length ?? 0,
      input_token_count: null,
      output_token_count: null
    });
  }
  const existingInputTelemetry =
    await prisma.formativeConversationInputTelemetry.findUnique({
      where: { conversation_turn_db_id: studentTurn.id },
      select: { id: true }
    });
  if (input.observable_input_telemetry && !existingInputTelemetry) {
    await recordFormativeConversationInputTelemetry({
      conversation_public_id: input.conversation_public_id,
      conversation_turn_db_id: studentTurn.id,
      client_message_id: input.client_message_id,
      typing_started_at:
        input.observable_input_telemetry.typing_started_at ?? null,
      typing_ended_at:
        input.observable_input_telemetry.typing_ended_at ?? null,
      typing_duration_ms:
        input.observable_input_telemetry.typing_duration_ms ?? null,
      typing_duration_method:
        input.observable_input_telemetry.typing_duration_method ?? null,
      edit_count: input.observable_input_telemetry.edit_count,
      backspace_count: input.observable_input_telemetry.backspace_count,
      paste_event_count: input.observable_input_telemetry.paste_event_count,
      paste_character_count:
        input.observable_input_telemetry.paste_character_count,
      final_message_length_chars: studentTurn.message_text?.length ?? 0,
      submitted_at: submittedAt
    });
  }

  const responseAttempt =
    await prepareFormativeConversationAssistantResponseAttempt({
      conversation_public_id: input.conversation_public_id,
      client_message_id: input.client_message_id
    });
  const responseReceipt = responseAttempt.receipt;
  if (responseReceipt.assistant_turn) {
    const existingCall = await prisma.agentCall.findUnique({
      where: {
        agent_invocation_key: formativeConversationInvocationKey(
          input.conversation_public_id,
          input.client_message_id,
          responseAttempt.attempt_index
        )
      }
    });
    const existingOutput =
      existingCall?.call_status === "succeeded" &&
      existingCall.output_validated &&
      existingCall.output_payload
        ? FormativeConversationAgentOutputSchema.safeParse(
            existingCall.output_payload
          )
        : null;
    const persistedEvidence =
      existingCall && existingOutput?.success
        ? await persistAgentProfileEvidence({
            conversation_public_id: input.conversation_public_id,
            source_agent_call_db_id: existingCall.id,
            source_tutor_turn_db_id: responseReceipt.assistant_turn.id,
            output: existingOutput.data
          })
        : null;
    const evidenceReferences =
      persistedEvidence?.evidence.references ??
      (existingCall
        ? await prisma.formativeConversationProfileEvidenceReference.findMany({
            where: { source_agent_call_db_id: existingCall.id },
            orderBy: { evidence_observation_index: "asc" }
          })
        : []);
    return {
      receipt: responseReceipt,
      student_turn: studentTurn,
      tutor_turn: responseReceipt.assistant_turn,
      agent_call: existingCall,
      evidence_references: evidenceReferences,
      profile_transition_recommendation:
        persistedEvidence?.profile_transition ?? null,
      profile_transition_rejection:
        persistedEvidence?.profile_transition_rejection ?? null,
      replayed: true,
      resumed: false
    };
  }

  let compiled: Awaited<
    ReturnType<typeof compilePersistedFormativeConversationContext>
  >;
  try {
    compiled = await compilePersistedFormativeConversationContext({
      conversation_public_id: input.conversation_public_id,
      ...input.context
    });
    assertNoProhibitedProviderInput(compiled.context);
  } catch {
    throw await persistTerminalAssistantResponseFailure({
      conversation_public_id: input.conversation_public_id,
      client_message_id: input.client_message_id,
      receipt_public_id: responseReceipt.receipt_public_id,
      attempt_index: responseAttempt.attempt_index,
      retry_count: responseReceipt.assistant_response_retry_count,
      failure_category: "context_compilation_failure"
    });
  }

  let runner: FormativeConversationAgentRunner;
  try {
    runner =
      dependencies.runner ??
      dependencies.runner_factory?.() ??
      (() => {
        throw new FormativeConversationRuntimeError(
          "agent_call_failed",
          "The formative conversation runner is unavailable."
        );
      })();
  } catch (error) {
    throw await persistTerminalAssistantResponseFailure({
      conversation_public_id: input.conversation_public_id,
      client_message_id: input.client_message_id,
      receipt_public_id: responseReceipt.receipt_public_id,
      attempt_index: responseAttempt.attempt_index,
      retry_count: responseReceipt.assistant_response_retry_count,
      failure_category: safeAssistantResponseFailureCategory(error)
    });
  }

  let agentResult: Awaited<ReturnType<typeof executeOrResumeAgentCall>>;
  try {
    agentResult = await executeOrResumeAgentCall({
      conversation_public_id: input.conversation_public_id,
      client_message_id: input.client_message_id,
      message_receipt_db_id: responseReceipt.id,
      context: compiled.context,
      runner,
      attempt_index: responseAttempt.attempt_index
    });
  } catch (error) {
    if (
      error instanceof FormativeConversationRuntimeError &&
      error.code === "agent_call_in_progress"
    ) {
      throw new FormativeConversationResponseGenerationError(
        responseReceipt.assistant_response_status === "retrying"
          ? "retrying"
          : "pending",
        responseReceipt.receipt_public_id,
        false
      );
    }
    const failedCall = await prisma.agentCall.findUnique({
      where: {
        agent_invocation_key: formativeConversationInvocationKey(
          input.conversation_public_id,
          input.client_message_id,
          responseAttempt.attempt_index
        )
      },
      select: {
        id: true,
        agent_name: true,
        call_status: true,
        completed_at: true,
        updated_at: true
      }
    });
    throw await persistTerminalAssistantResponseFailure({
      conversation_public_id: input.conversation_public_id,
      client_message_id: input.client_message_id,
      receipt_public_id: responseReceipt.receipt_public_id,
      attempt_index: responseAttempt.attempt_index,
      retry_count: responseReceipt.assistant_response_retry_count,
      failure_category: safeAssistantResponseFailureCategory(error),
      agent_call: failedCall
    });
  }
  if (agentResult.resumed) {
    await recordRuntimeEvent({
      conversation_public_id: input.conversation_public_id,
      client_message_id: input.client_message_id,
      event_type: "agent_call_completed",
      event_source: "agent",
      attempt_index: responseAttempt.attempt_index,
      agent_call_db_id: agentResult.agent_call.id,
      agent_name: agentResult.agent_call.agent_name,
      retry_count: agentResult.agent_call.retry_count,
      occurred_at:
        agentResult.agent_call.completed_at ?? agentResult.agent_call.updated_at
    });
  }

  let tutorMessage: Awaited<
    ReturnType<typeof persistFormativeConversationAssistantMessage>
  >;
  try {
    tutorMessage = await persistFormativeConversationAssistantMessage({
      conversation_public_id: input.conversation_public_id,
      client_message_id: input.client_message_id,
      message_text: agentResult.output.student_visible_message,
      generation_source: agentResult.generation_source,
      validator_status: "passed",
      agent_call_db_id: agentResult.agent_call.id,
      fallback_used: false
    });
  } catch {
    throw await persistTerminalAssistantResponseFailure({
      conversation_public_id: input.conversation_public_id,
      client_message_id: input.client_message_id,
      receipt_public_id: responseReceipt.receipt_public_id,
      attempt_index: responseAttempt.attempt_index,
      retry_count: responseReceipt.assistant_response_retry_count,
      failure_category: "assistant_response_persistence_failure",
      agent_call: agentResult.agent_call
    });
  }
  await recordFormativeConversationTurnTelemetry({
    conversation_public_id: input.conversation_public_id,
    conversation_turn_db_id: tutorMessage.assistant_turn.id,
    agent_call_db_id: agentResult.agent_call.id,
    turn_started_at: agentResult.agent_call.started_at,
    turn_submitted_at: agentResult.agent_call.completed_at,
    response_time_ms: agentResult.agent_call.latency_ms,
    message_length_chars: tutorMessage.assistant_turn.message_text?.length ?? 0,
    input_token_count: agentResult.agent_call.input_tokens,
    output_token_count: agentResult.agent_call.output_tokens
  });
  await recordRuntimeEvent({
    conversation_public_id: input.conversation_public_id,
    client_message_id: input.client_message_id,
    event_type: "tutor_message_persisted",
    event_source: "backend",
    occurred_at: tutorMessage.assistant_turn.created_at
  });

  const persistedEvidence = await persistAgentProfileEvidence({
    conversation_public_id: input.conversation_public_id,
    source_agent_call_db_id: agentResult.agent_call.id,
    source_tutor_turn_db_id: tutorMessage.assistant_turn.id,
    output: agentResult.output
  });

  return {
    receipt: tutorMessage.receipt,
    student_turn: studentTurn,
    tutor_turn: tutorMessage.assistant_turn,
    agent_call: agentResult.agent_call,
    evidence_references: persistedEvidence.evidence.references,
    profile_transition_recommendation:
      persistedEvidence.profile_transition,
    profile_transition_rejection:
      persistedEvidence.profile_transition_rejection,
    replayed: false,
    resumed: agentResult.resumed
  };
}
