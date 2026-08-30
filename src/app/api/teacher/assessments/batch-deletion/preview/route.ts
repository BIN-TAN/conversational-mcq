import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { previewArchivedAssessmentBatchDeletion } from "@/lib/services/content/assessment-deletion";

export async function POST(request: Request) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(
      await previewArchivedAssessmentBatchDeletion({
        teacher_user_db_id: auth.user.user_db_id,
        data: await request.json()
      })
    );
  } catch (error) {
    return contentRouteError(error);
  }
}
