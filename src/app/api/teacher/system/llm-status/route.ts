import { NextResponse } from "next/server";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import { getLlmReadiness } from "@/lib/llm/readiness";
import { logProductionError } from "@/lib/observability/production-safe-logger";

export async function GET() {
  const auth = await requireRoleApi("teacher_researcher");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json({ llm: await getLlmReadiness() });
  } catch (error) {
    logProductionError(error, {
      safe_error_code: "llm_status_route_failed"
    });
    return jsonApiError("llm_status_failed", "LLM status request failed.", 500);
  }
}
