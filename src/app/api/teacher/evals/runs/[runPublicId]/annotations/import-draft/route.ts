import { NextResponse } from "next/server";
import { evalRouteError, requireEvalTeacher } from "@/lib/services/evals/api";
import { importDraftAnnotationsForRunByTeacher } from "@/lib/services/evals/annotation-adjudication";

export async function POST(
  request: Request,
  context: { params: Promise<{ runPublicId: string }> }
) {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;

    return NextResponse.json(
      await importDraftAnnotationsForRunByTeacher(params.runPublicId, await request.json(), auth.user)
    );
  } catch (error) {
    return evalRouteError(error);
  }
}
