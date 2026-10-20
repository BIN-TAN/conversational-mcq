import {
  ITEM_PREPARATION_PROMPT_HASH,
  ITEM_PREPARATION_PROMPT_VERSION,
  ITEM_PREPARATION_SCHEMA_VERSION,
  type ItemPreparationInput,
  type ItemPreparationItemInput,
  type ItemPreparationOptionRationale,
  type ItemPreparationOutput,
  type ItemPreparationProblem,
  type ItemPreparationResult,
  type KeyStatus,
  type PreparedItem
} from "./contract";

/**
 * The application's checks on an item-preparation proposal (section 3, "The application
 * checks": never changes a confirmed key; the instructor approves every item).
 *
 * validateItemPreparationOutput lists structural faults that make a proposal unusable;
 * the call is regenerated once with them. applyItemPreparationRules then enforces the rules
 * on a usable proposal: a confirmed key is never replaced (a proposed change becomes a
 * reported problem), the format task records a key only when the source states it, and
 * rationales are kept to the incorrect options. Nothing here publishes or saves an item.
 */
export type ItemPreparationIssue = { path: string; code: string; message: string };

const MAX_ESSENTIAL_ELEMENTS = 3;
const norm = (value: string) => value.trim().toUpperCase();
const squash = (value: string) => value.replace(/\s+/g, " ").trim();
const clean = (value: string | null | undefined) => (typeof value === "string" && value.trim() ? value.trim() : null);

function newItemRefs(input: ItemPreparationInput) {
  return Array.from({ length: Math.max(0, input.requested_new_items) }, (_, index) => `new-${index + 1}`);
}

export function validateItemPreparationOutput(
  input: ItemPreparationInput,
  output: ItemPreparationOutput
): ItemPreparationIssue[] {
  const issues: ItemPreparationIssue[] = [];
  const inputRefs = new Set(input.items.map((item) => item.item_ref));
  const allowedNew = new Set(input.task === "draft_or_adapt" ? newItemRefs(input) : []);
  const seen = new Set<string>();
  const optionsByRef = new Map<string, Set<string>>();

  output.items.forEach((item, index) => {
    const path = `items.${index}`;
    if (seen.has(item.item_ref)) issues.push({ path, code: "duplicate_item_ref", message: `${item.item_ref} appears twice.` });
    seen.add(item.item_ref);
    if (!inputRefs.has(item.item_ref) && !allowedNew.has(item.item_ref)) {
      issues.push({ path: `${path}.item_ref`, code: "unknown_item_ref", message: `${item.item_ref} is not an item in the input.` });
    }
    const labels = item.options.map((option) => norm(option.label));
    const labelSet = new Set(labels);
    optionsByRef.set(item.item_ref, labelSet);
    if (labelSet.size !== labels.length || labels.some((label) => !/^[A-F]$/.test(label))) {
      issues.push({ path: `${path}.options`, code: "invalid_option_labels", message: "Option labels must be unique letters A-F." });
    }
    const isNew = !inputRefs.has(item.item_ref);
    if (isNew ? item.options.length < 3 || item.options.length > 4 : item.options.length < 2) {
      issues.push({
        path: `${path}.options`,
        code: "option_count",
        message: isNew ? "A drafted item has three or four options." : "An item needs at least two options."
      });
    }
    if (!item.stem.trim() || item.options.some((option) => !option.text.trim())) {
      issues.push({ path, code: "empty_text", message: "The stem and every option need text." });
    }
    if (item.proposed_key !== null && !labelSet.has(norm(item.proposed_key))) {
      issues.push({ path: `${path}.proposed_key`, code: "unknown_key", message: "The proposed key must be one of the item's options." });
    }
    const source = input.items.find((entry) => entry.item_ref === item.item_ref);
    if (source?.confirmed_key && !labelSet.has(norm(source.confirmed_key))) {
      issues.push({
        path: `${path}.options`,
        code: "confirmed_key_option_missing",
        message: `The confirmed key ${source.confirmed_key} must remain one of the options.`
      });
    }
    if (!item.target_reasoning.trim()) {
      issues.push({ path: `${path}.target_reasoning`, code: "missing_target_reasoning", message: "Propose target reasoning." });
    }
    const elements = item.essential_elements.filter((entry) => entry.trim());
    if (elements.length < 1 || elements.length > MAX_ESSENTIAL_ELEMENTS) {
      issues.push({ path: `${path}.essential_elements`, code: "essential_elements_count", message: "Propose one to three essential elements." });
    }
    const rationaleLabels = item.distractor_rationales.map((entry) => norm(entry.option_label));
    if (new Set(rationaleLabels).size !== rationaleLabels.length) {
      issues.push({ path: `${path}.distractor_rationales`, code: "duplicate_rationale", message: "Give one rationale per incorrect option." });
    }
    rationaleLabels.forEach((label, rationaleIndex) => {
      if (!labelSet.has(label)) {
        issues.push({
          path: `${path}.distractor_rationales.${rationaleIndex}`,
          code: "unknown_option",
          message: `Option ${label} does not exist in this item.`
        });
      }
    });
  });

  for (const ref of inputRefs) {
    if (!seen.has(ref)) issues.push({ path: "items", code: "missing_item", message: `Return ${ref}.` });
  }

  output.problems.forEach((problem, index) => {
    const path = `problems.${index}`;
    if (problem.item_ref !== null && !inputRefs.has(problem.item_ref) && !seen.has(problem.item_ref)) {
      issues.push({ path: `${path}.item_ref`, code: "unknown_item_ref", message: `${problem.item_ref} is not an item.` });
      return;
    }
    if (problem.option_label !== null) {
      const labels = problem.item_ref ? optionsByRef.get(problem.item_ref) : undefined;
      if (!labels?.has(norm(problem.option_label))) {
        issues.push({ path: `${path}.option_label`, code: "unknown_option", message: "The option must exist in that item." });
      }
    }
    if (!problem.message.trim()) {
      issues.push({ path: `${path}.message`, code: "empty_message", message: "Describe the problem." });
    }
  });

  return issues;
}

