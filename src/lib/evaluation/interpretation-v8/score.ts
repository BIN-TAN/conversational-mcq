import {
  EXPLANATION_QUALITIES,
  ERROR_SOURCES,
  type InterpretationOutputV8
} from "@/lib/services/student-assessment/interpretation-v8/contract";
import { buildStoredInterpretationV8 } from "@/lib/services/student-assessment/interpretation-v8/profile";
import { itemStatus, ITEM_STATUSES, topicSummary, type ItemStatus } from "@/lib/services/student-assessment/interpretation-v8/rules";
import { studentFacingTextProblems } from "@/lib/services/student-assessment/feedback-v8/validate";
import {
  acceptableContradictedReferences,
  buildCaseInput,
  chosenOptionTags,
  itemOf,
  type EvaluationCase,
  type EvaluationCaseFile,
  type ItemBank
} from "./case-model";
import type { FeedbackCase, FeedbackCaseFile } from "./feedback-case-model";
import {
  cohensKappa,
  confusionMatrix,
  gwetAC1,
  percentAgreement,
  precisionRecall,
  round,
  stability,
  wilsonInterval,
  type LabelPair
} from "./metrics";
import type { FeedbackRunRecord, InterpretationRunRecord } from "./run";

/**
 * Scores evaluation runs against the expected categories (design document, section 11.1).
 * The comparison standard is either the fixtures' design expectations (for developing the
 * prompt) or the resolved human reference coding (for the go-live decision).
 */
export const EVALUATION_SCORING_VERSION = "interpretation-v8-eval-scoring-1" as const;

export const GO_LIVE_THRESHOLDS = {
  coder_ac1_quality: 0.7,
  model_ac1_quality: 0.7,
  adequate_incorrect_disagreement_max: 0.05,
  misconception_precision: 0.9,
  misconception_recall: 0.7,
  critical_claims_max: 0,
  summary_stability: 0.9,
  fallback_rate_max: 0.05,
  unrated_item_rate_max: 0.05,
  feedback_focus_acceptable: 0.9,
  feedback_strategy_acceptable: 0.9,
  feedback_review_flag_acceptable: 0.9
} as const;

/** What one response is expected to lead to (from the fixtures or the human reference). */
export type ItemExpectation = {
  quality: string[];
  beyond_option_text: boolean | "either" | null;
  error_source: string[] | null;
  no_usable_reason: string[] | null;
  side_remark: boolean;
};

export type CaseExpectation = {
  case_id: string;
  items: Map<string, ItemExpectation>;
  misconceptions: Map<string, "endorsed" | "tentative">;
  considered: Set<string>;
  /** Items where a misconception claim is a critical error (choice only, a rejected idea, a question, process data). */
  critical: Set<string>;
  optional: Set<string>;
};

export type ReferenceCodingRow = {
  case_id: string;
  item_id: string;
  explanation_quality: string;
  beyond_option_text: boolean | null;
  error_source: string | null;
  no_usable_reason: string | null;
  side_remark: boolean;
  misconception: "none" | "endorsed" | "tentative";
  considered_idea: boolean;
};

export function expectationsFromFixtures(cases: EvaluationCaseFile): Map<string, CaseExpectation> {
  return new Map(cases.cases.map((evaluationCase) => [evaluationCase.case_id, {
    case_id: evaluationCase.case_id,
    items: new Map(evaluationCase.responses.map((response) => [response.item_id, {
      quality: response.expected.quality,
      beyond_option_text: response.expected.beyond_option_text,
      error_source: response.expected.error_source,
      no_usable_reason: response.expected.no_usable_reason,
      side_remark: response.expected.side_remark
    }])),
    misconceptions: new Map(evaluationCase.claims
      .filter((claim) => claim.kind === "possible_misconception")
      .map((claim) => [claim.item_id, claim.endorsement ?? "endorsed"])),
    considered: new Set(evaluationCase.claims.filter((claim) => claim.kind === "considered_idea").map((claim) => claim.item_id)),
    critical: new Set(evaluationCase.forbidden_claim_items),
    optional: new Set(evaluationCase.optional_claim_items)
  }]));
}

/**
 * Expectations from the resolved human reference coding. Exact categories replace the
 * fixtures' acceptable lists; the fixtures' critical items (claims that must never be made)
 * still apply, because they follow from the design rules rather than from judgement.
 */
