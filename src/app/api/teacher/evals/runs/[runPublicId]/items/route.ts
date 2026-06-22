import { NextResponse } from "next/server";
import {
  evalRouteError,
  queryObjectFromUrl,
  requireEvalTeacher
} from "@/lib/services/evals/api";
import { listEvalRunItems } from "@/lib/services/evals/service";

export async function GET(
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
      await listEvalRunItems(params.runPublicId, queryObjectFromUrl(request.url))
    );
  } catch (error) {
    return evalRouteError(error);
  }
}
