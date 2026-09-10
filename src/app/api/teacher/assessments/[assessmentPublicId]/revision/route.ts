import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { createEditableAssessmentRevision } from "@/lib/services/content/assessment-revisions";

export async function POST(
  request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const revision = await createEditableAssessmentRevision({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId,
      data: await request.json()
    });

    return NextResponse.json({ revision });
  } catch (error) {
    return contentRouteError(error);
  }
}
