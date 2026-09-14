import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { ContentServiceError } from "@/lib/services/content/errors";
import { WORKBOOK_MAX_BYTES } from "@/lib/services/content/mini-test-workbook-contract";
import { parseMiniTestWorkbook, stageMiniTestWorkbook } from "@/lib/services/content/mini-test-workbook-import";

export async function POST(request: Request) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const fileName = url.searchParams.get("filename") ?? "";
    if (!/\.xlsx$/i.test(fileName) || fileName.length > 240) throw new ContentServiceError("validation_failed", "Choose a standard .xlsx workbook.", 400);
    const reader = request.body?.getReader();
    if (!reader) throw new ContentServiceError("validation_failed", "Upload an XLSX workbook.", 400);
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > WORKBOOK_MAX_BYTES) { await reader.cancel(); throw new ContentServiceError("validation_failed", "The workbook must be 2 MB or smaller.", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    if (url.searchParams.get("action") === "stage") {
      return NextResponse.json(await stageMiniTestWorkbook({ teacher_user_db_id: auth.user.user_db_id, bytes,
        source_file_name: fileName, selected_sheets: url.searchParams.getAll("sheet") }));
    }
    return NextResponse.json((await parseMiniTestWorkbook(bytes)).preview);
  } catch (error) { return contentRouteError(error); }
}
