import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { ContentServiceError } from "@/lib/services/content/errors";
import { MINI_TEST_JSON_MAX_BYTES } from "@/lib/services/content/mini-test-json-contract";
import { stageMiniTestJsonImport } from "@/lib/services/content/mini-test-json-import";

export async function POST(request: Request) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new ContentServiceError("validation_failed", "A JSON file or pasted JSON is required.", 400);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MINI_TEST_JSON_MAX_BYTES) {
          await reader.cancel();
          throw new ContentServiceError("validation_failed", "The JSON file must be 2 MB or smaller.", 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const result = await stageMiniTestJsonImport({
      teacher_user_db_id: auth.user.user_db_id,
      source_text: Buffer.concat(chunks).toString("utf8"),
      source_file_name: new URL(request.url).searchParams.get("filename")?.slice(0, 240)
    });
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) { return contentRouteError(error); }
}
