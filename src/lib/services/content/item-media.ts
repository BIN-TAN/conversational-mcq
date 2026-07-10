import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type {
  ItemMediaAsset,
  ItemMediaPlacement,
  ItemMediaSourceType,
  ItemMediaType,
  Prisma
} from "@prisma/client";
import { z } from "zod";
import { generatePublicId } from "@/lib/services/ids";
import { ContentServiceError } from "./errors";

export const ITEM_MEDIA_CONTEXT_VERSION = "item-media-context-v1" as const;
export const ITEM_MEDIA_HIGHER_ORDER_POLICY =
  "apply_analyze_evaluate_default" as const;
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

const ImageMimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
const MediaTypeSchema = z.enum(["image", "video", "reference_link"]);
const MediaPlacementSchema = z.enum(["item_stem", "option"]);
const MediaSourceTypeSchema = z.enum(["uploaded", "external_url"]);

export const ItemMediaAssetInputSchema = z
  .object({
    media_public_id: z.string().trim().min(1).optional(),
    placement: MediaPlacementSchema.default("item_stem"),
    option_label: z.string().trim().min(1).max(16).optional().nullable(),
    media_type: MediaTypeSchema,
    source_type: MediaSourceTypeSchema,
    storage_key: z.string().trim().min(1).optional().nullable(),
    public_or_signed_url: z.string().trim().min(1).optional().nullable(),
    external_url: z.string().trim().min(1).optional().nullable(),
    title: z.string().trim().optional().nullable(),
    alt_text_or_description: z.string().trim().min(1),
    caption: z.string().trim().optional().nullable(),
    transcript_or_content_summary: z.string().trim().optional().nullable(),
    source_attribution: z.string().trim().optional().nullable(),
    order_index: z.number().int().nonnegative().default(0),
    active: z.boolean().default(true)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.placement === "option" && !value.option_label) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["option_label"],
        message: "Option media must identify the option label."
      });
    }

    if (value.placement === "item_stem" && value.option_label) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["option_label"],
        message: "Stem media must not be attached to an option label."
      });
    }

    if (value.source_type === "external_url" && !value.external_url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["external_url"],
        message: "External media requires an HTTPS URL."
      });
    }

    if (value.source_type === "uploaded" && !value.storage_key && !value.public_or_signed_url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storage_key"],
        message: "Uploaded media requires a storage reference."
      });
    }

    if (value.media_type === "video" && !value.transcript_or_content_summary) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transcript_or_content_summary"],
        message: "Video media requires a transcript or content summary for interpretation."
      });
    }
  });

export type ItemMediaAssetInput = z.infer<typeof ItemMediaAssetInputSchema>;

export type MediaStoragePutInput = {
  bytes: Uint8Array;
  content_type: z.infer<typeof ImageMimeTypeSchema>;
  original_filename?: string | null;
};

export type MediaStoragePutResult = {
  storage_key: string;
  public_or_signed_url: string;
};

export type MediaStorageProvider = {
  putObject(input: MediaStoragePutInput): Promise<MediaStoragePutResult>;
};

export type MediaStorageStatus = {
  configured: boolean;
  provider: "s3" | "none";
  missing_env: string[];
  uploads_enabled: boolean;
};

const STORAGE_ENV_KEYS = [
  "MEDIA_STORAGE_BUCKET",
  "MEDIA_STORAGE_REGION",
  "MEDIA_STORAGE_ENDPOINT",
  "MEDIA_STORAGE_ACCESS_KEY_ID",
  "MEDIA_STORAGE_SECRET_ACCESS_KEY",
  "MEDIA_STORAGE_PUBLIC_BASE_URL"
] as const;

function trim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optional(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function hash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function privateIpv4(hostname: string) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized.startsWith("169.254.")
  ) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return privateIpv4(normalized);
  }

  if (ipVersion === 6) {
    return (
      normalized === "::1" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd")
    );
  }

  return false;
}

export function assertSafeExternalMediaUrl(value: string, path = "external_url") {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ContentServiceError("validation_failed", "Media URL is invalid.", 400, {
      path,
      reason: "invalid_url"
    });
  }

  if (parsed.protocol !== "https:") {
    throw new ContentServiceError("validation_failed", "Media URL must use HTTPS.", 400, {
      path,
      reason: "unsupported_url_scheme"
    });
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new ContentServiceError(
      "validation_failed",
      "Media URL points to a blocked host.",
      400,
      { path, reason: "blocked_private_or_local_host" }
    );
  }

  return parsed.toString();
}

