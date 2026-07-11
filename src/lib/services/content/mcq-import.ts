import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { ensureMiniTestPrimaryConceptUnit } from "./assessments";
import { ContentServiceError } from "./errors";
import { assertAssessmentEditable } from "./governance";
import { replaceItemMediaAssets } from "./items";
import {
  assertApprovedVideoUrl,
  assertSafeExternalMediaUrl,
  normalizeItemMediaAssetInputs
} from "./item-media";
import {
  buildItemAdministrationRulesFromTeacherMetadata,
  readTeacherItemMetadata,
  type TeacherDiagnosticOptionNote
} from "./teacher-diagnostic-context";

const MCQ_IMPORT_SCHEMA_VERSION = "mcq-item-import-v1" as const;
const DIAGNOSTIC_ASSISTANT_PROMPT_VERSION = "mcq-diagnostic-authoring-assistant-v1" as const;
const DIAGNOSTIC_ASSISTANT_SCHEMA_VERSION = "mcq-diagnostic-authoring-suggestion-v1" as const;

const importSourceTypes = ["csv", "xlsx", "plain_text", "project_json"] as const;
const ImportSourceTypeSchema = z.enum(importSourceTypes);
export type McqImportSourceType = z.infer<typeof ImportSourceTypeSchema>;

const canonicalColumns = [
  "item_label",
  "stem",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "option_e",
  "key",
  "target_reasoning_note",
  "strong_reasoning_should_mention",
  "distractor_diagnostic_notes",
  "image_url",
  "video_url",
  "reference_url",
  "student_alt_text",
  "teacher_llm_media_description",
  "source_attribution"
] as const;
type CanonicalColumn = (typeof canonicalColumns)[number];

const McqImportPreviewInputSchema = z
  .object({
    source_type: ImportSourceTypeSchema,
    source_text: z.string().optional(),
    file_base64: z.string().optional(),
    source_file_name: z.string().trim().optional().nullable(),
    column_mapping: z.record(z.string().trim()).optional(),
    assisted_parsing_requested: z.boolean().default(false)
  })
  .strict();

const CandidateOptionSchema = z.object({
  label: z.string(),
  text: z.string()
});

const CandidateMediaAssetSchema = z.object({
  media_type: z.enum(["image", "video", "reference_link"]),
  source_type: z.literal("external_url"),
  external_url: z.string(),
  placement: z.enum(["item_stem", "option"]).default("item_stem"),
  option_label: z.string().nullable().optional(),
  alt_text_or_description: z.string(),
  student_alt_text: z.string().nullable().optional(),
  teacher_llm_media_description: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  transcript_or_content_summary: z.string().nullable().optional(),
  source_attribution: z.string().nullable().optional(),
  order_index: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true)
});

const CandidateStatusSchema = z.enum([
  "parsed",
  "needs_review",
  "needs_key",
  "needs_options",
  "key_conflict",
  "ready_as_draft",
  "imported",
  "rejected",
  "blocked"
]);

const McqSuggestionDecisionSchema = z.enum([
  "accept",
  "edit_accept",
  "reject",
  "leave_blank"
]);

const McqSuggestionFieldDecisionSchema = z.object({
  decision: McqSuggestionDecisionSchema,
  edited_value: z.string().optional().nullable()
});

const McqImportCandidateSchema = z.object({
  candidate_public_id: z.string(),
  source_item_number: z.number().int().positive(),
  source_location: z.string(),
  source_line_range: z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).nullable(),
  item_label: z.string().nullable(),
  stem: z.string(),
  options: z.array(CandidateOptionSchema),
  imported_key: z.string().nullable(),
  llm_suggested_key: z.string().nullable(),
  teacher_confirmed_key: z.string().nullable(),
  target_reasoning_note: z.string().nullable(),
  strong_reasoning_should_mention: z.string().nullable(),
  distractor_diagnostic_notes: z.string().nullable(),
  media_assets: z.array(CandidateMediaAssetSchema),
  missing_fields: z.array(z.string()),
  parsing_confidence: z.number().min(0).max(1),
  issue_flags: z.array(z.string()),
  duplicate_warnings: z.array(z.object({
    scope: z.enum(["batch", "assessment", "teacher_owned"]),
    existing_assessment_public_id: z.string().nullable(),
    existing_assessment_title: z.string().nullable(),
    existing_item_public_id: z.string().nullable(),
    message: z.string()
  })),
  status: CandidateStatusSchema,
  import_selected: z.boolean(),
  original_source_text: z.string(),
  normalized_changed_wording: z.boolean(),
  normalized_diff_summary: z.string().nullable(),
  suggestion: z.unknown().nullable().optional(),
  suggestion_decisions: z.record(McqSuggestionFieldDecisionSchema).optional(),
  imported_item_public_id: z.string().nullable().optional()
});

export type McqImportCandidate = z.infer<typeof McqImportCandidateSchema>;

const CandidatesPayloadSchema = z.object({
  schema_version: z.literal(MCQ_IMPORT_SCHEMA_VERSION),
  candidates: z.array(McqImportCandidateSchema)
});

const CandidateCommitUpdateSchema = z
  .object({
    candidate_public_id: z.string(),
    import_selected: z.boolean().optional(),
    item_label: z.string().optional().nullable(),
    stem: z.string().optional(),
    options: z.array(CandidateOptionSchema).optional(),
    teacher_confirmed_key: z.string().optional().nullable(),
    target_reasoning_note: z.string().optional().nullable(),
    strong_reasoning_should_mention: z.string().optional().nullable(),
    distractor_diagnostic_notes: z.string().optional().nullable(),
    media_assets: z.array(CandidateMediaAssetSchema).optional(),
    suggestion_decisions: z.record(McqSuggestionFieldDecisionSchema).optional()
  })
  .strict();

