import type {
  AgentInputByName,
  AgentOutputByName,
  ItemVerificationFinding,
  ItemVerificationIssueCode
} from "@/lib/agents/contracts";
import {
  essentialElementsList,
  readOptionRationales,
  readTeacherItemMetadata
} from "../teacher-diagnostic-context";
import {
  ITEM_PREPARATION_AGENT_VERSION,
  ITEM_PREPARATION_DEFAULT_COURSE_LEVEL,
  ITEM_PREPARATION_INPUT_VERSION,
  ITEM_PREPARATION_PROMPT_VERSION,
  ITEM_PREPARATION_SCHEMA_VERSION,
  PROBLEM_CODE_LABELS,
  type ItemPreparationInput,
  type ItemPreparationOptionRationale,
  type ItemPreparationProblem,
  type ItemPreparationResult
} from "./contract";

/**
 * Item preparation task 3 (check items and report problems) in the topic verification flow
 * that the item verification agent served. The check sees the instructor's items with their
 * confirmed keys, target reasoning, essential elements and per-option rationales; its
 * problems become the verification findings the instructor reviews and acknowledges before
 * publishing. A proposed key change is reported as a doubtful key and never applied.
 */
type CheckItem = {
  item_public_id: string;
  item_label?: string | null;
  item_stem: string;
  options: unknown;
  correct_option: string;
  distractor_rationales: unknown;
  administration_rules: unknown;
};

function options(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      return { label: String(record.label ?? "").trim(), text: String(record.text ?? "") };
    })
    .filter((option) => option.label);
}

export function preparationInputForItemCheck(input: {
  concept_unit: { title: string; learning_objective: string; related_concept_description: string };
  diagnostic_focus?: string | null;
  items: CheckItem[];
  course_level?: string;
}): ItemPreparationInput {
  return {
    schema_version: ITEM_PREPARATION_INPUT_VERSION,
    task: "check",
    topic: {
      title: input.concept_unit.title,
      learning_objective: input.concept_unit.learning_objective || null,
      description: input.concept_unit.related_concept_description || null,
      diagnostic_focus: input.diagnostic_focus?.trim() || null
    },
    course_level: input.course_level ?? ITEM_PREPARATION_DEFAULT_COURSE_LEVEL,
    items: input.items.map((item) => {
      const metadata = readTeacherItemMetadata(item.administration_rules);
      const itemOptions = options(item.options);
      return {
        item_ref: item.item_public_id,
        item_label: metadata.item_label || null,
        stem: item.item_stem,
        options: itemOptions,
        confirmed_key: item.correct_option || null,
        source_key: null,
        target_reasoning:
          metadata.correct_option_notes.target_reasoning_note || metadata.expected_reasoning_note || null,
        essential_elements: essentialElementsList(metadata.correct_option_notes.strong_reasoning_should_mention ?? ""),
        distractor_rationales: readOptionRationales({
          administration_rules: item.administration_rules,
          distractor_rationales: item.distractor_rationales,
          option_labels: itemOptions.map((option) => option.label),
          correct_option: item.correct_option
        }).flatMap((entry): ItemPreparationOptionRationale[] => entry.diagnostic_role === "not_diagnostic"
          ? entry.what_rules_it_out
            ? [{ option_label: entry.label, rationale: entry.what_rules_it_out, idea_label: null, not_tied_to_an_idea: true }]
            : []
          : entry.rationale
            ? [{ option_label: entry.label, rationale: entry.rationale, idea_label: entry.idea_label || null, not_tied_to_an_idea: false }]
            : []),
        imported_text: null
      };
    }),
    source_material: null,
    requested_new_items: 0
  };
}

const ISSUE_BY_CODE: Record<ItemPreparationProblem["code"], ItemVerificationIssueCode | null> = {
  more_than_one_defensible_answer: "possible_multiple_correct_answers",
  doubtful_key: "possible_answer_key_inconsistency",
  ambiguous_wording: "possible_ambiguity",
  answer_cue: "possible_answer_cue",
  implausible_option: "weak_or_implausible_distractor",
  outside_topic: "possible_concept_misalignment",
  unrelated_reading_demand: "possible_learning_objective_misalignment",
  does_not_assess_objective: "possible_learning_objective_misalignment",
  not_plain_language: "possible_ambiguity",
  item_dependency: "possible_answer_cue",
  // A typo or a name written two ways can make a student read the item two ways.
  typo_or_inconsistent_name: "possible_ambiguity",
  other: "possible_ambiguity",
  // A key change the check proposed is reported as a doubtful key, never applied.
  key_change_not_applied: "possible_answer_key_inconsistency",
  // The rest describe the proposal, not the instructor's item.
  key_not_stated_in_source: null,
  proposed_key_differs_from_source: null,
  missing_distractor_rationale: null,
  rationale_for_correct_option: null,
  wording_changed: null
};

function finding(problem: ItemPreparationProblem, issue: ItemVerificationIssueCode): ItemVerificationFinding {
  const explanation = `${PROBLEM_CODE_LABELS[problem.code]}: ${problem.message}`.slice(0, 600);
  if (problem.item_ref === null) {
    return {
      issue_code: issue === "possible_learning_objective_misalignment" ? issue : "possible_concept_misalignment",
      item_public_id: null,
      location: problem.field === "topic" ? "concept_unit" : "item_set",
      option_label: null,
      brief_explanation: explanation
    };
  }
  const optionSpecific =
    problem.option_label !== null && (problem.field === "option" || problem.field === "options" || problem.field === "distractor_rationale");
  const location: ItemVerificationFinding["location"] = optionSpecific
    ? problem.field === "distractor_rationale" ? "distractor_rationale" : "option"
    : ["key", "target_reasoning", "essential_elements"].includes(problem.field) ? "correct_option" : "item_stem";
  return {
    issue_code: issue,
    item_public_id: problem.item_ref,
    location,
    option_label: optionSpecific ? problem.option_label : null,
    brief_explanation: explanation
  };
}

export function verificationOutputFromPreparation(input: {
  providerInput: AgentInputByName["item_verification_agent"];
  result: ItemPreparationResult;
  generation_mode: "live_model" | "local_test";
}): AgentOutputByName["item_verification_agent"] {
  const itemIds = new Set(input.providerInput.items.map((item) => item.item_public_id));
  const findings = input.result.problems.flatMap((problem) => {
    const issue = ISSUE_BY_CODE[problem.code];
    if (!issue || (problem.item_ref !== null && !itemIds.has(problem.item_ref))) return [];
    return [finding(problem, issue)];
  });
  const setLevel = findings.filter((entry) => entry.item_public_id === null);
  const itemResults = input.providerInput.items.map((item) => {
    const itemFindings = findings.filter((entry) => entry.item_public_id === item.item_public_id);
    return { item_public_id: item.item_public_id, findings: itemFindings, teacher_review_required: itemFindings.length > 0 };
  });
  return {
    agent_name: "item_verification_agent",
    agent_version: ITEM_PREPARATION_AGENT_VERSION,
    prompt_version: ITEM_PREPARATION_PROMPT_VERSION,
    schema_version: ITEM_PREPARATION_SCHEMA_VERSION,
    output_status: findings.length ? "needs_review" : "ok",
    warnings: input.generation_mode === "local_test"
      ? ["Local test stand-in for the item check; not a validated item-quality judgment."]
      : [],
    verification_status: findings.length ? "verified_with_warnings" : "verified_no_warnings",
    set_level_findings: setLevel,
    item_results: itemResults,
    teacher_review_required: findings.length > 0
  };
}
