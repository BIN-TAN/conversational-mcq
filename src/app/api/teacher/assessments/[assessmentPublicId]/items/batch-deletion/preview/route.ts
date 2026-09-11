import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { previewItemDeletion } from "@/lib/services/content/item-deletion";

export async function POST(request: Request, context: { params: Promise<{ assessmentPublicId: string }> }) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  try {
    const { assessmentPublicId } = await context.params;
    const preview = await previewItemDeletion({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: assessmentPublicId,
      data: await request.json()
    });
    return NextResponse.json({ preview });
  } catch (error) { return contentRouteError(error); }
}
