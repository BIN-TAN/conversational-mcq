import { NextResponse } from "next/server";
import { createSessionToken, setSessionCookie, toClientUser, toPublicUser } from "@/lib/auth";
import { requireRoleApi } from "@/lib/http";
import { prisma } from "@/lib/db";
import {
  changeAuthenticatedTeacherPassword,
  getTeacherPasswordAccount,
  publicAccountSecurityError
} from "@/lib/services/account-security/teacher-account-security";

export async function POST(request: Request) {
  const auth = await requireRoleApi("teacher_researcher");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as {
      current_password?: unknown;
      new_password?: unknown;
      confirm_new_password?: unknown;
    };
    await changeAuthenticatedTeacherPassword({
      userDbId: auth.user.user_db_id,
      currentPassword: body.current_password,
      newPassword: body.new_password,
      confirmNewPassword: body.confirm_new_password
    });
    const refreshed = await prisma.user.findUniqueOrThrow({
      where: { id: auth.user.user_db_id },
      select: { id: true, user_id: true, role: true, auth_version: true }
    });
    const publicUser = toPublicUser(refreshed);
    const account = await getTeacherPasswordAccount({ userDbId: auth.user.user_db_id });
    const response = NextResponse.json({
      account,
      user: toClientUser(publicUser),
      message: "Password changed."
    });
    setSessionCookie(response, createSessionToken(publicUser));
    return response;
  } catch (error) {
    const safe = publicAccountSecurityError(error);
    return NextResponse.json({ error: { code: safe.code, message: safe.message, details: safe.details } }, { status: safe.status });
  }
}
