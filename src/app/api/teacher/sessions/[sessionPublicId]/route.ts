import { NextResponse } from "next/server";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import { getTeacherReviewSessionDetail } from "@/lib/services/teacher-review/session-detail";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireTeacherReview();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const detail = await getTeacherReviewSessionDetail(params.sessionPublicId);

    return NextResponse.json(detail);
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
