import { createHash } from "node:crypto";
import type { Item, ItemResponse } from "@prisma/client";
import { z } from "zod";
import { executeOperationalAgent } from "@/lib/agents/operational/executor";
import { persistOperationalEffectiveResult } from "@/lib/agents/operational/effective-results";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { getLlmRuntimeConfig, LlmConfigurationError } from "@/lib/llm/config";
import { getGuardedOperationalAgentIntegrationReadiness } from "@/lib/operational/guarded-agent-integration";
import { logConversationTurn } from "@/lib/services/conversation-turns";
import { INCLUDED_ITEM_RANGE } from "@/lib/services/content/governance";
import { toPrismaJson } from "@/lib/services/json";
import { logProcessEvent } from "@/lib/services/process-events";
import {
  getStudentSessionState,
  InitialAdministrationStep
} from "@/lib/services/student-assessment/service";
import {
  assertStudentPayloadIsSafe,
  serializeStudentSafeItem
} from "@/lib/services/student-assessment/serializers";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";
import { buildResponseCollectionFallback, type ResponseCollectionFallbackReason } from "./fallback";
import { buildResponseCollectionInput } from "./input-builder";
import { validateResponseCollectionOutputSemantics } from "./semantic-validation";
import type { AgentInputByName, AgentOutputByName } from "@/lib/agents/contracts";

const initialMessageSchema = z.object({
  message: z.string().trim().min(1),
  client_message_id: z.string().trim().min(1).max(120)
}).strict();

type ResponseCollectionOutput = AgentOutputByName["response_collection_agent"];
type ResponseCollectionInput = AgentInputByName["response_collection_agent"];

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function responseMissingFields(
  response: Pick<
    ItemResponse,
    "selected_option" | "reasoning_text" | "confidence_rating" | "skipped_reasoning" | "skipped_confidence" | "skipped_item"
  > | null
) {
  const missing: Array<"answer" | "reasoning" | "confidence"> = [];

  if (!response || (!response.selected_option && !response.skipped_item)) {
    missing.push("answer");
  }

  if (
    !response?.skipped_item &&
    !response?.skipped_reasoning &&
    (!response?.reasoning_text || response.reasoning_text.trim().length === 0)
  ) {
    missing.push("reasoning");
  }

  if (!response?.skipped_item && !response?.skipped_confidence && !response?.confidence_rating) {
    missing.push("confidence");
  }

  return missing;
}

function itemSnapshot(item: Item) {
  return {
    item_public_id: item.item_public_id,
    item_order: item.item_order,
    item_stem: item.item_stem,
    options: item.options,
    correct_option: item.correct_option,
    version: item.version
  };
}

