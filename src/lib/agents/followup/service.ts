import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AgentOutputByName } from "@/lib/agents/contracts";
import { ProcessEventTypeSchema } from "@/lib/domain/enums";
import type { MockProviderMode } from "@/lib/llm/providers/mock-provider";
import { executeOperationalAgent } from "@/lib/agents/operational/executor";
import { persistOperationalEffectiveResult } from "@/lib/agents/operational/effective-results";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { logConversationTurn } from "@/lib/services/conversation-turns";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";
import { toPrismaJson } from "@/lib/services/json";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";
import {
  getFollowupContextConfig,
  isPromptInjectionLike
} from "./context";
import { buildFollowupInput } from "./input-builder";
import {
  FollowupSemanticValidationError,
  trustedFollowupEventTypes,
  validateFollowupSemantics
} from "./semantic-validation";
import {
  serializeFollowupRoundForTeacher,
  serializeFollowupStateForStudent
} from "./serializers";
import {
  handleFollowupAssistantEvidence,
  requestStopFollowupWithPossibleFinalUpdate
} from "@/lib/agents/followup-updates/service";
import {
  getFormativeLoopGuardDecision,
  stopFollowupForFormativeLoopGuard
} from "@/lib/services/student-assessment/formative-loop-guard";

export class FollowupServiceError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "FollowupServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type FollowupOutput = AgentOutputByName["followup_agent"];

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function failureMessage() {
  return "The follow-up reply is not available right now. Your message was saved, and you can try again later.";
}

function containsMoveOnRequest(message: string | null | undefined) {
  return /\b(done|finished|move on|continue|next|ready to proceed|go ahead)\b/i.test(
    message ?? ""
  );
}

function isOffTopicMessage(message: string | null | undefined) {
  return /\b(off[-\s]?topic|unrelated|talk about something else)\b/i.test(message ?? "");
}

function defaultFollowupAction(value: string): {
  followup_action_type: FollowupOutput["followup_action_type"];
  assistant_message: string;
  evidence_request: string | null;
} {
  const byValue: Record<string, {
    followup_action_type: FollowupOutput["followup_action_type"];
    assistant_message: string;
    evidence_request: string | null;
  }> = {
    diagnostic_clarification: {
      followup_action_type: "clarification_prompt",
      assistant_message:
        "Please return to the current assessment task and add one clear sentence about your reasoning.",
      evidence_request: "Explain your reasoning for the current assessment task."
    },
    reasoning_refinement: {
      followup_action_type: "reasoning_refinement_prompt",
      assistant_message:
        "Please refine your explanation for the current assessment task and make the reasoning steps clear.",
      evidence_request: "Revise or extend your reasoning."
    },
    confidence_calibration: {
      followup_action_type: "confidence_calibration_prompt",
      assistant_message:
        "Please explain how your confidence connects to the evidence or reasoning you gave.",
      evidence_request: "Connect your confidence rating to your reasoning."
    },
    independent_understanding_verification: {
      followup_action_type: "independent_verification_prompt",
      assistant_message:
        "Please restate your reasoning for the current task in your own words.",
      evidence_request: "Restate your reasoning independently."
    },
    consolidation_or_transfer: {
      followup_action_type: "transfer_task",
      assistant_message:
        "Please apply the same reasoning approach to a similar generic situation and explain how it fits.",
      evidence_request: "Apply the reasoning pattern to a similar case."
    }
  };

  return byValue[value] ?? byValue.diagnostic_clarification;
}

