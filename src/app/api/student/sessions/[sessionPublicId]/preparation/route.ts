import { NextResponse } from "next/server";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { getOwnedInitialPreparationStatus } from "@/lib/workflow/initial-preparation-status";

export async function GET(_request: Request, context: { params: Promise<{ sessionPublicId: string }> }) {
  const auth = await requireStudent();
  if (!auth.ok) return auth.response;
  try {
    const { sessionPublicId } = await context.params;
    return NextResponse.json(await getOwnedInitialPreparationStatus({
      session_public_id: sessionPublicId, student_user_db_id: auth.user.user_db_id
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return studentAssessmentRouteError(error); }
}
