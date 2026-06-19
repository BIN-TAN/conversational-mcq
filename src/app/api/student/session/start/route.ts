import { NextResponse } from "next/server";
import { requireRole } from "@/lib/http";

export async function POST() {
  const auth = await requireRole("student");

  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json(
    {
      user: auth.user,
      session: null,
      message: "Assessment session creation is deferred until the assessment schema phase."
    },
    { status: 501 }
  );
}
