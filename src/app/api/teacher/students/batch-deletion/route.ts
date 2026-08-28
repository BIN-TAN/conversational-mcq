import { NextResponse } from "next/server";
import {
  requireStudentAccountTeacher,
  studentAccountRouteError
} from "@/lib/services/student-accounts/api";
import { deleteStudentAccountsAndAssociatedData } from "@/lib/services/student-accounts/deletion";

export async function POST(request: Request) {
  const auth = await requireStudentAccountTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await deleteStudentAccountsAndAssociatedData({
      teacher_user_db_id: auth.user.user_db_id,
      confirmation: await request.json()
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAccountRouteError(error);
  }
}
