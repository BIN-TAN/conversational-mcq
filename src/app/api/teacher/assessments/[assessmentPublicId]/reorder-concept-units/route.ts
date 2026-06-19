import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { reorderConceptUnits } from "@/lib/services/content/concept-units";

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
    const concept_units = await reorderConceptUnits({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId,
      data: await request.json()
    });

    return NextResponse.json({ concept_units });
  } catch (error) {
    return contentRouteError(error);
  }
}
