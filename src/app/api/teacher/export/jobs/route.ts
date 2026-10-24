import { NextResponse } from "next/server";
import {
  masterExportRouteError,
  requireMasterExportTeacher
} from "@/lib/services/master-export/api";
import { listExportJobs } from "@/lib/services/master-export/service";

export async function GET(request: Request) {
  const auth = await requireMasterExportTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const limit = Number(new URL(request.url).searchParams.get("limit"));
    return NextResponse.json(
      await listExportJobs(Number.isFinite(limit) && limit > 0 ? { limit } : {})
    );
  } catch (error) {
    return masterExportRouteError(error);
  }
}
