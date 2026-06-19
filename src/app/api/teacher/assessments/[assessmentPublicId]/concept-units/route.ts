import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import {
  createConceptUnit,
  listConceptUnits
} from "@/lib/services/content/concept-units";

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
    const concept_units = await listConceptUnits({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId
    });

    return NextResponse.json({ concept_units });
  } catch (error) {
    return contentRouteError(error);
  }
}

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
    const concept_unit = await createConceptUnit({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId,
      data: await request.json()
    });

    return NextResponse.json({ concept_unit }, { status: 201 });
  } catch (error) {
    return contentRouteError(error);
  }
}
