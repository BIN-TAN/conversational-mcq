import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { runConceptUnitVerification } from "@/lib/agents/item-verification/service";

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
    const result = await runConceptUnitVerification({
      teacher_user_db_id: auth.user.user_db_id,
      concept_unit_public_id: params.conceptUnitPublicId,
      mock_mode: typeof body?.mock_mode === "string" ? body.mock_mode : undefined
    });

    return NextResponse.json(result);
  } catch (error) {
    return contentRouteError(error);
  }
}
