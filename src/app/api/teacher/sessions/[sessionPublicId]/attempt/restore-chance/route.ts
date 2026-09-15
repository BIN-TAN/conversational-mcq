import { NextResponse } from "next/server";
import { requireTeacherReview, teacherReviewRouteError } from "@/lib/services/teacher-review/api";
import { restoreAttemptChance } from "@/lib/services/student-assessment/attempt-chances";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";

export async function POST(request: Request, context: { params: Promise<{ sessionPublicId: string }> }) {
  const auth = await requireTeacherReview();
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.reason !== "string") {
      throw new StudentAssessmentServiceError("validation_failed", "Provide a reason for restoring this chance.", 400);
    }
    const { sessionPublicId } = await context.params;
    const result = await restoreAttemptChance({ teacher_user_db_id: auth.user.user_db_id,
      session_public_id: sessionPublicId, reason: typeof body.reason === "string" ? body.reason : "" });
    return NextResponse.json({ result });
  } catch (error) { return teacherReviewRouteError(error); }
}