async function getOrCreateItemResponse(input: {
  concept_unit_session_db_id: string;
  item: Item;
}) {
  const existing = await prisma.itemResponse.findUnique({
    where: {
      concept_unit_session_db_id_item_db_id: {
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        item_db_id: input.item.id
      }
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.itemResponse.create({
    data: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      item_db_id: input.item.id,
      correct_option_snapshot: input.item.correct_option,
      correctness: "not_scored",
      item_started_at: new Date(),
      item_version_snapshot: input.item.version,
      item_snapshot: itemSnapshot(input.item)
    }
  });
}

async function getInitialMessageContext(input: {
  student_user_db_id: string;
  session_public_id: string;
}) {
  const session = await prisma.assessmentSession.findFirst({
    where: {
      session_public_id: input.session_public_id,
      user_db_id: input.student_user_db_id
    },
    include: {
      current_concept_unit: {
        include: {
          items: {
            where: {
              status: "published",
              included_in_published_set: true
            },
            orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
          }
        }
      }
    }
  });

  if (!session) {
    throw new StudentAssessmentServiceError(
      "session_not_owned",
      "Session was not found for this student.",
      403
    );
  }

  if (session.status === "completed" || session.current_phase === "session_completed") {
    throw new StudentAssessmentServiceError(
      "assessment_already_completed",
      "This assessment attempt is already completed.",
      409
    );
  }

  if (!["initial_item_administration", "missing_evidence_repair"].includes(session.current_phase)) {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "Initial free-text messages can be sent only during initial item administration.",
      409,
      { current_phase: session.current_phase }
    );
  }

  if (!session.current_concept_unit) {
    throw new StudentAssessmentServiceError(
      "current_concept_unit_unavailable",
      "No current concept unit is set for this session.",
      409
    );
  }

  const items = session.current_concept_unit.items;

  if (items.length < INCLUDED_ITEM_RANGE.min || items.length > INCLUDED_ITEM_RANGE.max) {
    throw new StudentAssessmentServiceError(
      "assessment_has_no_valid_published_concept_unit",
      "The current concept unit does not have a valid included item count.",
      409
    );
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit.id
      }
    },
    include: {
      item_responses: true
    }
  });

  if (!conceptUnitSession) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "Current concept-unit session was not found.",
      409
    );
  }

  if (conceptUnitSession.initial_completed_at || conceptUnitSession.status === "initial_completed") {
    throw new StudentAssessmentServiceError(
      "initial_response_locked_after_concept_completion",
      "Initial responses are locked after concept-unit completion.",
      409
    );
  }

  const responsesByItemId = new Map(
    conceptUnitSession.item_responses.map((response) => [response.item_db_id, response])
  );
  const firstMissingRepairItem = items.find((item) => {
    const response = responsesByItemId.get(item.id);
    return response?.missing_evidence_repair_offered && !response.item_submitted_at;
  });
  const firstIncompleteItem = items.find((item) => {
    const response = responsesByItemId.get(item.id);
    return !response?.item_submitted_at;
  });
  const currentItem =
    session.current_phase === "missing_evidence_repair"
      ? firstMissingRepairItem ?? firstIncompleteItem ?? null
      : firstIncompleteItem ?? null;

  if (!currentItem) {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "There is no current item that can receive an initial free-text message.",
      409
    );
  }

  const currentResponse = responsesByItemId.get(currentItem.id) ?? null;
  const recentTurns = await prisma.conversationTurn.findMany({
    where: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id
    },
    orderBy: [{ created_at: "asc" }],
    include: {
      item: {
        select: { item_public_id: true }
      }
    }
  });

  return {
    session,
    conceptUnitSession,
    item: currentItem,
    response: currentResponse,
    missingFields: responseMissingFields(currentResponse),
    recentTurns
  };
}

async function withInitialMessageIdempotency<T extends Record<string, unknown>>(input: {
  assessment_session_db_id: string;
  client_message_id: string;
  request_payload: unknown;
  run: () => Promise<T>;
}) {
  const requestHash = stableHash(input.request_payload);
  const where = {
    assessment_session_db_id_client_action_id: {
      assessment_session_db_id: input.assessment_session_db_id,
      client_action_id: input.client_message_id
    }
  };
  const existing = await prisma.studentActionIdempotencyKey.findUnique({ where });

  if (existing) {
    if (existing.action_type !== "initial_message" || existing.request_hash !== requestHash) {
      throw new StudentAssessmentServiceError(
        "idempotency_conflict",
        "The same client_message_id was used with different request content.",
        409
      );
    }

    if (existing.response_payload && typeof existing.response_payload === "object") {
      return existing.response_payload as T;
    }

    throw new StudentAssessmentServiceError(
      "session_start_conflict",
      "A matching message request is already in progress.",
      409
    );
  }

  const created = await prisma.studentActionIdempotencyKey.create({
    data: {
      assessment_session_db_id: input.assessment_session_db_id,
      client_action_id: input.client_message_id,
      action_type: "initial_message",
      request_hash: requestHash
    }
  });

  try {
    const response = await input.run();
    await prisma.studentActionIdempotencyKey.update({
      where: { id: created.id },
      data: { response_payload: toPrismaJson(response) }
    });
    return response;
  } catch (error) {
    await prisma.studentActionIdempotencyKey.delete({ where: { id: created.id } }).catch(() => null);
    throw error;
  }
}

