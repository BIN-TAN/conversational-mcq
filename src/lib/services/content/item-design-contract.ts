import { z } from "zod";

export const ITEM_DESIGN_BLUEPRINT_VERSION = "evidence-centered-item-design-v1" as const;
export const ITEM_DESIGN_ASSISTANT_PROMPT_VERSION = "evidence-centered-item-design-assistant-v9" as const;
export const ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION = "evidence-centered-item-design-assistant-output-v3" as const;
const ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION_V2 = "evidence-centered-item-design-assistant-output-v2" as const;
export const ITEM_DESIGN_ASSISTANT_THREAD_VERSION = "evidence-centered-item-design-thread-v1" as const;
export const ITEM_DESIGN_SOURCE_MATERIAL_VERSION = "evidence-centered-item-design-source-materials-v1" as const;
export const ITEM_GENERATION_PROMPT_VERSION = "evidence-centered-mcq-generation-v5" as const;
export const ITEM_GENERATION_SCHEMA_VERSION = "evidence-centered-mcq-generation-output-v1" as const;

export const ItemDesignCognitiveDemandBandSchema = z.enum([
  "foundational",
  "analyzing",
  "evaluating",
  "creating"
]);

export type ItemDesignCognitiveDemandBand = z.infer<
  typeof ItemDesignCognitiveDemandBandSchema
>;

const shortText = z.string().trim().min(1).max(240);
const longText = z.string().trim().min(1).max(2000);

export const ItemDesignObjectiveSchema = z.object({
  objective_id: z.string().trim().min(1).max(80),
  statement: z.string().trim().min(1).max(700),
  evidence_requirements: z.array(shortText).min(1).max(8)
}).strict();

export const ItemDesignMisconceptionSchema = z.object({
  misconception_id: z.string().trim().min(1).max(80),
  statement: z.string().trim().min(1).max(700),
  linked_objective_ids: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  student_language_examples: z.array(shortText).max(8).default([]),
  why_plausible: z.string().trim().max(1000).nullable().default(null)
}).strict();

export const ItemDesignExemplarSchema = z.object({
  exemplar_id: z.string().trim().min(1).max(80),
  item_text: longText,
  observed_difficulty_note: z.string().trim().max(1000).nullable().default(null)
}).strict();

export const ItemDesignGenerationSettingsSchema = z.object({
  target_item_count: z.number().int().min(3).max(12).default(4),
  option_count: z.number().int().min(3).max(5).default(4),
  difficulty_mix: z.array(ItemDesignCognitiveDemandBandSchema).min(1).max(4),
  // Notes for drafting (reading level, contexts to use or avoid, source pages). Long enough for a
  // mini test's design notes; the same limit as the other notes in the mini-test JSON.
  context_notes: z.string().trim().max(4000).nullable().default(null)
}).strict();

export const ItemDesignBlueprintSchema = z.object({
  schema_version: z.literal(ITEM_DESIGN_BLUEPRINT_VERSION),
  section_topic: z.string().trim().min(1).max(240),
  section_summary: z.string().trim().min(1).max(2000),
  objectives: z.array(ItemDesignObjectiveSchema).min(1).max(12),
  misconception_hypotheses: z.array(ItemDesignMisconceptionSchema).max(20).default([]),
  exemplar_items: z.array(ItemDesignExemplarSchema).max(12).default([]),
  generation_settings: ItemDesignGenerationSettingsSchema
}).strict().superRefine((blueprint, context) => {
  const objectiveIds = new Set(blueprint.objectives.map((objective) => objective.objective_id));
  if (objectiveIds.size !== blueprint.objectives.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["objectives"], message: "Objective IDs must be unique." });
  }

  const misconceptionIds = new Set(
    blueprint.misconception_hypotheses.map((misconception) => misconception.misconception_id)
  );
  if (misconceptionIds.size !== blueprint.misconception_hypotheses.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["misconception_hypotheses"],
      message: "Misconception IDs must be unique."
    });
  }

  blueprint.misconception_hypotheses.forEach((misconception, index) => {
    misconception.linked_objective_ids.forEach((objectiveId) => {
      if (!objectiveIds.has(objectiveId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["misconception_hypotheses", index, "linked_objective_ids"],
          message: `Unknown objective ID: ${objectiveId}.`
        });
      }
    });
  });
});

