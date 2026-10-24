import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";
import {
  formativeConversationReplyDependencies,
  FormativeConversationResponseGenerationError,
  getFormativeConversationStudentMessageForRetry,
  getStudentFormativeConversationMessageGate,
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
    // A narrow ownership check first. The full projection runs first only when a reply has
    // waited long enough for the projection to mark it failed; otherwise it is loaded only
    // for the response.
    const gate = await getStudentFormativeConversationMessageGate({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: sessionPublicId
    });
    const owned = gate?.stale_reply
      ? await getStudentFormativeConversationProjection({
          student_user_db_id: auth.user.user_db_id,
          session_public_id: sessionPublicId
        })
      : gate;
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
        formative_conversation: gate?.stale_reply
          ? owned
          : await getStudentFormativeConversationProjection({
              student_user_db_id: auth.user.user_db_id,
              session_public_id: sessionPublicId
            })
      });
    }
    if (
      storedMessage.receipt.assistant_response_status !== "failed"
    ) {
      throw new StudentAssessmentServiceError(
        "invalid_phase_for_action",
        "Please wait a moment before asking the tutor again.",
        409
      );
    }

    const { seed, runner_factory } = await formativeConversationReplyDependencies({
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
        { runner_factory }
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
