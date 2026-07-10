import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { downloadStudentAssessmentMatrixCsv } from "@/lib/services/teacher-simple-csv-export/service";

export async function GET() {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await downloadStudentAssessmentMatrixCsv({
      teacher_user_db_id: auth.user.user_db_id
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