function deterministicFollowupFallback(input: {
  built: Awaited<ReturnType<typeof buildFollowupInput>>;
  turn_type: "opening" | "student_reply";
  reason: string;
}): FollowupOutput {
  const studentMessage = input.built.input.student_message;
  const moveOn = input.turn_type === "student_reply" && containsMoveOnRequest(studentMessage);
  const offTopic = input.turn_type === "student_reply" && !moveOn && isOffTopicMessage(studentMessage);
  const action = moveOn
    ? {
        followup_action_type: "move_on_offer" as const,
        assistant_message:
          "You can move on when you are ready. I will save the current evidence and prepare the next step.",
        evidence_request: null
      }
    : offTopic
      ? {
          followup_action_type: "off_topic_redirect" as const,
          assistant_message:
            "Let's return to the current assessment task. You can continue with the current question or explain your reasoning.",
          evidence_request: null
        }
      : defaultFollowupAction(input.built.current_formative_value);

  return {
    agent_name: "followup_agent",
    agent_version: "deterministic-fallback",
    prompt_version: "followup-deterministic-fallback-v1",
    schema_version: "followup-output-v4",
    output_status: "ok",
    warnings: [`Deterministic effective fallback applied: ${input.reason}`],
    assistant_message: action.assistant_message,
    followup_action_type: action.followup_action_type,
    target_formative_value: input.built.current_formative_value as FollowupOutput["target_formative_value"],
    evidence_request: action.evidence_request,
    expects_student_response: !moveOn,
    evidence_trigger_candidate: moveOn,
    student_turn_substantive: false,
    evidence_trigger_reasons: moveOn ? ["move_on_request"] : [],
    should_offer_move_on: moveOn,
    off_topic_detected: offTopic,
    events_to_log: moveOn
      ? []
      : [
          {
            event_type: offTopic ? "off_topic_followup" : "followup_task_assigned",
            event_category: "followup",
            event_source: "agent",
            payload: {
              detail: "Deterministic operational fallback used.",
              reason: input.reason,
              item_public_id: null,
              followup_round_index: null,
              event_count: null
            }
          }
        ]
  };
}

function followupContextPublicId(built: Awaited<ReturnType<typeof buildFollowupInput>>) {
  const metadata = built.input.concept_unit_metadata as {
    assessment_session?: { session_public_id?: string };
    concept_unit?: { concept_unit_public_id?: string };
  };
  const round = built.input.current_followup_round as { round_index?: number };

  return [
    metadata.assessment_session?.session_public_id ?? "unknown_session",
    metadata.concept_unit?.concept_unit_public_id ?? "unknown_concept_unit",
    `round_${round.round_index ?? "unknown"}`
  ].join(":");
}

async function activeRoundForConceptUnitSession(conceptUnitSessionDbId: string) {
  return prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSessionDbId,
      status: "active"
    },
    orderBy: [{ round_index: "desc" }],
    include: {
      formative_decision: {
        select: {
          formative_value: true,
          created_at: true
        }
      },
      conversation_turns: {
        orderBy: [{ sequence_index: "asc" }],
        select: {
          actor_type: true,
          agent_name: true,
          message_text: true,
          structured_payload: true,
          created_at: true
        }
      },
      agent_calls: {
        where: { agent_name: "followup_agent" },
        orderBy: [{ created_at: "asc" }],
        select: {
          agent_name: true,
          provider: true,
          model_name: true,
          agent_version: true,
          prompt_version: true,
          schema_version: true,
          prompt_hash: true,
          retry_count: true,
          call_status: true,
          output_validated: true,
          live_call_allowed: true,
          blocked_reason: true,
          latency_ms: true,
          input_tokens: true,
          output_tokens: true,
          total_tokens: true,
          created_at: true,
          completed_at: true
        }
      }
    }
  });
}

async function serializeStudentFollowupStateByRound(roundDbId: string) {
  const config = getFollowupContextConfig();
  const round = await prisma.followupRound.findUniqueOrThrow({
    where: { id: roundDbId },
    include: {
      concept_unit_session: {
        select: {
          assessment_session: {
            select: {
              session_public_id: true,
              current_phase: true
            }
          }
        }
      },
      conversation_turns: {
        orderBy: [{ sequence_index: "asc" }],
        where: {
          phase: {
            in: ["followup_active", "followup_stopped"]
          }
        },
        select: {
          actor_type: true,
          message_text: true,
          created_at: true
        }
      }
    }
  });

  return serializeFollowupStateForStudent({
    session_public_id: round.concept_unit_session.assessment_session.session_public_id,
    phase: round.concept_unit_session.assessment_session.current_phase,
    round,
    turns: round.conversation_turns,
    message_max_chars: config.message_max_chars
  });
}

