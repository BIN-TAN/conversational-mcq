import { NextResponse } from "next/server";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { startOrResumeStudentAssessmentSession } from "@/lib/services/student-assessment/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireStudent();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const body = await request.json().catch(() => ({}));
    const newAttempt =
      body && typeof body === "object" && "new_attempt" in body
        ? (body as Record<string, unknown>).new_attempt === true
        : false;
    const result = await startOrResumeStudentAssessmentSession({
      student_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId,
      new_attempt: newAttempt,
      allow_post_commit_presenter_recovery: true
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
