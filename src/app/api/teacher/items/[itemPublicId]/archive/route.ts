import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { archiveItem } from "@/lib/services/content/items";

export async function POST(
  _request: Request,
  context: { params: Promise<{ itemPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const item = await archiveItem({
      teacher_user_db_id: auth.user.user_db_id,
      item_public_id: params.itemPublicId
    });

    return NextResponse.json({ item });
  } catch (error) {
    return contentRouteError(error);
  }
}
