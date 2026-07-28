import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { FORMATIVE_CONVERSATION_MEMORY_VERSION } from "./agent-contract";

export async function appendFormativeConversationMemorySnapshot(input: {
  conversation_public_id: string;
  through_turn_db_id?: string;
  source_transcript_hash: string;
  summary_payload: Prisma.InputJsonObject;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.formativeConversationSession.findUniqueOrThrow({
      where: { conversation_public_id: input.conversation_public_id },
      select: { id: true }
    });
    const latest = await tx.formativeConversationMemorySnapshot.findFirst({
      where: { formative_conversation_session_db_id: session.id },
      orderBy: { snapshot_index: "desc" },
      select: { snapshot_index: true }
    });

    return tx.formativeConversationMemorySnapshot.create({
      data: {
        formative_conversation_session_db_id: session.id,
        snapshot_index: (latest?.snapshot_index ?? 0) + 1,
        schema_version: FORMATIVE_CONVERSATION_MEMORY_VERSION,
        through_turn_db_id: input.through_turn_db_id,
        source_transcript_hash: input.source_transcript_hash,
        summary_payload: input.summary_payload
      }
    });
  });
}

export async function getLatestFormativeConversationMemorySnapshot(
  conversationPublicId: string
) {
  return prisma.formativeConversationMemorySnapshot.findFirst({
    where: {
      formative_conversation_session: {
        conversation_public_id: conversationPublicId
      }
    },
    orderBy: { snapshot_index: "desc" }
  });
}
