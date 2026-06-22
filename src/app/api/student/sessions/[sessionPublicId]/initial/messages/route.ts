import { NextResponse } from "next/server";
import { sendInitialAdministrationMessage } from "@/lib/agents/response-collection/service";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const [params, body] = await Promise.all([context.params, request.json()]);
    const result = await sendInitialAdministrationMessage({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      data: body
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}

