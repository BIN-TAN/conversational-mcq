import { NextResponse } from "next/server";
import { jsonApiError } from "@/lib/http";
import {
  ConceptProgressionServiceError,
  getStudentProgressionState
} from "@/lib/services/concept-progression/progression";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await getStudentProgressionState({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ConceptProgressionServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return studentAssessmentRouteError(error);
  }
}
