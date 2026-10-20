/**
 * DB-free checks of the interpretation v8 evaluation harness: statistics, fixtures, scoring,
 * coding materials, item import and the local pipeline.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildCaseInput,
  expectedOutcomes,
  parseEvaluationFixtures,
  type EvaluationCaseFile
} from "../src/lib/evaluation/interpretation-v8/case-model";
import { buildCodingSheet, parseCodingSheet } from "../src/lib/evaluation/interpretation-v8/coding";
import {
  buildFeedbackCaseInput,
  checkFeedbackFixtures,
  FeedbackCaseFileSchema
} from "../src/lib/evaluation/interpretation-v8/feedback-case-model";
import {
  caseTemplateForBank,
  importMiniTestFiles,
  splitOptionNote,
  unwrittenPlaceholders
} from "../src/lib/evaluation/interpretation-v8/import-items";
import {
  cohensKappa,
  confusionMatrix,
  gwetAC1,
  percentAgreement,
  precisionRecall,
  stability,
  wilsonInterval
} from "../src/lib/evaluation/interpretation-v8/metrics";
import { renderMarkdownReport } from "../src/lib/evaluation/interpretation-v8/report";
import { keyVariablesFromEnvFile, modelSettingsFromRuntimeEnv } from "../src/lib/evaluation/interpretation-v8/live-setup";
import { localStandInProvider, runFeedbackCase, runInterpretationCase, type InterpretationRunRecord } from "../src/lib/evaluation/interpretation-v8/run";
import type { LlmProvider } from "../src/lib/llm/providers/types";
import {
  coderAgreement,
  expectationsFromFixtures,
  expectationsFromReference,
  labelDistribution,
  questionsAsked,
  scoreInterpretation,
  type ReferenceCodingRow
} from "../src/lib/evaluation/interpretation-v8/score";
import { assertNoProhibitedProviderInput } from "../src/lib/agents/redaction";
import type { InterpretationOutputV8 } from "../src/lib/services/student-assessment/interpretation-v8/contract";
import { chosenOptionTagsFromPackage } from "../src/lib/services/student-assessment/interpretation-v8/input-builder";

const fixtures = path.resolve("src/lib/evaluation/interpretation-v8/fixtures");
const read = (file: string) => JSON.parse(readFileSync(path.join(fixtures, file), "utf8"));
let checks = 0;
async function check(name: string, body: () => void | Promise<void>) {
  await body();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

const { bank, cases, problems } = parseEvaluationFixtures(read("item-bank.json"), read("cases.json"));
const feedback = FeedbackCaseFileSchema.parse(read("feedback-cases.json"));
const caseById = new Map(cases.cases.map((entry) => [entry.case_id, entry]));

/** An output that rates every response exactly as the fixtures expect (for scoring tests). */
function oracleOutput(caseId: string): InterpretationOutputV8 {
  const evaluationCase = caseById.get(caseId)!;
  return {
    items: evaluationCase.responses.map((response) => ({
      item_id: response.item_id,
      explanation_quality: response.expected.quality[0],
      no_usable_reason: response.expected.no_usable_reason?.[0] ?? null,
      adds_beyond_option_text: typeof response.expected.beyond_option_text === "boolean" ? response.expected.beyond_option_text : null,
      evidence_quote: null,
      evidence_source: null,
      reference_id: null,
      missing_elements: null,
      rationale: "Oracle rating.",
      error_source: response.expected.error_source?.[0] ?? null,
      side_remark: response.expected.side_remark ? "side remark" : null,
      uncertainty_note: null,
      process_interpretation: null
    })),
    possible_misconceptions: evaluationCase.claims.filter((claim) => claim.kind === "possible_misconception").map((claim) => ({
      item_ids: [claim.item_id],
      idea: "idea",
      student_quote: "quote",
      quote_item_id: claim.item_id,
      quote_source: "explanation" as const,
      endorsement: claim.endorsement ?? "endorsed",
      contradicts_reference_id: `${claim.item_id}:target`,
      matching_distractor_reference_id: null,
      alternative_explanation: null
    })),
    considered_ideas: evaluationCase.claims.filter((claim) => claim.kind === "considered_idea").map((claim) => ({
      item_id: claim.item_id,
      idea: "idea",
      student_quote: "quote",
      quote_source: "tempting_option_reason" as const,
      contradicts_reference_id: `${claim.item_id}:target`
    }))
  } as InterpretationOutputV8;
}

