import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError } from "@/lib/http";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { submitTopicDialogueResponse } from "@/lib/services/student-assessment/activity-runtime-ui";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";

const responseSchema = z.object({
  dialogue_public_id: z.string().min(1),
  student_message: z.string().min(1),
  client_operation_id: z.string().min(1),
  expected_dialogue_version: z.string().min(1).optional()
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
    const activityRuntime = await submitTopicDialogueResponse({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      dialogue_public_id: body.dialogue_public_id,
      student_message: body.student_message,
      client_operation_id: body.client_operation_id,
      expected_dialogue_version: body.expected_dialogue_version ?? null
    });

    return NextResponse.json({ activity_runtime: activityRuntime });
  } catch (error) {
    if (error instanceof StudentAssessmentServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return studentAssessmentRouteError(error);
  }
}
