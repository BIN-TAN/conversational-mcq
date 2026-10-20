import { essentialElementsList } from "../teacher-diagnostic-context";
import {
  ITEM_PREPARATION_DEFAULT_COURSE_LEVEL,
  ITEM_PREPARATION_INPUT_VERSION,
  ITEM_PREPARATION_PROMPT_HASH,
  ITEM_PREPARATION_PROMPT_VERSION,
  ITEM_PREPARATION_SCHEMA_VERSION,
  PROBLEM_CODE_LABELS,
  type ItemPreparationInput,
  type ItemPreparationProblem,
  type ItemPreparationResult,
  type PreparedItem
} from "./contract";

/**
 * Maps import-review candidates to the item-preparation input, and the reviewed proposal
 * back to what the review page shows. Database-free.
 *
 * Draft/adapt ("Suggest missing notes") proposals go to candidate.suggestion; nothing is
 * applied until the instructor accepts it. Format ("Repair imported layout") proposals go
 * to candidate.formatting_suggestion; the stem, options and a source-stated key are applied
 * only when the instructor accepts the structure. A confirmed key is never replaced.
 */
export type PreparationCandidate = {
  candidate_public_id: string;
  item_label: string | null;
  stem: string;
  options: Array<{ label: string; text: string }>;
  imported_key: string | null;
  teacher_confirmed_key: string | null;
  target_reasoning_note: string | null;
  strong_reasoning_should_mention: string | null;
  option_rationales?: Array<{ label: string; rationale: string | null; idea_label: string | null }> | null;
  original_source_text: string;
  source_location: string;
};

export type PreparationTopic = {
  title: string;
  learning_objective: string | null;
  description: string | null;
  diagnostic_focus: string | null;
};

const MAX_IMPORTED_TEXT_CHARS = 5_000;

