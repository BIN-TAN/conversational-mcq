/**
 * Evaluation of interpretation v8 and feedback v8 (docs/INTERPRETATION_V8_EVALUATION_PLAN.md).
 *
 *   npm run eval:v8 -- check
 *   npm run eval:v8 -- run --engine local --runs 1
 *   npm run eval:v8 -- run --engine live --runs 3 --allow-live
 *   npm run eval:v8 -- coding-sheet
 *   npm run eval:v8 -- agreement --coder-a a.csv --coder-b b.csv
 *   npm run eval:v8 -- score --runs <run folder> [--reference reference.csv] [--coder-a a.csv --coder-b b.csv]
 *   npm run eval:v8 -- import-items --from edpy507-topic1.json,edpy507-topic2.json
 *   npm run eval:v8 -- hashes
 *
 * Common options: --bank, --cases and --feedback-cases replace the shipped fixtures (for
 * example with imported EDPY 507 items and their written cases). No database is used. Live
 * runs need --allow-live. --env-file <file> names the env file the earlier live runs used (only
 * the OpenAI key variables are taken from it); --runtime-env <json> names the approved runtime
 * settings file (only model settings are taken from it).
 * In PowerShell, run it as npx tsx prisma/interpretation-v8-evaluation-cli.ts <command> ...
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { keyVariablesFromEnvFile, modelSettingsFromRuntimeEnv } from "../src/lib/evaluation/interpretation-v8/live-setup";
import {
  EvaluationCaseFileSchema,
  expectedOutcomes,
  parseEvaluationFixtures,
  type EvaluationCaseFile,
  type ItemBank
} from "../src/lib/evaluation/interpretation-v8/case-model";
import {
  buildCodingSheet,
  buildFeedbackReadingSheet,
  CODING_INSTRUCTIONS,
  parseCodingSheet
} from "../src/lib/evaluation/interpretation-v8/coding";
import { checkFeedbackFixtures, FeedbackCaseFileSchema, type FeedbackCaseFile } from "../src/lib/evaluation/interpretation-v8/feedback-case-model";
import { caseTemplateForBank, importMiniTestFiles, unwrittenPlaceholders } from "../src/lib/evaluation/interpretation-v8/import-items";
import { itemComparisonCsv, renderMarkdownReport } from "../src/lib/evaluation/interpretation-v8/report";
import {
  runFeedbackCase,
  runInterpretationCase,
  type EvaluationEngine,
  type FeedbackRunRecord,
  type InterpretationRunRecord,
  type RunRecord
} from "../src/lib/evaluation/interpretation-v8/run";
import {
  coderAgreement,
  expectationsFromFixtures,
  expectationsFromReference,
  scoreFeedback,
  scoreInterpretation
} from "../src/lib/evaluation/interpretation-v8/score";
import { FEEDBACK_V8_AGENT_NAME, FEEDBACK_V8_PROMPT_HASH } from "../src/lib/services/student-assessment/feedback-v8/contract";
import { INTERPRETATION_V8_AGENT_NAME, INTERPRETATION_V8_PROMPT_HASH } from "../src/lib/services/student-assessment/interpretation-v8/contract";

const FIXTURES = path.resolve(process.cwd(), "src/lib/evaluation/interpretation-v8/fixtures");
const args = process.argv.slice(2);
const command = args[0] ?? "check";
const option = (name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const flag = (name: string) => args.includes(name);
const readJson = (file: string) => JSON.parse(readFileSync(path.resolve(file), "utf8").replace(/^﻿/, ""));
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const outDir = (fallback: string) => {
  const dir = path.resolve(option("--out") ?? path.join(".data/interpretation-v8-evaluation", fallback));
  mkdirSync(dir, { recursive: true });
  return dir;
};

function loadFixtures() {
  const bankPath = option("--bank") ?? path.join(FIXTURES, "item-bank.json");
  const casesPath = option("--cases") ?? path.join(FIXTURES, "cases.json");
  const feedbackPath = option("--feedback-cases") ?? (option("--cases") ? null : path.join(FIXTURES, "feedback-cases.json"));
  const { bank, cases, problems } = parseEvaluationFixtures(readJson(bankPath), readJson(casesPath));
  const feedback: FeedbackCaseFile | null = feedbackPath ? FeedbackCaseFileSchema.parse(readJson(feedbackPath)) : null;
  const feedbackProblems = feedback ? checkFeedbackFixtures(new Map(cases.cases.map((entry) => [entry.case_id, entry])), feedback) : [];
  const placeholders = unwrittenPlaceholders(cases);
  return { bank, cases, feedback, problems: [...problems, ...feedbackProblems, ...placeholders.map((entry) => `${entry} is not written yet`)], paths: { bankPath, casesPath, feedbackPath } };
}

function fixtureSummary(bank: ItemBank, cases: EvaluationCaseFile) {
  const labels = new Map<string, number>();
  const qualities = new Map<string, number>();
  for (const evaluationCase of cases.cases) {
    const outcome = expectedOutcomes(bank, evaluationCase);
    labels.set(outcome.summary, (labels.get(outcome.summary) ?? 0) + 1);
    for (const response of evaluationCase.responses) qualities.set(response.expected.quality[0], (qualities.get(response.expected.quality[0]) ?? 0) + 1);
  }
  const situations = new Map<string, number>();
  for (const response of cases.cases.flatMap((entry) => entry.responses)) situations.set(response.situation, (situations.get(response.situation) ?? 0) + 1);
  return {
    topics: bank.topics.length,
    items: bank.topics.reduce((sum, topic) => sum + topic.items.length, 0),
    simulated_students: cases.cases.length,
    item_responses: cases.cases.reduce((sum, entry) => sum + entry.responses.length, 0),
    expected_ratings: Object.fromEntries(qualities),
    expected_summary_labels: Object.fromEntries(labels),
    expected_misconception_claims: cases.cases.flatMap((entry) => entry.claims).filter((claim) => claim.kind === "possible_misconception").length,
    expected_considered_ideas: cases.cases.flatMap((entry) => entry.claims).filter((claim) => claim.kind === "considered_idea").length,
    items_where_a_claim_is_critical: cases.cases.reduce((sum, entry) => sum + entry.forbidden_claim_items.length, 0),
    situations_covered: `${situations.size} of ${Object.keys(cases.situations).length}`,
    situations_missing: Object.keys(cases.situations).filter((code) => !situations.has(code))
  };
}

async function liveEngine(): Promise<EvaluationEngine> {
  if (!flag("--allow-live")) throw new Error("Live runs call the model and cost money. Add --allow-live to confirm.");
  loadEnvConfig(process.cwd(), true);
  // The researcher's existing configuration is used, from the files named on the command line
  // (see src/lib/evaluation/interpretation-v8/live-setup.ts). Nothing is printed or written, and
  // .env.local is not changed. --allow-live switches live calls on for this process only.
  const envFile = option("--env-file");
  const keyVariables = envFile ? keyVariablesFromEnvFile(readFileSync(path.resolve(envFile), "utf8"), path.resolve(envFile)) : {};
  const runtimeEnvFile = option("--runtime-env");
  const modelSettings = runtimeEnvFile ? modelSettingsFromRuntimeEnv(JSON.parse(readFileSync(path.resolve(runtimeEnvFile), "utf8"))) : {};
  if (runtimeEnvFile && !Object.keys(modelSettings).length) throw new Error(`${runtimeEnvFile} holds no model settings.`);
  Object.assign(process.env, modelSettings, keyVariables, { LLM_PROVIDER: "openai", LLM_LIVE_CALLS_ENABLED: "true" });
  const { getLlmRuntimeConfig, resolveAgentModelConfig, resolveOpenAIModelConfigForRole } = await import("../src/lib/llm/config");
  const { createLlmProvider } = await import("../src/lib/llm/providers/provider-factory");
  const runtime = getLlmRuntimeConfig();
  if (runtime.provider !== "openai" || !runtime.live_calls_enabled || !runtime.openai_key_configured) {
    throw new Error("Live calls could not be switched on for this run.");
  }
  console.log(`Live calls are on for this run. OpenAI key: configured${envFile ? ` (from ${path.resolve(envFile)})` : ""}. Model settings: ${runtimeEnvFile ? path.resolve(runtimeEnvFile) : ".env.local"}.`);
  return {
    kind: "live",
    provider: createLlmProvider(),
    interpretation_model: resolveAgentModelConfig(INTERPRETATION_V8_AGENT_NAME),
    feedback_model: resolveOpenAIModelConfigForRole(FEEDBACK_V8_AGENT_NAME),
    key_env_file: envFile ? path.resolve(envFile) : null,
    model_settings_file: runtimeEnvFile ? path.resolve(runtimeEnvFile) : null
  };
}

function readRecords(dir: string): RunRecord[] {
  const file = path.join(dir, "runs.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunRecord);
}

async function inBatches<T>(tasks: Array<() => Promise<T>>, concurrency: number) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      await task();
    }
  }));
}

async function run() {
  const { bank, cases, feedback, problems } = loadFixtures();
  if (problems.length) throw new Error(`Fix the fixtures first:\n- ${problems.join("\n- ")}`);
  const engineKind = option("--engine") ?? "local";
  if (engineKind !== "local" && engineKind !== "live") throw new Error("--engine is local or live.");
  const runs = Number(option("--runs") ?? (engineKind === "live" ? 3 : 1));
  const part = option("--part") ?? "all";
  const only = option("--only")?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? null;
  const dir = outDir(`${engineKind}-${stamp()}`);
  const existing = readRecords(dir);
  const done = new Set(existing.map((record) => record.kind === "interpretation" ? `i:${record.case_id}:${record.run}` : `f:${record.feedback_case_id}:${record.run}`));

  const interpretationCases = part === "feedback" ? [] : cases.cases.filter((entry) => !only || only.includes(entry.case_id));
  const feedbackCases = part === "interpretation" || !feedback ? [] : feedback.cases.filter((entry) => !only || only.includes(entry.feedback_case_id));
  const pending: Array<{ key: string; task: (engine: EvaluationEngine) => Promise<RunRecord> }> = [];
  for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
    for (const evaluationCase of interpretationCases) {
      const key = `i:${evaluationCase.case_id}:${runNumber}`;
      if (!done.has(key)) pending.push({ key, task: (engine) => runInterpretationCase({ bank, evaluation_case: evaluationCase, run: runNumber, engine,
        job_retries: Number(option("--job-retries") ?? 2) }) });
    }
    for (const feedbackCase of feedbackCases) {
      const key = `f:${feedbackCase.feedback_case_id}:${runNumber}`;
      const base = cases.cases.find((entry) => entry.case_id === feedbackCase.base_case_id)!;
      if (!done.has(key)) pending.push({ key, task: (engine) => runFeedbackCase({ bank, base_case: base, feedback_case: feedbackCase, run: runNumber, engine }) });
    }
  }
  const maxCalls = Number(option("--max-calls") ?? 1000);
  const interpretationRuns = pending.filter((entry) => entry.key.startsWith("i:")).length;
  const worstCase = interpretationRuns * 2 * (1 + Number(option("--job-retries") ?? 2)) + (pending.length - interpretationRuns) * 2;
  console.log(`${pending.length} runs to do (${existing.length} already in ${dir}); usually about ${Math.round(pending.length * 1.3)} model calls, at most ${worstCase}.`);
  if (engineKind === "live" && worstCase > maxCalls) throw new Error(`At most ${worstCase} calls exceeds --max-calls ${maxCalls}.`);
  if (!pending.length) return dir;
  const engine: EvaluationEngine = engineKind === "live" ? await liveEngine() : { kind: "local" };
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({
    engine: engine.kind,
    runs,
    part,
    only,
    interpretation_model: engine.kind === "live" ? engine.interpretation_model : null,
    feedback_model: engine.kind === "live" ? engine.feedback_model : null,
    key_env_file: engine.kind === "live" ? engine.key_env_file ?? null : null,
    model_settings_file: engine.kind === "live" ? engine.model_settings_file ?? null : null,
    interpretation_prompt_hash: INTERPRETATION_V8_PROMPT_HASH,
    feedback_prompt_hash: FEEDBACK_V8_PROMPT_HASH,
    fixtures: { bank: bank.bank_version, cases: cases.cases_version, feedback: feedback?.feedback_cases_version ?? null },
    started_at: new Date().toISOString()
  }, null, 2));
  let finished = 0;
  await inBatches(pending.map(({ key, task }) => async () => {
    const record = await task(engine);
    appendFileSync(path.join(dir, "runs.jsonl"), `${JSON.stringify(record)}\n`);
    finished += 1;
    console.log(`[${finished}/${pending.length}] ${key} ${record.status}${record.reason ? ` (${record.reason})` : ""}`);
  }), Number(option("--concurrency") ?? (engine.kind === "live" ? 2 : 4)));
  return dir;
}

function score(runDir: string) {
  const { bank, cases, feedback } = loadFixtures();
  const records = readRecords(runDir);
  if (!records.length) throw new Error(`No runs.jsonl in ${runDir}.`);
  const interpretationRecords = records.filter((record): record is InterpretationRunRecord => record.kind === "interpretation");
  const feedbackRecords = records.filter((record): record is FeedbackRunRecord => record.kind === "feedback");
  const coderA = option("--coder-a");
  const coderB = option("--coder-b");
  const agreement = coderA && coderB
    ? coderAgreement(parseCodingSheet(readFileSync(coderA, "utf8")).rows, parseCodingSheet(readFileSync(coderB, "utf8")).rows)
    : null;
  const referencePath = option("--reference");
  let expectations = expectationsFromFixtures(cases);
  if (referencePath) {
    const parsed = parseCodingSheet(readFileSync(referencePath, "utf8"));
    if (parsed.problems.length) throw new Error(`Fix the reference coding first:\n- ${parsed.problems.join("\n- ")}`);
    expectations = expectationsFromReference(cases, parsed.rows);
  }
  const interpretation = interpretationRecords.length
    ? scoreInterpretation({
        bank, cases, expectations, records: interpretationRecords,
        standard: referencePath ? "human_reference" : "design_expectations",
        coder_agreement: agreement
      })
    : null;
  const feedbackReport = feedback && feedbackRecords.length ? scoreFeedback({ cases: feedback, records: feedbackRecords }) : null;
  const dir = option("--out") ? outDir("") : runDir;
  const engines = [...new Set(records.map((record) => record.engine))];
  const markdown = renderMarkdownReport({
    title: "Interpretation and feedback v8: evaluation report",
    generated_at: new Date().toISOString(),
    engine: engines.join(", "),
    model_names: [...new Set(records.map((record) => record.model_name))],
    prompt_hashes: { interpretation: INTERPRETATION_V8_PROMPT_HASH, feedback: FEEDBACK_V8_PROMPT_HASH },
    interpretation,
    feedback: feedbackReport
  });
  const suffix = referencePath ? "reference" : "design";
  writeFileSync(path.join(dir, `report-${suffix}.md`), markdown);
  writeFileSync(path.join(dir, `report-${suffix}.json`), JSON.stringify({ interpretation, feedback: feedbackReport, coder_agreement: agreement }, null, 2));
  if (interpretation) writeFileSync(path.join(dir, `mismatches-${suffix}.csv`), itemComparisonCsv(interpretation));
  if (feedback && feedbackRecords.length) writeFileSync(path.join(dir, "feedback-reading-sheet.csv"), buildFeedbackReadingSheet(feedback, feedbackRecords));
  const stale = records.filter((record) => record.prompt_hash !== (record.kind === "interpretation" ? INTERPRETATION_V8_PROMPT_HASH : FEEDBACK_V8_PROMPT_HASH));
  if (stale.length) console.warn(`${stale.length} runs used an earlier prompt; their results do not describe the current prompt.`);
  console.log(`Report: ${path.join(dir, `report-${suffix}.md`)}`);
  for (const entry of [...(interpretation?.criteria ?? []), ...(feedbackReport?.criteria ?? [])]) {
    console.log(`${entry.pass === null ? "n/a " : entry.pass ? "pass" : "FAIL"}  ${entry.name}: ${entry.value ?? "n/a"} (${entry.threshold})${entry.note ? ` - ${entry.note}` : ""}`);
  }
}

async function main() {
  switch (command) {
    case "check": {
      const { bank, cases, feedback, problems, paths } = loadFixtures();
      console.log(JSON.stringify({ fixtures: paths, ...fixtureSummary(bank, cases), feedback_cases: feedback?.cases.length ?? 0, problems }, null, 2));
      if (problems.length) process.exitCode = 1;
      return;
    }
    case "run": {
      const dir = await run();
      if (!flag("--no-score")) score(dir);
      return;
    }
    case "score": {
      const dir = option("--runs");
      if (!dir) throw new Error("Pass --runs <folder with runs.jsonl>.");
      score(path.resolve(dir));
      return;
    }
    case "coding-sheet": {
      const { bank, cases, problems } = loadFixtures();
      if (problems.length) throw new Error(`Fix the fixtures first:\n- ${problems.join("\n- ")}`);
      const dir = outDir(`coding-${stamp()}`);
      writeFileSync(path.join(dir, "coding-sheet.csv"), buildCodingSheet(bank, cases, Number(option("--seed") ?? 507)));
      writeFileSync(path.join(dir, "coding-instructions.txt"), CODING_INSTRUCTIONS);
      console.log(`Coding sheet: ${path.join(dir, "coding-sheet.csv")}`);
      return;
    }
    case "agreement": {
      const coderA = option("--coder-a");
      const coderB = option("--coder-b");
      if (!coderA || !coderB) throw new Error("Pass --coder-a and --coder-b.");
      const a = parseCodingSheet(readFileSync(coderA, "utf8"));
      const b = parseCodingSheet(readFileSync(coderB, "utf8"));
      const result = { problems: { coder_a: a.problems, coder_b: b.problems }, ...coderAgreement(a.rows, b.rows) };
      const dir = outDir(`agreement-${stamp()}`);
      writeFileSync(path.join(dir, "coder-agreement.json"), JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ paired_items: result.paired_items, explanation_quality: { ...result.fields.explanation_quality, disagreements: result.fields.explanation_quality.disagreements.length } }, null, 2));
      console.log(`Details: ${path.join(dir, "coder-agreement.json")}`);
      return;
    }
    case "import-items": {
      const from = option("--from")?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
      if (!from.length) throw new Error("Pass --from <mini-test JSON file>[,<file>...].");
      const ids = option("--topic-ids")?.split(",").map((entry) => entry.trim());
      const imported = importMiniTestFiles(from.map((file, index) => ({ name: path.basename(file), text: readFileSync(file, "utf8"), topic_id: ids?.[index] })), from.map((file) => path.basename(file)).join(", "));
      const shipped = EvaluationCaseFileSchema.parse(readJson(path.join(FIXTURES, "cases.json")));
      const template = caseTemplateForBank(imported.bank, shipped.situations, option("--students-per-topic") ? Number(option("--students-per-topic")) : undefined);
      const dir = outDir(`imported-${stamp()}`);
      writeFileSync(path.join(dir, "item-bank.json"), JSON.stringify(imported.bank, null, 1));
      writeFileSync(path.join(dir, "cases-template.json"), JSON.stringify(template, null, 1));
      writeFileSync(path.join(dir, "import-problems.txt"), [...imported.problems.map((entry) => `PROBLEM ${entry}`), ...imported.warnings.map((entry) => `warning ${entry}`)].join("\n"));
      console.log(JSON.stringify({
        topics: imported.bank.topics.map((topic) => ({ topic_id: topic.topic_id, title: topic.title, items: topic.items.length })),
        simulated_students_in_template: template.cases.length,
        item_responses_in_template: template.cases.reduce((sum, entry) => sum + entry.responses.length, 0),
        problems: imported.problems.length,
        warnings: imported.warnings.length,
        folder: dir
      }, null, 2));
      return;
    }
    case "hashes": {
      const [{ ITEM_PREPARATION_PROMPT_HASH }, { INSTRUCTOR_REPORT_V8_PROMPT_HASH }] = await Promise.all([
        import("../src/lib/services/content/item-preparation/contract"),
        import("../src/lib/services/instructor-report/contract")
      ]);
      console.log([
        "Approval hashes for the current prompts. Set each in the environment only after its evaluation passes.",
        `INTERPRETATION_V8_APPROVED_PROMPT_HASH=${INTERPRETATION_V8_PROMPT_HASH}`,
        `FORMATIVE_FEEDBACK_V8_APPROVED_PROMPT_HASH=${FEEDBACK_V8_PROMPT_HASH}`,
        `ITEM_PREPARATION_V8_APPROVED_PROMPT_HASH=${ITEM_PREPARATION_PROMPT_HASH}`,
        `INSTRUCTOR_REPORT_V8_APPROVED_PROMPT_HASH=${INSTRUCTOR_REPORT_V8_PROMPT_HASH}`
      ].join("\n"));
      return;
    }
    default:
      throw new Error(`Unknown command ${command}. Commands: check, run, score, coding-sheet, agreement, import-items, hashes.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
