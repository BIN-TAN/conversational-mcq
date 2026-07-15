import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { getResearchExportReadiness } from "@/lib/services/teacher-research-data/readiness";

export async function GET() {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json({ readiness: await getResearchExportReadiness() });
  } catch (error) {
    return contentRouteError(error);
  }
}
