import { NextResponse } from "next/server";
import { evalRouteError, requireEvalTeacher } from "@/lib/services/evals/api";
import { upsertEvalAnnotation } from "@/lib/services/evals/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ runItemPublicId: string }> }
) {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;

    return NextResponse.json(
      await upsertEvalAnnotation(params.runItemPublicId, await request.json(), auth.user)
    );
  } catch (error) {
    return evalRouteError(error);
  }
}
