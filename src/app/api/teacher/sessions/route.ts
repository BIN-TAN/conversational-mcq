import { NextResponse } from "next/server";
import { requireRole } from "@/lib/http";

export async function GET() {
  const auth = await requireRole("teacher_researcher");

  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json({
    sessions: [],
    message: "Session listing is deferred until the assessment session schema is implemented."
  });
}
