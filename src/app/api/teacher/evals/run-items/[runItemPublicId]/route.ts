import { NextResponse } from "next/server";
import { evalRouteError, requireEvalTeacher } from "@/lib/services/evals/api";
import { getEvalRunItem } from "@/lib/services/evals/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ runItemPublicId: string }> }
) {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const showProvider = new URL(request.url).searchParams.get("show_provider") === "true";

    return NextResponse.json(
      await getEvalRunItem(params.runItemPublicId, { blind: !showProvider })
    );
  } catch (error) {
    return evalRouteError(error);
  }
}