export const ItemDesignAssistantBlueprintUpdateSchema = z.discriminatedUnion("update_type", [
  z.object({
    update_type: z.literal("set_section_topic"),
    value: z.string().trim().min(1).max(240)
  }).strict(),
  z.object({
    update_type: z.literal("set_section_summary"),
    value: z.string().trim().min(1).max(2000)
  }).strict(),
  z.object({
    update_type: z.literal("upsert_objective"),
    objective: ItemDesignObjectiveSchema
  }).strict(),
  z.object({
    update_type: z.literal("remove_objective"),
    objective_id: z.string().trim().min(1).max(80)
  }).strict(),
  z.object({
    update_type: z.literal("upsert_misconception"),
    misconception: ItemDesignMisconceptionSchema
  }).strict(),
  z.object({
    update_type: z.literal("remove_misconception"),
    misconception_id: z.string().trim().min(1).max(80)
  }).strict(),
  z.object({
    update_type: z.literal("upsert_exemplar"),
    exemplar: ItemDesignExemplarSchema
  }).strict(),
  z.object({
    update_type: z.literal("remove_exemplar"),
    exemplar_id: z.string().trim().min(1).max(80)
  }).strict(),
  z.object({
    update_type: z.literal("update_generation_settings"),
    settings: ItemDesignGenerationSettingsSchema
  }).strict()
]);

/**
 * The course's topic bank (v3): the topics the course materials teach, each with its core
 * knowledge points, content notes and the quiz or sample items that assess it, plus item
 * templates the teacher gives for all mini tests. One mini test assesses one topic; the
 * mini tests for the other topics are prepared from the same bank without new uploads.
 */
export const ItemDesignSourceItemSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  answer_note: z.string().trim().max(300).nullable()
}).strict();

export const ItemDesignTopicSchema = z.object({
  topic_id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(600),
  knowledge_points: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
  content_notes: z.string().trim().max(2000),
  source_items: z.array(ItemDesignSourceItemSchema).max(8),
  source_material_ids: z.array(z.string().trim().min(1).max(100)).max(40)
}).strict();

export const ItemDesignTemplateSchema = z.object({
  template_id: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(2000)
}).strict();

export const ItemDesignTopicMapSchema = z.object({
  topics: z.array(ItemDesignTopicSchema).max(12),
  item_templates: z.array(ItemDesignTemplateSchema).max(6),
  selected_topic_id: z.string().trim().min(1).max(80).nullable()
}).strict();

export type ItemDesignTopic = z.infer<typeof ItemDesignTopicSchema>;
export type ItemDesignTopicMap = z.infer<typeof ItemDesignTopicMapSchema>;

export const EMPTY_ITEM_DESIGN_TOPIC_MAP: ItemDesignTopicMap = { topics: [], item_templates: [], selected_topic_id: null };

/** A topic map whose selected topic is one of its topics (otherwise none is selected). */
export function consistentTopicMap(value: unknown): ItemDesignTopicMap {
  const parsed = ItemDesignTopicMapSchema.safeParse(value);
  if (!parsed.success) return EMPTY_ITEM_DESIGN_TOPIC_MAP;
  const map = parsed.data;
  return map.selected_topic_id && map.topics.some((topic) => topic.topic_id === map.selected_topic_id)
    ? map
    : { ...map, selected_topic_id: null };
}

/**
 * The stored topic bank after a reply. A reply that lists topics replaces the list (topics it
 * leaves out are removed), but a topic's empty content notes or empty source items keep what is
 * stored for that topic. A reply with no topics keeps the stored topics, and no templates keeps
 * the stored templates. The selection follows the reply when it names a topic.
 */
export function mergeTopicMap(stored: ItemDesignTopicMap, reply: ItemDesignTopicMap): ItemDesignTopicMap {
  const storedById = new Map(stored.topics.map((topic) => [topic.topic_id, topic]));
  const topics = reply.topics.length === 0
    ? stored.topics
    : reply.topics.map((topic) => {
        const previous = storedById.get(topic.topic_id);
        return {
          ...topic,
          content_notes: topic.content_notes || previous?.content_notes || "",
          source_items: topic.source_items.length > 0 ? topic.source_items : previous?.source_items ?? []
        };
      });
  return consistentTopicMap({
    topics,
    item_templates: reply.item_templates.length > 0 ? reply.item_templates : stored.item_templates,
    selected_topic_id: reply.selected_topic_id ?? stored.selected_topic_id
  });
}

/** The bank as the assistant reads it: the selected topic in full, the others briefly. */
export function topicMapForAssistant(map: ItemDesignTopicMap) {
  const selected = map.topics.find((topic) => topic.topic_id === map.selected_topic_id) ?? null;
  return {
    selected_topic: selected,
    other_topics: map.topics
      .filter((topic) => topic.topic_id !== selected?.topic_id)
      .map((topic) => ({
        topic_id: topic.topic_id,
        title: topic.title,
        summary: topic.summary,
        knowledge_points: topic.knowledge_points,
        source_material_ids: topic.source_material_ids,
        content_notes_stored: topic.content_notes.length > 0,
        source_item_count: topic.source_items.length
      })),
    item_templates: map.item_templates
  };
}