const SuggestDiagnosticInputSchema = z
  .object({
    candidate_public_ids: z.array(z.string()).optional(),
    candidate_updates: z.array(CandidateCommitUpdateSchema).default([]),
    mode: z.enum(["mock", "live"]).default("mock")
  })
  .strict();

const CommitImportInputSchema = z
  .object({
    candidate_updates: z.array(CandidateCommitUpdateSchema).default([]),
    selected_candidate_public_ids: z.array(z.string()).optional()
  })
  .strict();

type RowRecord = Record<string, unknown>;

type CandidateDraft = {
  item_label: string | null;
  stem: string;
  options: Array<{ label: string; text: string }>;
  imported_key: string | null;
  target_reasoning_note: string | null;
  strong_reasoning_should_mention: string | null;
  distractor_diagnostic_notes: string | null;
  media_assets: z.infer<typeof CandidateMediaAssetSchema>[];
  original_source_text: string;
  source_location: string;
  source_line_range: { start: number; end: number } | null;
  parsing_confidence: number;
  issue_flags: string[];
};

function compactString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeTextForHash(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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

function sha256(value: string | Buffer | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function toRequiredPrismaJson(value: unknown) {
  const json = toPrismaJson(value);
  if (json === undefined) {
    throw new Error("Required JSON value cannot be undefined.");
  }
  return json;
}

function decodeBase64(input: string): Buffer {
  return Buffer.from(input, "base64");
}

function sourceText(input: z.infer<typeof McqImportPreviewInputSchema>) {
  if (input.source_text !== undefined) {
    return input.source_text;
  }

  if (input.file_base64) {
    return decodeBase64(input.file_base64).toString("utf8");
  }

  return "";
}

function candidateSignature(input: { stem: string; options: Array<{ label: string; text: string }> }) {
  return sha256(
    stableJson({
      stem: normalizeTextForHash(input.stem),
      options: input.options.map((option) => ({
        label: normalizeTextForHash(option.label),
        text: normalizeTextForHash(option.text)
      }))
    })
  );
}

function stemSignature(stem: string) {
  return sha256(normalizeTextForHash(stem));
}

function columnSynonyms(): Record<CanonicalColumn, string[]> {
  return {
    item_label: ["item_label", "label", "item", "item_id", "question_label"],
    stem: ["stem", "question", "item_stem", "prompt"],
    option_a: ["option_a", "a", "answer_a", "choice_a"],
    option_b: ["option_b", "b", "answer_b", "choice_b"],
    option_c: ["option_c", "c", "answer_c", "choice_c"],
    option_d: ["option_d", "d", "answer_d", "choice_d"],
    option_e: ["option_e", "e", "answer_e", "choice_e"],
    key: ["key", "answer", "correct", "correct_option", "correct_answer"],
    target_reasoning_note: ["target_reasoning_note", "target_reasoning", "expected_reasoning"],
    strong_reasoning_should_mention: [
      "strong_reasoning_should_mention",
      "strong_reasoning",
      "should_mention"
    ],
    distractor_diagnostic_notes: [
      "distractor_diagnostic_notes",
      "diagnostic_notes",
      "distractor_notes",
      "plain_language_distractor_diagnostic_notes"
    ],
    image_url: ["image_url", "image", "media_image_url"],
    video_url: ["video_url", "video", "media_video_url"],
    reference_url: ["reference_url", "reference", "link", "source_url"],
    student_alt_text: ["student_alt_text", "alt_text", "student_media_description"],
    teacher_llm_media_description: [
      "teacher_llm_media_description",
      "teacher_media_description",
      "media_description"
    ],
    source_attribution: ["source_attribution", "source", "citation"]
  };
}

function valueForColumn(row: RowRecord, column: CanonicalColumn, mapping: Record<string, string>) {
  const mappedHeader = mapping[column];
  if (mappedHeader && Object.prototype.hasOwnProperty.call(row, mappedHeader)) {
    return compactString(row[mappedHeader]);
  }

  const normalizedEntries = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value] as const)
  );
  for (const synonym of columnSynonyms()[column]) {
    const value = normalizedEntries.get(normalizeHeader(synonym));
    const normalized = compactString(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function keyLabel(value: string | null) {
  if (!value) return null;
  const match = value.trim().match(/[A-Za-z]/);
  return match ? match[0].toUpperCase() : value.trim();
}

function mediaAssetsFromRow(row: RowRecord, mapping: Record<string, string>) {
  const studentAlt = valueForColumn(row, "student_alt_text", mapping);
  const teacherDescription = valueForColumn(row, "teacher_llm_media_description", mapping);
  const sourceAttribution = valueForColumn(row, "source_attribution", mapping);
  const description = teacherDescription ?? studentAlt;
  const assets: z.infer<typeof CandidateMediaAssetSchema>[] = [];

  function pushMedia(media_type: "image" | "video" | "reference_link", urlColumn: CanonicalColumn) {
    const url = valueForColumn(row, urlColumn, mapping);
    if (!url) return;

    try {
      const safeUrl =
        media_type === "video" ? assertApprovedVideoUrl(url) : assertSafeExternalMediaUrl(url);
      if (!description) {
        return;
      }
      assets.push({
        media_type,
        source_type: "external_url",
        external_url: safeUrl,
        placement: "item_stem",
        option_label: null,
        alt_text_or_description: description,
        student_alt_text: studentAlt,
        teacher_llm_media_description: teacherDescription,
        caption: null,
        transcript_or_content_summary: media_type === "video" ? teacherDescription : null,
        source_attribution: sourceAttribution,
        order_index: assets.length,
        active: true
      });
    } catch {
      return;
    }
  }

  pushMedia("image", "image_url");
  pushMedia("video", "video_url");
  pushMedia("reference_link", "reference_url");
  return assets;
}

function draftFromRow(row: RowRecord, rowIndex: number, mapping: Record<string, string>): CandidateDraft {
  const options = ["A", "B", "C", "D", "E"]
    .map((label) => ({
      label,
      text: valueForColumn(row, `option_${label.toLowerCase()}` as CanonicalColumn, mapping)
    }))
    .filter((option): option is { label: string; text: string } => Boolean(option.text));
  const stem = valueForColumn(row, "stem", mapping) ?? "";
  const importedKey = keyLabel(valueForColumn(row, "key", mapping));
  const issueFlags: string[] = [];

  if (!stem) issueFlags.push("missing_stem");
  if (options.length < 2) issueFlags.push("too_few_options");
  if (!importedKey) issueFlags.push("key_missing");
  if (importedKey && !options.some((option) => option.label === importedKey)) {
    issueFlags.push("key_conflict");
  }

  const originalSourceText = stableJson(row);
  return {
    item_label: valueForColumn(row, "item_label", mapping),
    stem,
    options,
    imported_key: importedKey,
    target_reasoning_note: valueForColumn(row, "target_reasoning_note", mapping),
    strong_reasoning_should_mention: valueForColumn(row, "strong_reasoning_should_mention", mapping),
    distractor_diagnostic_notes: valueForColumn(row, "distractor_diagnostic_notes", mapping),
    media_assets: mediaAssetsFromRow(row, mapping),
    original_source_text: originalSourceText,
    source_location: `row ${rowIndex + 1}`,
    source_line_range: null,
    parsing_confidence: issueFlags.includes("missing_stem") || issueFlags.includes("too_few_options") ? 0.35 : 0.95,
    issue_flags: issueFlags
  };
}

function parseCsvRows(text: string): RowRecord[] {
  return parseCsv(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as RowRecord[];
}

function parseXlsxRows(bytes: Buffer): RowRecord[] {
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  return XLSX.utils.sheet_to_json<RowRecord>(workbook.Sheets[sheetName], {
    defval: "",
    raw: false
  });
}

function parsePlainTextItems(text: string): CandidateDraft[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const starts: Array<{ line: number; label: string | null }> = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*(\d+)[.)]\s*(.*)$/);
    if (match) {
      starts.push({ line: index, label: match[1] ?? null });
    }
  }

  const blocks = starts.length > 0
    ? starts.map((start, index) => ({
        start: start.line,
        end: (starts[index + 1]?.line ?? lines.length) - 1,
        label: start.label
      }))
    : [{ start: 0, end: lines.length - 1, label: null }];

  return blocks.map((block) => {
    const blockLines = lines.slice(block.start, block.end + 1);
    const stemLines: string[] = [];
    const options: Array<{ label: string; text: string }> = [];
    let importedKey: string | null = null;
    let firstOptionSeen = false;

    for (let offset = 0; offset < blockLines.length; offset += 1) {
      const rawLine = blockLines[offset] ?? "";
      const line = rawLine.trim();
      if (!line) continue;

      const numbered = offset === 0 ? line.match(/^\d+[.)]\s*(.*)$/) : null;
      const content = numbered ? (numbered[1] ?? "").trim() : line;
      if (!content) continue;

      const option = content.match(/^([A-Ea-e])[.)]\s+(.+)$/);
      if (option) {
        firstOptionSeen = true;
        options.push({ label: option[1]!.toUpperCase(), text: option[2]!.trim() });
        continue;
      }

      const answer = content.match(/^(answer|key|correct)\s*[:\-]\s*([A-Ea-e])\b/i);
      if (answer) {
        importedKey = answer[2]!.toUpperCase();
        continue;
      }

      if (!firstOptionSeen) {
        stemLines.push(content);
      }
    }

    const stem = stemLines.join(" ").trim();
    const issueFlags: string[] = [];
    if (!stem) issueFlags.push("missing_stem");
    if (options.length < 2) issueFlags.push("too_few_options");
    if (!importedKey) issueFlags.push("key_missing");
    if (importedKey && !options.some((option) => option.label === importedKey)) {
      issueFlags.push("key_conflict");
    }

    return {
      item_label: block.label ? `Item ${block.label}` : null,
      stem,
      options,
      imported_key: importedKey,
      target_reasoning_note: null,
      strong_reasoning_should_mention: null,
      distractor_diagnostic_notes: null,
      media_assets: [],
      original_source_text: blockLines.join("\n"),
      source_location: `lines ${block.start + 1}-${block.end + 1}`,
      source_line_range: { start: block.start + 1, end: block.end + 1 },
      parsing_confidence:
        issueFlags.includes("too_few_options") || issueFlags.includes("missing_stem")
          ? 0.4
          : 0.9,
      issue_flags: issueFlags.length > 0 ? issueFlags : []
    };
  });
}

function optionsFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const label = compactString(record.label) ?? String.fromCharCode(65 + index);
      const text = compactString(record.text);
      return text ? { label: label.toUpperCase(), text } : null;
    })
    .filter((entry): entry is { label: string; text: string } => Boolean(entry));
}

function parseProjectJsonItems(text: string): CandidateDraft[] {
  const parsed = JSON.parse(text) as unknown;
  const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const conceptUnits = Array.isArray(root.concept_units) ? root.concept_units : [];
  const rawItems =
    conceptUnits.length > 0
      ? conceptUnits.flatMap((unit) => {
          const record = unit && typeof unit === "object" ? (unit as Record<string, unknown>) : {};
          return Array.isArray(record.items) ? record.items : [];
        })
      : Array.isArray(root.items)
        ? root.items
        : [];

  return rawItems.map((entry, index) => {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const stem = compactString(record.item_stem) ?? compactString(record.stem) ?? "";
    const options = optionsFromUnknown(record.options);
    const importedKey = keyLabel(compactString(record.correct_option) ?? compactString(record.key));
    const issueFlags: string[] = [];
    if (!stem) issueFlags.push("missing_stem");
    if (options.length < 2) issueFlags.push("too_few_options");
    if (!importedKey) issueFlags.push("key_missing");
    if (importedKey && !options.some((option) => option.label === importedKey)) {
      issueFlags.push("key_conflict");
    }

    const rules = record.administration_rules;
    const metadata = readTeacherItemMetadata(rules);
    return {
      item_label: metadata.item_label || compactString(record.item_label),
      stem,
      options,
      imported_key: importedKey,
      target_reasoning_note:
        metadata.correct_option_notes.target_reasoning_note ||
        compactString(record.target_reasoning_note),
      strong_reasoning_should_mention:
        metadata.correct_option_notes.strong_reasoning_should_mention ||
        compactString(record.strong_reasoning_should_mention),
      distractor_diagnostic_notes:
        metadata.plain_language_distractor_diagnostic_notes ||
        compactString(record.distractor_diagnostic_notes),
      media_assets: [],
      original_source_text: stableJson(record),
      source_location: `json item ${index + 1}`,
      source_line_range: null,
      parsing_confidence: issueFlags.includes("missing_stem") || issueFlags.includes("too_few_options") ? 0.45 : 0.95,
      issue_flags: issueFlags
    };
  });
}

