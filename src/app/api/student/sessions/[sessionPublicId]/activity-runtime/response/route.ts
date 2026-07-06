import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError } from "@/lib/http";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { submitStudentActivityRuntimeResponse } from "@/lib/services/student-assessment/activity-runtime-ui";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";

const responseSchema = z.object({
  activity_attempt_public_id: z.string().min(1),
  response_text: z.string(),
  client_message_id: z.string().min(1).optional(),
  client_action_id: z.string().min(1).optional()
}).strict();

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
    const body = responseSchema.parse(await request.json());
    const clientMessageId = body.client_message_id ?? body.client_action_id;

    if (!clientMessageId) {
      return jsonApiError("validation_failed", "client_message_id is required.", 400);
    }

    const activityRuntime = await submitStudentActivityRuntimeResponse({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      activity_attempt_public_id: body.activity_attempt_public_id,
      response_text: body.response_text,
      client_message_id: clientMessageId
    });

    return NextResponse.json({ activity_runtime: activityRuntime });
  } catch (error) {
    if (error instanceof StudentAssessmentServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return studentAssessmentRouteError(error);
  }
}
