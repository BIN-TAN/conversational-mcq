import { z } from "zod";
import {
  INTERPRETATION_V8_INPUT_VERSION,
  type InterpretationInputV8,
  type InterpretationItemInputV8,
  type InterpretationReference,
  type ProcessIndicator
} from "@/lib/services/student-assessment/interpretation-v8/contract";
import { PROCESS_INDICATOR_DEFINITIONS } from "@/lib/services/student-assessment/interpretation-v8/indicators";
import {
  itemStatus,
  topicSummary,
  type ItemStatus,
  type TopicSummary
} from "@/lib/services/student-assessment/interpretation-v8/rules";

/**
 * Evaluation materials for interpretation v8 (docs/INTERPRETATION_V8_EVALUATION_PLAN.md):
 * an item bank, simulated students whose responses each represent one way of expressing
 * reasoning, and the categories each response is expected to lead to. Expected item status
 * and summary labels are derived from the expected ratings with the application's own
 * rules, so they can never disagree with the rules.
 */
export const EVALUATION_CASES_VERSION = "interpretation-v8-eval-cases-3" as const;

const Quality = z.enum(["adequate", "limited", "incorrect", "no_usable_explanation"]);
const ErrorSource = z.enum(["conceptual", "execution_slip", "possible_item_issue", "unclear"]);

export const ItemBankSchema = z.object({
  bank_version: z.string(),
  source: z.string(),
  topics: z.array(z.object({
    topic_id: z.string(),
    title: z.string(),
    learning_objective: z.string(),
    description: z.string(),
    items: z.array(z.object({
      item_id: z.string(),
      stem: z.string(),
      options: z.array(z.object({ label: z.string(), text: z.string() })).min(2),
      key: z.string(),
      target_reasoning: z.string(),
      essential_elements: z.string(),
      rationales: z.record(z.string(), z.object({ rationale: z.string(), idea_label: z.string().nullable() })),
      known_ambiguity: z.string().nullable()
    }))
  }))
});
export type ItemBank = z.infer<typeof ItemBankSchema>;
export type BankItem = ItemBank["topics"][number]["items"][number];

const ProcessSpec = z.object({
  first_selection_ms: z.number().nullable().default(30_000),
  first_option: z.string().nullable().optional(),
  first_explanation: z.string().nullable().optional(),
  first_confidence: z.enum(["low", "medium", "high"]).nullable().optional(),
  focused_seconds: z.number().nullable().default(70),
  unfocused_seconds: z.number().default(0),
  longest_pause_seconds: z.number().default(0),
  blocked_paste_attempts: z.number().int().default(0)
}).partial().default({});

export const ExpectedItemSchema = z.object({
  /** Acceptable explanation ratings; the first is the reference rating. */
  quality: z.array(Quality).min(1),
  /** Expected beyond-option-text flag; "either" when both readings are defensible. */
  beyond_option_text: z.union([z.boolean(), z.literal("either")]).nullable(),
  /** Acceptable error sources; null when no error source is expected. */
  error_source: z.array(ErrorSource).nullable(),
  /** Acceptable reason codes for no usable explanation. */
  no_usable_reason: z.array(z.enum(["not_provided", "off_task", "stated_guess"])).nullable().default(null),
  /** Whether a side remark is expected to be recorded. */
  side_remark: z.boolean().default(false)
});

export const CaseResponseSchema = z.object({
  item_id: z.string(),
  situation: z.string(),
  selected_option: z.string().nullable(),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  explanation: z.string().nullable(),
  tempting_option: z.string().nullable().default(null),
  tempting_option_reason: z.string().nullable().default(null),
  process: ProcessSpec,
  expected: ExpectedItemSchema
});

export const CaseClaimSchema = z.object({
  item_id: z.string(),
  kind: z.enum(["possible_misconception", "considered_idea"]),
  endorsement: z.enum(["endorsed", "tentative"]).nullable().default(null),
  /** The distractor whose rationale the idea matches, when there is one. */
  distractor: z.string().nullable().default(null),
  note: z.string().default("")
});

export const EvaluationCaseSchema = z.object({
  case_id: z.string(),
  topic_id: z.string(),
  profile: z.string(),
  responses: z.array(CaseResponseSchema).min(1),
  claims: z.array(CaseClaimSchema).default([]),
  /** Items where a possible misconception must never be claimed (a choice alone, a rejected idea, a question). */
  forbidden_claim_items: z.array(z.string()).default([]),
  /** Items where a claim is defensible either way; claims there count neither for nor against. */
  optional_claim_items: z.array(z.string()).default([])
});
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;
export type CaseResponse = z.infer<typeof CaseResponseSchema>;

export const EvaluationCaseFileSchema = z.object({
  cases_version: z.string(),
  situations: z.record(z.string(), z.string()),
  cases: z.array(EvaluationCaseSchema)
});
export type EvaluationCaseFile = z.infer<typeof EvaluationCaseFileSchema>;

export function topicOf(bank: ItemBank, topicId: string) {
  const topic = bank.topics.find((entry) => entry.topic_id === topicId);
  if (!topic) throw new Error(`Unknown topic ${topicId}`);
  return topic;
}

