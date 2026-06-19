import { NextResponse } from "next/server";
import {
  requireSummativeOutcomeTeacher,
  summativeOutcomeRouteError
} from "@/lib/services/summative-outcomes/api";
import { commitSummativeOutcomeImport } from "@/lib/services/summative-outcomes/import";

export async function POST(
  _request: Request,
  context: { params: Promise<{ batchPublicId: string }> }
) {
  const auth = await requireSummativeOutcomeTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await commitSummativeOutcomeImport({
      teacher_user_db_id: auth.user.user_db_id,
      batch_public_id: params.batchPublicId
    });

    return NextResponse.json(result);
  } catch (error) {
    return summativeOutcomeRouteError(error);
  }
}
