import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { getItemDetail, updateItem } from "@/lib/services/content/items";

export async function GET(
  _request: Request,
  context: { params: Promise<{ itemPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const item = await getItemDetail({
      teacher_user_db_id: auth.user.user_db_id,
      item_public_id: params.itemPublicId
    });

    return NextResponse.json({ item });
  } catch (error) {
    return contentRouteError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ itemPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const item = await updateItem({
      teacher_user_db_id: auth.user.user_db_id,
      item_public_id: params.itemPublicId,
      data: await request.json()
    });

    return NextResponse.json({ item });
  } catch (error) {
    return contentRouteError(error);
  }
}
