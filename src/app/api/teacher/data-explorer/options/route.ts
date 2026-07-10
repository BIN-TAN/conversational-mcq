import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { listSimpleCsvExplorerOptions } from "@/lib/services/teacher-simple-csv-export/service";

export async function GET() {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json(
      await listSimpleCsvExplorerOptions({ teacher_user_db_id: auth.user.user_db_id })
    );
  } catch (error) {
    return contentRouteError(error);
  }
}
