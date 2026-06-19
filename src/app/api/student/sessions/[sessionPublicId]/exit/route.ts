import { NextResponse } from "next/server";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { exitStudentAssessmentSession } from "@/lib/services/student-assessment/service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await exitStudentAssessmentSession({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
