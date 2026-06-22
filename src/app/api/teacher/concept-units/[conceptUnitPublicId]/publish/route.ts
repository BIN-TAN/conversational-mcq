import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { publishConceptUnit } from "@/lib/services/content/publishing";

export async function POST(
  request: Request,
  context: { params: Promise<{ conceptUnitPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const body = await request.json().catch(() => ({}));
    const result = await publishConceptUnit({
      teacher_user_db_id: auth.user.user_db_id,
      concept_unit_public_id: params.conceptUnitPublicId,
      confirm_publish_without_current_verification:
        Boolean(body?.confirm_publish_without_current_verification)
    });

    return NextResponse.json(result);
  } catch (error) {
    return contentRouteError(error);
  }
}