async function logFollowupEvent(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  event_type:
    | "followup_started"
    | "followup_turn_completed"
    | "followup_task_assigned"
    | "off_topic_followup"
    | "followup_stopped"
    | "prompt_injection_attempt"
    | "agent_call_started"
    | "agent_call_succeeded"
    | "agent_call_failed"
    | "schema_validation_succeeded"
    | "schema_validation_failed";
  payload?: Record<string, unknown>;
}) {
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: input.event_type,
    event_category: input.event_type.startsWith("agent_call")
      ? "agent_execution"
      : input.event_type.startsWith("schema_validation")
        ? "agent_execution"
        : "followup",
    event_source: input.event_type.startsWith("agent_call") ? "agent" : "backend",
    payload: input.payload,
    occurred_at: new Date()
  });
}

async function logAgentProposedEvents(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  events: Array<{
    event_type: string;
    event_category: string;
    event_source: string;
    payload?: Record<string, unknown> | null;
  }>;
}) {
  const allowlist = new Set(trustedFollowupEventTypes());

  for (const event of input.events) {
    if (!allowlist.has(event.event_type)) {
      continue;
    }

    const eventType = ProcessEventTypeSchema.parse(event.event_type);

    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_type: eventType,
      event_category: event.event_category || "followup",
      event_source: "backend",
      payload: {
        ...(event.payload ?? {}),
        proposed_by_agent: true
      },
      occurred_at: new Date()
    });
  }
}

