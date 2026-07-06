import { NextResponse } from "next/server";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import {
  getStudentActivityRuntimeState,
  startStudentActivityForSession
} from "@/lib/services/student-assessment/activity-runtime-ui";

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
    const activityRuntime = await getStudentActivityRuntimeState({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId
    });

    return NextResponse.json({ activity_runtime: activityRuntime });
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}

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
    const activityRuntime = await startStudentActivityForSession({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId
    });

    return NextResponse.json({ activity_runtime: activityRuntime });
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