export const ItemDesignAssistantOutputSchema = z.object({
  schema_version: z.literal(ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION),
  assistant_message: z.string().trim().min(1).max(4000),
  topic_map: ItemDesignTopicMapSchema,
  blueprint_updates: z.array(ItemDesignAssistantBlueprintUpdateSchema).max(48),
  change_summary: z.array(z.string().trim().min(1).max(300)).max(10),
  remaining_questions: z.array(z.string().trim().min(1).max(500)).max(8),
  material_summaries: z.array(z.object({
    material_id: z.string().trim().min(1).max(100),
    summary: z.string().trim().min(1).max(2400),
    limitations: z.array(z.string().trim().min(1).max(400)).max(8)
  }).strict()).max(5),
  ready_for_item_generation: z.boolean()
}).strict();

export const ItemDesignSourceMaterialSchema = z.object({
  material_id: z.string().trim().min(1).max(100),
  client_message_id: z.string().trim().min(1).max(120),
  file_name: z.string().trim().min(1).max(240),
  media_type: z.string().trim().min(1).max(120),
  source_kind: z.enum(["docx", "text", "pdf", "image"]),
  byte_size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  parser_version: z.string().trim().min(1).max(120).nullable(),
  extracted_text: z.string().max(50000).nullable(),
  content_summary: z.string().trim().min(1).max(2400),
  limitations: z.array(z.string().trim().min(1).max(400)).max(8),
  warnings: z.array(z.string().trim().min(1).max(160)).max(12),
  agent_call_public_id: z.string().trim().min(1).max(160),
  created_at: z.string().datetime()
}).strict();

export const ItemDesignSourceMaterialCollectionSchema = z.object({
  schema_version: z.literal(ITEM_DESIGN_SOURCE_MATERIAL_VERSION),
  materials: z.array(ItemDesignSourceMaterialSchema).max(40)
}).strict();

export const ItemDesignAssistantMessageSchema = z.object({
  message_id: z.string().trim().min(1).max(160),
  client_message_id: z.string().trim().min(1).max(120),
  role: z.enum(["teacher", "assistant"]),
  message_text: z.string().trim().min(1).max(20000),
  created_at: z.string().datetime(),
  agent_call_public_id: z.string().trim().min(1).max(160).nullable(),
  attachment_material_ids: z.array(z.string().trim().min(1).max(100)).max(5).default([])
}).strict();

export const ItemDesignAssistantThreadSchema = z.object({
  schema_version: z.literal(ITEM_DESIGN_ASSISTANT_THREAD_VERSION),
  messages: z.array(ItemDesignAssistantMessageSchema).max(100)
}).strict();

/** The evidence line of the one objective a new mini test starts with, before any design work. */
export const PLACEHOLDER_OBJECTIVE_EVIDENCE = "The student explains or applies the objective in their own reasoning.";

function isUntouchedPlaceholder(objective: { evidence_requirements: string[] }) {
  return objective.evidence_requirements.length === 1 && objective.evidence_requirements[0] === PLACEHOLDER_OBJECTIVE_EVIDENCE;
}

export function applyItemDesignAssistantUpdates(input: {
  blueprint: ItemDesignBlueprint;
  updates: z.infer<typeof ItemDesignAssistantBlueprintUpdateSchema>[];
}) {
  const next = structuredClone(input.blueprint);

  for (const update of input.updates) {
    switch (update.update_type) {
      case "set_section_topic":
        next.section_topic = update.value;
        break;
      case "set_section_summary":
        next.section_summary = update.value;
        break;
      case "upsert_objective": {
        const index = next.objectives.findIndex(
          (objective) => objective.objective_id === update.objective.objective_id
        );
        next.objectives = index === -1
          ? [...next.objectives, update.objective]
          : next.objectives.map((objective, objectiveIndex) =>
              objectiveIndex === index ? update.objective : objective
            );
        break;
      }
      case "remove_objective":
        next.objectives = next.objectives.filter(
          (objective) => objective.objective_id !== update.objective_id
        );
        break;
      case "upsert_misconception": {
        const index = next.misconception_hypotheses.findIndex(
          (misconception) => misconception.misconception_id === update.misconception.misconception_id
        );
        next.misconception_hypotheses = index === -1
          ? [...next.misconception_hypotheses, update.misconception]
          : next.misconception_hypotheses.map((misconception, misconceptionIndex) =>
              misconceptionIndex === index ? update.misconception : misconception
            );
        break;
      }
      case "remove_misconception":
        next.misconception_hypotheses = next.misconception_hypotheses.filter(
          (misconception) => misconception.misconception_id !== update.misconception_id
        );
        break;
      case "upsert_exemplar": {
        const index = next.exemplar_items.findIndex(
          (exemplar) => exemplar.exemplar_id === update.exemplar.exemplar_id
        );
        next.exemplar_items = index === -1
          ? [...next.exemplar_items, update.exemplar]
          : next.exemplar_items.map((exemplar, exemplarIndex) =>
              exemplarIndex === index ? update.exemplar : exemplar
            );
        break;
      }
      case "remove_exemplar":
        next.exemplar_items = next.exemplar_items.filter(
          (exemplar) => exemplar.exemplar_id !== update.exemplar_id
        );
        break;
      case "update_generation_settings":
        next.generation_settings = update.settings;
        break;
    }
  }

  // A new mini test starts with one placeholder objective. Once the assistant has written real
  // objectives, the untouched placeholder goes, unless a misconception still depends on it alone.
  const placeholders = next.objectives.filter(isUntouchedPlaceholder);
  if (placeholders.length > 0 && placeholders.length < next.objectives.length) {
    const removed = new Set(placeholders
      .filter((objective) => !next.misconception_hypotheses.some((entry) =>
        entry.linked_objective_ids.length === 1 && entry.linked_objective_ids[0] === objective.objective_id))
      .map((objective) => objective.objective_id));
    next.objectives = next.objectives.filter((objective) => !removed.has(objective.objective_id));
    next.misconception_hypotheses = next.misconception_hypotheses.map((entry) => ({
      ...entry,
      linked_objective_ids: entry.linked_objective_ids.filter((id) => !removed.has(id))
    }));
  }

  return ItemDesignBlueprintSchema.parse(next);
}

