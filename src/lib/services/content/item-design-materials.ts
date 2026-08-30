import { createHash } from "node:crypto";
import { extractDocxForMcqImport } from "./mcq-docx-parser";
import { ContentServiceError } from "./errors";

export const ITEM_DESIGN_MAX_ATTACHMENTS = 5;
export const ITEM_DESIGN_MAX_ATTACHMENT_BYTES = 15_000_000;
export const ITEM_DESIGN_MAX_TOTAL_ATTACHMENT_BYTES = 30_000_000;
export const ITEM_DESIGN_MAX_EXTRACTED_TEXT_CHARACTERS = 50_000;

export type IncomingItemDesignMaterial = {
  file_name: string;
  media_type: string;
  bytes: Buffer;
};

export type PreparedItemDesignMaterial = {
  material_id: string;
  client_message_id: string;
  file_name: string;
  media_type: string;
  source_kind: "docx" | "pdf" | "image";
  byte_size: number;
  sha256: string;
  parser_version: string | null;
  extracted_text: string | null;
  warnings: string[];
  provider_attachment: {
    material_id: string;
    kind: "pdf" | "image";
    file_name: string;
    media_type: string;
    bytes: Buffer;
  } | null;
};

function safeFileName(value: string) {
  const name = value.split(/[\\/]/).pop()?.trim() ?? "";
  if (!name) {
    throw new ContentServiceError(
      "validation_failed",
      "Each course-material attachment needs a valid file name.",
      400
    );
  }
  return name.slice(0, 240);
}

function lowerExtension(fileName: string) {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match?.[1]?.toLowerCase() ?? "";
}

