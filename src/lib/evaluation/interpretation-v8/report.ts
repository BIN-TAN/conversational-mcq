import { stringify } from "csv-stringify/sync";
import type { ConfusionMatrix } from "./metrics";
import type { InterpretationReport, scoreFeedback } from "./score";

/** Markdown and CSV renderings of an evaluation report. */
type FeedbackReport = ReturnType<typeof scoreFeedback>;

const pct = (value: number | null | undefined) => (value === null || value === undefined ? "n/a" : `${Math.round(value * 1000) / 10}%`);
const num = (value: number | null | undefined) => (value === null || value === undefined ? "n/a" : String(value));
const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");

function matrix(title: string, data: ConfusionMatrix) {
  const header = `| ${title} (rows: standard, columns: model) | ${data.categories.map(cell).join(" | ")} |`;
  const rule = `|---|${data.categories.map(() => "---:").join("|")}|`;
  const rows = data.categories.map((row) => `| ${cell(row)} | ${data.categories.map((column) => data.counts[row][column]).join(" | ")} |`);
  return [header, rule, ...rows].join("\n");
}

function criteriaTable(criteria: Array<{ name: string; threshold: string; value: number | null; pass: boolean | null; note: string | null }>) {
  return [
    "| Criterion | Threshold | Value | Result |",
    "|---|---|---:|---|",
    ...criteria.map((entry) => `| ${cell(entry.name)} | ${entry.threshold} | ${num(entry.value)} | ${entry.pass === null ? `not assessed${entry.note ? ` (${entry.note})` : ""}` : entry.pass ? "pass" : "**fail**"} |`)
  ].join("\n");
}

