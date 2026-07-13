import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: {
        code: "teacher_email_recovery_disabled",
        message: "Teacher email password recovery is not available."
      }
    },
    { status: 404 }
  );
}
