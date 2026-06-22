import { NextResponse } from "next/server";
import { evalRouteError, requireEvalTeacher } from "@/lib/services/evals/api";
import { seedEvalFixtures } from "@/lib/services/evals/service";

export async function POST() {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json(await seedEvalFixtures(auth.user.user_db_id), { status: 201 });
  } catch (error) {
    return evalRouteError(error);
  }
}
