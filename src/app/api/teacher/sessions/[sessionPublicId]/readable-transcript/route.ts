import { NextResponse } from "next/server";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import { getTeacherReadableTranscript } from "@/lib/services/teacher-review/readable-transcript";

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
    const transcript = await getTeacherReadableTranscript(params.sessionPublicId);

    return NextResponse.json(transcript);
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