export function expectationsFromReference(cases: EvaluationCaseFile, rows: ReferenceCodingRow[]): Map<string, CaseExpectation> {
  const fixtures = expectationsFromFixtures(cases);
  const byCase = new Map<string, ReferenceCodingRow[]>();
  for (const row of rows) byCase.set(row.case_id, [...(byCase.get(row.case_id) ?? []), row]);
  const result = new Map<string, CaseExpectation>();
  for (const [caseId, fixture] of fixtures) {
    const coded = byCase.get(caseId);
    if (!coded) continue;
    result.set(caseId, {
      case_id: caseId,
      items: new Map(coded.map((row) => [row.item_id, {
        quality: [row.explanation_quality],
        beyond_option_text: row.beyond_option_text,
        error_source: row.error_source ? [row.error_source] : null,
        no_usable_reason: row.no_usable_reason ? [row.no_usable_reason] : null,
        side_remark: row.side_remark
      }])),
      misconceptions: new Map(coded.filter((row) => row.misconception !== "none").map((row) => [row.item_id, row.misconception as "endorsed" | "tentative"])),
      considered: new Set(coded.filter((row) => row.considered_idea).map((row) => row.item_id)),
      critical: new Set([...fixture.critical].filter((itemId) => !coded.some((row) => row.item_id === itemId && row.misconception !== "none"))),
      optional: new Set()
    });
  }
  return result;
}

export type ItemComparison = {
  case_id: string;
  run: number;
  item_id: string;
  situation: string;
  expected_quality: string[];
  model_quality: string;
  quality_acceptable: boolean;
  expected_beyond: boolean | "either" | null;
  model_beyond: boolean | null;
  expected_error_source: string[] | null;
  model_error_source: string | null;
  error_source_acceptable: boolean | null;
  expected_status: ItemStatus;
  model_status: ItemStatus;
  side_remark_expected: boolean;
  side_remark_recorded: boolean;
  explanation: string | null;
  model_rationale: string;
};

export type ClaimOutcome = {
  case_id: string;
  run: number;
  item_id: string;
  kind: "possible_misconception" | "considered_idea";
  outcome: "true_positive" | "false_positive" | "false_negative" | "ignored_optional";
  critical: boolean;
  endorsement_expected: string | null;
  endorsement_model: string | null;
  reference_ok: boolean | null;
  idea: string | null;
  quote: string | null;
};

const situationOf = (cases: EvaluationCaseFile, caseId: string, itemId: string) =>
  cases.cases.find((entry) => entry.case_id === caseId)?.responses.find((response) => response.item_id === itemId)?.situation ?? "";

function modelStoredSummary(bank: ItemBank, evaluationCase: EvaluationCase, output: InterpretationOutputV8 | null) {
  return buildStoredInterpretationV8({
    model_input: buildCaseInput(bank, evaluationCase),
    output,
    generation_mode: output ? "live_model" : "fallback",
    fallback_reason: output ? null : "evaluation_failed",
    response_package_id: `evaluation:${evaluationCase.case_id}`,
    answer_review_v2: null,
    chosen_option_tags: chosenOptionTags(bank, evaluationCase)
  });
}

