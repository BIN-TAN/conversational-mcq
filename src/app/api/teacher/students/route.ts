import { NextResponse } from "next/server";
import { requireRole } from "@/lib/http";

export async function GET() {
  const auth = await requireRole("teacher_researcher");

  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json({
    students: [],
    message: "Student listing is deferred until the teacher dashboard phase."
  });
}
