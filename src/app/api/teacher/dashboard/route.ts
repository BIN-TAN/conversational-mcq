import { NextResponse } from "next/server";
import { requireRole } from "@/lib/http";

export async function GET() {
  const auth = await requireRole("teacher_researcher");

  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json({
    user: auth.user,
    dashboard: {
      sessions: [],
      flags: [],
      agent_metadata: []
    },
    message: "Teacher dashboard data is a Phase 1 placeholder."
  });
}
