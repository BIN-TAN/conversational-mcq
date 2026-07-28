import type { FormativeConversationAgentOutput } from "./agent-contract";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/services/json";

export type FormativeConversationProfileEvidenceHookInput = {
  conversation_public_id: string;
  source_agent_call_db_id: string;
  source_tutor_turn_db_id: string;
  agent_evidence_observations: FormativeConversationAgentOutput["evidence_observations"];
};

export type FormativeConversationProfileEvidenceHookResult = {
  evidence_reference_public_ids: string[];
  profile_changed: false;
};

export interface FormativeConversationProfileEvidenceHook {
  recordEvidenceReferences(
    input: FormativeConversationProfileEvidenceHookInput
  ): Promise<FormativeConversationProfileEvidenceHookResult>;
}

export async function recordFormativeConversationProfileTransitionRecommendation(
  input: {
    conversation_public_id: string;
    source_tutor_turn_db_id: string;
    recommendation: NonNullable<
      FormativeConversationAgentOutput["profile_transition_recommendation"]
    >;
  }
) {
  const session = await prisma.formativeConversationSession.findUniqueOrThrow({
    where: { conversation_public_id: input.conversation_public_id },
    select: {
      id: true,
      current_student_profile_db_id: true
    }
  });
  if (!input.recommendation.recommended) {
    return null;
  }
  const existing = await prisma.formativeConversationReviewSignal.findFirst({
    where: {
      formative_conversation_session_db_id: session.id,
      source_turn_db_id: input.source_tutor_turn_db_id,
      signal_type: "profile_transition_recommendation"
    }
  });
  if (existing) {
    return existing;
  }
  return prisma.formativeConversationReviewSignal.create({
    data: {
      formative_conversation_session_db_id: session.id,
      source_student_profile_db_id:
        session.current_student_profile_db_id ?? null,
      source_turn_db_id: input.source_tutor_turn_db_id,
      signal_type: "profile_transition_recommendation",
      reason_code: input.recommendation.proposed_outcome,
      evidence_summary: (toPrismaJson({
        rationale: input.recommendation.rationale,
        source_turn_sequence_indexes:
          input.recommendation.source_turn_sequence_indexes
      }) ?? {}) as Prisma.InputJsonValue
    }
  });
}
