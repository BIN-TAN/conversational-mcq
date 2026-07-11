import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { getMcqItemImportBatch } from "@/lib/services/content/mcq-import";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assessmentPublicId: string; batchPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await getMcqItemImportBatch({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: params.assessmentPublicId,
      batch_public_id: params.batchPublicId
    });

    return NextResponse.json(result);
  } catch (error) {
    return contentRouteError(error);
  }
}
