import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireStudent,
  studentAssessmentRouteError
} from "@/lib/services/student-assessment/api";
import { updateStudentFormativeConversationLifecycle } from "@/lib/services/student-assessment/formative-conversation";

const lifecycleSchema = z
  .object({
    action: z.enum(["pause", "resume", "end"])
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent();
  if (!auth.ok) {
    return auth.response;
  }
  try {
    const { sessionPublicId } = await context.params;
    const body = lifecycleSchema.parse(await request.json());
    const conversation = await updateStudentFormativeConversationLifecycle({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: sessionPublicId,
      action: body.action
    });
    return NextResponse.json({ formative_conversation: conversation });
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