export function compareInterpretation(input: {
  bank: ItemBank;
  cases: EvaluationCaseFile;
  expectations: Map<string, CaseExpectation>;
  records: InterpretationRunRecord[];
}) {
  const items: ItemComparison[] = [];
  const claims: ClaimOutcome[] = [];
  const summaries: Array<{ case_id: string; run: number; expected: string; model: string; fallback: boolean }> = [];
  for (const record of input.records) {
    const evaluationCase = input.cases.cases.find((entry) => entry.case_id === record.case_id);
    const expectation = input.expectations.get(record.case_id);
    if (!evaluationCase || !expectation) continue;
    const stored = modelStoredSummary(input.bank, evaluationCase, record.output);
    const expectedStatuses = new Map(evaluationCase.responses.map((response) => {
      const item = itemOf(input.bank, response.item_id);
      const expected = expectation.items.get(response.item_id)!;
      const rapid = (response.process?.first_selection_ms ?? 30_000) < 10_000;
      return [response.item_id, itemStatus({
        answer_correct: response.selected_option ? response.selected_option === item.key : null,
        skipped: !response.selected_option,
        explanation_quality: expected.quality[0] as (typeof EXPLANATION_QUALITIES)[number],
        rapid_selection: rapid
      })] as const;
    }));
    const expectedLabel = summaryFromStatuses(evaluationCase, expectation, expectedStatuses);
    summaries.push({ case_id: record.case_id, run: record.run, expected: expectedLabel, model: stored.topic_summary.label, fallback: !record.output });
    if (!record.output) continue;

    const ratings = new Map(record.output.items.map((rating) => [rating.item_id, rating]));
    for (const response of evaluationCase.responses) {
      const rating = ratings.get(response.item_id);
      const expected = expectation.items.get(response.item_id);
      if (!expected) continue;
      if (!rating) {
        // A salvaged output left this item unrated: it counts against agreement.
        items.push({
          case_id: record.case_id, run: record.run, item_id: response.item_id, situation: response.situation,
          expected_quality: expected.quality, model_quality: "rating_unavailable", quality_acceptable: false,
          expected_beyond: expected.beyond_option_text, model_beyond: null,
          expected_error_source: expected.error_source, model_error_source: null,
          error_source_acceptable: expected.error_source ? false : null,
          expected_status: expectedStatuses.get(response.item_id)!, model_status: "not_interpretable",
          side_remark_expected: expected.side_remark, side_remark_recorded: false,
          explanation: response.explanation, model_rationale: "(no rating: the item's rating failed the checks and was left out)"
        });
        continue;
      }
      const storedItem = stored.items.find((entry) => entry.item_id === response.item_id)!;
      items.push({
        case_id: record.case_id,
        run: record.run,
        item_id: response.item_id,
        situation: response.situation,
        expected_quality: expected.quality,
        model_quality: rating.explanation_quality,
        quality_acceptable: expected.quality.includes(rating.explanation_quality),
        expected_beyond: expected.beyond_option_text,
        model_beyond: rating.adds_beyond_option_text,
        expected_error_source: expected.error_source,
        model_error_source: rating.error_source,
        error_source_acceptable: expected.error_source ? expected.error_source.includes(rating.error_source ?? "none") : null,
        expected_status: expectedStatuses.get(response.item_id)!,
        model_status: storedItem.status!,
        side_remark_expected: expected.side_remark,
        side_remark_recorded: Boolean(rating.side_remark?.trim()),
        explanation: response.explanation,
        model_rationale: rating.rationale
      });
    }

    const seen = new Set<string>();
    for (const claim of record.output.possible_misconceptions) {
      for (const itemId of new Set(claim.item_ids)) {
        if (seen.has(itemId)) continue;
        seen.add(itemId);
        const expectedEndorsement = expectation.misconceptions.get(itemId) ?? null;
        const referenceOk = acceptableContradictedReferences(itemId).has(claim.contradicts_reference_id);
        const critical = expectation.critical.has(itemId) || (expectation.considered.has(itemId) && !expectedEndorsement);
        let outcome: ClaimOutcome["outcome"];
        if (expectation.optional.has(itemId) && !expectedEndorsement) outcome = "ignored_optional";
        else if (expectedEndorsement && referenceOk) outcome = "true_positive";
        else outcome = "false_positive";
        claims.push({
          case_id: record.case_id, run: record.run, item_id: itemId, kind: "possible_misconception", outcome, critical,
          endorsement_expected: expectedEndorsement, endorsement_model: claim.endorsement, reference_ok: referenceOk,
          idea: claim.idea, quote: claim.student_quote
        });
      }
    }
    for (const [itemId, endorsement] of expectation.misconceptions) {
      const matched = claims.some((claim) => claim.case_id === record.case_id && claim.run === record.run && claim.item_id === itemId
        && claim.kind === "possible_misconception" && claim.outcome === "true_positive");
      if (!matched) {
        claims.push({
          case_id: record.case_id, run: record.run, item_id: itemId, kind: "possible_misconception", outcome: "false_negative", critical: false,
          endorsement_expected: endorsement, endorsement_model: null, reference_ok: null, idea: null, quote: null
        });
      }
    }
    const consideredSeen = new Set<string>();
    for (const idea of record.output.considered_ideas) {
      if (consideredSeen.has(idea.item_id)) continue;
      consideredSeen.add(idea.item_id);
      claims.push({
        case_id: record.case_id, run: record.run, item_id: idea.item_id, kind: "considered_idea",
        outcome: expectation.considered.has(idea.item_id) ? "true_positive" : "false_positive", critical: false,
        endorsement_expected: null, endorsement_model: null, reference_ok: acceptableContradictedReferences(idea.item_id).has(idea.contradicts_reference_id),
        idea: idea.idea, quote: idea.student_quote
      });
    }
    for (const itemId of expectation.considered) {
      if (!consideredSeen.has(itemId)) {
        claims.push({
          case_id: record.case_id, run: record.run, item_id: itemId, kind: "considered_idea", outcome: "false_negative", critical: false,
          endorsement_expected: null, endorsement_model: null, reference_ok: null, idea: null, quote: null
        });
      }
    }
  }
  return { items, claims, summaries };
}

