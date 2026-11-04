import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { recordOtherAiToolUse } from "@/lib/services/student-assessment/ai-use-report";

const BodySchema = z.object({ used: z.boolean() });

// Release 40: the student's yes or no answer to "Did you use another AI tool while answering the questions?".
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const body = BodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json(
        { error: { code: "validation_failed", message: "Choose Yes or No." } },
        { status: 400 }
      );
    }
    const result = await recordOtherAiToolUse({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      used: body.data.used
    });

    return NextResponse.json(result);
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
