import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: {
        code: "teacher_email_change_disabled",
        message: "Teacher recovery email changes are not available."
      }
    },
    { status: 404 }
  );
}
