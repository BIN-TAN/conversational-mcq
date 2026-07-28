import { NextResponse } from "next/server";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";
import { getStudentFormativeConversationProjection } from "@/lib/services/student-assessment/formative-conversation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent();
  if (!auth.ok) {
    return auth.response;
  }
  try {
    const { sessionPublicId } = await context.params;
    const conversation = await getStudentFormativeConversationProjection({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: sessionPublicId
    });
    return NextResponse.json({ formative_conversation: conversation });
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
