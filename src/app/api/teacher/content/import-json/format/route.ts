import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { ContentServiceError } from "@/lib/services/content/errors";
import { formatMiniTestJsonWithAssistant } from "@/lib/services/content/item-design";
import { MINI_TEST_JSON_MAX_BYTES } from "@/lib/services/content/mini-test-json-contract";

/** The assistant puts a mini-test file into the import format; nothing is saved. */
export async function POST(request: Request) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new ContentServiceError("validation_failed", "Choose a file or paste its contents first.", 400);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MINI_TEST_JSON_MAX_BYTES) {
          await reader.cancel();
          throw new ContentServiceError("validation_failed", "The file must be 2 MB or smaller.", 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return NextResponse.json(await formatMiniTestJsonWithAssistant({
      teacher_user_db_id: auth.user.user_db_id,
      source_text: Buffer.concat(chunks).toString("utf8"),
      file_name: new URL(request.url).searchParams.get("filename")?.slice(0, 240) ?? null
    }));
  } catch (error) { return contentRouteError(error); }
}
