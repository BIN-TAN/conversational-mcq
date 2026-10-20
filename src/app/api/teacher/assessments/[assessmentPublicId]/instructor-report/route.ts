import { NextResponse } from "next/server";
import { contentRouteError, requireTeacherResearcher } from "@/lib/services/content/api";
import {
  generateInstructorReport,
  getInstructorReportStatus
} from "@/lib/services/instructor-report/service";

// Instructor reporting module (D8, docs/DESIGN_ALIGNMENT_2026-10-17.md; section 9.7 of
// docs/AI_MODULE_REDESIGN_2026-10-19.md). GET returns the latest stored report and whether a
// new one would carry a narrative; POST generates a new report from every student's
// submitted attempts (first and later attempts counted separately), their profiles and
// conversations. A report always carries the application's counts; when no checked
// narrative is available it is a counts-only report with a note. Both are scoped to the
// teacher who owns the mini test.

export async function GET(
  _request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  try {
    const { assessmentPublicId } = await context.params;
    const status = await getInstructorReportStatus({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: assessmentPublicId
    });
    return NextResponse.json({ instructor_report: status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contentRouteError(error);
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  try {
    const { assessmentPublicId } = await context.params;
    await generateInstructorReport({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: assessmentPublicId
    });
    const status = await getInstructorReportStatus({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: assessmentPublicId
    });
    return NextResponse.json({ instructor_report: status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contentRouteError(error);
  }
}
