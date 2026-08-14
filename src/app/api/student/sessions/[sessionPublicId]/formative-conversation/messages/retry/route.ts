import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";
import {
  buildFormativeConversationRuntimeContextSeed,
  createLiveFormativeConversationV18R2AgentRunner,
  FormativeConversationResponseGenerationError,
  getFormativeConversationStudentMessageForRetry,
  getStudentFormativeConversationProjection,
  processFormativeConversationStudentMessage
} from "@/lib/services/student-assessment/formative-conversation";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";

const retrySchema = z
  .object({
    conversation_public_id: z.string().min(1),
    receipt_public_id: z.string().min(1)
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { sessionPublicId } = await context.params;
    const body = retrySchema.parse(await request.json());
    const owned = await getStudentFormativeConversationProjection({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: sessionPublicId
    });
    if (
      !owned ||
      owned.conversation_public_id !== body.conversation_public_id
    ) {
      throw new StudentAssessmentServiceError(
        "not_found",
        "The learning conversation was not found.",
        404
      );
    }

    const storedMessage =
      await getFormativeConversationStudentMessageForRetry({
        conversation_public_id: body.conversation_public_id,
        receipt_public_id: body.receipt_public_id
      });
    if (storedMessage.receipt.assistant_turn) {
      return NextResponse.json({
        formative_conversation: owned
      });
    }
    if (
      storedMessage.receipt.assistant_response_status !== "failed"
    ) {
      throw new StudentAssessmentServiceError(
        "invalid_phase_for_action",
        "The tutor response is not ready to retry.",
        409
      );
    }

    const seed = await buildFormativeConversationRuntimeContextSeed({
      conversation_public_id: body.conversation_public_id,
      student_user_db_id: auth.user.user_db_id
    });
    try {
      await processFormativeConversationStudentMessage(
        {
          conversation_public_id: body.conversation_public_id,
          client_message_id: storedMessage.client_message_id,
          message_text: storedMessage.message_text,
          context: seed
        },
        { runner_factory: createLiveFormativeConversationV18R2AgentRunner }
      );
    } catch (error) {
      if (!(error instanceof FormativeConversationResponseGenerationError)) {
        throw error;
      }
    }

    const conversation = await getStudentFormativeConversationProjection({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: sessionPublicId
    });
    return NextResponse.json({
      formative_conversation: conversation
    });
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
