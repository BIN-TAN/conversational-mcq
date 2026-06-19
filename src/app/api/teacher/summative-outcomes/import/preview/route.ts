import { NextResponse } from "next/server";
import {
  requireSummativeOutcomeTeacher,
  summativeOutcomeRouteError
} from "@/lib/services/summative-outcomes/api";
import { previewSummativeOutcomeImport } from "@/lib/services/summative-outcomes/import";

export async function POST(request: Request) {
  const auth = await requireSummativeOutcomeTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const preview = await previewSummativeOutcomeImport({
      teacher_user_db_id: auth.user.user_db_id,
      data: await request.json()
    });

    return NextResponse.json(preview, { status: 201 });
  } catch (error) {
    return summativeOutcomeRouteError(error);
  }
}
