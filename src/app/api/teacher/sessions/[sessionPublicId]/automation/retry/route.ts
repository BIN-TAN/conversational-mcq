import { NextResponse } from "next/server";
import { jsonApiError } from "@/lib/http";
import {
  retryCurrentWorkflowStep,
  WorkflowOverrideError
} from "@/lib/workflow/overrides";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";

async function requestData(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  return (await request.json()) as {
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
    const result = await retryCurrentWorkflowStep({
      session_public_id: params.sessionPublicId,
      teacher_user_db_id: auth.user.user_db_id,
      reason: data.reason
    });

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof WorkflowOverrideError) {
      return jsonApiError(error.code, error.message, error.status, error.details);
    }

    return teacherReviewRouteError(error);
  }
}
