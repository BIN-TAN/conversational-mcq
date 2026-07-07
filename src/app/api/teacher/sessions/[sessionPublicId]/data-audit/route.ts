import { NextResponse } from "next/server";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import { buildTeacherSessionDataAudit } from "@/lib/services/teacher-review/session-data-audit";

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
    const audit = await buildTeacherSessionDataAudit({
      session_public_id: params.sessionPublicId,
      write_artifact: false
    });

    return NextResponse.json(audit);
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
