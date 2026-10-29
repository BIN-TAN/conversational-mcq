import type {
  ItemPreparationInput,
  ItemPreparationModelProblem,
  ItemPreparationOutput
} from "./contract";

/**
 * A labelled stand-in for the item-preparation model in mock mode and local tests. It
 * returns the items as given, keeps any key the instructor or the source supplied, and
 * fills empty fields with placeholder text that says it is not a judgment of the item.
 * `mock_mode` (the existing verification mock modes) adds one problem so the check flow
 * can be exercised without a model.
 */
const PLACEHOLDER = "Local test stand-in, not a judgment of this item:";

const MOCK_PROBLEMS: Record<string, Pick<ItemPreparationModelProblem, "field" | "code" | "message"> & { option?: boolean; set_level?: boolean }> = {
  item_verification_warning: { field: "stem", code: "ambiguous_wording", message: "The wording in the stem may allow more than one interpretation." },
  item_verification_ambiguous_stem: { field: "stem", code: "ambiguous_wording", message: "The wording in the stem may allow more than one interpretation." },
  item_verification_concept_misalignment: { field: "item", code: "outside_topic", message: "The item may not directly target the topic." },
  item_verification_learning_objective_misalignment: { field: "item", code: "unrelated_reading_demand", message: "The item may ask for reading unrelated to the assessed idea." },
  item_verification_multiple_correct_answers: { field: "option", code: "more_than_one_defensible_answer", message: "More than one option may be defensible from the stem.", option: true },
  item_verification_answer_key_inconsistency: { field: "key", code: "doubtful_key", message: "The confirmed key may not fit the stem and options." },
  item_verification_weak_distractor: { field: "option", code: "implausible_option", message: "This option may be too implausible to be chosen.", option: true },
  item_verification_overlapping_options: { field: "options", code: "ambiguous_wording", message: "Two options may be hard to tell apart." },
  item_verification_answer_cue: { field: "stem", code: "answer_cue", message: "The stem or options may contain a cue to the answer." },
  item_verification_insufficient_information: { field: "topic", code: "other", message: "The topic description may be too brief to check the items against.", set_level: true }
};

export function buildLocalTestItemPreparation(input: ItemPreparationInput, mockMode?: string | null): ItemPreparationOutput {
  const items = input.items.map((item) => {
    const key = item.confirmed_key ?? item.source_key ?? null;
    const existing = new Map(item.distractor_rationales.map((entry) => [entry.option_label.toUpperCase(), entry]));
    return {
      item_ref: item.item_ref,
      stem: item.stem,
      options: item.options,
      proposed_key: key,
      target_reasoning: item.target_reasoning ?? `${PLACEHOLDER} the reasoning that leads to the correct option.`,
      essential_elements: item.essential_elements.length
        ? item.essential_elements.slice(0, 3)
        : [`${PLACEHOLDER} the main point a strong explanation should mention.`],
      distractor_rationales: key
        ? item.options
            .filter((option) => option.label.toUpperCase() !== key.toUpperCase())
            .map((option) => existing.get(option.label.toUpperCase()) ?? {
              option_label: option.label,
              rationale: `${PLACEHOLDER} an incorrect idea that could lead to option ${option.label}.`,
              idea_label: null,
              not_tied_to_an_idea: false
            })
        : []
    };
  });

  for (let index = 1; index <= Math.max(0, input.requested_new_items); index += 1) {
    items.push({
      item_ref: `new-${index}`,
      stem: `${PLACEHOLDER} drafted item ${index} on ${input.topic.title}.`,
      options: ["A", "B", "C", "D"].map((label) => ({ label, text: `${PLACEHOLDER} option ${label}.` })),
      proposed_key: "A",
      target_reasoning: `${PLACEHOLDER} the reasoning that leads to option A.`,
      essential_elements: [`${PLACEHOLDER} the main point a strong explanation should mention.`],
      distractor_rationales: ["B", "C", "D"].map((label) => ({
        option_label: label,
        rationale: `${PLACEHOLDER} an incorrect idea that could lead to option ${label}.`,
        idea_label: null,
        not_tied_to_an_idea: false
      }))
    });
  }

  const problems: ItemPreparationModelProblem[] = [];
  const mock = mockMode ? MOCK_PROBLEMS[mockMode] : undefined;
  const first = input.items[0];
  if (mock && (first || mock.set_level)) {
    const optionLabel = mock.option ? first?.options[1]?.label ?? null : null;
    problems.push({
      item_ref: mock.set_level ? null : first!.item_ref,
      field: mock.option && !optionLabel ? "options" : mock.field,
      option_label: optionLabel,
      code: mock.code,
      message: mock.message
    });
  }

  return { items, problems };
}
