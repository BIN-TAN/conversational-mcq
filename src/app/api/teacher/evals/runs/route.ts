import { NextResponse } from "next/server";
import {
  evalRouteError,
  queryObjectFromUrl,
  requireEvalTeacher
} from "@/lib/services/evals/api";
import { listEvalRuns } from "@/lib/services/evals/service";

export async function GET(request: Request) {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json(await listEvalRuns(queryObjectFromUrl(request.url)));
  } catch (error) {
    return evalRouteError(error);
  }
}
