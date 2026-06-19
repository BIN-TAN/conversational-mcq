import { NextResponse } from "next/server";
import {
  queryObjectFromUrl,
  sessionListQuerySchema
} from "@/lib/services/teacher-review/filters";
import { listTeacherReviewSessions } from "@/lib/services/teacher-review/sessions";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";

export async function GET(request: Request) {
  const auth = await requireTeacherReview();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const query = sessionListQuerySchema.parse(queryObjectFromUrl(request.url));
    const result = await listTeacherReviewSessions(query);

    return NextResponse.json(result);
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
