import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/http";
import {
  cancelTeacherEmailChange,
  getTeacherAccountSecurity,
  publicAccountSecurityError
} from "@/lib/services/account-security/teacher-account-security";

export async function POST(request: Request) {
  const auth = await requireRoleApi("teacher_researcher");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as { current_password?: unknown };
    await cancelTeacherEmailChange({
      userDbId: auth.user.user_db_id,
      currentPassword: body.current_password
    });
    const account = await getTeacherAccountSecurity({ userDbId: auth.user.user_db_id });
    return NextResponse.json({ account, message: "Pending email change cancelled." });
  } catch (error) {
    const safe = publicAccountSecurityError(error);
    return NextResponse.json({ error: { code: safe.code, message: safe.message, details: safe.details } }, { status: safe.status });
  }
}

