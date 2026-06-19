import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { importConceptBasedItemSets } from "@/lib/services/content/import-json";

export async function POST(request: Request) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await importConceptBasedItemSets({
      teacher_user_db_id: auth.user.user_db_id,
      data: await request.json()
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return contentRouteError(error);
  }
}
