import { NextResponse } from "next/server";
import { evalRouteError, requireEvalTeacher } from "@/lib/services/evals/api";
import { confirmEvalAnnotation } from "@/lib/services/evals/annotation-adjudication";

export async function POST(
  _request: Request,
  context: { params: Promise<{ runItemPublicId: string }> }
) {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;

    return NextResponse.json(await confirmEvalAnnotation(params.runItemPublicId, auth.user));
  } catch (error) {
    return evalRouteError(error);
  }
}