const GeneratedOptionSchema = z.object({
  label: z.string().trim().regex(/^[A-E]$/),
  text: z.string().trim().min(1).max(700),
  rationale: z.string().trim().min(1).max(1000),
  /** Two to six words naming the incorrect idea (the same label for the same idea across items); null for the key. */
  idea_label: z.string().trim().min(1).max(60).nullable().default(null),
  linked_misconception_ids: z.array(z.string().trim().min(1).max(80)).max(8)
}).strict();

export const GeneratedItemCandidateSchema = z.object({
  item_label: z.string().trim().min(1).max(120),
  stem: z.string().trim().min(1).max(2000),
  options: z.array(GeneratedOptionSchema).min(3).max(5),
  proposed_correct_option: z.string().trim().regex(/^[A-E]$/),
  correct_answer_explanation: z.string().trim().min(1).max(1400),
  objective_ids: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  misconception_hypothesis_ids: z.array(z.string().trim().min(1).max(80)).max(8),
  target_reasoning_note: z.string().trim().min(1).max(1000),
  strong_reasoning_should_mention: z.string().trim().min(1).max(1000),
  cognitive_demand: z.enum(["remember", "understand", "apply", "analyze", "evaluate", "create"]),
  difficulty: ItemDesignCognitiveDemandBandSchema,
  limitations: z.array(z.string().trim().min(1).max(400)).max(6)
}).strict().superRefine((item, context) => {
  const labels = new Set(item.options.map((option) => option.label));
  if (labels.size !== item.options.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Option labels must be unique." });
  }
  if (!labels.has(item.proposed_correct_option)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["proposed_correct_option"],
      message: "The proposed key must match an option label."
    });
  }
});

export const ItemGenerationOutputSchema = z.object({
  schema_version: z.literal(ITEM_GENERATION_SCHEMA_VERSION),
  blueprint_version: z.literal(ITEM_DESIGN_BLUEPRINT_VERSION),
  candidates: z.array(GeneratedItemCandidateSchema).min(1).max(12),
  coverage_summary: z.array(z.object({
    objective_id: z.string().trim().min(1).max(80),
    candidate_count: z.number().int().nonnegative()
  }).strict()).min(1),
  set_level_limitations: z.array(z.string().trim().min(1).max(500)).max(8),
  teacher_review_required: z.literal(true)
}).strict();

/**
 * The check of generated drafts (20 Oct 2026). The checker sees each item without its proposed
 * key, answers it as a well-prepared student would, and reports problems; items with a
 * different answer or problems are revised once and checked again.
 */
export const ITEM_CHECK_PROMPT_VERSION = "evidence-centered-mcq-item-check-v1" as const;
export const ITEM_CHECK_SCHEMA_VERSION = "evidence-centered-mcq-item-check-output-v1" as const;
export const ITEM_REVISION_PROMPT_VERSION = "evidence-centered-mcq-revision-v1" as const;
export const ITEM_REVISION_SCHEMA_VERSION = "evidence-centered-mcq-revision-output-v1" as const;

