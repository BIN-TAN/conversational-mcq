import { NextResponse } from "next/server";
import {
  createSessionToken,
  setSessionCookie,
  toClientUser,
  toPublicUser
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonApiError, requireRoleApi } from "@/lib/http";
import { studentAccountRouteError } from "@/lib/services/student-accounts/api";
import { changeStudentPassword } from "@/lib/services/student-accounts/service";

export async function POST(request: Request) {
  const auth = await requireRoleApi("student");

  if (!auth.ok) {
    return auth.response;
  }

  try {
    await changeStudentPassword({
      student_user_db_id: auth.user.user_db_id,
      data: await request.json()
    });

    const refreshed = await prisma.user.findUnique({
      where: { id: auth.user.user_db_id },
      select: {
        id: true,
        user_id: true,
        role: true,
        auth_version: true,
        must_change_password: true
      }
    });

    if (!refreshed || refreshed.role !== "student") {
      return jsonApiError("account_unavailable", "This account is currently unavailable.", 403);
    }

    const publicUser = toPublicUser(refreshed);
    const response = NextResponse.json({
      student: {
        user_id: publicUser.user_id,
        must_change_password: publicUser.must_change_password ?? false
      },
      user: toClientUser(publicUser)
    });
    setSessionCookie(response, createSessionToken(publicUser));

    return response;
  } catch (error) {
    return studentAccountRouteError(error);
  }
}