async function runtimeReadinessForStudentWorkflow() {
  const env = getServerEnv();
  const integrationReadiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkDatabase: true
  });

  if (!integrationReadiness.allowed) {
    return {
      can_execute: false as const,
      fallback_reason: "operational_integration_disabled" as const
    };
  }

  try {
    const runtime = getLlmRuntimeConfig();

    if (runtime.provider === "mock" && !env.ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW) {
      return { can_execute: false as const, fallback_reason: "mock_provider_disabled" as const };
    }

    return { can_execute: true as const, provider: runtime.provider, mode: integrationReadiness.mode };
  } catch (error) {
    if (error instanceof LlmConfigurationError) {
      return { can_execute: false as const, fallback_reason: "live_provider_not_ready" as const };
    }

    throw error;
  }
}

function agentInvocationKey(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  item_db_id: string;
  client_message_id: string;
  agentInput: ResponseCollectionInput;
}) {
  const prompt = getPromptForAgent("response_collection_agent");

  return [
    "response_collection",
    input.assessment_session_db_id,
    input.concept_unit_session_db_id,
    input.item_db_id,
    input.client_message_id,
    prompt.prompt_version,
    prompt.schema_version,
    prompt.prompt_hash,
    stableHash(input.agentInput)
  ].join(":");
}

