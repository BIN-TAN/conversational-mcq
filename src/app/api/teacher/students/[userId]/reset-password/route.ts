import { NextResponse } from "next/server";
import {
  requireStudentAccountTeacher,
  studentAccountRouteError
} from "@/lib/services/student-accounts/api";
import { resetStudentPassword } from "@/lib/services/student-accounts/service";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireStudentAccountTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      temporary_password?: unknown;
      generate_password?: boolean;
    };
    const result = await resetStudentPassword({
      teacher_user_db_id: auth.user.user_db_id,
      user_id: decodeURIComponent(params.userId),
      temporary_password: body.temporary_password,
      generate_password: body.generate_password
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAccountRouteError(error);
  }
}
