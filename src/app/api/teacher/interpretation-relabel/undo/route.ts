import { NextResponse } from "next/server";
import { relabelRouteError, requireRelabelTeacher } from "@/lib/services/interpretation-relabel/api";
import { undoInterpretationRelabels } from "@/lib/services/interpretation-relabel/service";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireRelabelTeacher();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await undoInterpretationRelabels({ teacher_user_db_id: auth.user.user_db_id }));
  } catch (error) {
    return relabelRouteError(error);
  }
}
