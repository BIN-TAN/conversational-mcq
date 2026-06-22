import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonApiError } from "@/lib/http";
import {
  ConceptProgressionServiceError,
  requestStudentConceptProgression
} from "@/lib/services/concept-progression/progression";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";

const requestSchema = z
  .object({
    client_action_id: z.string().min(1).optional()
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
    const params = await context.params;
    const body = requestSchema.parse(await request.json().catch(() => ({})));
    const result = await requestStudentConceptProgression({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      data: body
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ConceptProgressionServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return studentAssessmentRouteError(error);
  }
}
