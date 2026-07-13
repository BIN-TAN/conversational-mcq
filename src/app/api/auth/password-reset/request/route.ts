import { NextResponse } from "next/server";
import {
  PASSWORD_RESET_PUBLIC_RESPONSE,
  requestTeacherPasswordReset
} from "@/lib/services/account-security/teacher-account-security";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { email?: unknown };
    await requestTeacherPasswordReset({ email: body.email, request });
  } catch {
    // The public response is intentionally non-enumerating.
  }

  return NextResponse.json({ message: PASSWORD_RESET_PUBLIC_RESPONSE });
}

