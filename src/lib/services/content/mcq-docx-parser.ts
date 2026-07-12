import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import mammoth from "mammoth";
import { ContentServiceError } from "./errors";

export type DocxTextBlock =
  | {
      kind: "paragraph";
      paragraph_index: number;
      text: string;
      style: string | null;
      is_list: boolean;
      contains_image: boolean;
      contains_equation: boolean;
      contains_object: boolean;
    }
  | {
      kind: "table";
      table_index: number;
      rows: string[][];
      contains_image: boolean;
      contains_equation: boolean;
      contains_object: boolean;
    };

export type DocxExtraction = {
  parser_version: string;
  source_file_name: string | null;
  raw_text: string;
  blocks: DocxTextBlock[];
  warnings: string[];
  embedded_image_count: number;
  equation_or_object_count: number;
  external_relationship_count: number;
  tracked_change_detected: boolean;
};

const DOCX_PARSER_VERSION = "docx-structured-parser-v1";
const DOCX_MAX_UNCOMPRESSED_BYTES = 12_000_000;
const DOCX_MAX_COMPRESSION_RATIO = 80;
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: false
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function safeName(name?: string | null) {
  return name?.split(/[\\/]/).pop() ?? null;
}

function assertSupportedDocxFile(sourceFileName?: string | null) {
  const name = safeName(sourceFileName)?.toLowerCase() ?? "";
  if (name.endsWith(".doc")) {
    throw new ContentServiceError(
      "validation_failed",
      "This file uses the older Word format. Save it as .docx and upload it again.",
      400,
      { unsupported_file_type: "doc" }
    );
  }
  if (name.endsWith(".docm")) {
    throw new ContentServiceError(
      "validation_failed",
      "Macro-enabled Word documents are not supported for MCQ import.",
      400,
      { unsupported_file_type: "docm" }
    );
  }
}

function collectText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(collectText).join("");
  }
  if (typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  let text = "";
  if (typeof record["#text"] === "string") text += record["#text"];
  if (typeof record.t === "string") text += record.t;
  if (record.t && typeof record.t === "object") text += collectText(record.t);
  if (record.tab) text += " ";
  if (record.br) text += "\n";

  for (const [key, entry] of Object.entries(record)) {
    if (key.startsWith("@_") || key === "#text" || key === "t" || key === "tab" || key === "br") {
      continue;
    }
    text += collectText(entry);
  }
  return text;
}

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\s+/g, " ").trim();
}

function blockContains(xml: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(xml));
}

function parseParagraph(xml: string, paragraphIndex: number): DocxTextBlock | null {
  const parsed = parser.parse(xml) as { p?: Record<string, unknown> };
  const p = parsed.p;
  if (!p) return null;
  const text = normalizeText(collectText(p));
  if (!text && !blockContains(xml, [/<a:blip\b/, /<w:drawing\b/, /<m:oMath\b/, /<w:object\b/])) {
    return null;
  }

  const pPr = p.pPr as Record<string, unknown> | undefined;
  const pStyle = pPr?.pStyle as Record<string, unknown> | undefined;
  return {
    kind: "paragraph",
    paragraph_index: paragraphIndex,
    text,
    style: typeof pStyle?.["@_val"] === "string" ? pStyle["@_val"] : null,
    is_list: Boolean(pPr?.numPr),
    contains_image: blockContains(xml, [/<a:blip\b/, /<w:drawing\b/]),
    contains_equation: blockContains(xml, [/<m:oMath\b/, /<m:oMathPara\b/]),
    contains_object: blockContains(xml, [/<w:object\b/, /<v:shape\b/, /<w:pict\b/])
  };
}

function parseTable(xml: string, tableIndex: number): DocxTextBlock | null {
  const parsed = parser.parse(xml) as { tbl?: Record<string, unknown> };
  const tbl = parsed.tbl;
  if (!tbl) return null;
  const rows = asArray(tbl.tr).map((row) => {
    const rowRecord = row as Record<string, unknown>;
    return asArray(rowRecord.tc).map((cell) => normalizeText(collectText(cell)));
  });
  const nonEmptyRows = rows.filter((row) => row.some((cell) => cell.trim()));
  if (nonEmptyRows.length === 0) return null;
  return {
    kind: "table",
    table_index: tableIndex,
    rows: nonEmptyRows,
    contains_image: blockContains(xml, [/<a:blip\b/, /<w:drawing\b/]),
    contains_equation: blockContains(xml, [/<m:oMath\b/, /<m:oMathPara\b/]),
    contains_object: blockContains(xml, [/<w:object\b/, /<v:shape\b/, /<w:pict\b/])
  };
}

function documentBodyXml(documentXml: string) {
  const start = documentXml.indexOf("<w:body");
  if (start < 0) return documentXml;
  const bodyStart = documentXml.indexOf(">", start);
  const end = documentXml.lastIndexOf("</w:body>");
  return bodyStart >= 0 && end > bodyStart ? documentXml.slice(bodyStart + 1, end) : documentXml;
}

function topLevelWordBlocks(documentXml: string) {
  const body = documentBodyXml(documentXml);
  const tagPattern = /<\/?w:(p|tbl)\b[^>]*>/g;
  const blocks: Array<{ type: "p" | "tbl"; xml: string }> = [];
  let depth = 0;
  let startIndex = -1;
  let blockType: "p" | "tbl" | null = null;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(body)) !== null) {
    const tag = match[0];
    const type = match[1] as "p" | "tbl";
    const closing = tag.startsWith("</");
    const selfClosing = tag.endsWith("/>");

    if (!closing && depth === 0) {
      startIndex = match.index;
      blockType = type;
    }
    if (!closing && !selfClosing) depth += 1;
    if (closing) depth = Math.max(0, depth - 1);
    if (depth === 0 && startIndex >= 0 && blockType) {
      blocks.push({ type: blockType, xml: body.slice(startIndex, tagPattern.lastIndex) });
      startIndex = -1;
      blockType = null;
    }
  }

  return blocks;
}

