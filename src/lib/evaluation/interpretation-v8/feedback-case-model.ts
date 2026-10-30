import { z } from "zod";
import {
  FEEDBACK_V8_CONTEXT_VERSION,
  FEEDBACK_V8_CONTRACT_VERSION,
  FOCUS_STATUSES,
  FOCUS_TYPES,
  REVIEW_FLAGS,
  STRATEGIES,
  type FeedbackV8Input,
  type FeedbackV8Item
} from "@/lib/services/student-assessment/feedback-v8/contract";
import { answerPatterns, itemStatus } from "@/lib/services/student-assessment/interpretation-v8/rules";
import {
  buildCaseInput,
  chosenOptionTags,
  itemOf,
  type EvaluationCase,
  type ItemBank
} from "./case-model";

/**
 * Feedback evaluation cases (design document, sections 7 and 11.1, "Audience and feedback").
 * Each case reuses a simulated student and builds the feedback input from the reference
 * coding rather than from a model profile, so the feedback model is judged on its own: the
 * focus it chooses, the strategy, the turn record and the audience rules.
 */
export const FEEDBACK_EVALUATION_CASES_VERSION = "feedback-v8-eval-cases-5" as const;
export const EVALUATION_MAX_STUDENT_TURNS = 6;

const QuoteSource = z.enum(["explanation", "explanation_first_version", "tempting_option_reason"]);

export const FeedbackCaseSchema = z.object({
  feedback_case_id: z.string(),
  situation: z.string(),
  base_case_id: z.string(),
  mode: z.enum(["opening", "reply"]),
  profile_available: z.boolean().default(true),
  misconceptions: z.array(z.object({
    item_id: z.string(),
    idea: z.string(),
    quote: z.string(),
    quote_source: QuoteSource.default("explanation"),
    endorsement: z.enum(["endorsed", "tentative"])
  })).default([]),
  considered_ideas: z.array(z.object({ item_id: z.string(), idea: z.string(), quote: z.string() })).default([]),
  saved_questions: z.array(z.object({ item_id: z.string().nullable(), question: z.string() })).default([]),
  transcript: z.array(z.object({ actor: z.enum(["student", "tutor"]), text: z.string().min(1) })).default([]),
  /**
   * Changes to the simulated student's responses for this case only (cases-3): for example a
   * correct answer given with low confidence and an unsure explanation. The base case, and the
   * interpretation evaluation that uses it, are unchanged; the reference quality still applies.
   */
  response_overrides: z.array(z.object({
    item_id: z.string(),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    explanation: z.string().optional(),
    tempting_option: z.string().nullable().optional(),
    tempting_option_reason: z.string().nullable().optional()
  }).strict()).default([]),
  /**
   * Incorrect options treated as not tied to a specific idea in this case only (cases-4,
   * release 22): their rationale is withheld and the input lists them with what rules them out.
   * The item bank, and the interpretation evaluation that uses it, are unchanged.
   */
  option_role_overrides: z.array(z.object({
    item_id: z.string(),
    option_label: z.string(),
    what_rules_it_out: z.string().min(1)
  }).strict()).default([]),
  expected: z.object({
    focus_types: z.array(z.enum(FOCUS_TYPES)).min(1),
    strategies: z.array(z.enum(STRATEGIES)).min(1),
    /** The focus should include at least one of these question numbers; empty means any. */
    item_numbers_any: z.array(z.number().int().min(1)).default([]),
    focus_status: z.array(z.enum(FOCUS_STATUSES)).nullable(),
    review_flags: z.array(z.enum(REVIEW_FLAGS)).min(1),
    max_questions: z.number().int().min(0),
    must_not_mark_corrected: z.boolean().default(false),
    /** The opening should begin with an overview of several points (opening v8.4). */
    expects_overview: z.boolean().default(false),
    /**
     * The points the overview should name, each as the item numbers that identify it; the
     * opening must name at least one item of every point. Required when expects_overview.
     */
    overview_points: z.array(z.array(z.number().int().min(1)).min(1)).default([]),
    notes: z.string().default("")
  })
});
export type FeedbackCase = z.infer<typeof FeedbackCaseSchema>;

export const FeedbackCaseFileSchema = z.object({
  feedback_cases_version: z.string(),
  cases: z.array(FeedbackCaseSchema)
});
export type FeedbackCaseFile = z.infer<typeof FeedbackCaseFileSchema>;

