import { NextResponse } from "next/server";
import {
  requireSummativeOutcomeTeacher,
  summativeOutcomeRouteError
} from "@/lib/services/summative-outcomes/api";
import { getSummativeOutcomeImportBatch } from "@/lib/services/summative-outcomes/import";

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchPublicId: string }> }
) {
  const auth = await requireSummativeOutcomeTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    return NextResponse.json(await getSummativeOutcomeImportBatch(params.batchPublicId));
  } catch (error) {
    return summativeOutcomeRouteError(error);
  }
}
