import { NextResponse } from "next/server";
import { contentRouteError, requireTeacherResearcher } from "@/lib/services/content/api";
import { createTopicMiniTestFromBank } from "@/lib/services/content/item-design";

/** Creates the draft mini test for another topic of this mini test's course topic bank. */
export async function POST(
  request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;

  try {
    const { assessmentPublicId } = await context.params;
    const result = await createTopicMiniTestFromBank({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: assessmentPublicId,
      data: await request.json()
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return contentRouteError(error);
  }
}
