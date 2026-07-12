import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { downloadTeacherAssessmentDashboardCsv } from "@/lib/services/teacher-dashboard/assessment-dashboard";

export async function GET(request: Request) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const assessmentPublicId = new URL(request.url).searchParams.get("assessment_public_id");

    if (!assessmentPublicId) {
      return NextResponse.json(
        {
          error: {
            code: "validation_failed",
            message: "assessment_public_id is required.",
            details: {}
          }
        },
        { status: 400 }
      );
    }

    const result = await downloadTeacherAssessmentDashboardCsv({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: assessmentPublicId
    });

    return new NextResponse(result.content, {
      headers: {
        "Content-Type": result.content_type,
        "Content-Disposition": `attachment; filename="${result.file_name}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return contentRouteError(error);
  }
}
