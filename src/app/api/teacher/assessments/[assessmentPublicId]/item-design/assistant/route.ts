import { NextResponse } from "next/server";
import { contentRouteError, requireTeacherResearcher } from "@/lib/services/content/api";
import { ContentServiceError } from "@/lib/services/content/errors";
import { respondToAssessmentItemDesignAssistant } from "@/lib/services/content/item-design";

async function assistantRequestPayload(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return { data: await request.json(), files: [] };
  }

  const form = await request.formData();
  const payload = form.get("payload");
  if (typeof payload !== "string") {
    throw new ContentServiceError(
      "validation_failed",
      "The course-material upload request is incomplete.",
      400
    );
  }
  const files = await Promise.all(
    form.getAll("files").flatMap((entry) =>
      entry instanceof File
        ? [entry]
        : []
    ).map(async (file) => ({
      file_name: file.name,
      media_type: file.type,
      bytes: Buffer.from(await file.arrayBuffer())
    }))
  );
  try {
    return { data: JSON.parse(payload) as unknown, files };
  } catch {
    throw new ContentServiceError(
      "validation_failed",
      "The course-material upload request could not be read.",
      400
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;

  try {
    const { assessmentPublicId } = await context.params;
    const payload = await assistantRequestPayload(request);
    return NextResponse.json(
      await respondToAssessmentItemDesignAssistant({
        teacher_user_db_id: auth.user.user_db_id,
        assessment_public_id: assessmentPublicId,
        data: payload.data,
        files: payload.files
      })
    );
  } catch (error) {
    return contentRouteError(error);
  }
}
