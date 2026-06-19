import { NextResponse } from "next/server";
import {
  requireSummativeOutcomeTeacher,
  summativeOutcomeRouteError
} from "@/lib/services/summative-outcomes/api";
import { replaceSummativeOutcome } from "@/lib/services/summative-outcomes/import";

export async function POST(
  request: Request,
  context: { params: Promise<{ outcomePublicId: string }> }
) {
  const auth = await requireSummativeOutcomeTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await replaceSummativeOutcome({
      teacher_user_db_id: auth.user.user_db_id,
      outcome_public_id: params.outcomePublicId,
      data: await request.json()
    });

    return NextResponse.json(result);
  } catch (error) {
    return summativeOutcomeRouteError(error);
  }
}