export function itemOf(bank: ItemBank, itemId: string) {
  for (const topic of bank.topics) {
    const item = topic.items.find((entry) => entry.item_id === itemId);
    if (item) return item;
  }
  throw new Error(`Unknown item ${itemId}`);
}

function references(item: BankItem): InterpretationReference[] {
  return [
    { reference_id: `${item.item_id}:target`, kind: "target_reasoning", option_label: null, text: item.target_reasoning },
    { reference_id: `${item.item_id}:elements`, kind: "essential_elements", option_label: null, text: item.essential_elements },
    ...Object.entries(item.rationales).map(([label, entry]) => ({
      reference_id: `${item.item_id}:option:${label}`,
      kind: "distractor_rationale" as const,
      option_label: label,
      text: entry.rationale
    }))
  ];
}

function answerChange(first: string | null | undefined, final: string | null, key: string) {
  if (!first || !final || first === final) return "none";
  const firstCorrect = first === key;
  const finalCorrect = final === key;
  if (!firstCorrect && finalCorrect) return "incorrect_to_correct";
  if (firstCorrect && !finalCorrect) return "correct_to_incorrect";
  return "incorrect_to_incorrect";
}

const confidenceRank = (value: string | null | undefined) => (value === "low" ? 1 : value === "medium" ? 2 : value === "high" ? 3 : null);

/** Process indicators for a simulated response, with the same definitions and roles as production. */
export function indicatorsFor(item: BankItem, response: CaseResponse): ProcessIndicator[] {
  const process = response.process ?? {};
  const firstRank = confidenceRank(process.first_confidence ?? response.confidence);
  const finalRank = confidenceRank(response.confidence);
  const values: Record<ProcessIndicator["name"], ProcessIndicator["value"]> = {
    rapid_selection: process.first_selection_ms === null || process.first_selection_ms === undefined ? null : process.first_selection_ms < 10_000,
    answer_change: answerChange(process.first_option, response.selected_option, item.key),
    explanation_revised: process.first_explanation ? process.first_explanation.trim() !== (response.explanation ?? "").trim() : false,
    confidence_change: firstRank === null || finalRank === null ? null : firstRank === finalRank ? "none" : finalRank > firstRank ? "higher" : "lower",
    focused_time: process.focused_seconds ?? null,
    focus_loss: process.unfocused_seconds ?? 0,
    longest_pause: process.longest_pause_seconds ?? 0,
    blocked_paste_attempts: process.blocked_paste_attempts ?? 0
  };
  return (Object.keys(PROCESS_INDICATOR_DEFINITIONS) as Array<ProcessIndicator["name"]>).map((name) => {
    const definition = PROCESS_INDICATOR_DEFINITIONS[name];
    return {
      indicator_id: `${item.item_id}:${name}`,
      name,
      value: values[name],
      unit: definition.unit,
      computed_as: definition.computed_as,
      role: definition.role,
      may: definition.may,
      may_not: definition.may_not,
      alternatives: definition.alternatives
    };
  });
}

/** The profiling input for a simulated student, built like the production input. */
export function buildCaseInput(bank: ItemBank, evaluationCase: EvaluationCase): InterpretationInputV8 {
  const topic = topicOf(bank, evaluationCase.topic_id);
  const items: InterpretationItemInputV8[] = evaluationCase.responses.map((response, index) => {
    const item = itemOf(bank, response.item_id);
    const skipped = !response.selected_option;
    const firstExplanation = response.process?.first_explanation ?? null;
    return {
      item_id: item.item_id,
      position: index + 1,
      stem: item.stem,
      options: item.options,
      correct_option: item.key,
      target_reasoning: item.target_reasoning,
      essential_elements: item.essential_elements,
      references: references(item),
      response: {
        skipped,
        selected_option: response.selected_option,
        answer_correct: skipped ? null : response.selected_option === item.key,
        reported_confidence: response.confidence,
        explanation: response.explanation,
        explanation_first_version: firstExplanation && firstExplanation.trim() !== (response.explanation ?? "").trim() ? firstExplanation : null,
        tempting_option: response.tempting_option,
        tempting_option_reason: response.tempting_option_reason,
        no_tempting_option: response.tempting_option ? false : null
      },
      process_indicators: indicatorsFor(item, response)
    };
  });
  return {
    input_version: INTERPRETATION_V8_INPUT_VERSION,
    topic: {
      title: topic.title,
      learning_objective: topic.learning_objective,
      description: topic.description,
      diagnostic_focus: null,
      references: [
        { reference_id: "topic:objective", kind: "learning_objective", option_label: null, text: topic.learning_objective },
        { reference_id: "topic:description", kind: "topic_description", option_label: null, text: topic.description }
      ]
    },
    items
  };
}

/** Option idea labels for the chosen incorrect options (used for answer patterns). */
export function chosenOptionTags(bank: ItemBank, evaluationCase: EvaluationCase) {
  return new Map(evaluationCase.responses.map((response) => {
    const item = itemOf(bank, response.item_id);
    const label = response.selected_option && response.selected_option !== item.key
      ? item.rationales[response.selected_option]?.idea_label ?? null : null;
    return [item.item_id, label] as const;
  }));
}