export const ItemCheckProblemSchema = z.enum([
  "more_than_one_defensible_answer",
  "no_defensible_answer",
  "ambiguous_wording",
  "answer_cue",
  "implausible_distractor",
  "not_plain_language",
  "reading_load",
  "outside_topic",
  "does_not_assess_objective",
  "item_dependency"
]);

export const ItemCheckOutputSchema = z.object({
  schema_version: z.literal(ITEM_CHECK_SCHEMA_VERSION),
  items: z.array(z.object({
    item_label: z.string().trim().min(1).max(120),
    independent_answer: z.string().trim().regex(/^[A-E]$/).nullable(),
    defensible_options: z.array(z.string().trim().regex(/^[A-E]$/)).max(5),
    problems: z.array(z.object({
      check: ItemCheckProblemSchema,
      detail: z.string().trim().min(1).max(400)
    }).strict()).max(8)
  }).strict()).min(1).max(12)
}).strict();

export type ItemCheckOutput = z.infer<typeof ItemCheckOutputSchema>;

export const ItemRevisionOutputSchema = z.object({
  schema_version: z.literal(ITEM_REVISION_SCHEMA_VERSION),
  candidates: z.array(GeneratedItemCandidateSchema).min(1).max(12)
}).strict();

/** What the teacher sees about a draft's check. */
export type ItemCheckSummary = {
  status: "checked" | "unavailable";
  independent_answer: string | null;
  agrees_with_key: boolean;
  revised: boolean;
  remaining_problems: string[];
};

/** Whether a checked draft needs another look: a different or no single answer, or problems. */
export function checkFindsProblem(
  check: ItemCheckOutput["items"][number] | undefined,
  proposedKey: string
): boolean {
  if (!check) return true;
  return check.independent_answer !== proposedKey ||
    check.defensible_options.length !== 1 ||
    check.defensible_options[0] !== proposedKey ||
    check.problems.length > 0;
}

export function itemCheckSummary(input: {
  check: ItemCheckOutput["items"][number] | undefined;
  proposed_key: string;
  revised: boolean;
}): ItemCheckSummary {
  if (!input.check) {
    return { status: "unavailable", independent_answer: null, agrees_with_key: false, revised: input.revised, remaining_problems: [] };
  }
  const agrees = input.check.independent_answer === input.proposed_key &&
    input.check.defensible_options.length === 1 && input.check.defensible_options[0] === input.proposed_key;
  const problems = input.check.problems.map((problem) => problem.detail);
  if (!agrees) {
    const options = input.check.defensible_options;
    const list = options.length > 1 ? `${options.slice(0, -1).join(", ")} and ${options.at(-1)}` : options.join("");
    problems.unshift(options.length > 1
      ? `When the assistant answered this item without seeing the key, it found more than one defensible answer (${list}). The proposed key is ${input.proposed_key}. Please check that only one answer is correct.`
      : input.check.independent_answer
        ? `When the assistant answered this item without seeing the key, it chose ${input.check.independent_answer}, but the proposed key is ${input.proposed_key}. Please check which answer is correct.`
        : `When the assistant answered this item without seeing the key, it could not defend any option. The proposed key is ${input.proposed_key}. Please check the item.`);
  }
  return { status: "checked", independent_answer: input.check.independent_answer, agrees_with_key: agrees, revised: input.revised, remaining_problems: problems };
}

/**
 * Existing items in the course materials (release CMCQ-20261020-06): the instructor's own
 * finished items are read from the uploaded files, kept word for word, and prepared for the
 * same review as generated drafts. A key is recorded only when the source states it; the
 * item specifications the source lacks are proposed and marked as suggestions.
 */
export const EXISTING_ITEMS_PROMPT_VERSION = "existing-mcq-import-v1" as const;
export const EXISTING_ITEMS_SCHEMA_VERSION = "existing-mcq-import-output-v1" as const;
export const EXISTING_ITEMS_MAX = 40;

const OptionLabelSchema = z.string().trim().regex(/^[A-E]$/);

export const ExistingItemsOutputSchema = z.object({
  schema_version: z.literal(EXISTING_ITEMS_SCHEMA_VERSION),
  items: z.array(z.object({
    source_label: z.string().trim().min(1).max(120),
    source_topic: z.string().trim().max(240).nullable(),
    belongs_to_selected_topic: z.boolean(),
    stem: z.string().trim().min(1).max(4000),
    options: z.array(z.object({ label: OptionLabelSchema, text: z.string().trim().min(1).max(1500) }).strict()).min(2).max(5),
    stated_key: OptionLabelSchema.nullable(),
    suggested_key: OptionLabelSchema.nullable(),
    target_reasoning: z.string().trim().min(1).max(1500),
    target_reasoning_from_source: z.boolean(),
    essential_elements: z.array(z.string().trim().min(1).max(400)).min(1).max(3),
    essential_elements_from_source: z.boolean(),
    option_notes: z.array(z.object({
      label: OptionLabelSchema,
      rationale: z.string().trim().min(1).max(1000),
      idea_label: z.string().trim().min(1).max(60),
      from_source: z.boolean(),
      linked_misconception_ids: z.array(z.string().trim().min(1).max(80)).max(8)
    }).strict()).max(4),
    objective_ids: z.array(z.string().trim().min(1).max(80)).max(8),
    note_for_teacher: z.string().trim().max(600).nullable()
  }).strict()).max(EXISTING_ITEMS_MAX),
  skipped: z.array(z.object({
    source_label: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(400)
  }).strict()).max(EXISTING_ITEMS_MAX)
}).strict();

