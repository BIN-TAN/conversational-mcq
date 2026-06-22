import { NextResponse } from "next/server";
import { evalRouteError, requireEvalTeacher } from "@/lib/services/evals/api";
import { getEvalRun } from "@/lib/services/evals/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runPublicId: string }> }
) {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;

    return NextResponse.json(await getEvalRun(params.runPublicId));
  } catch (error) {
    return evalRouteError(error);
  }
}