async function runFollowupAgent(input: {
  followup_round_db_id: string;
  turn_type: "opening" | "student_reply";
  student_turn_db_id?: string | null;
  invocation_reason: string;
  mock_provider_mode?: MockProviderMode;
}) {
  const built = await buildFollowupInput({
    followup_round_db_id: input.followup_round_db_id,
    turn_type: input.turn_type,
    student_turn_db_id: input.student_turn_db_id
  });

  await logFollowupEvent({
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    event_type: "agent_call_started",
    payload: {
      agent_name: "followup_agent",
      turn_type: input.turn_type,
      agent_invocation_key: built.agent_invocation_key
    }
  });

  const result = await executeOperationalAgent({
    agentName: "followup_agent",
    allowlistedInput: built.input,
    invocationKey: built.agent_invocation_key,
    operationalContext: {
      assessment_session_db_id: built.assessment_session_db_id,
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      followup_round_db_id: built.followup_round_db_id
    },
    metadata: {
      invocation_reason: input.invocation_reason,
      turn_type: input.turn_type,
      ...(input.mock_provider_mode ? { mock_mode: input.mock_provider_mode } : {})
    }
  });

  if (result.status !== "succeeded") {
    await logFollowupEvent({
      assessment_session_db_id: built.assessment_session_db_id,
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      event_type:
        result.status === "invalid_output" ? "schema_validation_failed" : "agent_call_failed",
      payload: {
        agent_name: "followup_agent",
        result_status: result.status,
        agent_call_id: "agent_call_id" in result ? result.agent_call_id : null
      }
    });

    const fallbackOutput = deterministicFollowupFallback({
      built,
      turn_type: input.turn_type,
      reason: result.status
    });
    const semantic = validateFollowupSemantics({
      output: fallbackOutput,
      current_formative_value: built.current_formative_value,
      config: built.config,
      turn_type: input.turn_type,
      student_message: built.input.student_message
    });

    await persistOperationalEffectiveResult({
      agent_call_db_id: "agent_call_id" in result ? result.agent_call_id : null,
      agent_name: "followup_agent",
      operational_context_type: `followup_${input.turn_type}`,
      operational_context_public_id: followupContextPublicId(built),
      invocation_key: built.agent_invocation_key,
      deterministic_guard_version: "followup-effective-guard-v1",
      canonicalization_version: "followup-effective-canonical-v1",
      fallback_version: "followup-move-on-fallback-v2",
      raw_output_status: result.status,
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
        target_formative_value_preserved: true,
        move_on_request: fallbackOutput.should_offer_move_on,
        evidence_trigger_candidate: fallbackOutput.evidence_trigger_candidate
      },
      warnings: [...fallbackOutput.warnings, ...semantic.warnings]
    });

    return {
      status: "succeeded" as const,
      output: fallbackOutput,
      built,
      agent_call_id: "agent_call_id" in result ? result.agent_call_id : null
    };
  }

  try {
    const semantic = validateFollowupSemantics({
      output: result.output,
      current_formative_value: built.current_formative_value,
      config: built.config,
      turn_type: input.turn_type,
      student_message: built.input.student_message
    });

    await logFollowupEvent({
      assessment_session_db_id: built.assessment_session_db_id,
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      event_type: "schema_validation_succeeded",
      payload: {
        agent_name: "followup_agent",
        agent_call_id: result.agent_call_id,
        warnings: semantic.warnings
      }
    });

    await persistOperationalEffectiveResult({
      agent_call_db_id: result.agent_call_id,
      agent_name: "followup_agent",
      operational_context_type: `followup_${input.turn_type}`,
      operational_context_public_id: followupContextPublicId(built),
      invocation_key: built.agent_invocation_key,
      deterministic_guard_version: "followup-effective-guard-v1",
      canonicalization_version: "followup-effective-canonical-v1",
      raw_output_status: "succeeded",
      raw_semantic_status: "pass",
      effective_semantic_status: "pass",
      effective_overall_status: "pass",
      effective_student_facing_usable: true,
      effective_workflow_usable: true,
      deterministic_guard_applied: true,
      canonicalization_applied: false,
      effective_output: result.output,
      effective_actions: {
        target_formative_value_preserved: true,
        move_on_request: result.output.should_offer_move_on,
        evidence_trigger_candidate: result.output.evidence_trigger_candidate
      },
      warnings: semantic.warnings
    });

    return {
      status: "succeeded" as const,
      output: result.output,
      built,
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count,
      warnings: semantic.warnings
    };
  } catch (error) {
    const issues =
      error instanceof FollowupSemanticValidationError
        ? error.issues
        : ["semantic validation failed"];

    await prisma.agentCall.update({
      where: { id: result.agent_call_id },
      data: {
        output_validated: false,
        call_status: "invalid_output",
        error_category: "semantic_validation",
        validation_error: issues.join("; "),
        output_payload: Prisma.JsonNull,
        raw_output: toPrismaJson(result.output) ?? Prisma.JsonNull
      }
    });
    await logFollowupEvent({
      assessment_session_db_id: built.assessment_session_db_id,
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      event_type: "schema_validation_failed",
      payload: {
        agent_name: "followup_agent",
        agent_call_id: result.agent_call_id,
        issues
      }
    });

    const fallbackOutput = deterministicFollowupFallback({
      built,
      turn_type: input.turn_type,
      reason: "semantic_validation_failed"
    });
    const fallbackSemantic = validateFollowupSemantics({
      output: fallbackOutput,
      current_formative_value: built.current_formative_value,
      config: built.config,
      turn_type: input.turn_type,
      student_message: built.input.student_message
    });

    await persistOperationalEffectiveResult({
      agent_call_db_id: result.agent_call_id,
      agent_name: "followup_agent",
      operational_context_type: `followup_${input.turn_type}`,
      operational_context_public_id: followupContextPublicId(built),
      invocation_key: built.agent_invocation_key,
      deterministic_guard_version: "followup-effective-guard-v1",
      canonicalization_version: "followup-effective-canonical-v1",
      fallback_version: "followup-move-on-fallback-v2",
      raw_output_status: "semantic_validation_failed",
      raw_semantic_status: "fail",
      effective_semantic_status: "pass",
      effective_overall_status: "fallback_safe",
      effective_student_facing_usable: true,
      effective_workflow_usable: true,
      deterministic_guard_applied: true,
      canonicalization_applied: true,
      fallback_applied: true,
      effective_output: fallbackOutput,
      effective_actions: {
        target_formative_value_preserved: true,
        move_on_request: fallbackOutput.should_offer_move_on,
        evidence_trigger_candidate: fallbackOutput.evidence_trigger_candidate,
        semantic_validation_issues: issues
      },
      warnings: [...fallbackOutput.warnings, ...fallbackSemantic.warnings]
    });

    return {
      status: "succeeded" as const,
      output: fallbackOutput,
      built,
      agent_call_id: result.agent_call_id,
      semantic_validation_issues: issues
    };
  }
}