function rejectUnsafeZipEntry(name: string) {
  if (name.startsWith("/") || name.includes("..") || /^[a-zA-Z]:/.test(name)) {
    throw new ContentServiceError(
      "validation_failed",
      "DOCX package contains an unsafe path. No import batch was created.",
      400,
      { unsafe_docx_path: true }
    );
  }
}

function zipEntryUncompressedSize(entry: JSZip.JSZipObject) {
  const internal = entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } };
  return typeof internal._data?.uncompressedSize === "number" ? internal._data.uncompressedSize : 0;
}

async function readZipText(zip: JSZip, path: string) {
  const file = zip.file(path);
  return file ? file.async("text") : null;
}

export async function extractDocxForMcqImport(input: {
  bytes: Buffer;
  sourceFileName?: string | null;
}): Promise<DocxExtraction> {
  assertSupportedDocxFile(input.sourceFileName);
  if (input.bytes.length < 4 || input.bytes.subarray(0, 2).toString("utf8") !== "PK") {
    throw new ContentServiceError(
      "validation_failed",
      "DOCX file could not be parsed as a Word ZIP package. No import batch was created.",
      400
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input.bytes, { checkCRC32: false });
  } catch {
    throw new ContentServiceError(
      "validation_failed",
      "DOCX file could not be parsed as a Word ZIP package. No import batch was created.",
      400
    );
  }

  let uncompressedBytes = 0;
  for (const entry of Object.values(zip.files)) {
    rejectUnsafeZipEntry(entry.name);
    if (!entry.dir) {
      uncompressedBytes += zipEntryUncompressedSize(entry);
    }
  }
  if (uncompressedBytes > DOCX_MAX_UNCOMPRESSED_BYTES) {
    throw new ContentServiceError(
      "validation_failed",
      "DOCX file expands beyond the safe import limit.",
      400,
      { max_uncompressed_bytes: DOCX_MAX_UNCOMPRESSED_BYTES }
    );
  }
  if (uncompressedBytes > 0 && uncompressedBytes / Math.max(input.bytes.length, 1) > DOCX_MAX_COMPRESSION_RATIO) {
    throw new ContentServiceError(
      "validation_failed",
      "DOCX file compression ratio exceeds the safe import limit.",
      400,
      { max_compression_ratio: DOCX_MAX_COMPRESSION_RATIO }
    );
  }

  if (zip.file(/vbaProject\.bin$/i).length > 0) {
    throw new ContentServiceError(
      "validation_failed",
      "Macro-enabled Word documents are not supported for MCQ import.",
      400,
      { unsupported_file_type: "macro_docx" }
    );
  }

  const contentTypes = await readZipText(zip, "[Content_Types].xml");
  if (contentTypes && /EncryptedPackage|application\/vnd\.ms-package\.encrypted/i.test(contentTypes)) {
    throw new ContentServiceError(
      "validation_failed",
      "Password-protected DOCX files cannot be imported. Save an unprotected .docx and upload it again.",
      400,
      { encrypted_docx: true }
    );
  }

  const documentXml = await readZipText(zip, "word/document.xml");
  if (!documentXml) {
    throw new ContentServiceError(
      "validation_failed",
      "DOCX document body is missing or malformed. No import batch was created.",
      400
    );
  }

  let rawText = "";
  try {
    rawText = (await mammoth.extractRawText({ buffer: input.bytes })).value;
  } catch {
    throw new ContentServiceError(
      "validation_failed",
      "DOCX text could not be extracted safely. No import batch was created.",
      400
    );
  }

  const blocks: DocxTextBlock[] = [];
  let paragraphIndex = 0;
  let tableIndex = 0;
  for (const block of topLevelWordBlocks(documentXml)) {
    if (block.type === "p") {
      paragraphIndex += 1;
      const paragraph = parseParagraph(block.xml, paragraphIndex);
      if (paragraph) blocks.push(paragraph);
    } else {
      tableIndex += 1;
      const table = parseTable(block.xml, tableIndex);
      if (table) blocks.push(table);
    }
  }

  const relationshipsXml = await readZipText(zip, "word/_rels/document.xml.rels");
  const externalRelationshipCount = relationshipsXml
    ? (relationshipsXml.match(/TargetMode=["']External["']/g) ?? []).length
    : 0;
  const embeddedImageCount = zip.file(/^word\/media\//i).filter((entry) => !entry.dir).length;
  const equationOrObjectCount = blocks.filter((block) => block.contains_equation || block.contains_object).length;
  const trackedChangeDetected = /<w:(ins|del|moveFrom|moveTo)\b/.test(documentXml);
  const warnings: string[] = [];

  if (embeddedImageCount > 0) warnings.push("embedded_image_requires_manual_reattachment");
  if (equationOrObjectCount > 0) warnings.push("equation_or_object_requires_manual_review");
  if (trackedChangeDetected) warnings.push("tracked_changes_require_teacher_review");
  if (externalRelationshipCount > 0) warnings.push("external_relationships_not_fetched");

  return {
    parser_version: DOCX_PARSER_VERSION,
    source_file_name: safeName(input.sourceFileName),
    raw_text: rawText,
    blocks,
    warnings,
    embedded_image_count: embeddedImageCount,
    equation_or_object_count: equationOrObjectCount,
    external_relationship_count: externalRelationshipCount,
    tracked_change_detected: trackedChangeDetected
  };
}
