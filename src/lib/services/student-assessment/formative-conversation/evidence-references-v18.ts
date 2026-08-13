import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  CanonicalEligibleEvidenceCatalogSchema,
  canonicalEvidenceById,
  canonicalEvidenceSequenceIndexes,
  type CanonicalEvidenceCatalog
} from "@/lib/domain/canonical-evidence-identity";
import { toPrismaJson } from "@/lib/services/json";
import type { FormativeConversationV18AgentOutput } from "./agent-contract-v18";
import { FormativeConversationEvidenceReferenceError } from "./evidence-references";
import { formativeConversationPersistenceError } from "./persistence-errors";

export const FORMATIVE_CONVERSATION_V18_EVIDENCE_REFERENCE_VERSION =
  "formative-conversation-evidence-reference-v2" as const;

export async function recordFormativeConversationV18ProfileEvidenceReferences(input: {
  conversation_public_id: string;
  source_agent_call_db_id: string;
  source_tutor_turn_db_id: string;
  allowed_evidence_catalog: CanonicalEvidenceCatalog;
  evidence_observations: FormativeConversationV18AgentOutput["evidence_observations"];
}) {
  try {
    return await recordV18ProfileEvidenceReferences(input);
  } catch (error) {
    if (error instanceof FormativeConversationEvidenceReferenceError) {
      throw error;
    }
    throw formativeConversationPersistenceError(
      error,
      "evidence_reference_persistence"
    );
  }
}

async function recordV18ProfileEvidenceReferences(input: {
  conversation_public_id: string;
  source_agent_call_db_id: string;
  source_tutor_turn_db_id: string;
  allowed_evidence_catalog: CanonicalEvidenceCatalog;
  evidence_observations: FormativeConversationV18AgentOutput["evidence_observations"];
}) {
  const catalog = CanonicalEligibleEvidenceCatalogSchema.parse(
    input.allowed_evidence_catalog
  );
  const evidenceById = canonicalEvidenceById(catalog);
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

  const observationIndexes = input.evidence_observations.map((observation) => {
    for (const evidenceId of observation.evidence_ids) {
      if (!evidenceById.has(evidenceId)) {
        throw new FormativeConversationEvidenceReferenceError(
          "evidence_turn_mismatch",
          "An evidence observation references an ID outside the canonical catalog."
        );
      }
    }
    return canonicalEvidenceSequenceIndexes(catalog, observation.evidence_ids);
  });
  const citedSequenceIndexes = [
    ...new Set(observationIndexes.flat())
  ].sort((left, right) => left - right);
  if (citedSequenceIndexes.length > 0) {
    const citedTurns = await prisma.conversationTurn.findMany({
      where: {
        formative_conversation_session_db_id: session.id,
        sequence_index: { in: citedSequenceIndexes }
      },
      select: { sequence_index: true, actor_type: true }
    });
    if (
      citedTurns.length !== citedSequenceIndexes.length ||
      citedTurns.some((turn) => turn.actor_type !== "student")
    ) {
      throw new FormativeConversationEvidenceReferenceError(
        "evidence_turn_mismatch",
        "Canonical formative evidence must resolve to student turns in this conversation."
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
          observationIndexes[index]
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
