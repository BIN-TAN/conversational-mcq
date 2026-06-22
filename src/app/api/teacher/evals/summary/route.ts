import { NextResponse } from "next/server";
import { evalRouteError, requireEvalTeacher } from "@/lib/services/evals/api";
import { summarizeEvalRun } from "@/lib/services/evals/service";

export async function GET() {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json({ summary: await summarizeEvalRun() });
  } catch (error) {
    return evalRouteError(error);
  }
}