async function runAgentOrFallback(input: {
  context: Awaited<ReturnType<typeof getInitialMessageContext>>;
  agentInput: ResponseCollectionInput;
  client_message_id: string;
  student_message: string;
  has_existing_reasoning: boolean;
}) {
  if (input.context.session.response_collection_mode_snapshot !== "llm_assisted") {
    return {
      output: buildResponseCollectionFallback({
        student_message: input.student_message,
        has_existing_reasoning: input.has_existing_reasoning,
        fallback_reason: "deterministic_mode"
      }),
      usedFallback: true,
      fallbackReason: "deterministic_mode" as ResponseCollectionFallbackReason,
      agentCallCreated: false
    };
  }

  const readiness = await runtimeReadinessForStudentWorkflow();

  if (!readiness.can_execute) {
    const invocationKey = agentInvocationKey({
      assessment_session_db_id: input.context.session.id,
      concept_unit_session_db_id: input.context.conceptUnitSession.id,
      item_db_id: input.context.item.id,
      client_message_id: input.client_message_id,
      agentInput: input.agentInput
    });
    const fallbackOutput = buildResponseCollectionFallback({
      student_message: input.student_message,
      has_existing_reasoning: input.has_existing_reasoning,
      fallback_reason: readiness.fallback_reason
    });

    await persistOperationalEffectiveResult({
      agent_name: "response_collection_agent",
      operational_context_type: "initial_item_free_text",
      operational_context_public_id: input.context.item.item_public_id,
      invocation_key: invocationKey,
      deterministic_guard_version: "response-collection-backend-controls-v1",
      canonicalization_version: "response-collection-canonical-v1",
      fallback_version: "response-collection-fallback-v1",
      raw_output_status: "blocked",
      raw_semantic_status: "not_run",
      effective_semantic_status: "pass",
      effective_overall_status: "fallback_safe",
      effective_student_facing_usable: true,
      effective_workflow_usable: true,
      deterministic_guard_applied: true,
      canonicalization_applied: true,
      fallback_applied: true,
      effective_output: fallbackOutput,
      effective_actions: {
        option_control_backend_owned: true,
        confidence_control_backend_owned: true,
        fallback_reason: readiness.fallback_reason
      },
      warnings: ["Deterministic response-collection fallback was used before provider execution."]
    });

    return {
      output: fallbackOutput,
      usedFallback: true,
      fallbackReason: readiness.fallback_reason,
      agentCallCreated: false
    };
  }

  await logProcessEvent({
    assessment_session_db_id: input.context.session.id,
    concept_unit_session_db_id: input.context.conceptUnitSession.id,
    item_db_id: input.context.item.id,
    event_type: "response_collection_agent_invoked",
    event_category: "initial_administration",
    event_source: "backend",
    payload: {
      mode_snapshot: input.context.session.response_collection_mode_snapshot,
      provider: readiness.provider
    }
  });

  const invocationKey = agentInvocationKey({
    assessment_session_db_id: input.context.session.id,
    concept_unit_session_db_id: input.context.conceptUnitSession.id,
    item_db_id: input.context.item.id,
    client_message_id: input.client_message_id,
    agentInput: input.agentInput
  });
  const result = await executeOperationalAgent({
    agentName: "response_collection_agent",
    allowlistedInput: input.agentInput,
    invocationKey,
    operationalContext: {
      assessment_session_db_id: input.context.session.id,
      concept_unit_session_db_id: input.context.conceptUnitSession.id
    },
    metadata: {
      classroom_workflow: "student_initial_administration",
      mock_mode: "response_collection_reasoning"
    }
  });

  if (result.status === "succeeded") {
    const semantic = validateResponseCollectionOutputSemantics({
      output: result.output,
      student_message: input.student_message,
      assistant_message_max_chars: getServerEnv().INITIAL_CHAT_MESSAGE_MAX_CHARS,
      has_existing_reasoning: input.has_existing_reasoning,
      collected_response_state: input.agentInput.collected_response_state,
      missing_evidence_state: input.agentInput.missing_evidence_state
    });

    if (semantic.ok) {
      await persistOperationalEffectiveResult({
        agent_call_db_id: result.agent_call_id,
        agent_name: "response_collection_agent",
        operational_context_type: "initial_item_free_text",
        operational_context_public_id: input.context.item.item_public_id,
        invocation_key: invocationKey,
        deterministic_guard_version: "response-collection-backend-controls-v1",
        canonicalization_version: "response-collection-canonical-v1",
        raw_output_status: "succeeded",
        raw_semantic_status: "pass",
        effective_semantic_status: "pass",
        effective_overall_status: "pass",
        effective_student_facing_usable: true,
        effective_workflow_usable: true,
        deterministic_guard_applied: true,
        canonicalization_applied: true,
        effective_output: result.output,
        effective_actions: {
          option_control_backend_owned: true,
          confidence_control_backend_owned: true,
          reasoning_segments_exact: true
        }
      });
      await logProcessEvent({
        assessment_session_db_id: input.context.session.id,
        concept_unit_session_db_id: input.context.conceptUnitSession.id,
        item_db_id: input.context.item.id,
        event_type: "schema_validation_succeeded",
        event_category: "agent_validation",
        event_source: "backend",
        payload: { agent_name: "response_collection_agent" }
      });
      await logProcessEvent({
        assessment_session_db_id: input.context.session.id,
        concept_unit_session_db_id: input.context.conceptUnitSession.id,
        item_db_id: input.context.item.id,
        event_type: "response_collection_agent_succeeded",
        event_category: "initial_administration",
        event_source: "backend",
        payload: { agent_call_recorded: true }
      });

      return {
        output: result.output,
        usedFallback: false,
        fallbackReason: null,
        agentCallCreated: true
      };
    }

    await logProcessEvent({
      assessment_session_db_id: input.context.session.id,
      concept_unit_session_db_id: input.context.conceptUnitSession.id,
      item_db_id: input.context.item.id,
      event_type: "schema_validation_failed",
      event_category: "agent_validation",
      event_source: "backend",
      payload: {
        agent_name: "response_collection_agent",
        semantic_issues: semantic.issues
      }
    });
  }

  await logProcessEvent({
    assessment_session_db_id: input.context.session.id,
    concept_unit_session_db_id: input.context.conceptUnitSession.id,
    item_db_id: input.context.item.id,
    event_type: "response_collection_agent_failed",
    event_category: "initial_administration",
    event_source: "backend",
    payload: {
      result_status: result.status,
      agent_call_recorded: "agent_call_id" in result && Boolean(result.agent_call_id)
    }
  });

  const fallbackReason =
    result.status === "blocked_by_usage_limit"
      ? ("usage_blocked" as const)
      : result.status === "blocked_by_operational_guard"
        ? ("operational_integration_disabled" as const)
        : ("agent_execution_failed" as const);
  const fallbackOutput = buildResponseCollectionFallback({
    student_message: input.student_message,
    has_existing_reasoning: input.has_existing_reasoning,
    fallback_reason: fallbackReason
  });

  await persistOperationalEffectiveResult({
    agent_call_db_id: "agent_call_id" in result ? result.agent_call_id : null,
    agent_name: "response_collection_agent",
    operational_context_type: "initial_item_free_text",
    operational_context_public_id: input.context.item.item_public_id,
    invocation_key: invocationKey,
    deterministic_guard_version: "response-collection-backend-controls-v1",
    canonicalization_version: "response-collection-canonical-v1",
    fallback_version: "response-collection-fallback-v1",
    raw_output_status: result.status,
    raw_semantic_status: result.status === "succeeded" ? "fail" : "not_run",
    effective_semantic_status: "pass",
    effective_overall_status: "fallback_safe",
    effective_student_facing_usable: true,
    effective_workflow_usable: true,
    deterministic_guard_applied: true,
    canonicalization_applied: true,
    fallback_applied: true,
    effective_output: fallbackOutput,
    effective_actions: {
      option_control_backend_owned: true,
      confidence_control_backend_owned: true,
      fallback_reason: fallbackReason
    },
    warnings: ["Deterministic response-collection fallback was used."]
  });

  return {
    output: fallbackOutput,
    usedFallback: true,
    fallbackReason,
    agentCallCreated: "agent_call_id" in result && Boolean(result.agent_call_id)
  };
}