function statusForDraft(draft: CandidateDraft): z.infer<typeof CandidateStatusSchema> {
  if (draft.issue_flags.includes("too_few_options") || draft.issue_flags.includes("missing_stem")) {
    return "needs_options";
  }
  if (draft.issue_flags.includes("key_conflict")) return "key_conflict";
  if (draft.issue_flags.includes("key_missing")) return "needs_key";
  return "ready_as_draft";
}

function missingFieldsForDraft(draft: CandidateDraft) {
  const missing: string[] = [];
  if (!draft.stem) missing.push("stem");
  if (draft.options.length < 2) missing.push("options");
  if (!draft.imported_key) missing.push("key");
  if (!draft.target_reasoning_note) missing.push("target_reasoning_note");
  if (!draft.strong_reasoning_should_mention) missing.push("strong_reasoning_should_mention");
  if (!draft.distractor_diagnostic_notes) missing.push("distractor_diagnostic_notes");
  if (draft.media_assets.length === 0) missing.push("media");
  return missing;
}

function candidateFromDraft(draft: CandidateDraft, index: number): McqImportCandidate {
  return {
    candidate_public_id: generatePublicId("mcq_import_candidate"),
    source_item_number: index + 1,
    source_location: draft.source_location,
    source_line_range: draft.source_line_range,
    item_label: draft.item_label,
    stem: draft.stem,
    options: draft.options,
    imported_key: draft.imported_key,
    llm_suggested_key: null,
    teacher_confirmed_key: null,
    target_reasoning_note: draft.target_reasoning_note,
    strong_reasoning_should_mention: draft.strong_reasoning_should_mention,
    distractor_diagnostic_notes: draft.distractor_diagnostic_notes,
    media_assets: draft.media_assets,
    missing_fields: missingFieldsForDraft(draft),
    parsing_confidence: draft.parsing_confidence,
    issue_flags: draft.issue_flags,
    duplicate_warnings: [],
    status: statusForDraft(draft),
    import_selected: !draft.issue_flags.includes("missing_stem") && !draft.issue_flags.includes("too_few_options"),
    original_source_text: draft.original_source_text,
    normalized_changed_wording: false,
    normalized_diff_summary: null,
    suggestion: null,
    suggestion_decisions: {}
  };
}

async function existingItemSignatures(teacherUserDbId: string, assessmentDbId: string) {
  const items = await prisma.item.findMany({
    where: {
      concept_unit: {
        assessment: {
          created_by_user_db_id: teacherUserDbId
        }
      },
      status: { not: "archived" }
    },
    select: {
      item_public_id: true,
      item_stem: true,
      options: true,
      concept_unit: {
        select: {
          assessment_db_id: true,
          assessment: {
            select: {
              assessment_public_id: true,
              title: true
            }
          }
        }
      }
    }
  });

  return items.map((item) => ({
    item_public_id: item.item_public_id,
    assessment_db_id: item.concept_unit.assessment_db_id,
    assessment_public_id: item.concept_unit.assessment.assessment_public_id,
    assessment_title: item.concept_unit.assessment.title,
    signature: candidateSignature({
      stem: item.item_stem,
      options: optionsFromUnknown(item.options)
    }),
    stem_signature: stemSignature(item.item_stem),
    scope: item.concept_unit.assessment_db_id === assessmentDbId ? "assessment" : "teacher_owned"
  }));
}