/** Expected item status and summary, from the reference ratings and the application's rules. */
export function expectedOutcomes(bank: ItemBank, evaluationCase: EvaluationCase): {
  statuses: Map<string, ItemStatus>;
  summary: TopicSummary["label"];
  summary_without_pending: TopicSummary["label_without_pending"];
} {
  const statuses = new Map<string, ItemStatus>();
  const summaryItems: Array<{ item_id: string; status: ItemStatus; flagged_for_review: boolean }> = [];
  for (const response of evaluationCase.responses) {
    const item = itemOf(bank, response.item_id);
    const rapid = (response.process?.first_selection_ms ?? 30_000) < 10_000;
    const status = itemStatus({
      answer_correct: response.selected_option ? response.selected_option === item.key : null,
      skipped: !response.selected_option,
      explanation_quality: response.expected.quality[0],
      rapid_selection: rapid
    });
    statuses.set(item.item_id, status);
    summaryItems.push({
      item_id: item.item_id,
      status,
      flagged_for_review: response.expected.error_source?.[0] === "possible_item_issue"
    });
  }
  const summary = topicSummary(summaryItems);
  return { statuses, summary: summary.label, summary_without_pending: summary.label_without_pending };
}

/** References a claim about an item may contradict: the item's target reasoning or essential elements, or the topic. */
export function acceptableContradictedReferences(itemId: string) {
  return new Set([`${itemId}:target`, `${itemId}:elements`, "topic:objective", "topic:description"]);
}

/** Load and check the fixtures that ship with the application. */
export function parseEvaluationFixtures(bankJson: unknown, casesJson: unknown) {
  const bank = ItemBankSchema.parse(bankJson);
  const cases = EvaluationCaseFileSchema.parse(casesJson);
  const problems: string[] = [];
  const caseIds = new Set<string>();
  for (const evaluationCase of cases.cases) {
    if (caseIds.has(evaluationCase.case_id)) problems.push(`${evaluationCase.case_id}: duplicate case id`);
    caseIds.add(evaluationCase.case_id);
    const topic = bank.topics.find((entry) => entry.topic_id === evaluationCase.topic_id);
    if (!topic) { problems.push(`${evaluationCase.case_id}: unknown topic ${evaluationCase.topic_id}`); continue; }
    const seen = new Set<string>();
    for (const response of evaluationCase.responses) {
      const item = topic.items.find((entry) => entry.item_id === response.item_id);
      if (!item) { problems.push(`${evaluationCase.case_id}: item ${response.item_id} is not in topic ${topic.topic_id}`); continue; }
      if (seen.has(item.item_id)) problems.push(`${evaluationCase.case_id}: item ${item.item_id} appears twice`);
      seen.add(item.item_id);
      if (!cases.situations[response.situation]) problems.push(`${evaluationCase.case_id}/${item.item_id}: unknown situation ${response.situation}`);
      const labels = new Set(item.options.map((option) => option.label));
      for (const [field, value] of [["selected_option", response.selected_option], ["tempting_option", response.tempting_option], ["first_option", response.process?.first_option ?? null]] as const) {
        if (value && !labels.has(value)) problems.push(`${evaluationCase.case_id}/${item.item_id}: ${field} ${value} is not an option`);
      }
      const quality = response.expected.quality[0];
      const hasText = Boolean(response.explanation?.trim());
      if (quality === "no_usable_explanation" && !response.expected.no_usable_reason?.length) {
        problems.push(`${evaluationCase.case_id}/${item.item_id}: no usable explanation needs a reason`);
      }
      if (quality !== "no_usable_explanation" && !hasText) problems.push(`${evaluationCase.case_id}/${item.item_id}: rated ${quality} without an explanation`);
      if (quality === "adequate" && response.expected.error_source?.[0] === "conceptual") {
        problems.push(`${evaluationCase.case_id}/${item.item_id}: adequate cannot have a conceptual error source`);
      }
      const correct = response.selected_option === item.key;
      if (!correct && response.selected_option && quality !== "no_usable_explanation" && quality !== "adequate" && !response.expected.error_source) {
        problems.push(`${evaluationCase.case_id}/${item.item_id}: an incorrect answer needs an expected error source`);
      }
    }
    for (const claim of evaluationCase.claims) {
      if (!seen.has(claim.item_id)) problems.push(`${evaluationCase.case_id}: claim on unknown item ${claim.item_id}`);
      if (evaluationCase.forbidden_claim_items.includes(claim.item_id) && claim.kind === "possible_misconception") {
        problems.push(`${evaluationCase.case_id}: item ${claim.item_id} is both expected and forbidden`);
      }
      if (claim.kind === "possible_misconception" && !claim.endorsement) problems.push(`${evaluationCase.case_id}/${claim.item_id}: misconception needs an endorsement`);
    }
  }
  return { bank, cases, problems };
}
