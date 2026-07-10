import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { deleteAssessmentAndAssociatedData } from "@/lib/services/content/assessment-deletion";

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
    const body = await request.json();
    const deletion = await deleteAssessmentAndAssociatedData({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId,
      deletion_mode: body.deletion_mode,
      assessment_confirmation: body.assessment_confirmation,
      delete_confirmation: body.delete_confirmation,
      confirm_delete_all_assessment_data: body.confirm_delete_all_assessment_data
    });

    return NextResponse.json({ deletion });
  } catch (error) {
    return contentRouteError(error);
  }
}
