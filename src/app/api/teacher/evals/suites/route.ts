import { NextResponse } from "next/server";
import { evalRouteError, requireEvalTeacher } from "@/lib/services/evals/api";
import { createEvalSuite, listEvalSuites } from "@/lib/services/evals/service";

export async function GET() {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json(await listEvalSuites());
  } catch (error) {
    return evalRouteError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return NextResponse.json(await createEvalSuite(await request.json(), auth.user), {
      status: 201
    });
  } catch (error) {
    return evalRouteError(error);
  }
}
