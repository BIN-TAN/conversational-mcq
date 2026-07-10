import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { downloadStudentCsv } from "@/lib/services/teacher-simple-csv-export/service";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await downloadStudentCsv({
      teacher_user_db_id: auth.user.user_db_id,
      student_user_id: decodeURIComponent(params.userId)
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
