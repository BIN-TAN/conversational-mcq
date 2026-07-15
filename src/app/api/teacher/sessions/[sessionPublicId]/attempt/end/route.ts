import { NextResponse } from "next/server";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import { closeAttemptAndAllowAnother } from "@/lib/services/teacher-review/attempt-controls";

async function requestData(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  return (await request.json().catch(() => ({}))) as {
    reason?: string | null;
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireTeacherReview();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const data = await requestData(request);
    const result = await closeAttemptAndAllowAnother({
      session_public_id: params.sessionPublicId,
      teacher_user_db_id: auth.user.user_db_id,
      reason: data.reason
    });

    return NextResponse.json({ result });
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
