import { NextResponse } from "next/server";
import {
  masterExportRouteError,
  requireMasterExportTeacher
} from "@/lib/services/master-export/api";
import { getExportJob } from "@/lib/services/master-export/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ exportPublicId: string }> }
) {
  const auth = await requireMasterExportTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    return NextResponse.json({ export_job: await getExportJob(params.exportPublicId) });
  } catch (error) {
    return masterExportRouteError(error);
  }
}