async function applyDuplicateWarnings(
  candidates: McqImportCandidate[],
  input: { teacher_user_db_id: string; assessment_db_id: string }
) {
  const batchBySignature = new Map<string, McqImportCandidate[]>();
  for (const candidate of candidates) {
    const signature = candidateSignature(candidate);
    batchBySignature.set(signature, [...(batchBySignature.get(signature) ?? []), candidate]);
  }

  for (const candidate of candidates) {
    const signature = candidateSignature(candidate);
    const sameBatch = (batchBySignature.get(signature) ?? []).filter(
      (entry) => entry.candidate_public_id !== candidate.candidate_public_id
    );
    if (sameBatch.length > 0) {
      candidate.duplicate_warnings.push({
        scope: "batch",
        existing_assessment_public_id: null,
        existing_assessment_title: null,
        existing_item_public_id: sameBatch[0]?.candidate_public_id ?? null,
        message: "Possible duplicate within this import batch."
      });
      candidate.issue_flags = [...new Set([...candidate.issue_flags, "possible_duplicate"])];
    }
  }

  const existing = await existingItemSignatures(input.teacher_user_db_id, input.assessment_db_id);
  for (const candidate of candidates) {
    const signature = candidateSignature(candidate);
    const stemHash = stemSignature(candidate.stem);
    const matches = existing.filter(
      (entry) => entry.signature === signature || entry.stem_signature === stemHash
    );

    for (const match of matches.slice(0, 3)) {
      candidate.duplicate_warnings.push({
        scope: match.scope as "assessment" | "teacher_owned",
        existing_assessment_public_id: match.assessment_public_id,
        existing_assessment_title: match.assessment_title,
        existing_item_public_id: match.item_public_id,
        message:
          match.scope === "assessment"
            ? "Possible duplicate in this mini test."
            : "Possible duplicate in another mini test owned by this teacher."
      });
      candidate.issue_flags = [...new Set([...candidate.issue_flags, "possible_duplicate"])];
    }

    if (candidate.duplicate_warnings.length > 0 && candidate.status === "ready_as_draft") {
      candidate.status = "needs_review";
    }
  }
}

function parseCandidates(input: z.infer<typeof McqImportPreviewInputSchema>): {
  sourceChecksum: string;
  drafts: CandidateDraft[];
} {
  const mapping = input.column_mapping ?? {};

  if (input.source_type === "xlsx") {
    if (!input.file_base64) {
      throw new ContentServiceError("validation_failed", "XLSX import requires a file.", 400);
    }
    const bytes = decodeBase64(input.file_base64);
    const rows = parseXlsxRows(bytes);
    return {
      sourceChecksum: sha256(bytes),
      drafts: rows.map((row, index) => draftFromRow(row, index, mapping))
    };
  }

  const text = sourceText(input);
  if (!text.trim()) {
    throw new ContentServiceError("validation_failed", "Import source is empty.", 400);
  }

  if (input.source_type === "csv") {
    const rows = parseCsvRows(text);
    return {
      sourceChecksum: sha256(text),
      drafts: rows.map((row, index) => draftFromRow(row, index, mapping))
    };
  }

  if (input.source_type === "plain_text") {
    const drafts = parsePlainTextItems(text);
    return { sourceChecksum: sha256(text), drafts };
  }

  const drafts = parseProjectJsonItems(text);
  return { sourceChecksum: sha256(text), drafts };
}

function validationSummary(candidates: McqImportCandidate[]) {
  return {
    ok: candidates.some((candidate) => candidate.import_selected),
    issue_counts: {
      key_missing: candidates.filter((candidate) => candidate.issue_flags.includes("key_missing")).length,
      too_few_options: candidates.filter((candidate) => candidate.issue_flags.includes("too_few_options")).length,
      possible_duplicate: candidates.filter((candidate) => candidate.issue_flags.includes("possible_duplicate")).length,
      key_conflict: candidates.filter((candidate) => candidate.issue_flags.includes("key_conflict")).length
    },
    status_counts: Object.fromEntries(
      [...new Set(candidates.map((candidate) => candidate.status))].map((status) => [
        status,
        candidates.filter((candidate) => candidate.status === status).length
      ])
    )
  };
}

function serializeBatch(batch: {
  batch_public_id: string;
  source_type: string;
  source_file_name: string | null;
  source_checksum: string;
  status: string;
  candidate_count: number;
  imported_count: number;
  rejected_count: number;
  key_missing_count: number;
  llm_suggestion_count: number;
  duplicate_count: number;
  validation_summary: unknown;
  candidates_payload: unknown;
  suggestion_payload?: unknown;
  import_summary?: unknown;
  created_at: Date;
  committed_at: Date | null;
}) {
  const payload = CandidatesPayloadSchema.parse(batch.candidates_payload);
  return {
    batch_public_id: batch.batch_public_id,
    source_type: batch.source_type,
    source_file_name: batch.source_file_name,
    source_checksum: batch.source_checksum,
    status: batch.status,
    candidate_count: batch.candidate_count,
    imported_count: batch.imported_count,
    rejected_count: batch.rejected_count,
    key_missing_count: batch.key_missing_count,
    llm_suggestion_count: batch.llm_suggestion_count,
    duplicate_count: batch.duplicate_count,
    validation_summary: batch.validation_summary,
    candidates: payload.candidates,
    suggestion_payload: batch.suggestion_payload ?? null,
    import_summary: batch.import_summary ?? null,
    created_at: batch.created_at.toISOString(),
    committed_at: batch.committed_at?.toISOString() ?? null
  };
}

export async function previewMcqItemImport(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  data: unknown;
}) {
  const data = McqImportPreviewInputSchema.parse(input.data);
  const assessment = await assertAssessmentEditable(input);
  const parsed = parseCandidates(data);
  const candidates = parsed.drafts.map(candidateFromDraft);
  await applyDuplicateWarnings(candidates, {
    teacher_user_db_id: input.teacher_user_db_id,
    assessment_db_id: assessment.id
  });
  const summary = validationSummary(candidates);
  const batchPublicId = generatePublicId("mcq_import_batch");
  const batch = await prisma.mcqItemImportBatch.create({
    data: {
      batch_public_id: batchPublicId,
      assessment_db_id: assessment.id,
      uploaded_by_user_db_id: input.teacher_user_db_id,
      source_type: data.source_type,
      source_file_name: data.source_file_name ?? null,
      source_checksum: parsed.sourceChecksum,
      status: "previewed",
      candidate_count: candidates.length,
      key_missing_count: candidates.filter((candidate) => candidate.issue_flags.includes("key_missing")).length,
      duplicate_count: candidates.filter((candidate) => candidate.issue_flags.includes("possible_duplicate")).length,
      validation_summary: toRequiredPrismaJson(summary),
      candidates_payload: toRequiredPrismaJson({ schema_version: MCQ_IMPORT_SCHEMA_VERSION, candidates })
    }
  });

  return {
    batch: serializeBatch(batch),
    supported_sources: [...importSourceTypes],
    template_url: `/api/teacher/assessments/${encodeURIComponent(
      input.assessment_public_id
    )}/mcq-import/template`
  };
}