/** True when the imported text states this key, for example "Answer: B" or "Key - B". */
export function sourceStatesKey(importedText: string | null, key: string): boolean {
  if (!importedText) return false;
  const label = key.trim().toUpperCase().replace(/[^A-F]/g, "");
  if (!label) return false;
  const pattern = new RegExp(
    `\\b(?:answer(?:\\s*key)?|key|correct(?:\\s*(?:answer|option))?)\\b\\s*(?:is\\s*)?[:=\\-\\u2013\\u2014)\\]]?\\s*\\(?${label}\\b`,
    "i"
  );
  return pattern.test(importedText);
}

function problem(
  item_ref: string | null,
  field: ItemPreparationProblem["field"],
  code: ItemPreparationProblem["code"],
  message: string,
  option_label: string | null = null
): ItemPreparationProblem {
  return { item_ref, field, option_label, code, message, source: "application" };
}

function resolveKey(
  task: ItemPreparationInput["task"],
  source: ItemPreparationItemInput | undefined,
  proposed: string | null,
  itemRef: string,
  problems: ItemPreparationProblem[]
): { key: string | null; key_status: KeyStatus } {
  const proposal = proposed ? norm(proposed) : null;
  const confirmed = source?.confirmed_key ? norm(source.confirmed_key) : null;
  const stated = source?.source_key ? norm(source.source_key) : null;

  // Rule 2: never change a confirmed key; a proposed change is reported, not applied.
  if (confirmed) {
    if (proposal && proposal !== confirmed) {
      problems.push(problem(
        itemRef,
        "key",
        "key_change_not_applied",
        `The assistant proposed ${proposal} as the key. Your confirmed key ${confirmed} was kept; review the key.`
      ));
    }
    return { key: confirmed, key_status: "confirmed" };
  }

  // Task 2: record a key only when the source states it.
  if (task === "format_imported") {
    if (stated) {
      if (proposal && proposal !== stated) {
        problems.push(problem(
          itemRef,
          "key",
          "key_change_not_applied",
          `The source states ${stated} as the key; the assistant proposed ${proposal}. The source key was kept; review the key.`
        ));
      }
      return { key: stated, key_status: "stated_in_source" };
    }
    if (proposal && sourceStatesKey(source?.imported_text ?? null, proposal)) {
      return { key: proposal, key_status: "stated_in_source" };
    }
    if (proposal) {
      problems.push(problem(
        itemRef,
        "key",
        "key_not_stated_in_source",
        `The assistant proposed ${proposal} as the key, but the source does not state a key. No key was recorded.`
      ));
    }
    return { key: null, key_status: "none" };
  }

  if (proposal && stated && proposal !== stated) {
    problems.push(problem(
      itemRef,
      "key",
      "proposed_key_differs_from_source",
      `The source states ${stated} as the key; the assistant proposed ${proposal}. Confirm the key yourself.`
    ));
  }
  return proposal ? { key: proposal, key_status: "proposed" } : { key: stated, key_status: stated ? "stated_in_source" : "none" };
}

