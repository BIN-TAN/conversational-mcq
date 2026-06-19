import { NextResponse } from "next/server";
import { requireRole } from "@/lib/http";

export async function GET() {
  const auth = await requireRole("student");

  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json({
    user: auth.user,
    current_session: null,
    message: "Student session lookup is a Phase 1 placeholder."
  });
}
