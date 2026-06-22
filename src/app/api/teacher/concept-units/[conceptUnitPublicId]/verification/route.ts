import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { getConceptUnitVerification } from "@/lib/agents/item-verification/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ conceptUnitPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await getConceptUnitVerification({
      teacher_user_db_id: auth.user.user_db_id,
      concept_unit_public_id: params.conceptUnitPublicId
    });

    return NextResponse.json({
      content_fingerprint: result.content_fingerprint,
      deterministic_validation: result.deterministic_validation,
      latest_verification: result.latest_verification,
      content_state: result.content_state
    });
  } catch (error) {
    return contentRouteError(error);
  }
}