function isPdf(bytes: Buffer) {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

function imageKind(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function validateCollectionLimits(files: IncomingItemDesignMaterial[]) {
  if (files.length > ITEM_DESIGN_MAX_ATTACHMENTS) {
    throw new ContentServiceError(
      "validation_failed",
      `Attach no more than ${ITEM_DESIGN_MAX_ATTACHMENTS} files in one message.`,
      400,
      { max_attachments: ITEM_DESIGN_MAX_ATTACHMENTS }
    );
  }
  const totalBytes = files.reduce((total, file) => total + file.bytes.length, 0);
  if (totalBytes > ITEM_DESIGN_MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new ContentServiceError(
      "validation_failed",
      "The selected course materials are too large to process together.",
      400,
      { max_total_bytes: ITEM_DESIGN_MAX_TOTAL_ATTACHMENT_BYTES }
    );
  }
}

export async function prepareItemDesignMaterials(input: {
  client_message_id: string;
  files: IncomingItemDesignMaterial[];
}): Promise<PreparedItemDesignMaterial[]> {
  validateCollectionLimits(input.files);
  const seenHashes = new Set<string>();
  const prepared: PreparedItemDesignMaterial[] = [];

  for (const file of input.files) {
    const fileName = safeFileName(file.file_name);
    if (file.bytes.length === 0) {
      throw new ContentServiceError("validation_failed", `${fileName} is empty.`, 400);
    }
    if (file.bytes.length > ITEM_DESIGN_MAX_ATTACHMENT_BYTES) {
      throw new ContentServiceError(
        "validation_failed",
        `${fileName} is larger than the 15 MB attachment limit.`,
        400,
        { max_file_bytes: ITEM_DESIGN_MAX_ATTACHMENT_BYTES }
      );
    }

    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    if (seenHashes.has(sha256)) {
      throw new ContentServiceError(
        "validation_failed",
        `${fileName} was selected more than once.`,
        400,
        { duplicate_attachment: true }
      );
    }
    seenHashes.add(sha256);
    const materialId = `material_${sha256.slice(0, 24)}`;
    const extension = lowerExtension(fileName);
    const declaredMediaType = file.media_type.toLowerCase();

    if (extension === "docx") {
      if (
        declaredMediaType &&
        declaredMediaType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
        declaredMediaType !== "application/octet-stream"
      ) {
        throw new ContentServiceError(
          "validation_failed",
          `${fileName} does not have a valid Word document type.`,
          400
        );
      }
      const extraction = await extractDocxForMcqImport({
        bytes: file.bytes,
        sourceFileName: fileName
      });
      const normalizedText = extraction.raw_text.replace(/\u0000/g, "").trim();
      if (!normalizedText) {
        throw new ContentServiceError(
          "validation_failed",
          `${fileName} does not contain readable text. Add screenshots separately if the document is image-based.`,
          400
        );
      }
      const truncated = normalizedText.length > ITEM_DESIGN_MAX_EXTRACTED_TEXT_CHARACTERS;
      prepared.push({
        material_id: materialId,
        client_message_id: input.client_message_id,
        file_name: fileName,
        media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        source_kind: "docx",
        byte_size: file.bytes.length,
        sha256,
        parser_version: extraction.parser_version,
        extracted_text: normalizedText.slice(0, ITEM_DESIGN_MAX_EXTRACTED_TEXT_CHARACTERS),
        warnings: [
          ...extraction.warnings,
          ...(truncated ? ["text_truncated_to_safe_authoring_limit"] : [])
        ],
        provider_attachment: null
      });
      continue;
    }

    if (extension === "pdf") {
      if (
        declaredMediaType &&
        declaredMediaType !== "application/pdf" &&
        declaredMediaType !== "application/octet-stream"
      ) {
        throw new ContentServiceError(
          "validation_failed",
          `${fileName} does not have a valid PDF type.`,
          400
        );
      }
      if (!isPdf(file.bytes)) {
        throw new ContentServiceError(
          "validation_failed",
          `${fileName} is not a valid PDF file.`,
          400
        );
      }
      prepared.push({
        material_id: materialId,
        client_message_id: input.client_message_id,
        file_name: fileName,
        media_type: "application/pdf",
        source_kind: "pdf",
        byte_size: file.bytes.length,
        sha256,
        parser_version: null,
        extracted_text: null,
        warnings: [],
        provider_attachment: {
          material_id: materialId,
          kind: "pdf",
          file_name: fileName,
          media_type: "application/pdf",
          bytes: file.bytes
        }
      });
      continue;
    }

    if (["png", "jpg", "jpeg", "webp"].includes(extension)) {
      const detectedMediaType = imageKind(file.bytes);
      if (!detectedMediaType) {
        throw new ContentServiceError(
          "validation_failed",
          `${fileName} is not a valid PNG, JPEG, or WebP image.`,
          400
        );
      }
      if (declaredMediaType && declaredMediaType !== detectedMediaType) {
        throw new ContentServiceError(
          "validation_failed",
          `${fileName} content does not match its declared image type.`,
          400
        );
      }
      prepared.push({
        material_id: materialId,
        client_message_id: input.client_message_id,
        file_name: fileName,
        media_type: detectedMediaType,
        source_kind: "image",
        byte_size: file.bytes.length,
        sha256,
        parser_version: null,
        extracted_text: null,
        warnings: [],
        provider_attachment: {
          material_id: materialId,
          kind: "image",
          file_name: fileName,
          media_type: detectedMediaType,
          bytes: file.bytes
        }
      });
      continue;
    }

    throw new ContentServiceError(
      "validation_failed",
      `${fileName} is not supported. Upload PDF, DOCX, PNG, JPEG, or WebP files.`,
      400,
      { supported_extensions: ["pdf", "docx", "png", "jpg", "jpeg", "webp"] }
    );
  }

  return prepared;
}

export function materialProviderContext(material: PreparedItemDesignMaterial) {
  return {
    material_id: material.material_id,
    client_message_id: material.client_message_id,
    file_name: material.file_name,
    media_type: material.media_type,
    source_kind: material.source_kind,
    byte_size: material.byte_size,
    sha256: material.sha256,
    parser_version: material.parser_version,
    extracted_text: material.extracted_text,
    warnings: material.warnings,
    content_delivery:
      material.source_kind === "docx"
        ? "extracted_text_in_context"
        : "multimodal_attachment_in_current_request"
  };
}
