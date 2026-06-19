import { NextResponse } from "next/server";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import { getTeacherReviewItemResponses } from "@/lib/services/teacher-review/item-responses";

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
    const itemResponses = await getTeacherReviewItemResponses(params.sessionPublicId);

    return NextResponse.json(itemResponses);
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