async function getTeacherOwnedBatch(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  batch_public_id: string;
}) {
  const batch = await prisma.mcqItemImportBatch.findFirst({
    where: {
      batch_public_id: input.batch_public_id,
      assessment: {
        assessment_public_id: input.assessment_public_id,
        created_by_user_db_id: input.teacher_user_db_id
      }
    }
  });

  if (!batch) {
    throw new ContentServiceError("not_found", "MCQ import batch was not found.", 404);
  }

  return batch;
}

export async function getMcqItemImportBatch(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  batch_public_id: string;
}) {
  return {
    batch: serializeBatch(await getTeacherOwnedBatch(input))
  };
}

function mockDiagnosticSuggestion(input: {
  assessment_title: string;
  assessment_diagnostic_focus: string | null;
  candidate: McqImportCandidate;
}) {
  const key = input.candidate.teacher_confirmed_key;
  const keyOption = input.candidate.options.find((option) => option.label === key);
  const distractors = input.candidate.options.filter((option) => option.label !== key);
  const focus = input.assessment_diagnostic_focus ?? input.assessment_title;
  const issueCodes: string[] = [];

  if (!key) {
    issueCodes.push("teacher_confirmed_key_required");
  }
  if (input.candidate.stem.split(/\s+/).length < 8) {
    issueCodes.push("recall_only_warning");
  }

  return {
    prompt_version: DIAGNOSTIC_ASSISTANT_PROMPT_VERSION,
    schema_version: DIAGNOSTIC_ASSISTANT_SCHEMA_VERSION,
    provider: "mock",
    model_name: "mock-mcq-diagnostic-authoring-assistant",
    output_validated: true,
    suggested_target_reasoning_note: keyOption
      ? `A strong response should explain why option ${keyOption.label} fits the assessment focus (${focus}) using evidence from the stem.`
      : null,
    suggested_strong_reasoning_should_mention: keyOption
      ? `Mention the distinction or condition that makes ${keyOption.label} more defensible than the tempting alternatives.`
      : null,
    suggested_plain_language_distractor_notes: distractors.length
      ? distractors
          .map(
            (option) =>
              `Option ${option.label}: This may be tempting for several reasons. Treat it as a tentative clue and compare it with the student's written reasoning before inferring a misconception.`
          )
          .join("\n")
      : null,
    suggested_cognitive_demand: input.candidate.stem.match(/\b(explain|compare|why|analyze|evaluate|apply)\b/i)
      ? "apply_analyze_or_evaluate"
      : "possible_recall_only",
    possible_ambiguity: input.candidate.issue_flags.includes("key_conflict"),
    possible_multiple_keys: input.candidate.issue_flags.includes("key_conflict"),
    distractor_quality_warning:
      distractors.length < 2
        ? "Few distractors are available, so diagnostic interpretation may be weak."
        : null,
    recall_only_warning: input.candidate.stem.split(/\s+/).length < 8,
    suggested_revision: null,
    evidence_justification_summary:
      "Suggestion is based only on the item stem, options, confirmed key, and teacher diagnostic focus. It is teacher-facing guidance, not ground truth.",
    confidence: key ? "medium" : "low",
    limitations: [
      "Distractor selection is indirect evidence only.",
      "Alternative explanations include partial guessing, misreading, language difficulty, fatigue, random error, low confidence, and insufficient evidence."
    ],
    issue_count: issueCodes.length,
    issue_codes: issueCodes
  };
}

export async function suggestMcqDiagnosticInformation(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  batch_public_id: string;
  data: unknown;
}) {
  const data = SuggestDiagnosticInputSchema.parse(input.data);
  if (data.mode === "live") {
    throw new ContentServiceError(
      "validation_failed",
      "Live MCQ diagnostic authoring suggestions are not enabled by default.",
      400,
      { live_smoke_command: "npm run student:teacher-mcq-diagnostic-assistant-live-smoke" }
    );
  }

  const batch = await getTeacherOwnedBatch(input);
  const assessment = await prisma.assessment.findFirstOrThrow({
    where: {
      assessment_public_id: input.assessment_public_id,
      created_by_user_db_id: input.teacher_user_db_id
    },
    select: { title: true, diagnostic_focus: true }
  });
  const payload = CandidatesPayloadSchema.parse(batch.candidates_payload);
  const updatesById = new Map(data.candidate_updates.map((update) => [update.candidate_public_id, update]));
  const updatedCandidates = payload.candidates.map((candidate) =>
    updatesById.has(candidate.candidate_public_id)
      ? applyCandidateUpdate(candidate, updatesById.get(candidate.candidate_public_id)!)
      : candidate
  );
  const selected = new Set(data.candidate_public_ids ?? updatedCandidates.map((candidate) => candidate.candidate_public_id));
  let suggestionCount = 0;
  const candidates = updatedCandidates.map((candidate) => {
    if (!selected.has(candidate.candidate_public_id)) return candidate;

    const suggestion = mockDiagnosticSuggestion({
      assessment_title: assessment.title,
      assessment_diagnostic_focus: assessment.diagnostic_focus,
      candidate
    });
    suggestionCount += 1;
    return {
      ...candidate,
      suggestion,
      llm_suggested_key: null,
      issue_flags: [
        ...new Set([
          ...candidate.issue_flags,
          ...(suggestion.issue_codes.includes("teacher_confirmed_key_required")
            ? ["teacher_confirmed_key_required"]
            : [])
        ])
      ]
    };
  });

  const suggestionPayload = {
    prompt_version: DIAGNOSTIC_ASSISTANT_PROMPT_VERSION,
    schema_version: DIAGNOSTIC_ASSISTANT_SCHEMA_VERSION,
    source: "mock_provider",
    suggestion_count: suggestionCount,
    agent_call_ids: [],
    created_at: new Date().toISOString()
  };

  const updated = await prisma.mcqItemImportBatch.update({
    where: { id: batch.id },
    data: {
      llm_suggestion_count: batch.llm_suggestion_count + suggestionCount,
      candidates_payload: toPrismaJson({ schema_version: MCQ_IMPORT_SCHEMA_VERSION, candidates }),
      suggestion_payload: toPrismaJson(suggestionPayload)
    }
  });

  return { batch: serializeBatch(updated) };
}

