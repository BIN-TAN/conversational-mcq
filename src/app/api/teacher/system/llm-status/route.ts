import { NextResponse } from "next/server";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import { getLlmReadiness } from "@/lib/llm/readiness";

export async function GET() {
  const auth = await requireRoleApi("teacher_researcher");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json({ llm: await getLlmReadiness() });
  } catch (error) {
    console.error(error);
    return jsonApiError("llm_status_failed", "LLM status request failed.", 500);
  }
}
