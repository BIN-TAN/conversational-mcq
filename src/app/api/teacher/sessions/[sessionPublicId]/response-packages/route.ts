import { NextResponse } from "next/server";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import { getTeacherReviewResponsePackages } from "@/lib/services/teacher-review/response-packages";

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
    const responsePackages = await getTeacherReviewResponsePackages(params.sessionPublicId);

    return NextResponse.json(responsePackages);
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
