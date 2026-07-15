import { NextResponse } from "next/server";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { endStudentAssessmentAttempt } from "@/lib/services/student-assessment/service";

async function requestData(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  return (await request.json().catch(() => ({}))) as {
    reason?: string | null;
  };
}

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
    const data = await requestData(request);
    const result = await endStudentAssessmentAttempt({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      reason: data.reason
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
