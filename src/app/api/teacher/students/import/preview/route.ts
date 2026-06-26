import { NextResponse } from "next/server";
import {
  requireStudentAccountTeacher,
  studentAccountRouteError
} from "@/lib/services/student-accounts/api";
import { previewRosterImport } from "@/lib/services/student-accounts/service";

export async function POST(request: Request) {
  const auth = await requireStudentAccountTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  if (process.env.PRIVATE_STAGING_MODE === "true") {
    return NextResponse.json(
      {
        error: {
          code: "private_staging_roster_import_disabled",
          message: "Roster import is disabled in private staging. Use the synthetic Phase 8D accounts only."
        }
      },
      { status: 403 }
    );
  }

  try {
    const preview = await previewRosterImport({
      teacher_user_db_id: auth.user.user_db_id,
      data: await request.json()
    });

    return NextResponse.json(preview, { status: 201 });
  } catch (error) {
    return studentAccountRouteError(error);
  }
}
