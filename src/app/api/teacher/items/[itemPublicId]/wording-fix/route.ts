import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { correctItemWording } from "@/lib/services/content/item-wording-fix";

/** Saves a wording fix for an item in a mini test that students have started (item-wording-fix-v1). */
export async function POST(
  request: Request,
  context: { params: Promise<{ itemPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const result = await correctItemWording({
      teacher_user_db_id: auth.user.user_db_id,
      item_public_id: params.itemPublicId,
      data: await request.json()
    });

    return NextResponse.json(result);
  } catch (error) {
    return contentRouteError(error);
  }
}