async function persistAssistantTurn(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  followup_round_db_id: string;
  agent_call_id: string | null;
  output: NonNullable<Awaited<ReturnType<typeof runFollowupAgent>>["output"]>;
  reply_to_client_message_id?: string | null;
}) {
  const turn = await logConversationTurn({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    followup_round_db_id: input.followup_round_db_id,
    phase: "followup_active",
    actor_type: "agent",
    agent_name: "followup_agent",
    message_text: input.output.assistant_message,
    structured_payload: {
      agent_call_id: input.agent_call_id,
      reply_to_client_message_id: input.reply_to_client_message_id ?? null,
      followup_action_type: input.output.followup_action_type,
      target_formative_value: input.output.target_formative_value,
      evidence_request: input.output.evidence_request ?? null,
      expects_student_response: input.output.expects_student_response,
      evidence_trigger_candidate: input.output.evidence_trigger_candidate,
      student_turn_substantive: input.output.student_turn_substantive,
      evidence_trigger_reasons: input.output.evidence_trigger_reasons,
      should_offer_move_on: input.output.should_offer_move_on,
      off_topic_detected: input.output.off_topic_detected
    }
  });

  await logAgentProposedEvents({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    events: input.output.events_to_log
  });
  await logFollowupEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "agent_call_succeeded",
    payload: {
      agent_name: "followup_agent",
      agent_call_id: input.agent_call_id
    }
  });
  await logFollowupEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: "followup_turn_completed",
    payload: {
      actor_type: "agent",
      agent_call_id: input.agent_call_id,
      evidence_trigger_candidate: input.output.evidence_trigger_candidate,
      student_turn_substantive: input.output.student_turn_substantive,
      evidence_trigger_reasons: input.output.evidence_trigger_reasons,
      should_offer_move_on: input.output.should_offer_move_on,
      off_topic_detected: input.output.off_topic_detected
    }
  });

  return turn;
}

