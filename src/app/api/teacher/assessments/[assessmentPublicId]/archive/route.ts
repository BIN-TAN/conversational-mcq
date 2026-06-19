import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { archiveAssessment } from "@/lib/services/content/assessments";

export async function POST(
  _request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const assessment = await archiveAssessment({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId
    });

    return NextResponse.json({ assessment });
  } catch (error) {
    return contentRouteError(error);
  }
}