async function persistReasoningIfPresent(input: {
  context: Awaited<ReturnType<typeof getInitialMessageContext>>;
  output: ResponseCollectionOutput;
}) {
  if (input.output.reasoning_evidence_segments.length === 0) {
    return { reasoning_saved: false };
  }

  const reasoningText = input.output.reasoning_evidence_segments.join("\n").trim();

  if (!reasoningText) {
    return { reasoning_saved: false };
  }

  const response = await getOrCreateItemResponse({
    concept_unit_session_db_id: input.context.conceptUnitSession.id,
    item: input.context.item
  });
  const hadReasoning = Boolean(response.reasoning_text?.trim());
  const reasoningChanged = response.reasoning_text !== null && response.reasoning_text !== reasoningText;

  await prisma.itemResponse.update({
    where: { id: response.id },
    data: {
      reasoning_text: reasoningText,
      skipped_reasoning: false,
      revision_count: reasoningChanged ? { increment: 1 } : undefined
    }
  });
  await logProcessEvent({
    assessment_session_db_id: input.context.session.id,
    concept_unit_session_db_id: input.context.conceptUnitSession.id,
    item_db_id: input.context.item.id,
    event_type: hadReasoning ? "reasoning_revised" : "reasoning_entered",
    event_category: "initial_administration",
    event_source: "backend",
    payload: {
      item_public_id: input.context.item.item_public_id,
      source: "response_collection_agent",
      revised: hadReasoning
    }
  });
  await logProcessEvent({
    assessment_session_db_id: input.context.session.id,
    concept_unit_session_db_id: input.context.conceptUnitSession.id,
    item_db_id: input.context.item.id,
    event_type: "response_collection_reasoning_extracted",
    event_category: "initial_administration",
    event_source: "backend",
    payload: {
      item_public_id: input.context.item.item_public_id,
      segment_count: input.output.reasoning_evidence_segments.length
    }
  });

  return { reasoning_saved: true };
}

async function logOutputEvents(input: {
  context: Awaited<ReturnType<typeof getInitialMessageContext>>;
  output: ResponseCollectionOutput;
}) {
  for (const event of input.output.events_to_log) {
    await logProcessEvent({
      assessment_session_db_id: input.context.session.id,
      concept_unit_session_db_id: input.context.conceptUnitSession.id,
      item_db_id: input.context.item.id,
      event_type: event.event_type,
      event_category: event.event_category,
      event_source: event.event_source,
      payload: event.payload ?? undefined
    });
  }
}