export function applyItemPreparationRules(
  input: ItemPreparationInput,
  output: ItemPreparationOutput
): ItemPreparationResult {
  const problems: ItemPreparationProblem[] = output.problems.map((entry) => ({
    item_ref: entry.item_ref,
    field: entry.field,
    option_label: entry.option_label ? norm(entry.option_label) : null,
    code: entry.code,
    message: entry.message.trim(),
    source: "model" as const
  }));

  const items: PreparedItem[] = output.items.map((item) => {
    const source = input.items.find((entry) => entry.item_ref === item.item_ref);
    const options = item.options.map((option) => ({ label: norm(option.label), text: option.text.trim() }));
    const { key, key_status } = resolveKey(input.task, source, item.proposed_key, item.item_ref, problems);

    // Task 2 keeps the instructor's wording; anything beyond whitespace is shown as a problem.
    if (input.task === "format_imported" && source) {
      const before = [source.stem, ...source.options.map((option) => `${norm(option.label)}:${option.text}`)].map(squash);
      const after = [item.stem, ...options.map((option) => `${option.label}:${option.text}`)].map(squash);
      if (source.stem.trim() && JSON.stringify(before) !== JSON.stringify(after)) {
        problems.push(problem(
          item.item_ref,
          "stem",
          "wording_changed",
          "The proposed structure changes wording beyond spacing and numbering. Compare it with the source before accepting."
        ));
      }
    }

    const rationales: ItemPreparationOptionRationale[] = [];
    for (const entry of item.distractor_rationales) {
      const label = norm(entry.option_label);
      if (key && label === key) {
        problems.push(problem(
          item.item_ref,
          "distractor_rationale",
          "rationale_for_correct_option",
          `Option ${label} is the key, so its rationale was left out.`,
          label
        ));
        continue;
      }
      const rationale = clean(entry.rationale);
      if (!rationale || !options.some((option) => option.label === label)) continue;
      rationales.push({ option_label: label, rationale, idea_label: clean(entry.idea_label)?.slice(0, 60) ?? null });
    }
    if (key) {
      for (const option of options) {
        if (option.label !== key && !rationales.some((entry) => entry.option_label === option.label)) {
          problems.push(problem(
            item.item_ref,
            "distractor_rationale",
            "missing_distractor_rationale",
            `No rationale was proposed for option ${option.label}.`,
            option.label
          ));
        }
      }
    }

    return {
      item_ref: item.item_ref,
      stem: item.stem.trim(),
      options,
      key,
      key_status,
      target_reasoning: clean(item.target_reasoning),
      essential_elements: item.essential_elements.map((entry) => entry.trim()).filter(Boolean).slice(0, MAX_ESSENTIAL_ELEMENTS),
      distractor_rationales: rationales
    };
  });

  const seen = new Set<string>();
  return {
    task: input.task,
    prompt_version: ITEM_PREPARATION_PROMPT_VERSION,
    schema_version: ITEM_PREPARATION_SCHEMA_VERSION,
    prompt_hash: ITEM_PREPARATION_PROMPT_HASH,
    items,
    problems: problems.filter((entry) => {
      const id = [entry.item_ref, entry.field, entry.option_label, entry.code, entry.message].join("\u0000");
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
  };
}
