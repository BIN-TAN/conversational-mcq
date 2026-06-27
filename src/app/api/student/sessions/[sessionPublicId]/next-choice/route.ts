import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError } from "@/lib/http";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";
import { submitNextChoice } from "@/lib/services/student-assessment/service";

const choiceSchema = z.object({
  choice: z.enum(["move_next", "try_another"]),
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
    const body = choiceSchema.parse(await request.json());
    const clientActionId = body.client_action_id;

    if (!clientActionId) {
      return jsonApiError("validation_failed", "client_action_id is required.", 400);
    }

    const result = await submitNextChoice({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      choice: body.choice,
      client_action_id: clientActionId
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StudentAssessmentServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return studentAssessmentRouteError(error);
  }
}