function record(caseId: string, run: number, output: InterpretationOutputV8 | null): InterpretationRunRecord {
  return {
    kind: "interpretation", case_id: caseId, run, engine: "local", model_name: "oracle", prompt_hash: "x",
    status: output ? "validated" : "failed", reason: output ? null : "validation_failed",
    attempts: [{ attempt: 1, outcome: output ? "validated" : "invalid_output", issues: [], latency_ms: 1, input_tokens: null, output_tokens: null }],
    output, started_at: "", completed_at: ""
  };
}

async function main() {
  await check("Cohen's kappa and Gwet's AC1 match worked examples", () => {
    // 50 pairs: 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no. po = .70, pe = .50, kappa = .40.
    const pairs = [
      ...Array(20).fill(["yes", "yes"]), ...Array(5).fill(["yes", "no"]),
      ...Array(10).fill(["no", "yes"]), ...Array(15).fill(["no", "no"])
    ] as Array<[string, string]>;
    assert.equal(percentAgreement(pairs), 0.7);
    assert.ok(Math.abs(cohensKappa(pairs)! - 0.4) < 1e-9);
    // AC1: pi(yes) = (25/50 + 30/50)/2 = .55; pe = 2 * .55 * .45 / 1 = .495; AC1 = (.7 - .495)/(.505).
    assert.ok(Math.abs(gwetAC1(pairs, ["yes", "no"])! - (0.7 - 0.495) / 0.505) < 1e-9);
    // Prevalence paradox: high agreement, one category dominant; kappa near zero, AC1 high.
    const skewed = [...Array(95).fill(["a", "a"]), ...Array(5).fill(["a", "b"])] as Array<[string, string]>;
    assert.ok((cohensKappa(skewed) ?? 0) < 0.05);
    assert.ok(gwetAC1(skewed, ["a", "b"])! > 0.9);
    assert.equal(confusionMatrix(pairs).counts.no.yes, 10);
  });

  await check("Wilson interval, precision and recall, stability", () => {
    const interval = wilsonInterval(0, 90)!;
    assert.equal(interval.low, 0);
    assert.ok(interval.high > 0.03 && interval.high < 0.05);
    assert.deepEqual(precisionRecall({ true_positive: 9, false_positive: 1, false_negative: 3 }).precision, 0.9);
    assert.equal(precisionRecall({ true_positive: 0, false_positive: 0, false_negative: 0 }).precision, null);
    assert.deepEqual(stability(new Map([["a", ["x", "x", "x"]], ["b", ["x", "y", "x"]], ["c", ["x"]]])), { stable: 1, units: 2, share: 0.5 });
  });

  await check("fixtures meet the coverage the design requires (section 11.1)", () => {
    assert.deepEqual(problems, []);
    assert.ok(bank.topics.length >= 3);
    const responses = cases.cases.flatMap((entry) => entry.responses);
    assert.ok(responses.length >= 120);
    assert.deepEqual(new Set(responses.map((response) => response.situation)), new Set(Object.keys(cases.situations)));
    for (const quality of ["adequate", "limited", "incorrect", "no_usable_explanation"]) {
      assert.ok(responses.some((response) => response.expected.quality[0] === quality), quality);
    }
    const labels = new Set(cases.cases.map((entry) => expectedOutcomes(bank, entry).summary));
    for (const label of ["Mostly understood", "Still developing", "Need more work", "Unavailable / insufficient evidence", "Pending item review"]) {
      assert.ok(labels.has(label as never), label);
    }
    const claims = cases.cases.flatMap((entry) => entry.claims);
    assert.ok(claims.some((claim) => claim.endorsement === "endorsed"));
    assert.ok(claims.some((claim) => claim.endorsement === "tentative"));
    assert.ok(claims.some((claim) => claim.kind === "considered_idea"));
    assert.ok(bank.topics.some((topic) => topic.items.some((item) => item.known_ambiguity)));
  });

  await check("the reviewer's four items give Still developing", () => {
    const outcome = expectedOutcomes(bank, caseById.get("R-11")!);
    assert.deepEqual([...outcome.statuses.values()], ["supported", "partly_supported", "not_supported", "partly_supported"]);
    assert.equal(outcome.summary, "Still developing");
  });

  await check("a flagged item that would change the label gives Pending item review", () => {
    const outcome = expectedOutcomes(bank, caseById.get("S-09")!);
    assert.equal(outcome.summary, "Pending item review");
    assert.equal(outcome.summary_without_pending, "Mostly understood");
  });

  await check("case inputs carry process indicators like production", () => {
    const input = buildCaseInput(bank, caseById.get("R-07")!);
    const r1 = input.items.find((item) => item.item_id === "R1")!;
    assert.equal(r1.process_indicators.find((indicator) => indicator.name === "answer_change")!.value, "incorrect_to_correct");
    assert.equal(r1.process_indicators.find((indicator) => indicator.name === "explanation_revised")!.value, true);
    assert.ok(r1.response.explanation_first_version);
    const r2 = input.items.find((item) => item.item_id === "R2")!;
    assert.equal(r2.process_indicators.find((indicator) => indicator.name === "focus_loss")!.value, 240);
    const rapid = buildCaseInput(bank, caseById.get("R-05")!).items[0];
    assert.equal(rapid.process_indicators.find((indicator) => indicator.name === "rapid_selection")!.value, true);
  });

  await check("an oracle that matches the expectations passes every interpretation criterion", () => {
    const records = cases.cases.flatMap((entry) => [1, 2, 3].map((run) => record(entry.case_id, run, oracleOutput(entry.case_id))));
    const report = scoreInterpretation({ bank, cases, expectations: expectationsFromFixtures(cases), standard: "design_expectations", records });
    assert.equal(report.explanation_quality.gwet_ac1, 1);
    assert.equal(report.misconceptions.precision, 1);
    assert.equal(report.misconceptions.recall, 1);
    assert.equal(report.summary_label.agreement, 1);
    assert.equal(report.summary_label.stability.share, 1);
    assert.equal(report.considered_ideas.recall, 1);
    for (const entry of report.criteria.filter((criterion) => criterion.pass !== null)) assert.equal(entry.pass, true, entry.name);
    assert.equal(report.criteria.find((criterion) => criterion.name.startsWith("Coder agreement"))!.pass, null);
    assert.equal(report.mismatches.length, 0);
  });

  await check("claims from a choice or a rejected idea are critical; fallback and instability are counted", () => {
    const choiceOnly = oracleOutput("V-09");
    choiceOnly.possible_misconceptions.push({
      item_ids: ["V2", "V3"], idea: "Any correlation is reliability.", student_quote: "x", quote_item_id: "V2", quote_source: "explanation",
      endorsement: "endorsed", contradicts_reference_id: "V2:target", matching_distractor_reference_id: null, alternative_explanation: null
    });
    const rejected = oracleOutput("R-06");
    rejected.possible_misconceptions.push({
      item_ids: ["R1"], idea: "Consistent means accurate.", student_quote: "x", quote_item_id: "R1", quote_source: "tempting_option_reason",
      endorsement: "endorsed", contradicts_reference_id: "R1:target", matching_distractor_reference_id: null, alternative_explanation: null
    });
    const report = scoreInterpretation({
      bank, cases, expectations: expectationsFromFixtures(cases), standard: "design_expectations",
      records: [record("V-09", 1, choiceOnly), record("R-06", 1, rejected), record("R-06", 2, null)]
    });
    assert.equal(report.misconceptions.critical_claims.length, 3);
    assert.equal(report.criteria.find((criterion) => criterion.name.startsWith("Misconceptions claimed"))!.pass, false);
    assert.equal(report.generation.fallback, 1);
    assert.equal(report.summary_label.stability.stable, 0);
    assert.equal(report.summary_label.stability.units, 1);
  });

  await check("a wrong rating appears in the situation table and the mismatch list", () => {
    const output = oracleOutput("S-01");
    output.items[0] = { ...output.items[0], explanation_quality: "limited" };
    const report = scoreInterpretation({ bank, cases, expectations: expectationsFromFixtures(cases), standard: "design_expectations", records: [record("S-01", 1, output)] });
    const s01 = report.situations.find((row) => row.situation === "S01")!;
    assert.equal(s01.responses - s01.quality_acceptable, 1);
    assert.equal(s01.most_common_wrong_rating, "limited");
    assert.equal(report.mismatches.length, 1);
    const markdown = renderMarkdownReport({
      title: "t", generated_at: "now", engine: "live", model_names: ["m"], prompt_hashes: { interpretation: "a", feedback: "b" },
      interpretation: report, feedback: null
    });
    assert.ok(markdown.includes("| S01 |"));
  });

  await check("the coding sheet is blind, and filled sheets give agreement and a reference", () => {
    const csv = buildCodingSheet(bank, cases);
    assert.ok(!/situation|expected|S0\d|S1\d|S2\d|S3\d/.test(csv.split("\n")[0]));
    assert.ok(!csv.includes("Copies or closely paraphrases"));
    const header = csv.split("\n")[0];
    assert.ok(header.includes("explanation_quality") && header.includes("misconception"));
    const rows: ReferenceCodingRow[] = cases.cases.flatMap((entry) => entry.responses.map((response) => ({
      case_id: entry.case_id,
      item_id: response.item_id,
      explanation_quality: response.expected.quality[0],
      beyond_option_text: typeof response.expected.beyond_option_text === "boolean" ? response.expected.beyond_option_text : null,
      error_source: response.expected.error_source?.[0] ?? null,
      no_usable_reason: response.expected.no_usable_reason?.[0] ?? null,
      side_remark: response.expected.side_remark,
      misconception: (entry.claims.find((claim) => claim.item_id === response.item_id && claim.kind === "possible_misconception")?.endorsement ?? "none") as ReferenceCodingRow["misconception"],
      considered_idea: entry.claims.some((claim) => claim.item_id === response.item_id && claim.kind === "considered_idea")
    })));
    const filled = "case_id,item_id,explanation_quality,beyond_option_text,error_source,no_usable_reason,side_remark,misconception,considered_idea\n"
      + rows.map((row) => [row.case_id, row.item_id, row.explanation_quality, row.beyond_option_text === null ? "na" : row.beyond_option_text ? "yes" : "no",
        row.error_source ?? "none", row.no_usable_reason ?? "", row.side_remark ? "yes" : "no", row.misconception, row.considered_idea ? "yes" : "no"].join(",")).join("\n");
    const parsed = parseCodingSheet(filled);
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.rows.length, 124);
    const agreement = coderAgreement(parsed.rows, parsed.rows);
    assert.equal(agreement.fields.explanation_quality.ac1, 1);
    const expectations = expectationsFromReference(cases, parsed.rows);
    const report = scoreInterpretation({
      bank, cases, expectations, standard: "human_reference", coder_agreement: agreement,
      records: cases.cases.map((entry) => record(entry.case_id, 1, oracleOutput(entry.case_id)))
    });
    assert.equal(report.explanation_quality.gwet_ac1, 1);
    assert.equal(report.criteria[0].pass, true);
    assert.ok(parseCodingSheet("case_id,item_id,explanation_quality\nR-01,R1,good\n").problems.length === 1);
  });

  await check("feedback fixtures match the simulated students and build production-shaped inputs", () => {
    assert.deepEqual(checkFeedbackFixtures(caseById, feedback), []);
    for (const feedbackCase of feedback.cases) {
      const input = buildFeedbackCaseInput(bank, caseById.get(feedbackCase.base_case_id)!, feedbackCase);
      assertNoProhibitedProviderInput(input);
      assert.equal(input.mode, feedbackCase.mode);
      if (input.mode === "reply") {
        assert.ok(input.opening_message && input.latest_student_message);
        assert.equal(input.lifecycle.student_turns_used, feedbackCase.transcript.filter((turn) => turn.actor === "student").length);
      }
      if (!feedbackCase.profile_available) assert.ok(input.items.every((item) => item.interpretation === null));
    }
    const pattern = buildFeedbackCaseInput(bank, caseById.get("V-09")!, feedback.cases.find((entry) => entry.feedback_case_id === "F06")!);
    assert.deepEqual(pattern.answer_patterns, [{ shared_idea: "any correlation is reliability", item_numbers: [2, 3] }]);
  });

  await check("the local pipeline runs every case through the production generation loops", async () => {
    for (const evaluationCase of cases.cases) {
      const result = await runInterpretationCase({ bank, evaluation_case: evaluationCase, run: 1, engine: { kind: "local" } });
      assert.equal(result.status, "validated", `${evaluationCase.case_id}: ${JSON.stringify(result.attempts.flatMap((attempt) => attempt.issues).slice(0, 3))}`);
    }
    for (const feedbackCase of feedback.cases) {
      const result = await runFeedbackCase({ bank, base_case: caseById.get(feedbackCase.base_case_id)!, feedback_case: feedbackCase, run: 1, engine: { kind: "local" } });
      assert.equal(result.status, "validated", `${feedbackCase.feedback_case_id}: ${JSON.stringify(result.attempts.flatMap((attempt) => attempt.issues).slice(0, 3))}`);
    }
  });

  await check("mini-test files import into a bank and a case template that cannot be scored until written", () => {
    const sample = readFileSync(path.resolve("public/samples/mini-test-import.json"), "utf8");
    const imported = importMiniTestFiles([{ name: "sample.json", text: sample, topic_id: "E1" }], "sample");
    assert.deepEqual(imported.problems, []);
    const topic = imported.bank.topics[0];
    assert.equal(topic.items.length, 3);
    assert.ok(Object.values(topic.items[0].rationales).every((entry) => entry.rationale && entry.idea_label));
    const template: EvaluationCaseFile = caseTemplateForBank(imported.bank, cases.situations);
    assert.ok(template.cases.length * 3 >= Object.keys(cases.situations).length);
    assert.ok(unwrittenPlaceholders(template).length > 0);
    const parsed = parseEvaluationFixtures(imported.bank, template);
    assert.deepEqual(parsed.problems.filter((problem) => !problem.includes("WRITE")), []);
    const broken = importMiniTestFiles([{ name: "broken.json", text: "{}" }], "x");
    assert.equal(broken.bank.topics.length, 0);
    assert.equal(broken.problems.length, 1);
  });

  await check("an older single distractor note splits by option letter", () => {
    const split = splitOptionNote("A: treats reliability as validity; B) ignores error\nC. assumes the score is exact");
    assert.deepEqual([...split.entries()], [["A", "treats reliability as validity"], ["B", "ignores error"], ["C", "assumes the score is exact"]]);
    assert.equal(splitOptionNote("No letters here.").size, 0);
  });

  await check("chosen-option idea labels come from the sealed package (answer patterns)", () => {
    const context = (labels: Record<string, string>) => ({
      teacher_diagnostic_context: { option_notes: Object.entries(labels).map(([label, idea_label]) => ({ label, idea_label })) }
    });
    const tags = chosenOptionTagsFromPackage({
      item_responses: [
        { item_public_id: "itm_1", selected_answer_final: "b", teacher_diagnostic_context: context({ B: "reliability = validity" }) },
        { item_public_id: "itm_2", selected_option: "C", teacher_diagnostic_context: context({ D: "other" }) },
        { item_public_id: "itm_3", selected_option: null, teacher_diagnostic_context: context({ A: "x" }) }
      ]
    });
    assert.deepEqual([...tags.entries()], [["itm_1", "reliability = validity"], ["itm_2", null], ["itm_3", null]]);
  });

  await check("label use is compared with the plan, with exact and accepted counts", () => {
    const rows = [
      { planned: "adequate", model: "adequate", ok: true },
      { planned: "adequate", model: "limited", ok: true },
      { planned: "limited", model: "limited", ok: true },
      { planned: "incorrect", model: "rating_unavailable", ok: false }
    ];
    const table = labelDistribution(rows, (row) => row.planned, (row) => row.model,
      ["adequate", "limited", "incorrect", "no_usable_explanation", "rating_unavailable"], (row) => row.ok);
    const byLabel = new Map(table.map((row) => [row.label, row]));
    assert.equal(byLabel.get("adequate")!.planned_share, 0.5);
    assert.equal(byLabel.get("adequate")!.model_share, 0.25);
    assert.equal(byLabel.get("adequate")!.kept, 1);
    assert.equal(byLabel.get("adequate")!.accepted, 2, "An accepted alternative counts as accepted, not as kept");
    assert.equal(byLabel.get("limited")!.share_difference, 0.25);
    assert.equal(byLabel.get("rating_unavailable")!.model, 1, "Unrated items are shown, not hidden");
    assert.equal(byLabel.get("no_usable_explanation")!.planned, 0, "Every planned label is listed even when unused");
  });

  await check("live runs take only the key variables from the named env file and only model settings from the settings file", () => {
    const envText = "# earlier live runs\r\nLLM_PROVIDER=mock\r\nDATABASE_URL=postgresql://x\r\nOPENAI_MODEL_PROFILING=other\r\nOPENAI_API_KEY_FILE=keys/placeholder.txt\r\n";
    const variables = keyVariablesFromEnvFile(envText, path.resolve("/data/release/.env.local"));
    assert.deepEqual(Object.keys(variables), ["OPENAI_API_KEY_FILE"], "Nothing but the key variables is taken");
    assert.equal(variables.OPENAI_API_KEY_FILE, path.resolve("/data/release/keys/placeholder.txt"), "A relative key file is relative to the env file");
    assert.deepEqual(keyVariablesFromEnvFile("OPENAI_API_KEY=\n", "/x/.env"), {});
    const settings = modelSettingsFromRuntimeEnv({ OPENAI_MODEL_PROFILING: "model-a", OPENAI_REASONING_EFFORT_PROFILING: "medium",
      OPENAI_MAX_OUTPUT_TOKENS_PROFILING: 4000, OPENAI_REQUEST_TIMEOUT_MS: 90000, OPERATIONAL_AGENT_MODE: "guarded_live",
      OPENAI_API_KEY: "placeholder", DATABASE_URL: "postgresql://x", APP_ENV: "development" });
    assert.deepEqual(settings, { OPENAI_MODEL_PROFILING: "model-a", OPENAI_REASONING_EFFORT_PROFILING: "medium",
      OPENAI_MAX_OUTPUT_TOKENS_PROFILING: "4000", OPENAI_REQUEST_TIMEOUT_MS: "90000" });
  });

  await check("questions quoted as examples are not counted as questions asked; rejected drafts are kept", () => {
    assert.equal(questionsAsked("Which part would you like to look at first?"), 1);
    assert.equal(questionsAsked("Reliability answers \u201CHow consistently are scores produced?\u201D and validity answers \"What evidence supports this use?\" Which would you like to explore?"), 1);
    assert.equal(questionsAsked("Is it the group? Or the conditions?"), 2);
  });

  await check("a rejected attempt keeps the output the checks rejected, for the strictness review", async () => {
    let calls = 0;
    const firstInvented: LlmProvider = {
      async executeStructured(request) {
        const result = await localStandInProvider.executeStructured(request);
        calls += 1;
        if (calls > 1 || result.status !== "completed") return result;
        const output = structuredClone(result.parsed_output) as { items: Array<{ evidence_quote: string | null }> };
        for (const item of output.items) if (item.evidence_quote) item.evidence_quote = "words the student never wrote anywhere";
        return { ...result, parsed_output: output as typeof result.parsed_output };
      }
    };
    const record = await runInterpretationCase({ bank, evaluation_case: caseById.get("R-01")!, run: 1,
      engine: { kind: "live", provider: firstInvented, interpretation_model: { model_name: "test" }, feedback_model: { model_name: "test" } } });
    assert.equal(record.status, "validated");
    assert.equal(record.attempts[0].outcome, "invalid_output");
    assert.ok(JSON.stringify(record.attempts[0].rejected_output).includes("never wrote"));
    assert.equal(record.attempts.at(-1)!.rejected_output, null);
  });

  console.log(`interpretation-v8-evaluation-unit-test: ${checks} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
