import { z } from "zod";

export const ITEM_DESIGN_BLUEPRINT_VERSION = "evidence-centered-item-design-v1" as const;
export const ITEM_DESIGN_ASSISTANT_PROMPT_VERSION = "evidence-centered-item-design-assistant-v3" as const;
export const ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION = "evidence-centered-item-design-assistant-output-v2" as const;
export const ITEM_DESIGN_ASSISTANT_THREAD_VERSION = "evidence-centered-item-design-thread-v1" as const;
export const ITEM_DESIGN_SOURCE_MATERIAL_VERSION = "evidence-centered-item-design-source-materials-v1" as const;
export const ITEM_GENERATION_PROMPT_VERSION = "evidence-centered-mcq-generation-v2" as const;
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
  target_item_count: z.number().int().min(3).max(12).default(6),
  option_count: z.number().int().min(3).max(5).default(4),
  difficulty_mix: z.array(ItemDesignCognitiveDemandBandSchema).min(1).max(4),
  context_notes: z.string().trim().max(1200).nullable().default(null)
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

export const ItemDesignAssistantOutputSchema = z.object({
  schema_version: z.literal(ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION),
  assistant_message: z.string().trim().min(1).max(4000),
  blueprint_updates: z.array(ItemDesignAssistantBlueprintUpdateSchema).max(24),
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
  source_kind: z.enum(["docx", "pdf", "image"]),
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

  return ItemDesignBlueprintSchema.parse(next);
}

const GeneratedOptionSchema = z.object({
  label: z.string().trim().regex(/^[A-E]$/),
  text: z.string().trim().min(1).max(700),
  rationale: z.string().trim().min(1).max(1000),
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
  return {
    ...output,
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
  const parsed = ItemGenerationOutputSchema.safeParse(
    normalizeLegacyItemGenerationOutput(input.output)
  );
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
