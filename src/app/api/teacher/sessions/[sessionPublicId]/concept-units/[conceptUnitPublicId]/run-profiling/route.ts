import { NextResponse } from "next/server";
import { jsonApiError } from "@/lib/http";
import { prisma } from "@/lib/db";
import {
  runInitialStudentProfiling,
  StudentProfilingServiceError
} from "@/lib/agents/student-profiling/service";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import { TeacherReviewServiceError } from "@/lib/services/teacher-review/errors";

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

  try {
    const params = await context.params;
    const conceptUnitSession = await prisma.conceptUnitSession.findFirst({
      where: {
        assessment_session: {
          session_public_id: params.sessionPublicId
        },
        concept_unit: {
          concept_unit_public_id: params.conceptUnitPublicId
        }
      },
      select: {
        id: true
      }
    });

    if (!conceptUnitSession) {
      throw new TeacherReviewServiceError(
        "concept_unit_session_not_found",
        "Concept-unit session was not found for this assessment session.",
        404,
        {
          session_public_id: params.sessionPublicId,
          concept_unit_public_id: params.conceptUnitPublicId
        }
      );
    }

    const result = await runInitialStudentProfiling({
      concept_unit_session_db_id: conceptUnitSession.id,
      requested_by_user_db_id: auth.user.user_db_id,
      invocation_reason: "teacher_manual_phase6b_trigger"
    });

    return NextResponse.json({
      session_public_id: params.sessionPublicId,
      concept_unit_public_id: params.conceptUnitPublicId,
      result: {
        status: result.status,
        profile: result.profile
      }
    });
  } catch (error) {
    if (error instanceof StudentProfilingServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return teacherReviewRouteError(error);
  }
}