export function renderMarkdownReport(input: {
  title: string;
  generated_at: string;
  engine: string;
  model_names: string[];
  prompt_hashes: { interpretation: string; feedback: string };
  interpretation: InterpretationReport | null;
  feedback: FeedbackReport | null;
}) {
  const lines: string[] = [
    `# ${input.title}`,
    "",
    `Generated ${input.generated_at}. Engine: ${input.engine}. Models: ${input.model_names.join(", ") || "n/a"}.`,
    `Interpretation prompt hash: \`${input.prompt_hashes.interpretation}\`. Feedback prompt hash: \`${input.prompt_hashes.feedback}\`.`,
    ""
  ];
  if (input.engine === "local") {
    lines.push("> These results come from the local stand-ins, which are not a model. They check that the pipeline runs; they say nothing about model quality.", "");
  }
  const report = input.interpretation;
  if (report) {
    lines.push(
      "## Interpretation",
      "",
      `Standard: ${report.standard === "human_reference" ? "resolved human reference coding" : "design expectations in the fixtures"}. Runs per case: ${report.runs_per_case}.`,
      "",
      criteriaTable(report.criteria),
      "",
      "### Generation",
      "",
      `${report.generation.submissions} submissions: ${report.generation.validated_first_attempt} validated on the first attempt, ${report.generation.validated_after_regeneration} after one regeneration, ${report.generation.fallback} fallback (${pct(report.generation.fallback_rate)}).`,
      "",
      report.generation.rejection_reasons.length
        ? `Rejection reasons across attempts: ${report.generation.rejection_reasons.map((entry) => `${entry.code} (${entry.count})`).join(", ")}.`
        : "No attempt was rejected.",
      "",
      "### Explanation quality",
      "",
      `${report.explanation_quality.items} item ratings; ${report.explanation_quality.acceptable} in the acceptable categories (${pct(report.explanation_quality.acceptable_agreement)}); exact agreement with the first-listed category ${pct(report.explanation_quality.exact_reference_agreement)}. Gwet's AC1 ${num(report.explanation_quality.gwet_ac1)}, Cohen's kappa ${num(report.explanation_quality.cohens_kappa)}. Adequate-versus-incorrect disagreements: ${report.explanation_quality.adequate_incorrect_disagreements}.`,
      "",
      matrix("Explanation quality", report.explanation_quality.confusion_matrix),
      "",
      "### Situations: did each way of expressing reasoning lead to the expected category?",
      "",
      "| Situation | Description | Ratings | Quality as expected | Status as expected | Error source as expected | Misconception FP / FN | Critical | Most common wrong rating |",
      "|---|---|---:|---:|---:|---:|---:|---:|---|",
      ...report.situations.map((row) => `| ${row.situation} | ${cell(row.description)} | ${row.responses} | ${row.quality_acceptable}/${row.responses} | ${row.status_agreement}/${row.responses} | ${row.error_source_scored ? `${row.error_source_acceptable}/${row.error_source_scored}` : "-"} | ${row.misconception_false_positives} / ${row.misconception_false_negatives} | ${row.critical_claims} | ${row.most_common_wrong_rating ?? "-"} |`),
      "",
      "### Other fields",
      "",
      `- Beyond-option-text flag: ${report.beyond_option_text.items} scored, agreement ${pct(report.beyond_option_text.agreement)}, AC1 ${num(report.beyond_option_text.gwet_ac1)}.`,
      `- Error source: ${report.error_source.items} scored, agreement ${pct(report.error_source.acceptable_agreement)}, AC1 ${num(report.error_source.gwet_ac1)}; ${report.error_source.unexpected_error_source} error sources where none was expected; possible item issue flagged ${report.error_source.possible_item_issue_recall.flagged} of ${report.error_source.possible_item_issue_recall.items} times, ${report.error_source.possible_item_issue_false_flags} false flags.`,
      `- Side remarks: recorded ${report.side_remarks.recorded_when_expected} of ${report.side_remarks.expected} times when expected, ${report.side_remarks.recorded_when_not_expected} times when not expected.`,
      `- Item status (from the ratings by rule): agreement ${pct(report.item_status.agreement)}, AC1 ${num(report.item_status.gwet_ac1)}.`,
      `- Summary label: agreement ${pct(report.summary_label.agreement)} over ${report.summary_label.submissions} submissions; same label in every run for ${report.summary_label.stability.stable} of ${report.summary_label.stability.units} students.`,
      `- Item rating stability: same rating in every run for ${report.quality_stability.stable} of ${report.quality_stability.units} responses.`,
      "",
      matrix("Summary label", report.summary_label.confusion_matrix),
      "",
      "### Claims",
      "",
      `Possible misconceptions: ${report.misconceptions.true_positive} matched, ${report.misconceptions.false_positive} false, ${report.misconceptions.false_negative} missed; precision ${num(report.misconceptions.precision)}, recall ${num(report.misconceptions.recall)}; endorsement agreement on matched claims ${pct(report.misconceptions.endorsement_agreement)}.`,
      `Ideas considered but not endorsed: precision ${num(report.considered_ideas.precision)}, recall ${num(report.considered_ideas.recall)}.`,
      "",
      report.misconceptions.critical_claims.length
        ? ["Critical claims (must be zero):", "", ...report.misconceptions.critical_claims.map((claim) => `- ${claim.case_id} run ${claim.run}, ${claim.item_id}: "${cell(claim.idea ?? "")}" from "${cell(claim.quote ?? "")}"`)].join("\n")
        : "No critical claims.",
      "",
      report.misconceptions.false_positives.length
        ? ["False claims:", "", ...report.misconceptions.false_positives.map((claim) => `- ${claim.case_id} run ${claim.run}, ${claim.item_id}${claim.reference_ok === false ? " (wrong contradicted reference)" : ""}: "${cell(claim.idea ?? "")}"`)].join("\n")
        : "No false claims.",
      "",
      "### Ratings that differ from the standard",
      "",
      report.mismatches.length
        ? [
            "| Case | Run | Item | Situation | Standard | Model | Status (standard / model) | Model rationale |",
            "|---|---:|---|---|---|---|---|---|",
            ...report.mismatches.map((row) => `| ${row.case_id} | ${row.run} | ${row.item_id} | ${row.situation} | ${row.expected_quality.join(" or ")}${row.expected_error_source ? `; ${row.expected_error_source.join(" or ")}` : ""} | ${row.model_quality}${row.model_error_source ? `; ${row.model_error_source}` : ""} | ${row.expected_status} / ${row.model_status} | ${cell(row.model_rationale)} |`)
          ].join("\n")
        : "None.",
      ""
    );
  }
  const feedback = input.feedback;
  if (feedback) {
    lines.push(
      "## Feedback",
      "",
      criteriaTable(feedback.criteria),
      "",
      `${feedback.runs} runs, ${feedback.failed} without a delivered message. Shares: focus type ${pct(feedback.shares.focus_type)}, strategy ${pct(feedback.shares.strategy)}, focus items ${pct(feedback.shares.focus_items)}, focus status ${pct(feedback.shares.focus_status)}, instructor flag ${pct(feedback.shares.review_flag)}, question limit ${pct(feedback.shares.question_limit)}.`,
      "",
      "| Case | Run | Focus | Strategy | Items | Status | Flag | Questions | Words for the reader to check |",
      "|---|---:|---|---|---|---|---|---:|---|",
      ...feedback.rows.map((row) => row.checks
        ? `| ${row.feedback_case_id} | ${row.run} | ${row.output!.focus.focus_type}${row.checks.focus_type ? "" : " ✗"} | ${row.output!.strategy}${row.checks.strategy ? "" : " ✗"} | ${row.output!.focus.item_numbers.join(", ") || "-"}${row.checks.items ? "" : " ✗"} | ${row.output!.focus_status ?? "-"}${row.checks.focus_status && row.checks.no_false_corrected ? "" : " ✗"} | ${row.output!.instructor_review.flag}${row.checks.review_flag ? "" : " ✗"} | ${row.questions}${row.checks.question_limit ? "" : " ✗"} | ${(row.process_words_for_review ?? []).join(", ") || "-"} |`
        : `| ${row.feedback_case_id} | ${row.run} | no message delivered | | | | | | |`),
      ""
    );
  }
  return lines.join("\n");
}

export function itemComparisonCsv(report: InterpretationReport) {
  return stringify(report.mismatches.map((row) => ({
    case_id: row.case_id,
    run: row.run,
    item_id: row.item_id,
    situation: row.situation,
    explanation: row.explanation ?? "",
    standard_quality: row.expected_quality.join(" | "),
    model_quality: row.model_quality,
    standard_error_source: row.expected_error_source?.join(" | ") ?? "",
    model_error_source: row.model_error_source ?? "",
    standard_status: row.expected_status,
    model_status: row.model_status,
    model_rationale: row.model_rationale,
    reviewer_judgement: "",
    reviewer_notes: ""
  })), { header: true, quoted_string: true });
}
