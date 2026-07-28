import { prisma } from "@/lib/db";
import type { FormativeExecutionMode } from "@/lib/services/student-assessment/formative-execution-mode";
import { createFormativeConversationOpeningRunner } from "./opening-runner";
import { processFormativeConversationOpening } from "./runtime";
import { buildFormativeConversationRuntimeContextSeedForInternalOpening } from "./runtime-context";

export async function ensureFormativeConversationOpeningForConceptUnitSession(input: {
  concept_unit_session_db_id: string;
  execution_mode: FormativeExecutionMode;
}) {
  const conversation = await prisma.formativeConversationSession.findUnique({
    where: {
      concept_unit_session_db_id: input.concept_unit_session_db_id
    },
    select: {
      conversation_public_id: true,
      _count: {
        select: {
          conversation_turns: true
        }
      }
    }
  });

  if (!conversation) {
    return {
      status: "legacy_runtime" as const,
      opening: null
    };
  }

  if (conversation._count.conversation_turns > 0) {
    return {
      status: "existing_transcript" as const,
      opening: null
    };
  }

  const context =
    await buildFormativeConversationRuntimeContextSeedForInternalOpening({
      conversation_public_id: conversation.conversation_public_id
    });
  const opening = await processFormativeConversationOpening(
    {
      conversation_public_id: conversation.conversation_public_id,
      context
    },
    {
      runner: createFormativeConversationOpeningRunner(input.execution_mode)
    }
  );

  return {
    status: opening.replayed ? ("existing_opening" as const) : ("created" as const),
    opening
  };
}
