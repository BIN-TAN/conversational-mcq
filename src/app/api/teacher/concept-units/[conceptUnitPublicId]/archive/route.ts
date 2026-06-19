import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { archiveConceptUnit } from "@/lib/services/content/concept-units";

export async function POST(
  _request: Request,
  context: { params: Promise<{ conceptUnitPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const concept_unit = await archiveConceptUnit({
      teacher_user_db_id: auth.user.user_db_id,
      concept_unit_public_id: params.conceptUnitPublicId
    });

    return NextResponse.json({ concept_unit });
  } catch (error) {
    return contentRouteError(error);
  }
}
