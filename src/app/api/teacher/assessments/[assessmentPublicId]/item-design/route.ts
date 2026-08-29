import { NextResponse } from "next/server";
import { contentRouteError, requireTeacherResearcher } from "@/lib/services/content/api";
import {
  getAssessmentItemDesign,
  saveAssessmentItemDesign
} from "@/lib/services/content/item-design";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  try {
    const { assessmentPublicId } = await context.params;
    return NextResponse.json(await getAssessmentItemDesign({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: assessmentPublicId
    }));
  } catch (error) {
    return contentRouteError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  try {
    const { assessmentPublicId } = await context.params;
    return NextResponse.json(await saveAssessmentItemDesign({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: assessmentPublicId,
      data: await request.json()
    }));
  } catch (error) {
    return contentRouteError(error);
  }
}
