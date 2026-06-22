import { NextResponse } from "next/server";
import { evalRouteError, requireEvalTeacher } from "@/lib/services/evals/api";
import { createMockEvaluationRuns } from "@/lib/services/evals/service";

export async function POST(request: Request) {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = await request.json().catch(() => ({}));

    return NextResponse.json(await createMockEvaluationRuns(body, auth.user), {
      status: 201
    });
  } catch (error) {
    return evalRouteError(error);
  }
}
