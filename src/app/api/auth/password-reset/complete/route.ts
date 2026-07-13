import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import {
  completeTeacherPasswordReset,
  publicAccountSecurityError
} from "@/lib/services/account-security/teacher-account-security";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      token?: string;
      new_password?: unknown;
      confirm_new_password?: unknown;
    };
    await completeTeacherPasswordReset({
      token: body.token ?? "",
      newPassword: body.new_password,
      confirmNewPassword: body.confirm_new_password
    });
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    const safe = publicAccountSecurityError(error);
    return NextResponse.json({ error: { code: safe.code, message: safe.message, details: safe.details } }, { status: safe.status });
  }
}
