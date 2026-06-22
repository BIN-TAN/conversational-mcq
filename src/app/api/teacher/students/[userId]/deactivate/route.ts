import { NextResponse } from "next/server";
import {
  requireStudentAccountTeacher,
  studentAccountRouteError
} from "@/lib/services/student-accounts/api";
import { setStudentAccountStatus } from "@/lib/services/student-accounts/service";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireStudentAccountTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await setStudentAccountStatus({
      teacher_user_db_id: auth.user.user_db_id,
      user_id: decodeURIComponent(params.userId),
      account_status: "inactive"
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAccountRouteError(error);
  }
}
