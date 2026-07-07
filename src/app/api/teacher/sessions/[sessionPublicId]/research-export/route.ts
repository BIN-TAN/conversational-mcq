import { NextResponse } from "next/server";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import { buildTeacherResearchBulkExport } from "@/lib/services/teacher-research-export/service";

function includeRestrictedKeys(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get("include_restricted_item_keys") === "true";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireTeacherReview();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const exportResult = await buildTeacherResearchBulkExport({
      session_public_id: params.sessionPublicId,
      generated_by_role: auth.user.role,
      include_restricted_item_keys: includeRestrictedKeys(request)
    });

    return new NextResponse(exportResult.buffer, {
      headers: {
        "Content-Type": exportResult.content_type,
        "Content-Disposition": `attachment; filename="${exportResult.filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
