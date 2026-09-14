import { z } from "zod";
import { ItemDesignBlueprintSchema } from "./item-design-contract";

export const MINI_TEST_JSON_VERSION = "mini-test-import-v1" as const;
export const MINI_TEST_JSON_MAX_BYTES = 2_000_000;
export const MINI_TEST_JSON_SAMPLE_URL = "/samples/mini-test-import.json";

const note = z.string().trim().max(4000).nullable().optional();
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
  distractor_diagnostic_notes: note,
  objective_ids: ids,
  misconception_hypothesis_ids: ids,
  cognitive_demand: z.enum(["remember", "understand", "apply", "analyze", "evaluate", "create"]).nullable().optional(),
  source_reference: note,
  media_assets: z.array(mediaSchema).max(20).default([])
}).strict().superRefine((item, ctx) => {
  const labels = new Set(item.options.map(option => option.label));
  if (labels.size !== item.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Option labels must be unique." });
  if (item.key && !labels.has(item.key)) ctx.addIssue({ code: "custom", path: ["key"], message: "The supplied key must match an option label." });
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
  if (new TextEncoder().encode(text).byteLength > MINI_TEST_JSON_MAX_BYTES) {
    throw new Error("The JSON file must be 2 MB or smaller.");
  }
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new Error("Invalid JSON. Check commas, quotation marks, and brackets."); }
  const parsed = MiniTestJsonSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.slice(0, 8).map(issue =>
      `${issue.path.join(".") || "JSON"}: ${issue.message}`
    ).join("\n"));
  }
  return parsed.data;
}
