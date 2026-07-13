import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import {
  computeAssessmentOrganizationRevision,
  createAssessment,
  listAssessments
} from "@/lib/services/content/assessments";

export async function GET() {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const assessments = await listAssessments({ teacher_user_db_id: auth.user.user_db_id });

    return NextResponse.json({
      assessments,
      organization_revision: computeAssessmentOrganizationRevision(assessments)
    });
  } catch (error) {
    return contentRouteError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const assessment = await createAssessment({
      teacher_user_db_id: auth.user.user_db_id,
      data: await request.json()
    });

    return NextResponse.json({ assessment }, { status: 201 });
  } catch (error) {
    return contentRouteError(error);
  }
}