async function conceptUnitSessionForTeacherRoute(input: {
  session_public_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnitSession = await prisma.conceptUnitSession.findFirst({
    where: {
      assessment_session: { session_public_id: input.session_public_id },
      concept_unit: { concept_unit_public_id: input.concept_unit_public_id }
    },
    include: {
      assessment_session: {
        select: {
          id: true,
          session_public_id: true,
          current_phase: true
        }
      },
      concept_unit: {
        select: {
          concept_unit_public_id: true
        }
      },
      latest_student_profile: { select: { id: true } },
      latest_formative_decision: { select: { id: true } }
    }
  });

  if (!conceptUnitSession) {
    throw new FollowupServiceError(
      "concept_unit_session_not_found",
      "Concept-unit session was not found for this assessment session.",
      404,
      input
    );
  }

  return conceptUnitSession;
}

export async function startFollowupRoundForTeacher(input: {
  session_public_id: string;
  concept_unit_public_id: string;
  requested_by_user_db_id: string;
  mock_provider_mode?: MockProviderMode;
}) {
  const conceptUnitSession = await conceptUnitSessionForTeacherRoute(input);

  if (!conceptUnitSession.latest_student_profile) {
    throw new FollowupServiceError(
      "latest_student_profile_required",
      "A valid latest student profile is required before follow-up can start.",
      409
    );
  }

  if (!conceptUnitSession.latest_formative_decision) {
    throw new FollowupServiceError(
      "latest_formative_decision_required",
      "A valid latest formative decision is required before follow-up can start.",
      409
    );
  }

  const existingActive = await activeRoundForConceptUnitSession(conceptUnitSession.id);

  if (existingActive) {
    return {
      status: "already_active" as const,
      round: serializeFollowupRoundForTeacher(existingActive),
      student_state: await serializeStudentFollowupStateByRound(existingActive.id)
    };
  }

  const existingNotStarted = await prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      status: "not_started"
    },
    orderBy: [{ round_index: "desc" }]
  });

  if (conceptUnitSession.assessment_session.current_phase !== "planning_completed") {
    throw new FollowupServiceError(
      "followup_not_ready",
      "Follow-up can start only after planning is completed.",
      409,
      { current_phase: conceptUnitSession.assessment_session.current_phase }
    );
  }

  const round =
    existingNotStarted ??
    (await prisma.$transaction(async (tx) => {
      const latest = await tx.followupRound.findFirst({
        where: { concept_unit_session_db_id: conceptUnitSession.id },
        orderBy: [{ round_index: "desc" }],
        select: { round_index: true }
      });

      return tx.followupRound.create({
        data: {
          concept_unit_session_db_id: conceptUnitSession.id,
          round_index: (latest?.round_index ?? 0) + 1,
          formative_decision_db_id: conceptUnitSession.latest_formative_decision?.id ?? "",
          status: "not_started",
          started_at: null,
          updated_student_profile_db_id: null
        }
      });
    }));
  const agent = await runFollowupAgent({
    followup_round_db_id: round.id,
    turn_type: "opening",
    invocation_reason: "teacher_manual_phase6d1_start_followup",
    mock_provider_mode: input.mock_provider_mode
  });

  if (agent.status !== "succeeded" || !agent.output) {
    return {
      status: agent.status,
      round: null,
      student_state: await serializeStudentFollowupStateByRound(round.id),
      agent_call_id: agent.agent_call_id
    };
  }

  await persistAssistantTurn({
    assessment_session_db_id: agent.built.assessment_session_db_id,
    concept_unit_session_db_id: agent.built.concept_unit_session_db_id,
    followup_round_db_id: round.id,
    agent_call_id: agent.agent_call_id ?? null,
    output: agent.output
  });
  await prisma.followupRound.update({
    where: { id: round.id },
    data: {
      status: "active",
      started_at: new Date()
    }
  });
  await prisma.conceptUnitSession.update({
    where: { id: conceptUnitSession.id },
    data: {
      status: "followup_active",
      followup_status: "active",
      followup_started_at: new Date(),
      followup_round_count: { increment: 1 }
    }
  });
  await updateAssessmentSessionPhase({
    assessment_session_db_id: conceptUnitSession.assessment_session.id,
    to_phase: "followup_active",
    reason: "followup_agent_opening_message_created",
    payload: {
      agent_name: "followup_agent",
      followup_round_index: round.round_index,
      requested_by_user_db_id: input.requested_by_user_db_id
    }
  });
  await logFollowupEvent({
    assessment_session_db_id: conceptUnitSession.assessment_session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "followup_started",
    payload: {
      followup_round_index: round.round_index,
      requested_by: "teacher_researcher"
    }
  });

  const active = await activeRoundForConceptUnitSession(conceptUnitSession.id);

  return {
    status: "followup_started" as const,
    round: active ? serializeFollowupRoundForTeacher(active) : null,
    student_state: await serializeStudentFollowupStateByRound(round.id)
  };
}

async function getOwnedFollowupSession(input: {
  student_user_db_id: string;
  session_public_id: string;
}) {
  const session = await prisma.assessmentSession.findFirst({
    where: {
      session_public_id: input.session_public_id,
      user_db_id: input.student_user_db_id
    },
    include: {
      current_concept_unit: true
    }
  });

  if (!session) {
    throw new StudentAssessmentServiceError(
      "session_not_owned",
      "Session was not found for this student.",
      403
    );
  }

  return session;
}

async function activeRoundForStudentSession(input: {
  student_user_db_id: string;
  session_public_id: string;
}) {
  const session = await getOwnedFollowupSession(input);

  if (session.current_phase !== "followup_active") {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "Follow-up messages can be sent only while follow-up is active.",
      409,
      { current_phase: session.current_phase }
    );
  }

  if (!session.current_concept_unit_db_id) {
    throw new StudentAssessmentServiceError("not_found", "No current concept unit is set.", 404);
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit_db_id
      }
    }
  });

  if (!conceptUnitSession) {
    throw new StudentAssessmentServiceError("not_found", "Concept-unit session was not found.", 404);
  }

  const round = await prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      status: "active"
    },
    orderBy: [{ round_index: "desc" }]
  });

  if (!round) {
    throw new StudentAssessmentServiceError(
      "conflict",
      "No active follow-up round is available.",
      409
    );
  }

  return { session, conceptUnitSession, round };
}

export async function getStudentFollowupState(input: {
  student_user_db_id: string;
  session_public_id: string;
}) {
  const { round } = await activeRoundForStudentSession(input);

  return serializeStudentFollowupStateByRound(round.id);
}