/** The expected label when expected item statuses come from the chosen standard. */
function summaryFromStatuses(evaluationCase: EvaluationCase, expectation: CaseExpectation, statuses: Map<string, ItemStatus>) {
  return topicSummary(evaluationCase.responses.map((response) => ({
    item_id: response.item_id,
    status: statuses.get(response.item_id)!,
    flagged_for_review: expectation.items.get(response.item_id)?.error_source?.[0] === "possible_item_issue"
  }))).label;
}

export type InterpretationReport = ReturnType<typeof scoreInterpretation>;

/** How often each label was planned (the standard) and how often the model used it. */
export function labelDistribution<T>(rows: readonly T[], planned: (row: T) => string, model: (row: T) => string, labels: readonly string[]) {
  const total = rows.length;
  const all = [...new Set([...labels, ...rows.map(planned), ...rows.map(model)])];
  return all.map((label) => {
    const plannedCount = rows.filter((row) => planned(row) === label).length;
    const modelCount = rows.filter((row) => model(row) === label).length;
    return {
      label,
      planned: plannedCount,
      planned_share: total ? round(plannedCount / total) : null,
      model: modelCount,
      model_share: total ? round(modelCount / total) : null,
      share_difference: total ? round((modelCount - plannedCount) / total) : null,
      /** Of the rows planned with this label, how many the model gave exactly this label. */
      kept: rows.filter((row) => planned(row) === label && model(row) === label).length
    };
  }).filter((row) => row.planned || row.model || labels.includes(row.label));
}

