import { prisma } from "@/lib/db";
import type { FormativeExecutionMode } from "@/lib/services/student-assessment/formative-execution-mode";
import { FormativeConversationUnavailableError } from "./availability";
import { createFormativeConversationOpeningRunner } from "./opening-runner";
import {
  FormativeConversationRuntimeError,
  processFormativeConversationOpening
} from "./runtime";
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
  try {
    const opening = await processFormativeConversationOpening(
      {
        conversation_public_id: conversation.conversation_public_id,
        context
      },
      {
        runner_factory: () =>
          createFormativeConversationOpeningRunner(input.execution_mode)
      }
    );

    return {
      status: opening.replayed
        ? ("existing_opening" as const)
        : ("created" as const),
      opening
    };
  } catch (error) {
    if (
      error instanceof FormativeConversationUnavailableError ||
      (error instanceof FormativeConversationRuntimeError &&
        [
          "agent_call_in_progress",
          "agent_call_failed",
          "agent_output_invalid"
        ].includes(error.code)) ||
      (error instanceof Error &&
        error.message.startsWith("formative_conversation_provider_failed:"))
    ) {
      return {
        status: "opening_retry_available" as const,
        opening: null
      };
    }
    throw error;
  }
}