/** The base case with this feedback case's response overrides applied. */
export function feedbackCaseStudent(base: EvaluationCase, feedbackCase: Pick<FeedbackCase, "response_overrides">): EvaluationCase {
  if (!feedbackCase.response_overrides?.length) return base;
  const overrides = new Map(feedbackCase.response_overrides.map((entry) => [entry.item_id, entry]));
  return {
    ...base,
    responses: base.responses.map((response) => {
      const override = overrides.get(response.item_id);
      if (!override) return response;
      const { item_id: _item, ...changes } = override;
      return { ...response, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) };
    })
  };
}

/** The feedback input for a case, shaped exactly like compileFeedbackV8Context's output. */
export function buildFeedbackCaseInput(bank: ItemBank, baseCase: EvaluationCase, feedbackCase: FeedbackCase): FeedbackV8Input {
  const base = feedbackCaseStudent(baseCase, feedbackCase);
  const interpretationInput = buildCaseInput(bank, base);
  const numberById = new Map(interpretationInput.items.map((item, index) => [item.item_id, index + 1]));
  const responseById = new Map(base.responses.map((response) => [response.item_id, response]));
  const notTied = feedbackCase.option_role_overrides;
  const items: FeedbackV8Item[] = interpretationInput.items.map((item, index) => {
    const response = responseById.get(item.item_id)!;
    const quality = response.expected.quality[0];
    const errorSource = response.expected.error_source?.[0] ?? null;
    const rapid = item.process_indicators.find((indicator) => indicator.name === "rapid_selection")?.value;
    return {
      item_number: index + 1,
      item_id: item.item_id,
      stem: item.stem,
      options: item.options,
      correct_option: item.correct_option,
      instructor_explanation: item.target_reasoning,
      essential_elements: item.essential_elements,
      distractor_rationales: item.references
        .filter((reference) => reference.kind === "distractor_rationale" && reference.option_label &&
          !notTied.some((entry) => entry.item_id === item.item_id && entry.option_label === reference.option_label))
        .map((reference) => ({ option_label: reference.option_label!, rationale: reference.text })),
      options_not_tied_to_an_idea: notTied
        .filter((entry) => entry.item_id === item.item_id)
        .map((entry) => ({ option_label: entry.option_label, what_rules_it_out: entry.what_rules_it_out })),
      student_response: {
        selected_option: item.response.selected_option,
        answer_correct: item.response.answer_correct,
        reported_confidence: item.response.reported_confidence,
        explanation: item.response.explanation,
        tempting_option: item.response.tempting_option,
        tempting_option_reason: item.response.tempting_option_reason
      },
      interpretation: feedbackCase.profile_available
        ? {
            explanation_quality: quality,
            adds_beyond_option_text: typeof response.expected.beyond_option_text === "boolean" ? response.expected.beyond_option_text : null,
            evidence_quote: null,
            missing_elements: quality === "limited" ? "Not all of the essential elements are stated." : null,
            rationale: `Reference coding: ${quality.replaceAll("_", " ")}.`,
            error_source: errorSource,
            uncertainty_note: null,
            item_status: itemStatus({
              answer_correct: item.response.answer_correct,
              skipped: item.response.skipped,
              explanation_quality: quality,
              rapid_selection: typeof rapid === "boolean" ? rapid : null
            }),
            possible_item_issue: errorSource === "possible_item_issue"
          }
        : null,
      process_interpretation: null
    };
  });
  const tags = chosenOptionTags(bank, base);
  // An option not tied to an idea has no idea label, so it never forms an answer pattern.
  for (const response of base.responses) {
    if (notTied.some((entry) => entry.item_id === response.item_id && entry.option_label === response.selected_option)) tags.set(response.item_id, null);
  }
  const patterns = answerPatterns(interpretationInput.items.map((item) => ({
    item_id: item.item_id,
    answer_correct: item.response.answer_correct,
    chosen_option_tag: tags.get(item.item_id) ?? null
  })));
  const turns = feedbackCase.transcript.map((turn, index) => ({ sequence_index: index + 1, ...turn }));
  const opening = feedbackCase.mode === "reply" && turns[0]?.actor === "tutor" ? turns[0] : null;
  const last = turns.at(-1) ?? null;
  const latest = feedbackCase.mode === "reply" && last?.actor === "student" ? last : null;
  const studentTurns = turns.filter((turn) => turn.actor === "student").length;
  return {
    contract_version: FEEDBACK_V8_CONTRACT_VERSION,
    context_version: FEEDBACK_V8_CONTEXT_VERSION,
    mode: feedbackCase.mode,
    topic: {
      title: interpretationInput.topic.title,
      learning_objective: interpretationInput.topic.learning_objective,
      description: interpretationInput.topic.description
    },
    profile_available: feedbackCase.profile_available,
    items,
    possible_misconceptions: feedbackCase.profile_available ? feedbackCase.misconceptions.map((entry) => ({
      item_numbers: [numberById.get(entry.item_id) ?? 0],
      idea: entry.idea,
      student_quote: entry.quote,
      endorsement: entry.endorsement
    })) : [],
    considered_ideas: feedbackCase.profile_available ? feedbackCase.considered_ideas.map((entry) => ({
      item_number: numberById.get(entry.item_id) ?? 0,
      idea: entry.idea,
      student_quote: entry.quote
    })) : [],
    answer_patterns: patterns.map((pattern) => ({
      shared_idea: pattern.misconception_tag,
      item_numbers: pattern.item_ids.map((id) => numberById.get(id) ?? 0)
    })),
    saved_questions: feedbackCase.saved_questions.map((entry) => ({
      item_number: entry.item_id ? numberById.get(entry.item_id) ?? null : null,
      question: entry.question
    })),
    opening_message: opening?.text ?? null,
    visible_transcript: turns
      .filter((turn) => turn !== opening && turn !== latest)
      .map(({ sequence_index, actor, text }) => ({ sequence_index, actor, text })),
    latest_student_message: latest ? { sequence_index: latest.sequence_index, text: latest.text } : null,
    lifecycle: {
      student_turns_used: studentTurns,
      max_student_turns: EVALUATION_MAX_STUDENT_TURNS,
      final_allowed_turn: studentTurns === EVALUATION_MAX_STUDENT_TURNS,
      another_student_turn_available: studentTurns < EVALUATION_MAX_STUDENT_TURNS
    }
  };
}

