import type { AgentInputByName } from "@/lib/agents/contracts";

type VerificationConceptUnit = {
  concept_unit_public_id: string;
  title: string;
  learning_objective: string;
  related_concept_description: string;
  version: number;
};

type VerificationItem = {
  item_public_id: string;
  item_order: number;
  item_stem: string;
  options: unknown;
  correct_option: string;
  distractor_rationales: unknown;
  expected_reasoning_patterns: unknown;
  possible_misconception_indicators: unknown;
  version: number;
};

function optionArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((option) => {
      if (!option || typeof option !== "object") {
        return null;
      }

      const record = option as Record<string, unknown>;

      return {
        label: String(record.label ?? ""),
        text: String(record.text ?? "")
      };
    })
    .filter((option): option is { label: string; text: string } => Boolean(option));
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function jsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function buildItemVerificationInput(input: {
  conceptUnit: VerificationConceptUnit;
  items: VerificationItem[];
}): AgentInputByName["item_verification_agent"] {
  return {
    concept_unit: {
      concept_unit_public_id: input.conceptUnit.concept_unit_public_id,
      title: input.conceptUnit.title,
      learning_objective: input.conceptUnit.learning_objective,
      related_concept_description: input.conceptUnit.related_concept_description,
      version: input.conceptUnit.version
    },
    items: input.items.map((item) => ({
      item_public_id: item.item_public_id,
      item_order: item.item_order,
      item_stem: item.item_stem,
      options: optionArray(item.options),
      correct_option: item.correct_option,
      distractor_rationales: jsonRecord(item.distractor_rationales),
      expected_reasoning_patterns: stringArray(item.expected_reasoning_patterns),
      possible_misconception_indicators: stringArray(item.possible_misconception_indicators),
      version: item.version
    })),
    verification_constraints: {
      advisory_only: true,
      teacher_final_authority: true,
      do_not_generate_or_rewrite_content: true,
      deterministic_validation_already_passed: true,
      no_student_data_in_input: true
    }
  };
}

export function buildItemVerificationFingerprintPayload(input: {
  conceptUnit: VerificationConceptUnit;
  items: Array<VerificationItem & { included_in_published_set?: boolean }>;
}) {
  return {
    concept_unit: {
      title: input.conceptUnit.title,
      learning_objective: input.conceptUnit.learning_objective,
      related_concept_description: input.conceptUnit.related_concept_description,
      version: input.conceptUnit.version
    },
    items: input.items.map((item) => ({
      item_public_id: item.item_public_id,
      item_order: item.item_order,
      item_stem: item.item_stem,
      options: optionArray(item.options),
      correct_option: item.correct_option,
      distractor_rationales: jsonRecord(item.distractor_rationales),
      expected_reasoning_patterns: stringArray(item.expected_reasoning_patterns),
      possible_misconception_indicators: stringArray(item.possible_misconception_indicators),
      version: item.version,
      included_in_published_set: Boolean(item.included_in_published_set)
    }))
  };
}
