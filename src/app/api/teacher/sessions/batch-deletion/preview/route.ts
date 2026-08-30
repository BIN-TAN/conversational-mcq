import { NextResponse } from "next/server";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import { previewSessionBatchDeletion } from "@/lib/services/teacher-review/session-deletion";

export async function POST(request: Request) {
  const auth = await requireTeacherReview();
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(
      await previewSessionBatchDeletion({
        teacher_user_db_id: auth.user.user_db_id,
        data: await request.json()
      })
    );
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
