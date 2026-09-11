import JSZip from "jszip";
import type { Readable } from "node:stream";
import { ContentServiceError } from "./errors";

const MAX_ENTRIES = 1000;
const MAX_EXPANDED_BYTES = 12_000_000;
const MAX_COMPRESSION_RATIO = 80;

function reject(reason: string): never {
  throw new ContentServiceError(
    "validation_failed",
    "The Office file cannot be imported safely. Save a smaller, standard DOCX or XLSX file and try again.",
    400,
    { office_archive_reason: reason }
  );
}

// Check actual decompressed bytes, not only attacker-controlled ZIP size metadata.
export async function readBoundedOfficeArchive(bytes: Buffer): Promise<JSZip> {
  if (bytes.length > 15_000_000 || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
    reject("invalid_or_oversized_zip");
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    reject("invalid_zip");
  }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ENTRIES) reject("too_many_entries");
  const budget = Math.min(MAX_EXPANDED_BYTES, bytes.length * MAX_COMPRESSION_RATIO);
  let total = 0;
  const checked = new JSZip();
  for (const entry of entries) {
    const originalName = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (originalName !== entry.name || /(^\/|\\|\0|^[a-z]:)/i.test(originalName) || originalName.split("/").includes("..")) {
      reject("unsafe_path");
    }
    if (entry.dir) continue;
    if (/vbaProject\.bin$/i.test(entry.name)) {
      throw new ContentServiceError("validation_failed", "Macro-enabled Office documents are not supported.", 400);
    }
    const declared = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof declared !== "number" || !Number.isSafeInteger(declared) || declared < 0 || total + declared > budget) {
      reject("expanded_size_limit");
    }
    const chunks: Buffer[] = [];
    const content = await new Promise<Buffer>((resolve, rejectPromise) => {
      const stream = entry.nodeStream("nodebuffer") as Readable;
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > budget) {
          stream.destroy(new ContentServiceError("validation_failed", "Office file expands beyond the safe import limit.", 400, {
            office_archive_reason: "expanded_size_limit"
          }));
        } else {
          chunks.push(chunk);
        }
      });
      stream.on("error", () => rejectPromise(new ContentServiceError(
        "validation_failed", "Office file is malformed or exceeds the safe import limit.", 400
      )));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
    if (/\.(xml|rels)$/i.test(entry.name)) {
      // Office XML never requires a DTD; reject it before any XML parser sees it.
      const text = content.toString("utf8");
      if (content.includes(0) || /<!\s*(DOCTYPE|ENTITY)\b/i.test(text)) reject("xml_dtd_or_unsupported_encoding");
    }
    checked.file(entry.name, content);
  }
  return checked;
}