/** Structural checks of the feedback fixtures against the simulated students. */
export function checkFeedbackFixtures(baseCases: ReadonlyMap<string, EvaluationCase>, file: FeedbackCaseFile, bank?: ItemBank) {
  const problems: string[] = [];
  for (const feedbackCase of file.cases) {
    const id = feedbackCase.feedback_case_id;
    const baseCase = baseCases.get(feedbackCase.base_case_id);
    if (!baseCase) { problems.push(`${id}: unknown base case ${feedbackCase.base_case_id}`); continue; }
    for (const entry of feedbackCase.response_overrides) {
      if (!baseCase.responses.some((response) => response.item_id === entry.item_id)) problems.push(`${id}: response override for unknown item ${entry.item_id}`);
    }
    for (const entry of feedbackCase.option_role_overrides) {
      if (!baseCase.responses.some((response) => response.item_id === entry.item_id)) {
        problems.push(`${id}: option role override for unknown item ${entry.item_id}`);
        continue;
      }
      if (!bank) continue;
      const item = itemOf(bank, entry.item_id);
      if (!item.options.some((option) => option.label === entry.option_label) || item.key === entry.option_label) {
        problems.push(`${id}: option role override names ${entry.option_label}, which is not an incorrect option of ${entry.item_id}`);
      }
    }
    if (feedbackCase.expected.expects_overview && feedbackCase.expected.overview_points.length < 2) {
      problems.push(`${id}: an expected overview needs at least two overview points`);
    }
    for (const point of feedbackCase.expected.overview_points) {
      if (point.some((number) => number > baseCase.responses.length)) problems.push(`${id}: overview point names an item beyond ${baseCase.responses.length}`);
    }
    const base = feedbackCaseStudent(baseCase, feedbackCase);
    const responses = new Map(base.responses.map((response) => [response.item_id, response]));
    for (const entry of feedbackCase.misconceptions) {
      const response = responses.get(entry.item_id);
      const text = entry.quote_source === "tempting_option_reason" ? response?.tempting_option_reason : response?.explanation;
      if (!text?.includes(entry.quote)) problems.push(`${id}: misconception quote is not in the ${entry.quote_source} of ${entry.item_id}`);
    }
    for (const entry of feedbackCase.considered_ideas) {
      if (!responses.get(entry.item_id)?.tempting_option_reason?.includes(entry.quote)) problems.push(`${id}: considered-idea quote is not in ${entry.item_id}`);
    }
    if (feedbackCase.mode === "opening" && feedbackCase.transcript.length) problems.push(`${id}: an opening case has no transcript`);
    if (feedbackCase.mode === "reply") {
      if (feedbackCase.transcript[0]?.actor !== "tutor") problems.push(`${id}: a reply case starts with the opening message`);
      if (feedbackCase.transcript.at(-1)?.actor !== "student") problems.push(`${id}: a reply case ends with a student message`);
      if (!feedbackCase.expected.focus_status) problems.push(`${id}: a reply case needs expected focus statuses`);
    }
    if (feedbackCase.mode === "opening" && feedbackCase.expected.focus_status) problems.push(`${id}: an opening has no focus status`);
  }
  return problems;
}
