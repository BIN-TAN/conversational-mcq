import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/http";
import {
  getTeacherAccountSecurity,
  publicAccountSecurityError,
  requestTeacherEmailChange
} from "@/lib/services/account-security/teacher-account-security";

export async function POST(request: Request) {
  const auth = await requireRoleApi("teacher_researcher");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as { current_password?: unknown; new_email?: unknown };
    await requestTeacherEmailChange({
      userDbId: auth.user.user_db_id,
      currentPassword: body.current_password,
      newEmail: body.new_email
    });
    const account = await getTeacherAccountSecurity({ userDbId: auth.user.user_db_id });
    return NextResponse.json({
      account,
      message:
        "A verification link has been sent to the new email address. Your current email remains active until the new address is verified."
    });
  } catch (error) {
    const safe = publicAccountSecurityError(error);
    return NextResponse.json({ error: { code: safe.code, message: safe.message, details: safe.details } }, { status: safe.status });
  }
}