export async function submitStudentFollowupMessage(input: {
  student_user_db_id: string;
  session_public_id: string;
  message: string;
  client_message_id: string;
  mock_provider_mode?: MockProviderMode;
}) {
  const config = getFollowupContextConfig();
  const message = input.message.trim();

  if (!message) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "Enter a message before sending.",
      400
    );
  }

  if (message.length > config.message_max_chars) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "The follow-up message is too long.",
      400,
      { max_chars: config.message_max_chars }
    );
  }

  const { session, conceptUnitSession, round } = await activeRoundForStudentSession(input);
  const requestPayload = {
    message,
    client_message_id: input.client_message_id,
    session_public_id: input.session_public_id
  };
  const requestHash = stableHash(requestPayload);
  const idempotencyWhere = {
    assessment_session_db_id_client_action_id: {
      assessment_session_db_id: session.id,
      client_action_id: input.client_message_id
    }
  };
  const existingKey = await prisma.studentActionIdempotencyKey.findUnique({
    where: idempotencyWhere
  });

  if (existingKey) {
    if (
      existingKey.action_type !== "followup_message" ||
      existingKey.request_hash !== requestHash
    ) {
      throw new StudentAssessmentServiceError(
        "idempotency_conflict",
        "The same client message ID was used with different content.",
        409
      );
    }

    if (existingKey.response_payload && typeof existingKey.response_payload === "object") {
      return existingKey.response_payload as Record<string, unknown>;
    }
  } else {
    await prisma.studentActionIdempotencyKey.create({
      data: {
        assessment_session_db_id: session.id,
        client_action_id: input.client_message_id,
        action_type: "followup_message",
        request_hash: requestHash
      }
    });
  }

  let studentTurn = await prisma.conversationTurn.findFirst({
    where: {
      assessment_session_db_id: session.id,
      followup_round_db_id: round.id,
      actor_type: "student",
      structured_payload: {
        path: ["client_message_id"],
        equals: input.client_message_id
      }
    }
  });

  if (!studentTurn) {
    studentTurn = await logConversationTurn({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      followup_round_db_id: round.id,
      phase: "followup_active",
      actor_type: "student",
      message_text: message,
      structured_payload: {
        client_message_id: input.client_message_id
      }
    });
  }

  if (isPromptInjectionLike(message)) {
    await logFollowupEvent({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      event_type: "prompt_injection_attempt",
      payload: {
        source: "student_followup_message",
        client_message_id: input.client_message_id
      }
    });
  }

  const existingAssistant = await prisma.conversationTurn.findFirst({
    where: {
      assessment_session_db_id: session.id,
      followup_round_db_id: round.id,
      actor_type: "agent",
      structured_payload: {
        path: ["reply_to_client_message_id"],
        equals: input.client_message_id
      }
    }
  });

  if (existingAssistant) {
    const state = await serializeStudentFollowupStateByRound(round.id);
    const response = {
      message_status: "already_replied",
      assistant_message: existingAssistant.message_text ?? "",
      state
    };

    await prisma.studentActionIdempotencyKey.update({
      where: idempotencyWhere,
      data: { response_payload: toPrismaJson(response) }
    });

    return response;
  }

  const agent = await runFollowupAgent({
    followup_round_db_id: round.id,
    turn_type: "student_reply",
    student_turn_db_id: studentTurn.id,
    invocation_reason: "student_followup_message",
    mock_provider_mode: input.mock_provider_mode
  });

  if (agent.status !== "succeeded" || !agent.output) {
    const state = await serializeStudentFollowupStateByRound(round.id);
    const response = {
      message_status: agent.status,
      assistant_message: null,
      student_safe_message: failureMessage(),
      state
    };

    await prisma.studentActionIdempotencyKey.update({
      where: idempotencyWhere,
      data: { response_payload: toPrismaJson(response) }
    });

    return response;
  }

  const assistantTurn = await persistAssistantTurn({
    assessment_session_db_id: agent.built.assessment_session_db_id,
    concept_unit_session_db_id: agent.built.concept_unit_session_db_id,
    followup_round_db_id: round.id,
    agent_call_id: agent.agent_call_id ?? null,
    output: agent.output,
    reply_to_client_message_id: input.client_message_id
  });
  await handleFollowupAssistantEvidence({
    concept_unit_session_db_id: conceptUnitSession.id,
    followup_round_db_id: round.id,
    student_turn_db_id: studentTurn.id,
    assistant_turn_db_id: assistantTurn.id,
    output: agent.output
  });
  const guardDecision = await getFormativeLoopGuardDecision({
    followup_round_db_id: round.id
  });

  if (guardDecision.triggered) {
    await stopFollowupForFormativeLoopGuard({
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      followup_round_db_id: round.id,
      stage: "followup_response",
      assessment_state_before: "FOLLOWUP_RESPONSE",
      reason_code: guardDecision.reason_code,
      loop_turn_count: guardDecision.loop_turn_count,
      repeated_followup_count: guardDecision.repeated_followup_count,
      latest_agent_call_id: agent.agent_call_id ?? null
    });
  }

  const state = await serializeStudentFollowupStateByRound(round.id);
  const response = {
    message_status: "assistant_replied",
    assistant_message: agent.output.assistant_message,
    state,
    next_choice_available: guardDecision.triggered
  };

  await prisma.studentActionIdempotencyKey.update({
    where: idempotencyWhere,
    data: { response_payload: toPrismaJson(response) }
  });

  return response;
}

