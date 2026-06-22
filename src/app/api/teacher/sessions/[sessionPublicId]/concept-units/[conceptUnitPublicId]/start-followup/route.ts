import { NextResponse } from "next/server";
import { jsonApiError } from "@/lib/http";
import {
  FollowupServiceError,
  startFollowupRoundForTeacher
} from "@/lib/agents/followup/service";
import {
  requireDevelopmentActiveSessionControls,
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{
      sessionPublicId: string;
      conceptUnitPublicId: string;
    }>;
  }
) {
  const auth = await requireTeacherReview();

  if (!auth.ok) {
    return auth.response;
  }

  const developmentOnly = requireDevelopmentActiveSessionControls();

  if (developmentOnly) {
    return developmentOnly;
  }

  try {
    const params = await context.params;
    const result = await startFollowupRoundForTeacher({
      session_public_id: params.sessionPublicId,
      concept_unit_public_id: params.conceptUnitPublicId,
      requested_by_user_db_id: auth.user.user_db_id
    });

    return NextResponse.json({
      session_public_id: params.sessionPublicId,
      concept_unit_public_id: params.conceptUnitPublicId,
      result
    });
  } catch (error) {
    if (error instanceof FollowupServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return teacherReviewRouteError(error);
  }
}