function applyCandidateUpdate(
  candidate: McqImportCandidate,
  update: z.infer<typeof CandidateCommitUpdateSchema>
): McqImportCandidate {
  return {
    ...candidate,
    import_selected: update.import_selected ?? candidate.import_selected,
    item_label:
      update.item_label === undefined ? candidate.item_label : compactString(update.item_label),
    stem: update.stem ?? candidate.stem,
    options: update.options ?? candidate.options,
    teacher_confirmed_key:
      update.teacher_confirmed_key === undefined
        ? candidate.teacher_confirmed_key
        : keyLabel(update.teacher_confirmed_key),
    target_reasoning_note:
      update.target_reasoning_note === undefined
        ? candidate.target_reasoning_note
        : compactString(update.target_reasoning_note),
    strong_reasoning_should_mention:
      update.strong_reasoning_should_mention === undefined
        ? candidate.strong_reasoning_should_mention
        : compactString(update.strong_reasoning_should_mention),
    distractor_diagnostic_notes:
      update.distractor_diagnostic_notes === undefined
        ? candidate.distractor_diagnostic_notes
        : compactString(update.distractor_diagnostic_notes),
    media_assets: update.media_assets ?? candidate.media_assets,
    suggestion_decisions: update.suggestion_decisions ?? candidate.suggestion_decisions
  };
}

function suggestionRecord(candidate: McqImportCandidate): Record<string, unknown> {
  return candidate.suggestion && typeof candidate.suggestion === "object" && !Array.isArray(candidate.suggestion)
    ? (candidate.suggestion as Record<string, unknown>)
    : {};
}

function acceptedSuggestionValue(candidate: McqImportCandidate, field: string): string | null {
  const decision = candidate.suggestion_decisions?.[field];
  if (!decision || decision.decision === "reject" || decision.decision === "leave_blank") return null;
  if (decision.decision === "edit_accept") return compactString(decision.edited_value);

  const suggestion = suggestionRecord(candidate)[field];
  return compactString(suggestion);
}

function applyAcceptedSuggestionFields(candidate: McqImportCandidate): McqImportCandidate {
  return {
    ...candidate,
    target_reasoning_note:
      candidate.target_reasoning_note ??
      acceptedSuggestionValue(candidate, "suggested_target_reasoning_note"),
    strong_reasoning_should_mention:
      candidate.strong_reasoning_should_mention ??
      acceptedSuggestionValue(candidate, "suggested_strong_reasoning_should_mention"),
    distractor_diagnostic_notes:
      candidate.distractor_diagnostic_notes ??
      acceptedSuggestionValue(candidate, "suggested_plain_language_distractor_notes")
  };
}

function selectedCandidates(
  candidates: McqImportCandidate[],
  data: z.infer<typeof CommitImportInputSchema>
) {
  const explicitSelected = data.selected_candidate_public_ids
    ? new Set(data.selected_candidate_public_ids)
    : null;
  const updatesById = new Map(data.candidate_updates.map((update) => [update.candidate_public_id, update]));

  return candidates
    .map((candidate) => {
      const updated = updatesById.has(candidate.candidate_public_id)
        ? applyCandidateUpdate(candidate, updatesById.get(candidate.candidate_public_id)!)
        : candidate;
      return explicitSelected
        ? { ...updated, import_selected: explicitSelected.has(updated.candidate_public_id) }
        : updated;
    })
    .map(applyAcceptedSuggestionFields);
}

function candidateCanImport(candidate: McqImportCandidate) {
  return Boolean(candidate.stem.trim()) && candidate.options.length >= 2;
}

function teacherMetadataForCandidate(candidate: McqImportCandidate) {
  const optionLabels = candidate.options.map((option) => option.label);
  const correct = candidate.teacher_confirmed_key ?? "";
  const optionNotes: TeacherDiagnosticOptionNote[] = optionLabels
    .filter((label) => label !== correct)
    .map((label) => ({
      label,
      distractor_diagnostic_value: candidate.distractor_diagnostic_notes ?? undefined
    }));

  return {
    item_label: candidate.item_label ?? undefined,
    item_purpose: "initial_item",
    expected_reasoning_note: candidate.target_reasoning_note ?? undefined,
    item_diagnostic_value_note: candidate.target_reasoning_note ?? undefined,
    plain_language_distractor_diagnostic_notes: candidate.distractor_diagnostic_notes ?? undefined,
    correct_option_notes: {
      target_reasoning_note: candidate.target_reasoning_note ?? undefined,
      strong_reasoning_should_mention: candidate.strong_reasoning_should_mention ?? undefined
    },
    option_notes: optionNotes
  };
}

