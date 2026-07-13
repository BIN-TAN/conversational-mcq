import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/http";
import { getTeacherAccountSecurity } from "@/lib/services/account-security/teacher-account-security";

export async function GET() {
  const auth = await requireRoleApi("teacher_researcher");
  if (!auth.ok) {
    return auth.response;
  }

  const account = await getTeacherAccountSecurity({ userDbId: auth.user.user_db_id });
  return NextResponse.json({ account });
}