export type ExistingItemsOutput = z.infer<typeof ExistingItemsOutputSchema>;

export type ExistingItemDraft = {
  item_label: string;
  stem: string;
  options: Array<{ label: string; text: string }>;
  /** The key the source states; the instructor still confirms it. */
  stated_key: string | null;
  /** The assistant's answer when the source states no key; a suggestion only. */
  suggested_key: string | null;
  target_reasoning_note: string | null;
  suggested_target_reasoning_note: string | null;
  essential_elements: string | null;
  suggested_essential_elements: string | null;
  option_rationales: Array<{ label: string; rationale: string; idea_label: string | null }>;
  suggested_option_rationales: Array<{ label: string; rationale: string; idea_label: string | null }>;
  objective_ids: string[];
  misconception_hypothesis_ids: string[];
  source_topic: string | null;
  from_source: string[];
  suggested: string[];
  note_for_teacher: string | null;
};

/**
 * The items of the selected topic as review drafts: what the source states fills the fields,
 * and what the assistant proposes waits as a suggestion for the instructor. Options the
 * output does not list, rationales for the key and unknown links are dropped.
 */
export function existingItemDrafts(output: ExistingItemsOutput, blueprint: ItemDesignBlueprint): {
  drafts: ExistingItemDraft[];
  other_topic_count: number;
} {
  const objectiveIds = new Set(blueprint.objectives.map((objective) => objective.objective_id));
  const misconceptionIds = new Set(blueprint.misconception_hypotheses.map((entry) => entry.misconception_id));
  const selected = output.items.filter((item) => item.belongs_to_selected_topic);
  const drafts = selected.flatMap((item) => {
    const labels = new Set(item.options.map((option) => option.label));
    if (labels.size !== item.options.length) return [];
    const statedKey = item.stated_key && labels.has(item.stated_key) ? item.stated_key : null;
    const suggestedKey = !statedKey && item.suggested_key && labels.has(item.suggested_key) ? item.suggested_key : null;
    const key = statedKey ?? suggestedKey;
    const notes = item.option_notes.filter((note, index, all) =>
      labels.has(note.label) && note.label !== key && all.findIndex((entry) => entry.label === note.label) === index);
    const asRationale = (note: (typeof notes)[number]) => ({ label: note.label, rationale: note.rationale, idea_label: note.idea_label });
    const elements = item.essential_elements.join("\n");
    const fromSource = ["stem", "options", ...(statedKey ? ["key"] : [])];
    const suggested = suggestedKey ? ["key"] : [];
    (item.target_reasoning_from_source ? fromSource : suggested).push("target reasoning");
    (item.essential_elements_from_source ? fromSource : suggested).push("essential elements");
    if (notes.some((note) => note.from_source)) fromSource.push("notes on incorrect options");
    if (notes.some((note) => !note.from_source)) suggested.push("notes on incorrect options");
    return [{
      item_label: item.source_label,
      stem: item.stem,
      options: item.options.map(({ label, text }) => ({ label, text })),
      stated_key: statedKey,
      suggested_key: suggestedKey,
      target_reasoning_note: item.target_reasoning_from_source ? item.target_reasoning : null,
      suggested_target_reasoning_note: item.target_reasoning_from_source ? null : item.target_reasoning,
      essential_elements: item.essential_elements_from_source ? elements : null,
      suggested_essential_elements: item.essential_elements_from_source ? null : elements,
      option_rationales: notes.filter((note) => note.from_source).map(asRationale),
      suggested_option_rationales: notes.filter((note) => !note.from_source).map(asRationale),
      objective_ids: item.objective_ids.filter((id) => objectiveIds.has(id)),
      misconception_hypothesis_ids: [...new Set(notes.flatMap((note) => note.linked_misconception_ids).filter((id) => misconceptionIds.has(id)))],
      source_topic: item.source_topic,
      from_source: fromSource,
      suggested,
      note_for_teacher: item.note_for_teacher
    }];
  });
  return { drafts, other_topic_count: output.items.length - selected.length };
}