function importProvenanceRules(candidate: McqImportCandidate, batch: { batch_public_id: string; source_type: string; source_checksum: string; source_file_name: string | null }) {
  return {
    import_provenance: {
      import_batch_public_id: batch.batch_public_id,
      source_type: batch.source_type,
      source_file_name: batch.source_file_name,
      source_checksum: batch.source_checksum,
      source_location: candidate.source_location,
      source_line_range: candidate.source_line_range,
      original_source_hash: sha256(candidate.original_source_text),
      imported_key: candidate.imported_key,
      teacher_confirmed_key: candidate.teacher_confirmed_key,
      missing_fields_at_import: candidate.missing_fields,
      issue_flags_at_import: candidate.issue_flags,
      suggestion_review: candidate.suggestion_decisions ?? {}
    }
  };
}

export async function commitMcqItemImport(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  batch_public_id: string;
  data: unknown;
}) {
  const data = CommitImportInputSchema.parse(input.data);
  const batch = await getTeacherOwnedBatch(input);
  await assertAssessmentEditable(input);
  const conceptUnit = await ensureMiniTestPrimaryConceptUnit(input);
  const conceptUnitRecord = await prisma.conceptUnit.findUniqueOrThrow({
    where: { concept_unit_public_id: conceptUnit.concept_unit_public_id },
    select: { id: true }
  });
  const payload = CandidatesPayloadSchema.parse(batch.candidates_payload);
  const candidates = selectedCandidates(payload.candidates, data);
  const toImport = candidates.filter((candidate) => candidate.import_selected && candidateCanImport(candidate));
  const rejectedCount = candidates.filter((candidate) => !candidate.import_selected).length;
  const existingLast = await prisma.item.findFirst({
    where: { concept_unit_db_id: conceptUnitRecord.id },
    orderBy: { item_order: "desc" },
    select: { item_order: true }
  });
  let nextOrder = (existingLast?.item_order ?? 0) + 1;
  const importedItemPublicIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const candidate of toImport) {
      const administrationRules = buildItemAdministrationRulesFromTeacherMetadata({
        administration_rules: importProvenanceRules(candidate, batch),
        metadata: teacherMetadataForCandidate(candidate)
      });
      const created = await tx.item.create({
        data: {
          item_public_id: generatePublicId("item"),
          concept_unit_db_id: conceptUnitRecord.id,
          item_order: nextOrder++,
          item_stem: candidate.stem,
          options: toPrismaJson(candidate.options) ?? [],
          correct_option: candidate.teacher_confirmed_key ?? "",
          distractor_rationales: toPrismaJson({}),
          expected_reasoning_patterns: toPrismaJson(
            candidate.strong_reasoning_should_mention
              ? [candidate.strong_reasoning_should_mention]
              : []
          ),
          possible_misconception_indicators: toPrismaJson([]),
          administration_rules: toPrismaJson(administrationRules),
          included_in_published_set: true,
          status: "draft",
          version: 1
        }
      });
      await replaceItemMediaAssets(tx, {
        item_db_id: created.id,
        media_assets: normalizeItemMediaAssetInputs(candidate.media_assets)
      });
      importedItemPublicIds.push(created.item_public_id);
      candidate.status = "imported";
      candidate.imported_item_public_id = created.item_public_id;
    }

    await tx.mcqItemImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "committed",
        imported_count: importedItemPublicIds.length,
        rejected_count: rejectedCount,
        committed_at: new Date(),
        candidates_payload: toPrismaJson({ schema_version: MCQ_IMPORT_SCHEMA_VERSION, candidates }),
        import_summary: toPrismaJson({
          imported_item_public_ids: importedItemPublicIds,
          blocked_candidate_public_ids: candidates
            .filter((candidate) => candidate.import_selected && !candidateCanImport(candidate))
            .map((candidate) => candidate.candidate_public_id),
          committed_at: new Date().toISOString()
        })
      }
    });
  });

  const updatedBatch = await prisma.mcqItemImportBatch.findUniqueOrThrow({
    where: { id: batch.id }
  });

  return {
    batch: serializeBatch(updatedBatch),
    imported_item_public_ids: importedItemPublicIds,
    imported_count: importedItemPublicIds.length,
    blocked_count: candidates.filter((candidate) => candidate.import_selected && !candidateCanImport(candidate)).length,
    review_imported_items_url: `/teacher/content/assessments/${encodeURIComponent(input.assessment_public_id)}`,
    add_more_items_url: `/teacher/content/assessments/${encodeURIComponent(input.assessment_public_id)}/import-mcq`
  };
}

export function mcqCsvTemplate() {
  const header = canonicalColumns.join(",");
  const row = [
    "Q1",
    "\"Stem text\"",
    "\"Option A\"",
    "\"Option B\"",
    "\"Option C\"",
    "\"Option D\"",
    "",
    "A",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ].join(",");
  return `${header}\n${row}\n`;
}

export async function liveMcqDiagnosticAssistantSmoke() {
  if (process.env.RUN_LIVE_TEACHER_MCQ_DIAGNOSTIC_ASSISTANT_SMOKE !== "1") {
    return {
      status: "skipped",
      reason:
        "RUN_LIVE_TEACHER_MCQ_DIAGNOSTIC_ASSISTANT_SMOKE is not 1. No OpenAI call was made."
    };
  }

  throw new ContentServiceError(
    "validation_failed",
    "Live MCQ diagnostic assistant smoke is not implemented in Phase 31q.",
    400
  );
}
