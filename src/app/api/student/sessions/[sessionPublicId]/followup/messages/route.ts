import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError } from "@/lib/http";
import {
  FollowupServiceError,
  submitStudentFollowupMessage
} from "@/lib/agents/followup/service";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";

const messageSchema = z.object({
  message: z.string(),
  client_message_id: z.string().min(1).optional(),
  client_action_id: z.string().min(1).optional()
});

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const body = messageSchema.parse(await request.json());
    const clientMessageId = body.client_message_id ?? body.client_action_id;

    if (!clientMessageId) {
      return jsonApiError(
        "validation_failed",
        "client_message_id is required.",
        400
      );
    }

    const result = await submitStudentFollowupMessage({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      message: body.message,
      client_message_id: clientMessageId
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof FollowupServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return studentAssessmentRouteError(error);
  }
}
