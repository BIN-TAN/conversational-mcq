import { NextResponse } from "next/server";
import { jsonApiError } from "@/lib/http";
import { prisma } from "@/lib/db";
import {
  FormativePlanningServiceError,
  runInitialFormativePlanning
} from "@/lib/agents/formative-planning/service";
import {
  requireDevelopmentActiveSessionControls,
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

  const developmentOnly = requireDevelopmentActiveSessionControls();

  if (developmentOnly) {
    return developmentOnly;
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

    const result = await runInitialFormativePlanning({
      concept_unit_session_db_id: conceptUnitSession.id,
      requested_by_user_db_id: auth.user.user_db_id,
      invocation_reason: "teacher_manual_phase6c_trigger"
    });

    return NextResponse.json({
      session_public_id: params.sessionPublicId,
      concept_unit_public_id: params.conceptUnitPublicId,
      result: {
        status: result.status,
        decision: result.decision,
        default_formative_value: result.default_formative_value
      }
    });
  } catch (error) {
    if (error instanceof FormativePlanningServiceError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return teacherReviewRouteError(error);
  }
}
