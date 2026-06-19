import { NextResponse } from "next/server";
import {
  requireSummativeOutcomeTeacher,
  summativeOutcomeRouteError
} from "@/lib/services/summative-outcomes/api";
import { listSummativeOutcomeNames } from "@/lib/services/summative-outcomes/import";

export async function GET() {
  const auth = await requireSummativeOutcomeTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json(await listSummativeOutcomeNames());
  } catch (error) {
    return summativeOutcomeRouteError(error);
  }
}