export function scoreInterpretation(input: {
  bank: ItemBank;
  cases: EvaluationCaseFile;
  expectations: Map<string, CaseExpectation>;
  standard: "design_expectations" | "human_reference";
  records: InterpretationRunRecord[];
  coder_agreement?: CoderAgreement | null;
}) {
  const { items, claims, summaries } = compareInterpretation(input);
  const submissions = input.records.length;
  const fallback = input.records.filter((record) => record.status === "failed").length;
  const salvaged = input.records.filter((record) => record.salvage);
  const repairCounts = new Map<string, number>();
  for (const record of input.records) for (const repair of record.repairs ?? []) repairCounts.set(repair.code, (repairCounts.get(repair.code) ?? 0) + 1);
  const unratedItems = items.filter((item) => item.model_quality === "rating_unavailable").length;
  const firstAttempt = input.records.filter((record) => record.status === "validated" && record.attempts.length === 1).length;
  const issueCounts = new Map<string, number>();
  for (const record of input.records) {
    for (const attempt of record.attempts) for (const issue of attempt.issues) issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);
  }

  const qualityPairs: LabelPair[] = items.map((item) => [item.expected_quality[0], item.model_quality]);
  // Agreement with acceptable alternatives: a rating in the acceptable list counts as the reference.
  const acceptablePairs: LabelPair[] = items.map((item) => [item.quality_acceptable ? item.model_quality : item.expected_quality[0], item.model_quality]);
  const qualityCategories = [...EXPLANATION_QUALITIES];
  const adequateIncorrect = items.filter((item) =>
    (item.expected_quality[0] === "adequate" && item.model_quality === "incorrect" && !item.quality_acceptable)
    || (item.expected_quality[0] === "incorrect" && item.model_quality === "adequate" && !item.quality_acceptable)).length;

  const beyondPairs: LabelPair[] = items
    .filter((item) => typeof item.expected_beyond === "boolean" && item.model_beyond !== null)
    .map((item) => [String(item.expected_beyond), String(item.model_beyond)]);
  const errorPairs: LabelPair[] = items
    .filter((item) => item.expected_error_source)
    .map((item) => [item.error_source_acceptable ? item.model_error_source ?? "none" : item.expected_error_source![0], item.model_error_source ?? "none"]);
  const unexpectedErrorSource = items.filter((item) => !item.expected_error_source && item.model_error_source).length;
  const statusPairs: LabelPair[] = items.map((item) => [item.expected_status, item.model_status]);
  const summaryPairs: LabelPair[] = summaries.map((entry) => [entry.expected, entry.model]);

  const misconceptionClaims = claims.filter((claim) => claim.kind === "possible_misconception");
  const misconceptions = precisionRecall({
    true_positive: misconceptionClaims.filter((claim) => claim.outcome === "true_positive").length,
    false_positive: misconceptionClaims.filter((claim) => claim.outcome === "false_positive").length,
    false_negative: misconceptionClaims.filter((claim) => claim.outcome === "false_negative").length
  });
  const considered = precisionRecall({
    true_positive: claims.filter((claim) => claim.kind === "considered_idea" && claim.outcome === "true_positive").length,
    false_positive: claims.filter((claim) => claim.kind === "considered_idea" && claim.outcome === "false_positive").length,
    false_negative: claims.filter((claim) => claim.kind === "considered_idea" && claim.outcome === "false_negative").length
  });
  const endorsementPairs: LabelPair[] = misconceptionClaims
    .filter((claim) => claim.outcome === "true_positive" && claim.endorsement_expected && claim.endorsement_model)
    .map((claim) => [claim.endorsement_expected!, claim.endorsement_model!]);
  const critical = misconceptionClaims.filter((claim) => claim.critical && claim.outcome !== "ignored_optional");

  const labelRuns = new Map<string, string[]>();
  for (const entry of [...summaries].sort((a, b) => a.run - b.run)) labelRuns.set(entry.case_id, [...(labelRuns.get(entry.case_id) ?? []), entry.model]);
  const qualityRuns = new Map<string, string[]>();
  for (const item of [...items].sort((a, b) => a.run - b.run)) {
    const key = `${item.case_id}:${item.item_id}`;
    qualityRuns.set(key, [...(qualityRuns.get(key) ?? []), item.model_quality]);
  }

  const situations = [...new Set(items.map((item) => item.situation))].sort().map((situation) => {
    const rows = items.filter((item) => item.situation === situation);
    const wrong = new Map<string, number>();
    for (const row of rows.filter((entry) => !entry.quality_acceptable)) wrong.set(row.model_quality, (wrong.get(row.model_quality) ?? 0) + 1);
    const claimRows = misconceptionClaims.filter((claim) => situationOf(input.cases, claim.case_id, claim.item_id) === situation);
    return {
      situation,
      description: input.cases.situations[situation] ?? "",
      responses: rows.length,
      quality_acceptable: rows.filter((row) => row.quality_acceptable).length,
      status_agreement: rows.filter((row) => row.expected_status === row.model_status).length,
      error_source_acceptable: rows.filter((row) => row.error_source_acceptable === true).length,
      error_source_scored: rows.filter((row) => row.error_source_acceptable !== null).length,
      misconception_false_positives: claimRows.filter((claim) => claim.outcome === "false_positive").length,
      misconception_false_negatives: claimRows.filter((claim) => claim.outcome === "false_negative").length,
      critical_claims: claimRows.filter((claim) => claim.critical && claim.outcome !== "ignored_optional").length,
      most_common_wrong_rating: [...wrong.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    };
  });

  const qualityAc1 = gwetAC1(acceptablePairs, qualityCategories);
  const summaryStability = stability(labelRuns);
  const runsPerCase = Math.max(0, ...[...labelRuns.values()].map((labels) => labels.length));
  const criteria = [
    criterion("Coder agreement on explanation quality (AC1)", ">=", GO_LIVE_THRESHOLDS.coder_ac1_quality, input.coder_agreement?.fields.explanation_quality.ac1 ?? null,
      input.coder_agreement ? null : "Needs two coders' sheets."),
    criterion("Model against the standard on explanation quality (AC1)", ">=", GO_LIVE_THRESHOLDS.model_ac1_quality, qualityAc1),
    criterion("Adequate-versus-incorrect disagreements (share of items)", "<=", GO_LIVE_THRESHOLDS.adequate_incorrect_disagreement_max,
      items.length ? adequateIncorrect / items.length : null),
    criterion("Misconception precision", ">=", GO_LIVE_THRESHOLDS.misconception_precision, misconceptions.precision),
    criterion("Misconception recall", ">=", GO_LIVE_THRESHOLDS.misconception_recall, misconceptions.recall),
    criterion("Misconceptions claimed from a choice, a rejected idea, a question or process data alone", "<=", GO_LIVE_THRESHOLDS.critical_claims_max, critical.length),
    criterion("Same summary label in every run (share of students)", ">=", GO_LIVE_THRESHOLDS.summary_stability, summaryStability.share,
      runsPerCase < 2 ? "Needs at least two runs per case." : null),
    criterion("Outputs rejected twice, fallback profile saved (share of submissions)", "<=", GO_LIVE_THRESHOLDS.fallback_rate_max,
      submissions ? fallback / submissions : null),
    criterion("Items left without a rating in salvaged outputs (share of item responses)", "<=", GO_LIVE_THRESHOLDS.unrated_item_rate_max,
      items.length ? unratedItems / items.length : null)
  ];

  return {
    scoring_version: EVALUATION_SCORING_VERSION,
    standard: input.standard,
    runs_per_case: runsPerCase,
    generation: {
      submissions,
      validated_first_attempt: firstAttempt,
      validated_after_regeneration: submissions - fallback - firstAttempt,
      fallback,
      fallback_rate: submissions ? round(fallback / submissions) : null,
      fallback_rate_interval: wilsonInterval(fallback, submissions),
      salvaged_outputs: salvaged.length,
      unrated_items: unratedItems,
      dropped_claims: salvaged.reduce((sum, record) => sum + (record.salvage?.dropped_misconceptions ?? 0) + (record.salvage?.dropped_considered_ideas ?? 0), 0),
      repairs: [...repairCounts.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })),
      rejection_reasons: [...issueCounts.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count }))
    },
    explanation_quality: {
      items: items.length,
      acceptable: items.filter((item) => item.quality_acceptable).length,
      exact_reference_agreement: round(percentAgreement(qualityPairs)),
      acceptable_agreement: round(percentAgreement(acceptablePairs)),
      gwet_ac1: round(qualityAc1),
      cohens_kappa: round(cohensKappa(acceptablePairs, qualityCategories)),
      adequate_incorrect_disagreements: adequateIncorrect,
      confusion_matrix: confusionMatrix(acceptablePairs, qualityCategories),
      by_reference_category: qualityCategories.map((category) => {
        const rows = items.filter((item) => item.expected_quality[0] === category);
        return { category, items: rows.length, acceptable: rows.filter((row) => row.quality_acceptable).length };
      })
    },
    beyond_option_text: {
      items: beyondPairs.length,
      agreement: round(percentAgreement(beyondPairs)),
      gwet_ac1: round(gwetAC1(beyondPairs, ["true", "false"])),
      cohens_kappa: round(cohensKappa(beyondPairs, ["true", "false"]))
    },
    error_source: {
      items: errorPairs.length,
      acceptable_agreement: round(percentAgreement(errorPairs)),
      gwet_ac1: round(gwetAC1(errorPairs, [...ERROR_SOURCES, "none"])),
      confusion_matrix: confusionMatrix(errorPairs, [...ERROR_SOURCES, "none"]),
      unexpected_error_source: unexpectedErrorSource,
      possible_item_issue_recall: (() => {
        const rows = items.filter((item) => item.expected_error_source?.[0] === "possible_item_issue");
        return { items: rows.length, flagged: rows.filter((row) => row.model_error_source === "possible_item_issue").length };
      })(),
      possible_item_issue_false_flags: items.filter((item) => item.model_error_source === "possible_item_issue"
        && !(item.expected_error_source ?? []).includes("possible_item_issue")).length
    },
    side_remarks: {
      expected: items.filter((item) => item.side_remark_expected).length,
      recorded_when_expected: items.filter((item) => item.side_remark_expected && item.side_remark_recorded).length,
      recorded_when_not_expected: items.filter((item) => !item.side_remark_expected && item.side_remark_recorded).length
    },
    item_status: {
      items: statusPairs.length,
      agreement: round(percentAgreement(statusPairs)),
      gwet_ac1: round(gwetAC1(statusPairs, [...ITEM_STATUSES])),
      confusion_matrix: confusionMatrix(statusPairs, [...ITEM_STATUSES])
    },
    summary_label: {
      submissions: summaryPairs.length,
      agreement: round(percentAgreement(summaryPairs)),
      confusion_matrix: confusionMatrix(summaryPairs),
      stability: summaryStability
    },
    misconceptions: {
      ...misconceptions,
      precision: round(misconceptions.precision),
      recall: round(misconceptions.recall),
      endorsement_agreement: round(percentAgreement(endorsementPairs)),
      critical_claims: critical.map(({ case_id, run, item_id, idea, quote }) => ({ case_id, run, item_id, idea, quote })),
      false_positives: misconceptionClaims.filter((claim) => claim.outcome === "false_positive")
        .map(({ case_id, run, item_id, idea, quote, critical: isCritical, reference_ok }) => ({ case_id, run, item_id, idea, quote, critical: isCritical, reference_ok })),
      false_negatives: misconceptionClaims.filter((claim) => claim.outcome === "false_negative").map(({ case_id, run, item_id }) => ({ case_id, run, item_id }))
    },
    considered_ideas: { ...considered, precision: round(considered.precision), recall: round(considered.recall) },
    quality_stability: stability(qualityRuns),
    situations,
    label_distributions: {
      explanation_quality: labelDistribution(items, (item) => item.quality_acceptable ? item.model_quality : item.expected_quality[0],
        (item) => item.model_quality, [...EXPLANATION_QUALITIES, "rating_unavailable"]),
      error_source: labelDistribution(items.filter((item) => item.expected_error_source || item.model_error_source),
        (item) => item.error_source_acceptable ? item.model_error_source ?? "none" : item.expected_error_source?.[0] ?? "none",
        (item) => item.model_error_source ?? "none", [...ERROR_SOURCES, "none"]),
      item_status: labelDistribution(items, (item) => item.expected_status, (item) => item.model_status, [...ITEM_STATUSES]),
      summary_label: labelDistribution(summaries, (entry) => entry.expected, (entry) => entry.model,
        ["Mostly understood", "Still developing", "Need more work", "Pending item review", "Unavailable / insufficient evidence"])
    },
    criteria,
    mismatches: items.filter((item) => !item.quality_acceptable || item.error_source_acceptable === false || item.expected_status !== item.model_status)
  };
}

