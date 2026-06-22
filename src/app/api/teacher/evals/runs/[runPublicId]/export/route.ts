import { evalRouteError, requireEvalTeacher } from "@/lib/services/evals/api";
import { exportEvalRunCsv } from "@/lib/services/evals/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runPublicId: string }> }
) {
  const auth = await requireEvalTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const exportResult = await exportEvalRunCsv(params.runPublicId);

    return new Response(exportResult.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportResult.file_name}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return evalRouteError(error);
  }
}
