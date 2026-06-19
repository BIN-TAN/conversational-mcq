import { NextResponse } from "next/server";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import { getTeacherReviewTranscript } from "@/lib/services/teacher-review/transcripts";

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
    const transcript = await getTeacherReviewTranscript(params.sessionPublicId);

    return NextResponse.json(transcript);
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
