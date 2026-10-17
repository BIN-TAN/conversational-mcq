import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudent, studentAssessmentRouteError } from "@/lib/services/student-assessment/api";
import { attemptTabStatus, claimAttemptTab } from "@/lib/services/student-assessment/attempt-tab";

// D11: one active browser tab per attempt (src/lib/services/student-assessment/attempt-tab.ts).
const claimSchema = z.object({ browser_tab_id: z.string().uuid() }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent({ checkAttemptTab: false });
  if (!auth.ok) return auth.response;

  try {
    const [params, body] = await Promise.all([context.params, request.json()]);
    const data = claimSchema.parse(body);
    const result = await claimAttemptTab({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      browser_tab_id: data.browser_tab_id
    });
    return NextResponse.json(result);
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireStudent({ checkAttemptTab: false });
  if (!auth.ok) return auth.response;

  try {
    const params = await context.params;
    const result = await attemptTabStatus({
      student_user_db_id: auth.user.user_db_id,
      session_public_id: params.sessionPublicId,
      browser_tab_id: new URL(request.url).searchParams.get("browser_tab_id")
    });
    return NextResponse.json(result);
  } catch (error) {
    return studentAssessmentRouteError(error);
  }
}
