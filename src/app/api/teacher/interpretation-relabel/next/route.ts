import { NextResponse } from "next/server";
import { relabelNextBodySchema, relabelRouteError, requireRelabelTeacher } from "@/lib/services/interpretation-relabel/api";
import { interpretationRelabelNext } from "@/lib/services/interpretation-relabel/service";

export const dynamic = "force-dynamic";
// One attempt per request: one interpretation call, with one regeneration when needed.
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await requireRelabelTeacher();
  if (!auth.ok) return auth.response;
  try {
    const body = relabelNextBodySchema.parse(await request.json().catch(() => ({})));
    return NextResponse.json(await interpretationRelabelNext({ teacher_user_db_id: auth.user.user_db_id, skip: body.skip }));
  } catch (error) {
    return relabelRouteError(error);
  }
}
