import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/services/json";
import { logProcessEvent } from "@/lib/services/process-events";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";

export const MAX_FORMATIVE_LOOP_ACTIONS = 5;
export const MAX_REPEATED_FOLLOWUP_RESPONSES = 3;
export const MAX_FORMATIVE_REPAIR_TURNS = 3;
export const FORMATIVE_LOOP_GUARD_MESSAGE =
  "We have enough evidence for now. You can move to the next concept or try another question on this idea.";

export type FormativeLoopGuardReason =
  | "max_formative_loop_turns"
  | "repeated_followup_limit";

export type FormativeLoopGuardStage =
  | "formative_activity_response"
  | "revision_response"
  | "followup_response";

type FormativeLoopAssessmentState =
  | "FORMATIVE_ACTIVITY"
  | "REVISION"
  | "FOLLOWUP_RESPONSE"
  | "TARGETED_FEEDBACK";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function payloadSource(value: unknown) {
  const source = record(value)?.source;
  return typeof source === "string" ? source : null;
}

function isLoopStudentTurn(input: {
  actor_type: string;
  phase: string | null;
  structured_payload: unknown;
}) {
  if (input.actor_type !== "student") {
    return false;
  }

  const source = payloadSource(input.structured_payload);

  return (
    source === "chat_native_formative_activity_response" ||
    source === "chat_native_formative_activity_response_quality_rejected" ||
    source === "chat_native_revision" ||
    source === "chat_native_revision_quality_rejected" ||
    (input.phase === "followup_active" &&
      source !== "chat_native_next_choice" &&
      source !== "transfer_answer" &&
      source !== "transfer_reasoning" &&
      source !== "transfer_confidence" &&
      source !== "transfer_tempting_option")
  );
}

function isRepeatedFollowupTurn(input: {
  actor_type: string;
  phase: string | null;
  structured_payload: unknown;
}) {
  if (input.actor_type !== "student" || input.phase !== "followup_active") {
    return false;
  }

  const source = payloadSource(input.structured_payload);

  return source !== "chat_native_revision" && source !== "chat_native_revision_quality_rejected";
}

export async function getFormativeLoopGuardCounts(input: {
  followup_round_db_id: string;
}) {
  const [turns, targetedEvaluationCount] = await Promise.all([
    prisma.conversationTurn.findMany({
      where: { followup_round_db_id: input.followup_round_db_id },
      orderBy: [{ created_at: "asc" }],
      select: {
        actor_type: true,
        phase: true,
        structured_payload: true
      }
    }),
    prisma.agentCall.count({
      where: {
        followup_round_db_id: input.followup_round_db_id,
        agent_name: "followup_agent",
        schema_version: "chat-native-formative-activity-evaluation-output-v1"
      }
    })
  ]);
  const loopTurns = turns.filter(isLoopStudentTurn);
  const repeatedFollowupTurns = turns.filter(isRepeatedFollowupTurn);

  return {
    loop_turn_count: loopTurns.length,
    repeated_followup_count: repeatedFollowupTurns.length,
    targeted_feedback_evaluation_count: targetedEvaluationCount
  };
}

export async function getFormativeLoopGuardDecision(input: {
  followup_round_db_id: string;
}) {
  const counts = await getFormativeLoopGuardCounts(input);

  if (counts.repeated_followup_count >= MAX_REPEATED_FOLLOWUP_RESPONSES) {
    return {
      triggered: true as const,
      reason_code: "repeated_followup_limit" as const,
      ...counts
    };
  }

  if (counts.loop_turn_count >= MAX_FORMATIVE_LOOP_ACTIONS) {
    return {
      triggered: true as const,
      reason_code: "max_formative_loop_turns" as const,
      ...counts
    };
  }

  return {
    triggered: false as const,
    reason_code: null,
    ...counts
  };
}

