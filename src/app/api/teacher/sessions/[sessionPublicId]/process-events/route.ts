import { NextResponse } from "next/server";
import {
  queryObjectFromUrl,
  processEventQuerySchema
} from "@/lib/services/teacher-review/filters";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import { getTeacherReviewProcessEvents } from "@/lib/services/teacher-review/process-events";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireTeacherReview();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const query = processEventQuerySchema.parse(queryObjectFromUrl(request.url));
    const processEvents = await getTeacherReviewProcessEvents(params.sessionPublicId, query);

    return NextResponse.json(processEvents);
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
