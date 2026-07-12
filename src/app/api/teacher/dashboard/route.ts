import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { getTeacherAssessmentDashboard } from "@/lib/services/teacher-dashboard/assessment-dashboard";

export async function GET(request: Request) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);
    const assessmentPublicId = url.searchParams.get("assessment_public_id");
    const dashboard = await getTeacherAssessmentDashboard({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: assessmentPublicId
    });

    return NextResponse.json({ user: auth.user, dashboard });
  } catch (error) {
    return contentRouteError(error);
  }
}