function bounded(value: string, max: number) {
  const normalized = value.trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export function candidateItemRef(index: number) {
  return `item-${index + 1}`;
}

export function preparationInputFromCandidates(input: {
  task: "draft_or_adapt" | "format_imported";
  topic: PreparationTopic;
  candidates: PreparationCandidate[];
  course_level?: string;
}): ItemPreparationInput {
  return {
    schema_version: ITEM_PREPARATION_INPUT_VERSION,
    task: input.task,
    topic: input.topic,
    course_level: input.course_level ?? ITEM_PREPARATION_DEFAULT_COURSE_LEVEL,
    items: input.candidates.map((candidate, index) => ({
      item_ref: candidateItemRef(index),
      item_label: candidate.item_label,
      stem: candidate.stem,
      options: candidate.options.map((option) => ({ label: option.label, text: option.text })),
      confirmed_key: candidate.teacher_confirmed_key,
      source_key: candidate.imported_key,
      target_reasoning: candidate.target_reasoning_note,
      essential_elements: essentialElementsList(candidate.strong_reasoning_should_mention ?? ""),
      distractor_rationales: (candidate.option_rationales ?? [])
        .filter((entry) => entry.rationale && entry.label !== candidate.teacher_confirmed_key)
        .map((entry) => ({ option_label: entry.label, rationale: entry.rationale!, idea_label: entry.idea_label })),
      imported_text: input.task === "format_imported" ? bounded(candidate.original_source_text, MAX_IMPORTED_TEXT_CHARS) : null
    })),
    source_material: null,
    requested_new_items: 0
  };
}

export function problemsForItem(result: ItemPreparationResult, itemRef: string) {
  return result.problems.filter((problem) => problem.item_ref === itemRef || problem.item_ref === null);
}

export function problemText(problem: ItemPreparationProblem) {
  const where = problem.option_label ? `option ${problem.option_label}` : problem.field.replaceAll("_", " ");
  return `${PROBLEM_CODE_LABELS[problem.code]} (${where}): ${problem.message}`;
}

export type PreparationMetadata = {
  provider: string;
  model_name: string;
  agent_call_public_id: string | null;
  generation_mode: "live_model" | "local_test";
};

/** The record stored in candidate.suggestion (draft/adapt task). */
export function suggestionFromPreparedItem(input: {
  candidate: PreparationCandidate;
  item: PreparedItem;
  result: ItemPreparationResult;
  agent_name: string;
}) {
  const problems = problemsForItem(input.result, input.item.item_ref);
  const keyIsSuggestion = !input.candidate.teacher_confirmed_key && input.item.key_status === "proposed";
  return {
    agent_name: input.agent_name,
    prompt_version: ITEM_PREPARATION_PROMPT_VERSION,
    schema_version: ITEM_PREPARATION_SCHEMA_VERSION,
    prompt_hash: ITEM_PREPARATION_PROMPT_HASH,
    task: input.result.task,
    mode: input.candidate.teacher_confirmed_key ? "diagnostic_information" : "suggest_key",
    output_status: problems.length ? "needs_teacher_review" : "ok",
    suggested_key: keyIsSuggestion ? input.item.key : null,
    key_rationale: keyIsSuggestion ? "Unofficial key suggestion from the item preparation assistant." : null,
    suggested_target_reasoning_note: input.item.target_reasoning,
    suggested_strong_reasoning_should_mention: input.item.essential_elements.length ? input.item.essential_elements.join("\n") : null,
    suggested_essential_elements: input.item.essential_elements,
    suggested_option_rationales: input.item.distractor_rationales.map((entry) => ({
      label: entry.option_label,
      rationale: entry.rationale,
      idea_label: entry.idea_label
    })),
    problems,
    evidence_justification_summary:
      "Suggestions from the item preparation assistant. Rationales are hypotheses about possible ideas, not judgments of any student. Review each one before use.",
    limitations: problems.map(problemText),
    reviewer_warning: "Teacher review required before import."
  };
}

function squash(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/** The record stored in candidate.formatting_suggestion (format task). */
export function formattingSuggestionFromPreparedItem(input: {
  candidate: PreparationCandidate;
  item: PreparedItem;
  result: ItemPreparationResult;
  agent_name: string;
}) {
  const problems = problemsForItem(input.result, input.item.item_ref);
  const sameWording =
    squash(input.item.stem) === squash(input.candidate.stem) &&
    input.item.options.length === input.candidate.options.length &&
    input.item.options.every((option, index) => squash(option.text) === squash(input.candidate.options[index]?.text ?? ""));
  const wordingChanged = problems.some((problem) => problem.code === "wording_changed");
  const span = (field: string, excerpt: string | null) => ({
    field,
    source_locations: [input.candidate.source_location],
    source_excerpt: excerpt
  });
  return {
    agent_name: input.agent_name,
    prompt_version: ITEM_PREPARATION_PROMPT_VERSION,
    schema_version: ITEM_PREPARATION_SCHEMA_VERSION,
    prompt_hash: ITEM_PREPARATION_PROMPT_HASH,
    task: input.result.task,
    output_status: "needs_teacher_review",
    proposed_stem: input.item.stem || null,
    proposed_options: input.item.options.map((option) => ({
      label: option.label,
      text: option.text,
      source_span: span(`option_${option.label.toLowerCase()}`, null)
    })),
    proposed_imported_key: input.item.key_status === "stated_in_source" ? input.item.key : null,
    key_source_evidence: input.item.key_status === "stated_in_source" ? "The imported source states this key." : null,
    // Proposals (target reasoning, essential elements, rationales) are suggestions, not
    // source text; they are offered through the note suggestions instead.
    source_supported_fields: {
      target_reasoning_note: null,
      strong_reasoning_should_mention: null,
      distractor_diagnostic_notes: null,
      diagnostic_value: null,
      image_url: null,
      video_url: null,
      reference_url: null,
      alt_text: null,
      media_description: null,
      source_attribution: null
    },
    source_span_mapping: [span("stem", null)],
    normalization_summary: sameWording
      ? "Wording kept as imported; only the structure was proposed."
      : wordingChanged
        ? "The proposed wording differs from the import. Compare it with the source before accepting."
        : "Spacing or numbering was normalized; the wording is unchanged.",
    wording_change_indicator: sameWording ? "none" : wordingChanged ? "possible_wording_change" : "formatting_only",
    problems,
    limitations: problems.map(problemText),
    reviewer_warning: "Teacher review required before import."
  };
}
