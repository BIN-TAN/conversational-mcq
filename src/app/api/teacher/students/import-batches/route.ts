import { NextResponse } from "next/server";
import {
  requireStudentAccountTeacher,
  studentAccountRouteError
} from "@/lib/services/student-accounts/api";
import { listRosterImportBatches } from "@/lib/services/student-accounts/service";

export async function GET() {
  const auth = await requireStudentAccountTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json(await listRosterImportBatches());
  } catch (error) {
    return studentAccountRouteError(error);
  }
}
