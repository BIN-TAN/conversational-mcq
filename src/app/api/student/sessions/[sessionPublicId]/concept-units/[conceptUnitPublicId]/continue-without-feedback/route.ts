import { NextResponse } from "next/server";
import { requireStudent } from "@/lib/services/student-assessment/api";

// Retired explicitly so an older browser tab cannot skip required AI support.
export async function POST() {
  const auth = await requireStudent();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ error: { code: "feedback_continuation_retired",
    message: "Continuing without AI feedback is no longer available. Refresh to retry or end this attempt." } }, { status: 410 });
}
