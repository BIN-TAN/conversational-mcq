import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/services/json";
import type { FormativeConversationAgentOutput } from "./agent-contract";

export class FormativeConversationEvidenceReferenceError extends Error {
  constructor(
    public readonly code:
      | "conversation_not_found"
      | "agent_call_mismatch"
      | "tutor_turn_mismatch"
      | "evidence_turn_mismatch",
    message: string
  ) {
    super(message);
    this.name = "FormativeConversationEvidenceReferenceError";
  }
}

export async function recordFormativeConversationProfileEvidenceReferences(input: {
  conversation_public_id: string;
  source_agent_call_db_id: string;
  source_tutor_turn_db_id: string;
  evidence_observations: FormativeConversationAgentOutput["evidence_observations"];
}) {
  const session = await prisma.formativeConversationSession.findUnique({
    where: { conversation_public_id: input.conversation_public_id },
    select: {
      id: true,
      current_student_profile_db_id: true
    }
  });
  if (!session) {
    throw new FormativeConversationEvidenceReferenceError(
      "conversation_not_found",
      "The formative conversation does not exist."
    );
  }

  const [agentCall, tutorTurn] = await Promise.all([
    prisma.agentCall.findUniqueOrThrow({
      where: { id: input.source_agent_call_db_id },
      select: { formative_conversation_session_db_id: true }
    }),
    prisma.conversationTurn.findUniqueOrThrow({
      where: { id: input.source_tutor_turn_db_id },
      select: {
        formative_conversation_session_db_id: true,
        actor_type: true,
        agent_name: true
      }
    })
  ]);
  if (agentCall.formative_conversation_session_db_id !== session.id) {
    throw new FormativeConversationEvidenceReferenceError(
      "agent_call_mismatch",
      "The agent call does not belong to this formative conversation."
    );
  }
  if (
    tutorTurn.formative_conversation_session_db_id !== session.id ||
    tutorTurn.actor_type !== "agent" ||
    tutorTurn.agent_name !== "formative_conversation_agent"
  ) {
    throw new FormativeConversationEvidenceReferenceError(
      "tutor_turn_mismatch",
      "The tutor turn does not belong to the formative conversation agent."
    );
  }

  const citedSequenceIndexes = [
    ...new Set(
      input.evidence_observations.flatMap(
        (observation) => observation.source_turn_sequence_indexes
      )
    )
  ];
  if (citedSequenceIndexes.length > 0) {
    const citedTurnCount = await prisma.conversationTurn.count({
      where: {
        formative_conversation_session_db_id: session.id,
        sequence_index: { in: citedSequenceIndexes }
      }
    });
    if (citedTurnCount !== citedSequenceIndexes.length) {
      throw new FormativeConversationEvidenceReferenceError(
        "evidence_turn_mismatch",
        "An evidence reference points outside this formative conversation."
      );
    }
  }

  if (input.evidence_observations.length > 0) {
    await prisma.formativeConversationProfileEvidenceReference.createMany({
      data: input.evidence_observations.map((observation, index) => ({
        formative_conversation_session_db_id: session.id,
        source_agent_call_db_id: input.source_agent_call_db_id,
        source_tutor_turn_db_id: input.source_tutor_turn_db_id,
        evidence_observation_index: index,
        source_turn_sequence_indexes: (toPrismaJson(
          observation.source_turn_sequence_indexes
        ) ?? []) as Prisma.InputJsonValue
      })),
      skipDuplicates: true
    });
  }

  const references =
    await prisma.formativeConversationProfileEvidenceReference.findMany({
      where: { source_agent_call_db_id: input.source_agent_call_db_id },
      orderBy: { evidence_observation_index: "asc" }
    });

  return {
    references,
    current_student_profile_db_id: session.current_student_profile_db_id
  };
}
