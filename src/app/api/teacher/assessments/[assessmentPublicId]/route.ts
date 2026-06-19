import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import {
  getAssessmentDetail,
  updateAssessment
} from "@/lib/services/content/assessments";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const assessment = await getAssessmentDetail({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId
    });

    return NextResponse.json({ assessment });
  } catch (error) {
    return contentRouteError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const assessment = await updateAssessment({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId,
      data: await request.json()
    });

    return NextResponse.json({ assessment });
  } catch (error) {
    return contentRouteError(error);
  }
}