function criterion(name: string, comparison: ">=" | "<=", threshold: number, value: number | null, note: string | null = null) {
  return {
    name,
    threshold: `${comparison} ${threshold}`,
    value: round(value),
    pass: value === null ? null : comparison === ">=" ? value >= threshold : value <= threshold,
    note
  };
}

// ---------------------------------------------------------------- coder agreement

export type CoderAgreement = ReturnType<typeof coderAgreement>;

export function coderAgreement(first: ReferenceCodingRow[], second: ReferenceCodingRow[]) {
  const key = (row: ReferenceCodingRow) => `${row.case_id}:${row.item_id}`;
  const secondByKey = new Map(second.map((row) => [key(row), row]));
  const paired = first.flatMap((row) => (secondByKey.has(key(row)) ? [[row, secondByKey.get(key(row))!] as const] : []));
  const field = (pick: (row: ReferenceCodingRow) => string, categories: readonly string[]) => {
    const pairs: LabelPair[] = paired.map(([a, b]) => [pick(a), pick(b)]);
    return {
      items: pairs.length,
      agreement: round(percentAgreement(pairs)),
      ac1: round(gwetAC1(pairs, categories)),
      cohens_kappa: round(cohensKappa(pairs, categories)),
      disagreements: paired.filter(([a, b]) => pick(a) !== pick(b)).map(([a, b]) => ({ case_id: a.case_id, item_id: a.item_id, first: pick(a), second: pick(b) }))
    };
  };
  return {
    paired_items: paired.length,
    fields: {
      explanation_quality: field((row) => row.explanation_quality, EXPLANATION_QUALITIES),
      beyond_option_text: field((row) => String(row.beyond_option_text), ["true", "false", "null"]),
      error_source: field((row) => row.error_source ?? "none", [...ERROR_SOURCES, "none"]),
      misconception: field((row) => row.misconception, ["none", "endorsed", "tentative"])
    }
  };
}

