import { NextResponse } from "next/server";
import {
  requireSummativeOutcomeTeacher,
  summativeOutcomeRouteError
} from "@/lib/services/summative-outcomes/api";
import { listSummativeOutcomeImportBatches } from "@/lib/services/summative-outcomes/import";

export async function GET() {
  const auth = await requireSummativeOutcomeTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json(await listSummativeOutcomeImportBatches());
  } catch (error) {
    return summativeOutcomeRouteError(error);
  }
}
