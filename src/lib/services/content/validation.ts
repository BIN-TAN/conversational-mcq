import { z } from "zod";
import type { ContentValidationIssue } from "./errors";

const nonEmptyText = z.string().trim().min(1);
const optionalText = z.string().trim().optional().nullable();
const jsonObject = z.record(z.unknown());

export const ItemOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(16),
    text: z.string().trim().min(1)
  })
  .strict();

export const AssessmentDraftInputSchema = z
  .object({
    title: nonEmptyText,
    description: optionalText
  })
  .strict();

export const AssessmentUpdateInputSchema = z
  .object({
    title: nonEmptyText.optional(),
    description: optionalText
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one assessment field is required."
  });

export const ConceptUnitDraftInputSchema = z
  .object({
    title: nonEmptyText,
    learning_objective: nonEmptyText,
    related_concept_description: nonEmptyText,
    administration_rules: jsonObject.default({}),
    order_index: z.number().int().positive().optional()
  })
  .strict();

export const ConceptUnitUpdateInputSchema = z
  .object({
    title: nonEmptyText.optional(),
    learning_objective: nonEmptyText.optional(),
    related_concept_description: nonEmptyText.optional(),
    administration_rules: jsonObject.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one concept unit field is required."
  });

export const ItemDraftInputSchema = z
  .object({
    item_stem: nonEmptyText,
    options: z.array(ItemOptionSchema).min(2).max(6),
    correct_option: z.string().trim().min(1),
    distractor_rationales: z.record(z.string().trim().min(1)).default({}),
    expected_reasoning_patterns: z.array(nonEmptyText).default([]),
    possible_misconception_indicators: z.array(nonEmptyText).default([]),
    administration_rules: jsonObject.default({}),
    included_in_published_set: z.boolean().default(true),
    item_order: z.number().int().positive().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const labels = value.options.map((option) => option.label);
    const uniqueLabels = new Set(labels);

    if (uniqueLabels.size !== labels.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Option labels must be unique within an item."
      });
    }

    if (!uniqueLabels.has(value.correct_option)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correct_option"],
        message: "correct_option must match one option label."
      });
    }
  });

export const ItemUpdateInputSchema = z
  .object({
    item_stem: nonEmptyText.optional(),
    options: z.array(ItemOptionSchema).min(2).max(6).optional(),
    correct_option: z.string().trim().min(1).optional(),
    distractor_rationales: z.record(z.string().trim().min(1)).optional(),
    expected_reasoning_patterns: z.array(nonEmptyText).optional(),
    possible_misconception_indicators: z.array(nonEmptyText).optional(),
    administration_rules: jsonObject.optional(),
    included_in_published_set: z.boolean().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one item field is required."
  });

export const ImportedConceptUnitSchema = ConceptUnitDraftInputSchema.extend({
  items: z.array(ItemDraftInputSchema).min(1)
}).strict();

export const ConceptUnitImportInputSchema = z
  .object({
    assessment_public_id: z.string().trim().min(1).optional(),
    assessment: AssessmentDraftInputSchema.optional(),
    concept_units: z.array(ImportedConceptUnitSchema).min(1)
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.assessment_public_id && !value.assessment) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assessment"],
        message: "Provide either assessment or assessment_public_id."
      });
    }

    if (value.assessment_public_id && value.assessment) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assessment_public_id"],
        message: "Provide assessment or assessment_public_id, not both."
      });
    }
  });

export const PublishConceptUnitCheckSchema = z
  .object({
    concept_unit_public_id: z.string().trim().min(1)
  })
  .strict();

export const ReorderConceptUnitsInputSchema = z
  .object({
    ordered_concept_unit_public_ids: z.array(z.string().trim().min(1)).min(1)
  })
  .strict();

export const ReorderItemsInputSchema = z
  .object({
    ordered_item_public_ids: z.array(z.string().trim().min(1)).min(1)
  })
  .strict();

export type AssessmentDraftInput = z.infer<typeof AssessmentDraftInputSchema>;
export type ConceptUnitDraftInput = z.infer<typeof ConceptUnitDraftInputSchema>;
export type ItemDraftInput = z.infer<typeof ItemDraftInputSchema>;
export type ConceptUnitImportInput = z.infer<typeof ConceptUnitImportInputSchema>;

export function zodIssuesToContentIssues(
  error: z.ZodError,
  pathPrefix = ""
): ContentValidationIssue[] {
  return error.issues.map((issue) => {
    const issuePath = issue.path.join(".");
    const path = [pathPrefix, issuePath].filter(Boolean).join(".");

    return {
      path,
      code: issue.code,
      message: issue.message
    };
  });
}
