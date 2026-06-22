import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { acknowledgeItemVerificationWarnings } from "@/lib/agents/item-verification/service";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{
      conceptUnitPublicId: string;
      verificationPublicId: string;
    }>;
  }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const verification = await acknowledgeItemVerificationWarnings({
      teacher_user_db_id: auth.user.user_db_id,
      concept_unit_public_id: params.conceptUnitPublicId,
      verification_public_id: params.verificationPublicId
    });

    return NextResponse.json({ verification });
  } catch (error) {
    return contentRouteError(error);
  }
}