/** One sentence for the review page: what came from the instructor's file and what the assistant suggested. */
export function describeExistingItemSources(fromSource: string[], suggested: string[]) {
  const list = (values: string[]) =>
    values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
  return suggested.length === 0
    ? `Everything here comes from your file: ${list(fromSource)}.`
    : `From your file: ${list(fromSource)}. Suggested by the assistant for your review: ${list(suggested)}.`;
}

export type ItemDesignBlueprint = z.infer<typeof ItemDesignBlueprintSchema>;
export type ItemDesignAssistantMessage = z.infer<typeof ItemDesignAssistantMessageSchema>;
export type ItemDesignAssistantOutput = z.infer<typeof ItemDesignAssistantOutputSchema>;
export type ItemDesignAssistantThread = z.infer<typeof ItemDesignAssistantThreadSchema>;
export type ItemDesignSourceMaterial = z.infer<typeof ItemDesignSourceMaterialSchema>;
export type ItemGenerationOutput = z.infer<typeof ItemGenerationOutputSchema>;

const legacyCognitiveDemandBands: Record<string, ItemDesignCognitiveDemandBand> = {
  foundational: "foundational",
  application: "foundational",
  reasoning: "analyzing",
  analyzing: "analyzing",
  evaluating: "evaluating",
  creating: "creating"
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeDemandMix(value: unknown) {
  if (!Array.isArray(value)) return value;
  return Array.from(new Set(value.map((entry) =>
    typeof entry === "string" ? legacyCognitiveDemandBands[entry] ?? entry : entry
  )));
}

export function normalizeLegacyItemDesignBlueprint(value: unknown): unknown {
  const blueprint = record(value);
  const settings = record(blueprint.generation_settings);
  if (Object.keys(settings).length === 0) return value;
  return {
    ...blueprint,
    generation_settings: {
      ...settings,
      difficulty_mix: normalizeDemandMix(settings.difficulty_mix)
    }
  };
}

export function normalizeLegacyItemDesignAssistantOutput(value: unknown): unknown {
  const output = record(value);
  if (!Array.isArray(output.blueprint_updates)) return value;
  // v2 outputs (before the topic map) replay as v3 with no topics.
  const versioned = output.schema_version === ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION_V2
    ? { schema_version: ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION, topic_map: EMPTY_ITEM_DESIGN_TOPIC_MAP }
    : {};
  return {
    ...output,
    ...versioned,
    blueprint_updates: output.blueprint_updates.map((candidate) => {
      const update = record(candidate);
      if (update.update_type !== "update_generation_settings") return candidate;
      const settings = record(update.settings);
      return {
        ...update,
        settings: {
          ...settings,
          difficulty_mix: normalizeDemandMix(settings.difficulty_mix)
        }
      };
    })
  };
}

export function normalizeLegacyItemGenerationOutput(value: unknown): unknown {
  const output = record(value);
  if (!Array.isArray(output.candidates)) return value;
  return {
    ...output,
    candidates: output.candidates.map((candidate) => {
      const item = record(candidate);
      return {
        ...item,
        // Drafts generated before idea labels (generation v3) carry none.
        options: Array.isArray(item.options)
          ? item.options.map((option) => ({ idea_label: null, ...record(option) }))
          : item.options,
        difficulty:
          typeof item.difficulty === "string"
            ? legacyCognitiveDemandBands[item.difficulty] ?? item.difficulty
            : item.difficulty
      };
    })
  };
}

function cognitiveDemandBand(value: z.infer<typeof GeneratedItemCandidateSchema>["cognitive_demand"]) {
  if (value === "analyze") return "analyzing" as const;
  if (value === "evaluate") return "evaluating" as const;
  if (value === "create") return "creating" as const;
  return "foundational" as const;
}

export function validateGeneratedItemSet(input: {
  blueprint: ItemDesignBlueprint;
  output: unknown;
  expected_candidate_count?: number;
  required_objective_ids?: string[];
  required_misconception_ids?: string[];
  required_cognitive_demand_bands?: ItemDesignCognitiveDemandBand[];
}) {
  let parsed = ItemGenerationOutputSchema.safeParse(
    normalizeLegacyItemGenerationOutput(input.output)
  );
  if (!parsed.success) return parsed;

  // The item-level index includes all option-level links. This is metadata
  // closure only: no new hypothesis, wording, or answer key is inferred.
  parsed = ItemGenerationOutputSchema.safeParse({
    ...parsed.data,
    candidates: parsed.data.candidates.map((candidate) => ({
      ...candidate,
      misconception_hypothesis_ids: [...new Set([
        ...candidate.misconception_hypothesis_ids,
        ...candidate.options.flatMap((option) => option.linked_misconception_ids)
      ])]
    }))
  });
  if (!parsed.success) return parsed;

  const objectiveIds = new Set(input.blueprint.objectives.map((objective) => objective.objective_id));
  const misconceptionIds = new Set(
    input.blueprint.misconception_hypotheses.map((misconception) => misconception.misconception_id)
  );
  const issues: Array<{ path: string; message: string }> = [];
  const coveredObjectiveIds = new Set<string>();
  const coveredMisconceptionIds = new Set<string>();
  const expectedCandidateCount =
    input.expected_candidate_count ?? input.blueprint.generation_settings.target_item_count;
  if (parsed.data.candidates.length !== expectedCandidateCount) {
    issues.push({ path: "candidates", message: "Generated candidate count does not match the saved blueprint." });
  }
  parsed.data.candidates.forEach((candidate, index) => {
    if (candidate.options.length !== input.blueprint.generation_settings.option_count) {
      issues.push({ path: `candidates.${index}.options`, message: "Option count does not match the saved blueprint." });
    }
    candidate.objective_ids.forEach((id) => {
      if (!objectiveIds.has(id)) {
        issues.push({ path: `candidates.${index}.objective_ids`, message: `Unknown objective ID: ${id}.` });
      } else {
        coveredObjectiveIds.add(id);
      }
    });
    candidate.misconception_hypothesis_ids.forEach((id) => {
      if (!misconceptionIds.has(id)) {
        issues.push({ path: `candidates.${index}.misconception_hypothesis_ids`, message: `Unknown misconception ID: ${id}.` });
      } else {
        coveredMisconceptionIds.add(id);
      }
    });
    if (!input.blueprint.generation_settings.difficulty_mix.includes(candidate.difficulty)) {
      issues.push({
        path: `candidates.${index}.difficulty`,
        message: `Cognitive-demand band ${candidate.difficulty} was not selected in the saved design.`
      });
    }
    if (candidate.difficulty !== cognitiveDemandBand(candidate.cognitive_demand)) {
      issues.push({
        path: `candidates.${index}.difficulty`,
        message: "The cognitive-demand label and band do not agree."
      });
    }
    const candidateMisconceptionIds = new Set(candidate.misconception_hypothesis_ids);
    candidate.options.forEach((option, optionIndex) => {
      option.linked_misconception_ids.forEach((id) => {
        if (!misconceptionIds.has(id)) {
          issues.push({
            path: `candidates.${index}.options.${optionIndex}.linked_misconception_ids`,
            message: `Unknown misconception ID: ${id}.`
          });
        } else {
          coveredMisconceptionIds.add(id);
          if (!candidateMisconceptionIds.has(id)) {
            issues.push({
              path: `candidates.${index}.misconception_hypothesis_ids`,
              message: `Option-linked misconception ${id} must also be declared at candidate level.`
            });
          }
        }
      });
    });
  });
  const requiredObjectiveIds = input.required_objective_ids ?? [...objectiveIds];
  requiredObjectiveIds.forEach((id) => {
    if (!coveredObjectiveIds.has(id)) {
      issues.push({ path: "candidates", message: `No generated candidate covers objective ID: ${id}.` });
    }
  });
  const requiredMisconceptionIds = input.required_misconception_ids ?? [...misconceptionIds];
  requiredMisconceptionIds.forEach((id) => {
    if (!coveredMisconceptionIds.has(id)) {
      issues.push({ path: "candidates", message: `No generated candidate probes misconception ID: ${id}.` });
    }
  });
  const coveredDemandBands = new Set(parsed.data.candidates.map((candidate) => candidate.difficulty));
  (input.required_cognitive_demand_bands ?? []).forEach((band) => {
    if (!coveredDemandBands.has(band)) {
      issues.push({
        path: "candidates",
        message: `No generated candidate covers cognitive-demand band: ${band}.`
      });
    }
  });

  const coverageRows = new Map(parsed.data.coverage_summary.map((row) => [row.objective_id, row.candidate_count]));
  if (coverageRows.size !== parsed.data.coverage_summary.length) {
    issues.push({ path: "coverage_summary", message: "Coverage summary objective IDs must be unique." });
  }
  objectiveIds.forEach((id) => {
    const actualCount = parsed.data.candidates.filter((candidate) => candidate.objective_ids.includes(id)).length;
    if (actualCount > 0 && coverageRows.get(id) !== actualCount) {
      issues.push({ path: "coverage_summary", message: `Coverage summary is incorrect for objective ID: ${id}.` });
    }
  });
  coverageRows.forEach((_count, id) => {
    if (!objectiveIds.has(id)) {
      issues.push({ path: "coverage_summary", message: `Coverage summary contains unknown objective ID: ${id}.` });
    }
  });
  return issues.length === 0
    ? parsed
    : { success: false as const, error: { issues } };
}
