import { NextResponse } from "next/server";
import {
  requireStudentAccountTeacher,
  studentAccountRouteError
} from "@/lib/services/student-accounts/api";
import { getRosterImportBatch } from "@/lib/services/student-accounts/service";

type RouteContext = {
  params: Promise<{ batchPublicId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireStudentAccountTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    return NextResponse.json(await getRosterImportBatch(params.batchPublicId));
  } catch (error) {
    return studentAccountRouteError(error);
  }
}
