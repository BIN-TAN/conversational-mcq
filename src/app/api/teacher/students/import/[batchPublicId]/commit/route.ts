import { NextResponse } from "next/server";
import {
  requireStudentAccountTeacher,
  studentAccountRouteError
} from "@/lib/services/student-accounts/api";
import { commitRosterImport } from "@/lib/services/student-accounts/service";

type RouteContext = {
  params: Promise<{ batchPublicId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireStudentAccountTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await commitRosterImport({
      teacher_user_db_id: auth.user.user_db_id,
      batch_public_id: params.batchPublicId,
      data: await request.json().catch(() => ({}))
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAccountRouteError(error);
  }
}
