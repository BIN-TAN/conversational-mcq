import { NextResponse } from "next/server";
import { contentRouteError, requireTeacherResearcher } from "@/lib/services/content/api";
import { importExistingItemsFromMaterials } from "@/lib/services/content/item-design";

/** Reads the instructor's existing items from the course materials (and any attached files). */
export async function POST(
  request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;

  try {
    const { assessmentPublicId } = await context.params;
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const files = contentType.startsWith("multipart/form-data")
      ? await Promise.all((await request.formData()).getAll("files").flatMap((entry) => entry instanceof File ? [entry] : [])
          .map(async (file) => ({ file_name: file.name, media_type: file.type, bytes: Buffer.from(await file.arrayBuffer()) })))
      : [];
    return NextResponse.json(
      await importExistingItemsFromMaterials({
        teacher_user_db_id: auth.user.user_db_id,
        assessment_public_id: assessmentPublicId,
        files
      })
    );
  } catch (error) {
    return contentRouteError(error);
  }
}