export async function sendInitialAdministrationMessage(input: {
  student_user_db_id: string;
  session_public_id: string;
  data: unknown;
}) {
  const env = getServerEnv();
  const data = initialMessageSchema.parse(input.data);

  if (data.message.length > env.INITIAL_CHAT_MESSAGE_MAX_CHARS) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "The message is too long.",
      400,
      { max_chars: env.INITIAL_CHAT_MESSAGE_MAX_CHARS }
    );
  }

  const context = await getInitialMessageContext(input);

  return withInitialMessageIdempotency({
    assessment_session_db_id: context.session.id,
    client_message_id: data.client_message_id,
    request_payload: data,
    run: async () => {
      const now = new Date();
      const currentResponse = context.response;
      const hasExistingReasoning = Boolean(currentResponse?.reasoning_text?.trim());
      const safeItem = serializeStudentSafeItem(context.item, currentResponse);
      const agentInput = buildResponseCollectionInput({
        current_phase: context.session.current_phase,
        current_item_student_safe: safeItem,
        student_message: data.message,
        selected_option: currentResponse?.selected_option ?? null,
        reasoning_text: currentResponse?.reasoning_text ?? null,
        confidence_rating: currentResponse?.confidence_rating ?? null,
        skipped_item: currentResponse?.skipped_item ?? false,
        skipped_reasoning: currentResponse?.skipped_reasoning ?? false,
        skipped_confidence: currentResponse?.skipped_confidence ?? false,
        revision_count: currentResponse?.revision_count ?? 0,
        missing_fields: context.missingFields,
        recent_turns: context.recentTurns
      });

      await logConversationTurn({
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        phase: context.session.current_phase,
        actor_type: "student",
        message_text: data.message,
        structured_payload: {
          source: "initial_free_text",
          client_message_id: data.client_message_id,
          item_public_id: context.item.item_public_id
        },
        created_at: now
      });

      const { output, usedFallback, fallbackReason, agentCallCreated } = await runAgentOrFallback({
        context,
        agentInput,
        client_message_id: data.client_message_id,
        student_message: data.message,
        has_existing_reasoning: hasExistingReasoning
      });

      if (usedFallback) {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "response_collection_fallback_used",
          event_category: "initial_administration",
          event_source: "backend",
          payload: {
            fallback_reason: fallbackReason,
            agent_call_recorded: agentCallCreated
          }
        });
      }

      const reasoning = await persistReasoningIfPresent({ context, output });
      if (!reasoning.reasoning_saved && output.reasoning_capture_status !== "none") {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "response_collection_reasoning_extraction_failed",
          event_category: "initial_administration",
          event_source: "backend",
          payload: { reason: "no_valid_reasoning_segment" }
        });
      }
      await logOutputEvents({ context, output });
      await logConversationTurn({
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        phase: context.session.current_phase,
        actor_type: usedFallback ? "system" : "agent",
        agent_name: usedFallback ? "deterministic_response_collection_fallback" : "response_collection_agent",
        message_text: output.assistant_message,
        structured_payload: {
          source: usedFallback ? "deterministic_fallback" : "response_collection_agent",
          fallback_reason: fallbackReason,
          reasoning_saved: reasoning.reasoning_saved,
          requires_structured_controls:
            output.requires_option_button || output.requires_confidence_control,
          requested_control_action: output.requested_control_action
        },
        created_at: new Date()
      });
      await prisma.assessmentSession.update({
        where: { id: context.session.id },
        data: { last_activity_at: new Date() }
      });

      const state = await getStudentSessionState({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id
      });
      const result = {
        message_status: usedFallback ? "fallback_replied" : "assistant_replied",
        assistant_message: output.assistant_message,
        reasoning_saved: reasoning.reasoning_saved,
        state
      };

      assertStudentPayloadIsSafe(result);
      const nextStep = InitialAdministrationStep.safeParse(state.next_step);

      if (!nextStep.success) {
        throw new StudentAssessmentServiceError(
          "invalid_phase_for_action",
          "Initial message created an invalid student state.",
          500
        );
      }

      return result;
    }
  });
}
