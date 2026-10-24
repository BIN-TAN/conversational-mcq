import { z } from "zod";
import { ItemDesignBlueprintSchema } from "./item-design-contract";
import { normalizeMiniTestJson, relaxedJsonText } from "./mini-test-json-normalize";

export const MINI_TEST_JSON_VERSION = "mini-test-import-v1" as const;
export const MINI_TEST_JSON_MAX_BYTES = 2_000_000;
export const MINI_TEST_JSON_SAMPLE_URL = "/samples/mini-test-import.json";

const note = z.string().trim().max(4000).nullable().optional();
const optionLabel = z.string().regex(/^[A-F]$/);
// Per-option notes (docs/AI_MODULE_REDESIGN_2026-10-19.md, section 5): one rationale per
// incorrect option, and an optional idea label of a few words used to spot answer patterns.
const optionRationales = z.record(optionLabel, z.string().trim().min(1).max(4000)).optional();
const optionIdeaLabels = z.record(optionLabel, z.string().trim().min(1).max(60)).optional();
const ids = z.array(z.string().trim().min(1).max(80)).max(20).default([]);
const mediaSchema = z.object({
  media_type: z.enum(["image", "video", "reference_link"]),
  source_type: z.literal("external_url"),
  external_url: z.string().url().max(2000),
  placement: z.enum(["item_stem", "option"]).default("item_stem"),
  option_label: z.string().regex(/^[A-F]$/).nullable().optional(),
  alt_text_or_description: z.string().trim().min(1).max(4000),
  student_alt_text: note,
  teacher_llm_media_description: note,
  caption: note,
  transcript_or_content_summary: note,
  source_attribution: note,
  order_index: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true)
}).strict();

const itemSchema = z.object({
  item_label: z.string().trim().max(120).nullable().optional(),
  stem: z.string().trim().min(1).max(20000),
  options: z.array(z.object({
    label: z.string().regex(/^[A-F]$/),
    text: z.string().trim().min(1).max(10000)
  }).strict()).min(2).max(6),
  key: z.string().regex(/^[A-F]$/).nullable().optional(),
  target_reasoning_note: note,
  strong_reasoning_should_mention: note,
  essential_elements: z.array(z.string().trim().min(1).max(1000)).min(1).max(3).optional(),
  distractor_diagnostic_notes: note,
  distractor_rationales: optionRationales,
  idea_labels: optionIdeaLabels,
  objective_ids: ids,
  misconception_hypothesis_ids: ids,
  cognitive_demand: z.enum(["remember", "understand", "apply", "analyze", "evaluate", "create"]).nullable().optional(),
  source_reference: note,
  media_assets: z.array(mediaSchema).max(20).default([])
}).strict().superRefine((item, ctx) => {
  const labels = new Set(item.options.map(option => option.label));
  if (labels.size !== item.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Option labels must be unique." });
  if (item.key && !labels.has(item.key)) ctx.addIssue({ code: "custom", path: ["key"], message: "The supplied key must match an option label." });
  if (item.essential_elements && item.strong_reasoning_should_mention) {
    ctx.addIssue({ code: "custom", path: ["essential_elements"], message: "Use essential_elements or strong_reasoning_should_mention, not both." });
  }
  for (const field of ["distractor_rationales", "idea_labels"] as const) {
    for (const label of Object.keys(item[field] ?? {})) {
      if (!labels.has(label)) ctx.addIssue({ code: "custom", path: [field, label], message: `Option ${label} does not exist in this item.` });
      else if (field === "distractor_rationales" && item.key === label) {
        ctx.addIssue({ code: "custom", path: [field, label], message: "The key needs no distractor rationale; describe its reasoning in target_reasoning_note." });
      }
    }
  }
  item.media_assets.forEach((media, index) => {
    if (media.placement === "option" ? !media.option_label || !labels.has(media.option_label) : Boolean(media.option_label)) {
      ctx.addIssue({ code: "custom", path: ["media_assets", index, "option_label"], message: "Media must reference an existing option, or the item stem without an option label." });
    }
  });
});

export const MiniTestJsonSchema = z.object({
  schema_version: z.literal(MINI_TEST_JSON_VERSION),
  assessment: z.object({
    title: z.string().trim().min(1).max(240),
    diagnostic_focus: note,
    folder_label: z.string().trim().max(240).nullable().optional()
  }).strict(),
  design: ItemDesignBlueprintSchema.nullable().optional(),
  items: z.array(itemSchema).min(1).max(500)
}).strict().superRefine((document, ctx) => {
  const objectives = new Set(document.design?.objectives.map(item => item.objective_id));
  const misconceptions = new Set(document.design?.misconception_hypotheses.map(item => item.misconception_id));
  document.items.forEach((item, index) => {
    for (const [field, known] of [["objective_ids", objectives], ["misconception_hypothesis_ids", misconceptions]] as const) {
      item[field].forEach(id => {
        if (!known.has(id)) ctx.addIssue({ code: "custom", path: ["items", index, field], message: `Unknown design reference: ${id}. Add it to design or leave this mapping empty.` });
      });
    }
  });
});

export type MiniTestJson = z.infer<typeof MiniTestJsonSchema>;

export function parseMiniTestJson(text: string): MiniTestJson {
  return parseMiniTestJsonWithChanges(text).document;
}

/** Thrown when a file cannot be imported as it is; `syntax` is true when it is not valid JSON at all. */
export class MiniTestJsonError extends Error {
  constructor(message: string, readonly syntax: boolean, readonly changes: string[] = []) {
    super(message);
    this.name = "MiniTestJsonError";
  }
}

/**
 * Reads a mini-test file leniently: small syntax slips (trailing commas, comments) and format
 * differences with one safe reading are fixed (mini-test-json-normalize.ts), and each fix is
 * returned as a sentence for the instructor. What remains is reported in plain sentences.
 */
export function parseMiniTestJsonWithChanges(text: string): { document: MiniTestJson; changes: string[]; normalized_text: string } {
  if (new TextEncoder().encode(text).byteLength > MINI_TEST_JSON_MAX_BYTES) {
    throw new MiniTestJsonError("The JSON file must be 2 MB or smaller.", false);
  }
  const source = text.replace(/^\uFEFF/, "");
  const changes: string[] = [];
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    const relaxed = relaxedJsonText(source);
    try {
      if (!relaxed.changed) throw new Error("unchanged");
      value = JSON.parse(relaxed.text);
      changes.push("Removed trailing commas or comments, which JSON does not allow.");
    } catch (error) {
      const detail = error instanceof SyntaxError ? ` (${error.message.replace(/^JSON\.parse: /, "")})` : "";
      throw new MiniTestJsonError(`This is not valid JSON${detail}. Check commas, quotation marks and brackets, or let the assistant format the file.`, true);
    }
  }
  const normalized = normalizeMiniTestJson(value);
  changes.push(...normalized.changes);
  const parsed = MiniTestJsonSchema.safeParse(normalized.value);
  if (!parsed.success) {
    throw new MiniTestJsonError(
      parsed.error.issues.slice(0, 8).map(issue => miniTestJsonIssueText(issue, normalized.value)).join("\n"),
      false,
      changes
    );
  }
  // The file as read, in the import format: used downstream instead of the original when anything changed.
  return { document: parsed.data, changes, normalized_text: changes.length ? JSON.stringify(normalized.value) : source };
}