// ---------------------------------------------------------------- feedback

const PROCESS_WORDS = /\b(seconds?|minutes?|quickly|paste\w*|clipboard|tab|window|left the page|first answer|changed|switched|hesitat\w*|paus\w*)\b/i;

export function scoreFeedback(input: { cases: FeedbackCaseFile; records: FeedbackRunRecord[] }) {
  const byId = new Map(input.cases.cases.map((entry) => [entry.feedback_case_id, entry]));
  const rows = input.records.map((record) => {
    const feedbackCase = byId.get(record.feedback_case_id) as FeedbackCase | undefined;
    const output = record.output;
    if (!feedbackCase || !output) {
      return { feedback_case_id: record.feedback_case_id, run: record.run, validated: false, checks: null, message: null, output: null };
    }
    const expected = feedbackCase.expected;
    const questions = (output.student_visible_message.match(/\?/g) ?? []).length;
    const checks = {
      focus_type: expected.focus_types.includes(output.focus.focus_type),
      strategy: expected.strategies.includes(output.strategy),
      items: expected.item_numbers_any.length === 0 || output.focus.item_numbers.some((number) => expected.item_numbers_any.includes(number)),
      focus_status: expected.focus_status === null ? output.focus_status === null : output.focus_status !== null && expected.focus_status.includes(output.focus_status),
      review_flag: expected.review_flags.includes(output.instructor_review.flag),
      question_limit: questions <= expected.max_questions,
      no_false_corrected: !expected.must_not_mark_corrected || output.focus_status !== "corrected_reasoning_expressed",
      audience: studentFacingTextProblems(output.student_visible_message).length === 0
    };
    return {
      feedback_case_id: record.feedback_case_id,
      run: record.run,
      validated: true,
      checks,
      questions,
      process_words_for_review: (output.student_visible_message.match(new RegExp(PROCESS_WORDS, "gi")) ?? []).map((word) => word.toLowerCase()),
      message: output.student_visible_message,
      output
    };
  });
  const scored = rows.filter((row) => row.checks);
  const share = (pick: (checks: NonNullable<(typeof rows)[number]["checks"]>) => boolean) =>
    scored.length ? round(scored.filter((row) => pick(row.checks!)).length / scored.length) : null;
  const failed = rows.filter((row) => !row.validated).length;
  const audienceViolations = scored.filter((row) => !row.checks!.audience).length;
  const criteria = [
    criterion("Feedback outputs rejected twice (share of runs)", "<=", GO_LIVE_THRESHOLDS.fallback_rate_max, rows.length ? failed / rows.length : null),
    criterion("Delivered messages with an audience violation", "<=", 0, audienceViolations),
    criterion("Focus type follows the priority (share)", ">=", GO_LIVE_THRESHOLDS.feedback_focus_acceptable, share((checks) => checks.focus_type)),
    criterion("Strategy fits the evidence (share)", ">=", GO_LIVE_THRESHOLDS.feedback_strategy_acceptable, share((checks) => checks.strategy)),
    criterion("Expected instructor flag raised (share)", ">=", GO_LIVE_THRESHOLDS.feedback_review_flag_acceptable, share((checks) => checks.review_flag)),
    criterion("Messages over the question limit", "<=", 0, scored.filter((row) => !row.checks!.question_limit).length),
    criterion("Echo or bare answer recorded as corrected reasoning", "<=", 0, scored.filter((row) => !row.checks!.no_false_corrected).length)
  ];
  return {
    runs: rows.length,
    failed,
    shares: {
      focus_type: share((checks) => checks.focus_type),
      strategy: share((checks) => checks.strategy),
      focus_items: share((checks) => checks.items),
      focus_status: share((checks) => checks.focus_status),
      review_flag: share((checks) => checks.review_flag),
      question_limit: share((checks) => checks.question_limit),
      no_false_corrected: share((checks) => checks.no_false_corrected)
    },
    criteria,
    rows
  };
}
