import { NextResponse } from "next/server";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { getStudentSessionState } from "@/lib/services/student-assessment/service";
import { continueWithoutInitialFeedback } from "@/lib/workflow/continue-without-feedback";

export async function POST(_request: Request, context: { params: Promise<{ sessionPublicId: string; conceptUnitPublicId: string }> }) {
  const auth = await requireStudent();
  if (!auth.ok) return auth.response;
  try {
    const params = await context.params;
    const input = { student_user_db_id: auth.user.user_db_id, session_public_id: params.sessionPublicId,
      concept_unit_public_id: params.conceptUnitPublicId };
    const outcome = await continueWithoutInitialFeedback(input);
    return NextResponse.json({ ...outcome, state: await getStudentSessionState(input) });
  } catch (error) { return studentAssessmentRouteError(error); }
}
