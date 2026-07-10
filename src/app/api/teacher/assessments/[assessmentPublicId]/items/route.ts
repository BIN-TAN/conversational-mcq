import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { createAssessmentItem } from "@/lib/services/content/items";

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
    const item = await createAssessmentItem({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId,
      data: await request.json()
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return contentRouteError(error);
  }
}