export function assertApprovedVideoUrl(value: string) {
  const parsed = new URL(assertSafeExternalMediaUrl(value, "external_url"));
  const allowed = ["youtube.com", "www.youtube.com", "youtu.be", "vimeo.com", "www.vimeo.com"];
  const extraAllowed = (process.env.MEDIA_VIDEO_EMBED_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const allowedHosts = new Set([...allowed, ...extraAllowed]);

  if (!allowedHosts.has(parsed.hostname.toLowerCase())) {
    throw new ContentServiceError(
      "validation_failed",
      "Video URL host is not on the approved allow-list.",
      400,
      { path: "external_url", reason: "video_host_not_allowlisted" }
    );
  }

  return parsed.toString();
}

export function mediaStorageStatus(env: NodeJS.ProcessEnv = process.env): MediaStorageStatus {
  const provider = env.MEDIA_STORAGE_PROVIDER === "s3" ? "s3" : "none";
  const missing = provider === "s3"
    ? STORAGE_ENV_KEYS.filter((key) => !trim(env[key]))
    : [...STORAGE_ENV_KEYS];

  return {
    provider,
    configured: provider === "s3" && missing.length === 0,
    missing_env: missing,
    uploads_enabled: provider === "s3" && missing.length === 0
  };
}

export function safeStorageKey(contentType: string) {
  const extension = contentType === "image/png"
    ? "png"
    : contentType === "image/jpeg"
      ? "jpg"
      : "webp";

  return `item-media/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
}

export function validateImageUploadForMedia(input: MediaStoragePutInput) {
  const contentType = ImageMimeTypeSchema.parse(input.content_type);
  if (input.bytes.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
    throw new ContentServiceError("validation_failed", "Image upload is too large.", 400, {
      max_bytes: MAX_IMAGE_UPLOAD_BYTES
    });
  }

  const bytes = input.bytes;
  const signature = Array.from(bytes.slice(0, 12));
  const png = signature[0] === 0x89 && signature[1] === 0x50 && signature[2] === 0x4e && signature[3] === 0x47;
  const jpeg = signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  const webp =
    signature[0] === 0x52 &&
    signature[1] === 0x49 &&
    signature[2] === 0x46 &&
    signature[3] === 0x46 &&
    signature[8] === 0x57 &&
    signature[9] === 0x45 &&
    signature[10] === 0x42 &&
    signature[11] === 0x50;

  const validSignature =
    (contentType === "image/png" && png) ||
    (contentType === "image/jpeg" && jpeg) ||
    (contentType === "image/webp" && webp);

  if (!validSignature) {
    throw new ContentServiceError("validation_failed", "Image upload signature did not match its MIME type.", 400, {
      content_type: contentType
    });
  }

  return { content_type: contentType, byte_length: bytes.byteLength };
}

export async function prepareUploadedImageMedia(input: {
  file: MediaStoragePutInput;
  alt_text_or_description: string;
  storage: MediaStorageProvider;
  placement?: ItemMediaPlacement;
  option_label?: string | null;
  title?: string | null;
  caption?: string | null;
  source_attribution?: string | null;
  order_index?: number;
}) {
  validateImageUploadForMedia(input.file);
  const stored = await input.storage.putObject(input.file);

  return normalizeItemMediaAssetInput({
    media_type: "image",
    source_type: "uploaded",
    placement: input.placement ?? "item_stem",
    option_label: input.option_label,
    storage_key: stored.storage_key,
    public_or_signed_url: stored.public_or_signed_url,
    alt_text_or_description: input.alt_text_or_description,
    title: input.title,
    caption: input.caption,
    source_attribution: input.source_attribution,
    order_index: input.order_index ?? 0
  });
}

export function normalizeItemMediaAssetInput(input: unknown): ItemMediaAssetInput {
  const parsed = ItemMediaAssetInputSchema.parse(input);
  const externalUrl = parsed.external_url
    ? parsed.media_type === "video"
      ? assertApprovedVideoUrl(parsed.external_url)
      : assertSafeExternalMediaUrl(parsed.external_url)
    : null;
  const publicUrl = parsed.public_or_signed_url
    ? assertSafeExternalMediaUrl(parsed.public_or_signed_url, "public_or_signed_url")
    : null;

  return {
    ...parsed,
    media_public_id: parsed.media_public_id ?? generatePublicId("item_media"),
    external_url: externalUrl,
    public_or_signed_url: publicUrl,
    title: optional(parsed.title),
    caption: optional(parsed.caption),
    transcript_or_content_summary: optional(parsed.transcript_or_content_summary),
    source_attribution: optional(parsed.source_attribution),
    option_label: parsed.placement === "option" ? trim(parsed.option_label) : null
  };
}

export function normalizeItemMediaAssetInputs(value: unknown): ItemMediaAssetInput[] {
  const entries = Array.isArray(value) ? value : [];

  return entries
    .map(normalizeItemMediaAssetInput)
    .sort((left, right) => left.order_index - right.order_index);
}

export function mediaContextHash(input: {
  media_type: ItemMediaType | string;
  placement: ItemMediaPlacement | string;
  option_label?: string | null;
  alt_text_or_description: string;
  caption?: string | null;
  transcript_or_content_summary?: string | null;
  source_attribution?: string | null;
}) {
  return hash({
    media_type: input.media_type,
    placement: input.placement,
    option_label: input.option_label ?? null,
    alt_text_or_description: input.alt_text_or_description,
    caption: input.caption ?? null,
    transcript_or_content_summary: input.transcript_or_content_summary ?? null,
    source_attribution: input.source_attribution ?? null
  });
}

export function itemMediaCreateData(
  itemDbId: string,
  input: ItemMediaAssetInput
): Prisma.ItemMediaAssetCreateManyInput {
  return {
    media_public_id: input.media_public_id ?? generatePublicId("item_media"),
    item_db_id: itemDbId,
    option_label: input.option_label ?? null,
    placement: input.placement as ItemMediaPlacement,
    media_type: input.media_type as ItemMediaType,
    source_type: input.source_type as ItemMediaSourceType,
    storage_key: input.storage_key ?? null,
    public_or_signed_url: input.public_or_signed_url ?? null,
    external_url: input.external_url ?? null,
    title: input.title ?? null,
    alt_text_or_description: input.alt_text_or_description,
    caption: input.caption ?? null,
    transcript_or_content_summary: input.transcript_or_content_summary ?? null,
    source_attribution: input.source_attribution ?? null,
    media_context_hash: mediaContextHash(input),
    order_index: input.order_index,
    active: input.active,
    media_version: 1
  };
}

export function serializeItemMediaAsset(
  asset: Pick<
    ItemMediaAsset,
    | "media_public_id"
    | "option_label"
    | "placement"
    | "media_type"
    | "source_type"
    | "public_or_signed_url"
    | "external_url"
    | "title"
    | "alt_text_or_description"
    | "caption"
    | "transcript_or_content_summary"
    | "source_attribution"
    | "media_context_hash"
    | "order_index"
    | "active"
    | "media_version"
  >
) {
  return {
    media_public_id: asset.media_public_id,
    placement: asset.placement,
    option_label: asset.option_label,
    media_type: asset.media_type,
    source_type: asset.source_type,
    url: asset.public_or_signed_url ?? asset.external_url ?? null,
    title: asset.title,
    alt_text_or_description: asset.alt_text_or_description,
    caption: asset.caption,
    transcript_or_content_summary: asset.transcript_or_content_summary,
    source_attribution: asset.source_attribution,
    media_context_hash: asset.media_context_hash,
    media_version: asset.media_version,
    order_index: asset.order_index,
    active: asset.active
  };
}

export function mediaAssetsForInput(
  assets: Array<Pick<
    ItemMediaAsset,
    | "media_public_id"
    | "option_label"
    | "placement"
    | "media_type"
    | "source_type"
    | "public_or_signed_url"
    | "external_url"
    | "title"
    | "alt_text_or_description"
    | "caption"
    | "transcript_or_content_summary"
    | "source_attribution"
    | "order_index"
    | "active"
  >>
) {
  return assets.map((asset) => ({
    media_public_id: asset.media_public_id,
    placement: asset.placement,
    option_label: asset.option_label,
    media_type: asset.media_type,
    source_type: asset.source_type,
    public_or_signed_url: asset.public_or_signed_url,
    external_url: asset.external_url,
    title: asset.title,
    alt_text_or_description: asset.alt_text_or_description,
    caption: asset.caption,
    transcript_or_content_summary: asset.transcript_or_content_summary,
    source_attribution: asset.source_attribution,
    order_index: asset.order_index,
    active: asset.active
  }));
}

export function llmMediaContextForAssets(
  assets: Array<Pick<
    ItemMediaAsset,
    | "media_public_id"
    | "option_label"
    | "placement"
    | "media_type"
    | "source_type"
    | "title"
    | "alt_text_or_description"
    | "caption"
    | "transcript_or_content_summary"
    | "source_attribution"
    | "media_context_hash"
    | "order_index"
    | "active"
    | "media_version"
  >>
) {
  return assets
    .filter((asset) => asset.active)
    .sort((left, right) => left.order_index - right.order_index)
    .map((asset) => ({
      context_version: ITEM_MEDIA_CONTEXT_VERSION,
      media_public_id: asset.media_public_id,
      media_type: asset.media_type,
      placement: asset.placement,
      option_label: asset.option_label,
      title: asset.title,
      alt_text_or_description: asset.alt_text_or_description,
      caption: asset.caption,
      transcript_or_content_summary: asset.transcript_or_content_summary,
      source_attribution: asset.source_attribution,
      media_version: asset.media_version,
      media_context_hash: asset.media_context_hash,
      direct_multimodal_input_supplied: false,
      limitations: [
        asset.media_type === "image"
          ? "image_context_from_teacher_description_not_direct_image"
          : null,
        asset.media_type === "video"
          ? "video_context_from_transcript_or_summary_not_direct_video"
          : null,
        asset.media_type === "reference_link"
          ? "reference_link_content_not_fetched"
          : null,
        "llm_must_not_infer_unseen_media_content"
      ].filter((entry): entry is string => Boolean(entry))
    }));
}

export function mediaTypeSummary(assets: Array<Pick<ItemMediaAsset, "media_type" | "active">>) {
  const active = assets.filter((asset) => asset.active);
  const counts = active.reduce<Record<string, number>>((summary, asset) => {
    summary[asset.media_type] = (summary[asset.media_type] ?? 0) + 1;
    return summary;
  }, {});

  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `${type}:${count}`)
    .join(",");
}
