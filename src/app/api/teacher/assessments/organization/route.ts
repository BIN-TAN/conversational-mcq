import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { saveAssessmentOrganization } from "@/lib/services/content/assessments";

async function saveOrganization(request: Request) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await saveAssessmentOrganization({
      teacher_user_db_id: auth.user.user_db_id,
      data: await request.json()
    });

    return NextResponse.json(result);
  } catch (error) {
    return contentRouteError(error);
  }
}

export async function POST(request: Request) {
  return saveOrganization(request);
}

export async function PUT(request: Request) {
  return saveOrganization(request);
}