export async function stopStudentFollowup(input: {
  student_user_db_id: string;
  session_public_id: string;
}) {
  const session = await getOwnedFollowupSession(input);

  if (
    ![
      "followup_active",
      "followup_profile_update_pending",
      "followup_planning_update_pending"
    ].includes(session.current_phase)
  ) {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "Follow-up can be stopped only while follow-up is active or updating.",
      409,
      { current_phase: session.current_phase }
    );
  }

  if (!session.current_concept_unit_db_id) {
    throw new StudentAssessmentServiceError("not_found", "No current concept unit is set.", 404);
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit_db_id
      }
    }
  });

  if (!conceptUnitSession) {
    throw new StudentAssessmentServiceError("not_found", "Concept-unit session was not found.", 404);
  }

  const round = await prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      status: "active"
    },
    orderBy: [{ round_index: "desc" }]
  });

  if (!round) {
    throw new StudentAssessmentServiceError(
      "conflict",
      "No active follow-up round is available.",
      409
    );
  }

  const stopPlan = await requestStopFollowupWithPossibleFinalUpdate({
    concept_unit_session_db_id: conceptUnitSession.id
  });

  if (
    stopPlan.status === "final_update_enqueued" ||
    stopPlan.status === "stop_after_active_cycle"
  ) {
    return serializeStudentFollowupStateByRound(round.id);
  }

  const now = new Date();

  await prisma.followupRound.update({
    where: { id: round.id },
    data: {
      status: "stopped",
      completed_at: now
    }
  });
  await prisma.conceptUnitSession.update({
    where: { id: conceptUnitSession.id },
    data: {
      followup_status: "stopped",
      followup_completed_at: now
    }
  });
  await updateAssessmentSessionPhase({
    assessment_session_db_id: session.id,
    to_phase: "followup_stopped",
    reason: "student_stopped_followup",
    payload: {
      followup_round_index: round.round_index
    }
  });
  await logFollowupEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "followup_stopped",
    payload: {
      followup_round_index: round.round_index,
      stopped_by: "student"
    }
  });

  return serializeStudentFollowupStateForStopped(session.session_public_id, round.id);
}

async function serializeStudentFollowupStateForStopped(
  sessionPublicId: string,
  roundDbId: string
) {
  const config = getFollowupContextConfig();
  const round = await prisma.followupRound.findUniqueOrThrow({
    where: { id: roundDbId },
    include: {
      conversation_turns: {
        orderBy: [{ sequence_index: "asc" }],
        select: {
          actor_type: true,
          message_text: true,
          created_at: true
        }
      }
    }
  });

  return serializeFollowupStateForStudent({
    session_public_id: sessionPublicId,
    phase: "followup_stopped",
    round,
    turns: round.conversation_turns,
    message_max_chars: config.message_max_chars
  });
}
