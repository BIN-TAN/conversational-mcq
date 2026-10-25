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
    let files: Array<{ file_name: string; media_type: string; bytes: Buffer }> = [];
    // Accessible wording is on unless the teacher turned it off ("false").
    let accessibleWording = true;
    if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData();
      accessibleWording = form.get("accessible_wording") !== "false";
      files = await Promise.all(form.getAll("files").flatMap((entry) => entry instanceof File ? [entry] : [])
        .map(async (file) => ({ file_name: file.name, media_type: file.type, bytes: Buffer.from(await file.arrayBuffer()) })));
    } else if (contentType.startsWith("application/json")) {
      const body: unknown = await request.json().catch(() => null);
      accessibleWording = !(body && typeof body === "object" && (body as Record<string, unknown>).accessible_wording === false);
    }
    return NextResponse.json(
      await importExistingItemsFromMaterials({
        teacher_user_db_id: auth.user.user_db_id,
        assessment_public_id: assessmentPublicId,
        files,
        accessible_wording: accessibleWording
      })
    );
  } catch (error) {
    return contentRouteError(error);
  }
}
