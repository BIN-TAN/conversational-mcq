import { NextResponse } from "next/server";
import { jsonApiError } from "@/lib/http";
import {
  FollowupServiceError,
  stopStudentFollowup
} from "@/lib/agents/followup/service";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";

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
    const state = await stopStudentFollowup({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId
    });

    return NextResponse.json({
      stop_status:
        state.current_phase === "followup_stopped" ? "followup_stopped" : "followup_update_pending",
      state
    });
  } catch (error) {
    if (error instanceof FollowupServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return studentAssessmentRouteError(error);
  }
}