export async function stopFollowupForFormativeLoopGuard(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  followup_round_db_id: string;
  stage: FormativeLoopGuardStage;
  assessment_state_before: FormativeLoopAssessmentState;
  reason_code: FormativeLoopGuardReason;
  loop_turn_count: number;
  repeated_followup_count: number;
  latest_agent_call_id?: string | null;
}) {
  const now = new Date();
  const session = await prisma.assessmentSession.findUnique({
    where: { id: input.assessment_session_db_id },
    select: {
      session_public_id: true,
      current_phase: true
    }
  });
  let promptCreated = false;

  await prisma.$transaction(async (tx) => {
    const existingPrompt = await tx.conversationTurn.findFirst({
      where: {
        followup_round_db_id: input.followup_round_db_id,
        actor_type: "agent",
        structured_payload: {
          path: ["source"],
          equals: "chat_native_formative_loop_guard"
        }
      },
      select: { id: true }
    });

    if (!existingPrompt) {
      await tx.conversationTurn.create({
        data: {
          assessment_session_db_id: input.assessment_session_db_id,
          concept_unit_session_db_id: input.concept_unit_session_db_id,
          followup_round_db_id: input.followup_round_db_id,
          phase: "followup_active",
          actor_type: "agent",
          agent_name: "chat_native_formative_loop_guard",
          message_text: FORMATIVE_LOOP_GUARD_MESSAGE,
          structured_payload: toPrismaJson({
            source: "chat_native_formative_loop_guard",
            message_type: "terminal_guard",
            stage: input.stage,
            reason_code: input.reason_code,
            loop_turn_count: input.loop_turn_count,
            repeated_followup_count: input.repeated_followup_count,
            latest_agent_call_id: input.latest_agent_call_id ?? null
          }),
          created_at: now
        }
      });
      promptCreated = true;
    }

    await tx.followupRound.update({
      where: { id: input.followup_round_db_id },
      data: {
        status: "stopped",
        completed_at: now
      }
    });
    await tx.conceptUnitSession.update({
      where: { id: input.concept_unit_session_db_id },
      data: {
        status: "followup_completed",
        followup_status: "stopped",
        followup_completed_at: now
      }
    });
  });

  await updateAssessmentSessionPhase({
    assessment_session_db_id: input.assessment_session_db_id,
    to_phase: "followup_stopped",
    reason: "chat_native_formative_loop_guard",
    payload: {
      stage: input.stage,
      reason_code: input.reason_code,
      loop_turn_count: input.loop_turn_count,
      repeated_followup_count: input.repeated_followup_count,
      latest_agent_call_id: input.latest_agent_call_id ?? null
    }
  });

  if (promptCreated) {
    const safePayload = {
      session_public_id: session?.session_public_id ?? null,
      current_phase: session?.current_phase ?? null,
      assessment_state_before: input.assessment_state_before,
      assessment_state_after: "NEXT_CHOICE",
      loop_turn_count: input.loop_turn_count,
      repeated_followup_count: input.repeated_followup_count,
      latest_agent_call_id: input.latest_agent_call_id ?? null,
      reason_code: input.reason_code
    };

    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_type: "formative_loop_guard_triggered",
      event_category: "formative_loop",
      event_source: "backend",
      payload: safePayload,
      occurred_at: now
    });
    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_type: "formative_loop_terminal_choice_shown",
      event_category: "next_choice",
      event_source: "backend",
      payload: {
        ...safePayload,
        next_step_after: "followup_stopped",
        options: ["move_to_next_concept", "try_another_question_same_idea"]
      },
      occurred_at: now
    });
    await logProcessEvent({
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      event_type: "next_choice_shown",
      event_category: "next_choice",
      event_source: "backend",
      payload: {
        reason: input.reason_code,
        source: "chat_native_formative_loop_guard",
        options: ["move_to_next_concept", "try_another_question_same_idea"]
      },
      occurred_at: now
    });
  }

  return {
    status: "guard_triggered" as const,
    message: FORMATIVE_LOOP_GUARD_MESSAGE,
    phase: "followup_stopped" as const,
    assessment_state: "NEXT_CHOICE" as const,
    reason_code: input.reason_code
  };
}
