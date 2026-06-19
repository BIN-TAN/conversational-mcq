import { NextResponse } from "next/server";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { submitItemResponse } from "@/lib/services/student-assessment/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string; itemPublicId: string }> }
) {
  const auth = await requireStudent();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await submitItemResponse({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      item_public_id: params.itemPublicId,
      data: await request.json()
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
