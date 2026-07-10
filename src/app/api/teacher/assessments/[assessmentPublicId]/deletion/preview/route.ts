import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { previewAssessmentDeletion } from "@/lib/services/content/assessment-deletion";

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
    const preview = await previewAssessmentDeletion({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId
    });

    return NextResponse.json({ preview });
  } catch (error) {
    return contentRouteError(error);
  }
}
