import { NextResponse } from "next/server";
import {
  requireStudentAccountTeacher,
  studentAccountRouteError
} from "@/lib/services/student-accounts/api";
import { deleteStudentAccountAndAssociatedData } from "@/lib/services/student-accounts/deletion";

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
    const result = await deleteStudentAccountAndAssociatedData({
      teacher_user_db_id: auth.user.user_db_id,
      user_id: decodeURIComponent(params.userId),
      confirmation: await request.json()
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAccountRouteError(error);
  }
}
