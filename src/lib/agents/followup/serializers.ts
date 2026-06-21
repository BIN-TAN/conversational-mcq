import type { AgentCall, ConversationTurn, FollowupRound, FormativeDecision } from "@prisma/client";
import { assertStudentPayloadIsSafe } from "@/lib/services/student-assessment/serializers";
import { serializeDate, stripInternalKeys } from "@/lib/services/teacher-review/serializers";

export type FollowupRoundWithDecision = FollowupRound & {
  formative_decision: Pick<FormativeDecision, "formative_value" | "created_at">;
};

export type FollowupAgentCallSummary = Pick<
  AgentCall,
  | "agent_name"
  | "provider"
  | "model_name"
  | "agent_version"
  | "prompt_version"
  | "schema_version"
  | "prompt_hash"
  | "retry_count"
  | "call_status"
  | "output_validated"
  | "live_call_allowed"
  | "blocked_reason"
  | "latency_ms"
  | "input_tokens"
  | "output_tokens"
  | "total_tokens"
  | "created_at"
  | "completed_at"
>;

function stripFollowupStructuredPayload(value: unknown) {
  const stripped = stripInternalKeys(value);

  if (!stripped || typeof stripped !== "object" || Array.isArray(stripped)) {
    return stripped;
  }

  const output = { ...stripped } as Record<string, unknown>;

  delete output.agent_call_id;

  return output;
}

export function serializeFollowupRoundForTeacher(
  round: FollowupRoundWithDecision & {
    conversation_turns?: Array<Pick<
      ConversationTurn,
      "actor_type" | "agent_name" | "message_text" | "structured_payload" | "created_at"
    >>;
    agent_calls?: FollowupAgentCallSummary[];
  }
) {
  return {
    round_index: round.round_index,
    status: round.status,
    started_at: serializeDate(round.started_at),
    completed_at: serializeDate(round.completed_at),
    updated_student_profile_present: Boolean(round.updated_student_profile_db_id),
    formative_decision: {
      formative_value: round.formative_decision.formative_value,
      created_at: serializeDate(round.formative_decision.created_at)
    },
    transcript: (round.conversation_turns ?? []).map((turn) => ({
      actor_type: turn.actor_type,
      agent_name: turn.agent_name,
      message_text: turn.message_text,
      created_at: serializeDate(turn.created_at),
      structured_payload: stripFollowupStructuredPayload(turn.structured_payload)
    })),
    agent_calls: (round.agent_calls ?? []).map((call) => ({
      agent_name: call.agent_name,
      provider: call.provider,
      model_name: call.model_name,
      agent_version: call.agent_version,
      prompt_version: call.prompt_version,
      schema_version: call.schema_version,
      prompt_hash: call.prompt_hash,
      retry_count: call.retry_count,
      call_status: call.call_status,
      output_validated: call.output_validated,
      live_call_allowed: call.live_call_allowed,
      blocked_reason: call.blocked_reason,
      latency_ms: call.latency_ms,
      input_tokens: call.input_tokens,
      output_tokens: call.output_tokens,
      total_tokens: call.total_tokens,
      created_at: serializeDate(call.created_at),
      completed_at: serializeDate(call.completed_at),
      mock_or_live: call.provider === "mock" ? "mock" : "live"
    })),
    mock_output_notice: (round.agent_calls ?? []).some((call) => call.provider === "mock")
      ? "Mock provider output for infrastructure testing only; not validated formative guidance."
      : null
  };
}

export function serializeFollowupTurnForStudent(
  turn: Pick<ConversationTurn, "actor_type" | "message_text" | "created_at">
) {
  return {
    actor: turn.actor_type === "agent" ? "assistant" : "student",
    message_text: turn.message_text ?? "",
    created_at: serializeDate(turn.created_at)
  };
}

export function serializeFollowupStateForStudent(input: {
  session_public_id: string;
  phase: string;
  round: Pick<FollowupRound, "round_index" | "status" | "started_at" | "completed_at"> | null;
  turns: Array<Pick<ConversationTurn, "actor_type" | "message_text" | "created_at">>;
  message_max_chars: number;
}) {
  const result = {
    session_public_id: input.session_public_id,
    current_phase: input.phase,
    followup: input.round
      ? {
          round_index: input.round.round_index,
          status: input.round.status,
          started_at: serializeDate(input.round.started_at),
          completed_at: serializeDate(input.round.completed_at),
          turns: input.turns.map(serializeFollowupTurnForStudent),
          can_send: input.phase === "followup_active" && input.round.status === "active",
          can_stop: input.phase === "followup_active" && input.round.status === "active",
          can_save_exit: true,
          message_max_chars: input.message_max_chars
        }
      : null
  };

  assertStudentPayloadIsSafe(result);
  return result;
}
