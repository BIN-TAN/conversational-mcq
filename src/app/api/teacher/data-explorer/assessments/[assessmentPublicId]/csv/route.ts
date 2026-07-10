import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { downloadAssessmentCsv } from "@/lib/services/teacher-simple-csv-export/service";

type RouteContext = {
  params: Promise<{ assessmentPublicId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await downloadAssessmentCsv({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: decodeURIComponent(params.assessmentPublicId)
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