const count = (value: number | bigint) => Number(value).toLocaleString("en-US");

/** Where a problem is, in words an instructor can find in the file: "Item 2, options" or "design.generation_settings.context_notes". */
function issueLocation(path: Array<string | number>) {
  if (path.length === 0) return "The file";
  if (path[0] === "items" && typeof path[1] === "number") {
    const rest = path.slice(2).join(".");
    return `Item ${path[1] + 1}${rest ? `, ${rest}` : ""}`;
  }
  return path.join(".");
}

function valueAtIssuePath(source: unknown, path: ReadonlyArray<PropertyKey>) {
  let value = source;
  for (const segment of path) {
    if ((typeof value !== "object" || value === null) || !(segment in value)) return undefined;
    value = (value as Record<PropertyKey, unknown>)[segment];
  }
  return value;
}

function receivedType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** One plain sentence per validation problem, naming where it is and what to change. */
export function miniTestJsonIssueText(issue: z.ZodIssue, source?: unknown): string {
  const where = issueLocation(issue.path as Array<string | number>);
  const receivedValue = valueAtIssuePath(source, issue.path);
  switch (issue.code) {
    case "too_big":
      return issue.origin === "string"
        ? `${where}: this text is longer than the ${count(issue.maximum)}-character limit. Shorten it and try again.`
        : issue.origin === "array"
          ? `${where}: this list has more than ${count(issue.maximum)} entries. Remove some and try again.`
          : `${where}: the value must be at most ${count(issue.maximum)}.`;
    case "too_small":
      return issue.origin === "string"
        ? `${where}: this text is empty. Fill it in, or remove the field if it is optional.`
        : issue.origin === "array"
          ? `${where}: this list needs at least ${count(issue.minimum)} ${Number(issue.minimum) === 1 ? "entry" : "entries"}.`
          : `${where}: the value must be at least ${count(issue.minimum)}.`;
    case "invalid_type": {
      const received = source === undefined
        ? /received (.+)$/u.exec(issue.message)?.[1] ?? "unknown"
        : receivedType(receivedValue);
      return received === "undefined"
        ? `${where}: this field is required.`
        : `${where}: expected ${issue.expected === "string" ? "text" : issue.expected}, but found ${received}.`;
    }
    case "invalid_value":
      return issue.values.length === 1
        ? `${where}: this must be "${String(issue.values[0])}".`
        : `${where}: "${String(receivedValue)}" is not allowed. Use one of: ${issue.values.join(", ")}.`;
    case "unrecognized_keys":
      return `${where}: ${issue.keys.length === 1 ? `the field "${issue.keys[0]}" is` : `the fields ${issue.keys.map(key => `"${key}"`).join(", ")} are`} not part of the format. Check the spelling or remove ${issue.keys.length === 1 ? "it" : "them"}.`;
    case "invalid_format":
      return `${where}: ${issue.format === "url" ? "this must be a full web address starting with https://." : "this value is not in the expected format (an option label is a single capital letter, A to F)."}`;
    default:
      return `${where}: ${issue.message}`;
  }
}
