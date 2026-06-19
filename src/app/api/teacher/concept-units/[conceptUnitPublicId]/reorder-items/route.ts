import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { reorderItems } from "@/lib/services/content/items";

export async function POST(
  request: Request,
  context: { params: Promise<{ conceptUnitPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const items = await reorderItems({
      teacher_user_db_id: auth.user.user_db_id,
      concept_unit_public_id: params.conceptUnitPublicId,
      data: await request.json()
    });

    return NextResponse.json({ items });
  } catch (error) {
    return contentRouteError(error);
  }
}
