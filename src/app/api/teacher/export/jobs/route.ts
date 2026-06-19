import { NextResponse } from "next/server";
import {
  masterExportRouteError,
  requireMasterExportTeacher
} from "@/lib/services/master-export/api";
import { listExportJobs } from "@/lib/services/master-export/service";

export async function GET() {
  const auth = await requireMasterExportTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json(await listExportJobs());
  } catch (error) {
    return masterExportRouteError(error);
  }
}
