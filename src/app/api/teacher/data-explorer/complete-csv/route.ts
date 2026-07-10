import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { buildTeacherDetailedCsvBundle } from "@/lib/services/teacher-detailed-csv-export/service";

export async function GET() {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await buildTeacherDetailedCsvBundle({
      teacher_user_db_id: auth.user.user_db_id,
      scope: "all_authorized"
    });

    return new NextResponse(result.buffer, {
      headers: {
        "Content-Type": result.content_type,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return contentRouteError(error);
  }
}
