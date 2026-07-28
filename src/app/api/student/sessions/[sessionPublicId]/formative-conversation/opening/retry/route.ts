import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";
import {
  FORMATIVE_CONVERSATION_UNAVAILABLE_MESSAGE,
  buildFormativeConversationRuntimeContextSeed,
  createFormativeConversationOpeningRunner,
  getStudentFormativeConversationProjection,
  processFormativeConversationOpening
} from "@/lib/services/student-assessment/formative-conversation";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";

const retryOpeningSchema = z
  .object({
    conversation_public_id: z.string().min(1)
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
    const body = retryOpeningSchema.parse(await request.json());
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
    if (owned.opening_status === "ready") {
      return NextResponse.json({ formative_conversation: owned });
    }
    if (!owned.can_retry_opening) {
      throw new StudentAssessmentServiceError(
        "formative_conversation_unavailable",
        FORMATIVE_CONVERSATION_UNAVAILABLE_MESSAGE,
        503,
        { retryable: false }
      );
    }

    const seed = await buildFormativeConversationRuntimeContextSeed({
      conversation_public_id: body.conversation_public_id,
      student_user_db_id: auth.user.user_db_id
    });
    await processFormativeConversationOpening(
      {
        conversation_public_id: body.conversation_public_id,
        context: seed
      },
      {
        runner_factory: () =>
          createFormativeConversationOpeningRunner("production")
      }
    );
    const conversation = await getStudentFormativeConversationProjection({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: sessionPublicId
    });
    return NextResponse.json({ formative_conversation: conversation });
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
