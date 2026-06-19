import { NextResponse } from "next/server";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { listAvailableAssessments } from "@/lib/services/student-assessment/service";

export async function GET() {
  const auth = await requireStudent();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await listAvailableAssessments({
      student_user_db_id: auth.user.user_db_id
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
