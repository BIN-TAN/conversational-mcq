import { NextResponse } from "next/server";
import {
  masterExportRouteError,
  requireMasterExportTeacher
} from "@/lib/services/master-export/api";
import { createMasterCsvExport } from "@/lib/services/master-export/service";

export async function POST(request: Request) {
  const auth = await requireMasterExportTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const job = await createMasterCsvExport({
      teacher_user_db_id: auth.user.user_db_id,
      data: await request.json().catch(() => ({}))
    });

    return NextResponse.json({ export_job: job }, { status: 201 });
  } catch (error) {
    return masterExportRouteError(error);
  }
}
