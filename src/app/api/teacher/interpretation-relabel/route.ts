import { NextResponse } from "next/server";
import { relabelRouteError, requireRelabelTeacher } from "@/lib/services/interpretation-relabel/api";
import { interpretationRelabelStatus } from "@/lib/services/interpretation-relabel/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRelabelTeacher();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await interpretationRelabelStatus({ teacher_user_db_id: auth.user.user_db_id }), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return relabelRouteError(error);
  }
}
