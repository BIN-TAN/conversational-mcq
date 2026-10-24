/**
 * Release CMCQ-20261024-10: a small live check of the item preparation prompt, with no database.
 * The import page's "Suggest missing notes" (draft_or_adapt) and "Repair imported layout"
 * (format_imported) send this prompt live without the approval hash, so a new prompt version is
 * compared with the previous one before it ships. The item check (check) is gated and stays off;
 * it is run here only to see whether the planted overlap in item S4 is still reported.
 *
 * It runs each task once per topic of the evaluation item bank (3 topics, 12 items), records each
 * attempt in memory, and writes the results to --out. Run it once on the previous commit and once
 * on this one (copy this file into the older checkout; it imports only modules both have), then
 * compare the two summary.json files.
 *
 *   npx tsx prisma/item-preparation-v8-live-check.ts --allow-live --env-file <file> --runtime-env <json> --out <dir>
 *
 * Only the OpenAI key variables are taken from --env-file and only model settings from
 * --runtime-env (src/lib/evaluation/interpretation-v8/live-setup.ts). Nothing secret is printed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { keyVariablesFromEnvFile, modelSettingsFromRuntimeEnv } from "../src/lib/evaluation/interpretation-v8/live-setup";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/item_preparation_live_check";
process.env.SESSION_SECRET ??= "item-preparation-live-check-session-secret-0000000000";

type BankItem = {
  item_id: string;
  stem: string;
  options: Array<{ label: string; text: string }>;
  key: string;
  target_reasoning: string;
  essential_elements: string;
  rationales: Record<string, { rationale: string; idea_label: string | null }>;
};
type BankTopic = { topic_id: string; title: string; learning_objective: string | null; description: string | null; items: BankItem[] };

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
};

function essentialElements(text: string) {
  return text.split(/\s*\d\)\s*/).map((part) => part.trim()).filter(Boolean).slice(0, 3);
}

function importedText(item: BankItem) {
  // A plain layout like a pasted Word file: label, stem, lettered options and the key line.
  return [`${item.item_id}. ${item.stem}`, ...item.options.map((entry) => `${entry.label.toLowerCase()}) ${entry.text}`), `Answer: ${item.key}`].join("\n");
}

async function main() {
  if (!args.includes("--allow-live")) throw new Error("This check calls the model and costs money. Add --allow-live to confirm.");
  const out = option("--out");
  if (!out) throw new Error("Name the output folder with --out.");
  loadEnvConfig(process.cwd(), true);
  const envFile = option("--env-file");
  const runtimeEnvFile = option("--runtime-env");
  const keyVariables = envFile ? keyVariablesFromEnvFile(readFileSync(path.resolve(envFile), "utf8"), path.resolve(envFile)) : {};
  const modelSettings = runtimeEnvFile ? modelSettingsFromRuntimeEnv(JSON.parse(readFileSync(path.resolve(runtimeEnvFile), "utf8"))) : {};
  Object.assign(process.env, modelSettings, keyVariables, { LLM_PROVIDER: "openai", LLM_LIVE_CALLS_ENABLED: "true" });

  const { getLlmRuntimeConfig, resolveOpenAIModelConfigForRole } = await import("../src/lib/llm/config");
  const { createLlmProvider } = await import("../src/lib/llm/providers/provider-factory");
  const call = await import("../src/lib/services/content/item-preparation/call");
  const contract = await import("../src/lib/services/content/item-preparation/contract");
  const runtime = getLlmRuntimeConfig();
  if (runtime.provider !== "openai" || !runtime.live_calls_enabled || !runtime.openai_key_configured) {
    throw new Error("Live calls could not be switched on for this run.");
  }
  const provider = createLlmProvider();
  const bank = JSON.parse(readFileSync(path.join(process.cwd(), "src/lib/evaluation/interpretation-v8/fixtures/item-bank.json"), "utf8")) as { topics: BankTopic[] };

  const attempts: unknown[] = [];
  const recorder = {
    async start(entry: unknown) {
      attempts.push({ start: entry });
      return { id: `attempt-${attempts.length}`, public_id: null };
    },
    async finish(id: string, entry: { status: string; validation_error?: string | null; error_category?: string | null }) {
      attempts.push({ finish: id, status: entry.status, validation_error: entry.validation_error ?? null, error_category: entry.error_category ?? null });
    }
  };

  mkdirSync(out, { recursive: true });
  const runs: Array<Record<string, unknown>> = [];
  for (const topic of bank.topics) {
    for (const task of contract.ITEM_PREPARATION_TASKS) {
      const items = topic.items.map((item) => {
        const complete = task === "check";
        return {
          item_ref: item.item_id,
          item_label: item.item_id,
          stem: item.stem,
          options: item.options,
          confirmed_key: task === "format_imported" ? null : item.key,
          source_key: task === "format_imported" ? item.key : null,
          target_reasoning: complete ? item.target_reasoning : null,
          essential_elements: complete ? essentialElements(item.essential_elements) : [],
          distractor_rationales: complete
            ? Object.entries(item.rationales).map(([label, entry]) => ({ option_label: label, rationale: entry.rationale, idea_label: entry.idea_label ?? null }))
            : [],
          imported_text: task === "format_imported" ? importedText(item) : null
        };
      });
      const modelInput = {
        schema_version: contract.ITEM_PREPARATION_INPUT_VERSION,
        task,
        topic: { title: topic.title, learning_objective: topic.learning_objective, description: topic.description, diagnostic_focus: null },
        course_level: contract.ITEM_PREPARATION_DEFAULT_COURSE_LEVEL,
        items,
        source_material: null,
        requested_new_items: task === "draft_or_adapt" ? 1 : 0
      };
      const plan = call.planTeacherItemPreparation({
        task: "draft_or_adapt",
        mode: "live",
        override: { provider, provider_label: "openai", model_config: resolveOpenAIModelConfigForRole(call.ITEM_PREPARATION_ROLE_BY_TASK[task]) }
      });
      const started = Date.now();
      const result = await call.runItemPreparation({ model_input: modelInput as never, plan, invocation_key_base: `live-check:${topic.topic_id}:${task}`, recorder: recorder as never });
      const record: Record<string, unknown> = { topic: topic.topic_id, task, status: result.status, seconds: Math.round((Date.now() - started) / 1000) };
      if (result.status === "succeeded") {
        record.retry_count = result.retry_count;
        record.problems = result.result.problems.map((problem) => ({ item: problem.item_ref, code: problem.code, option: problem.option_label, message: problem.message }));
        record.items = result.result.items.map((item) => ({
          item: item.item_ref, key: item.key, key_status: item.key_status, stem: item.stem, options: item.options,
          target_reasoning: item.target_reasoning, essential_elements: item.essential_elements,
          rationales: item.distractor_rationales
        }));
        record.confirmed_key_changed = result.result.items
          .filter((item) => topic.items.some((source) => source.item_id === item.item_ref && task !== "format_imported" && item.key !== source.key))
          .map((item) => item.item_ref);
      } else {
        record.reason = result.reason;
      }
      runs.push(record);
      console.log(`${topic.topic_id} ${task}: ${result.status}`);
    }
  }

  const succeeded = runs.filter((run) => run.status === "succeeded");
  const problems = (run: Record<string, unknown>) => (run.problems as Array<{ item: string | null; code: string; option: string | null }> | undefined) ?? [];
  const s4 = runs.find((run) => run.topic === "S" && run.task === "check");
  const summary = {
    prompt_version: contract.ITEM_PREPARATION_PROMPT_VERSION,
    prompt_hash: contract.ITEM_PREPARATION_PROMPT_HASH,
    runs: runs.length,
    rejected_twice: runs.filter((run) => run.status === "failed").map((run) => `${run.topic} ${run.task}: ${run.reason}`),
    repaired_after_first_attempt: succeeded.filter((run) => Number(run.retry_count) > 0).map((run) => `${run.topic} ${run.task}`),
    wording_changed_in_format: runs.filter((run) => run.task === "format_imported").flatMap((run) => problems(run).filter((entry) => entry.code === "wording_changed").map((entry) => `${run.topic} ${entry.item}`)),
    confirmed_key_changed: succeeded.flatMap((run) => (run.confirmed_key_changed as string[]).map((item) => `${run.topic} ${run.task} ${item}`)),
    s4_check_problems: s4 ? problems(s4).filter((entry) => entry.item === "S4") : "not run",
    problem_codes: Object.fromEntries(contract.ITEM_PREPARATION_TASKS.map((task) => [task,
      runs.filter((run) => run.task === task).flatMap((run) => problems(run).map((entry) => entry.code)).sort()]))
  };
  writeFileSync(path.join(out, "runs.json"), `${JSON.stringify(runs, null, 2)}\n`);
  writeFileSync(path.join(out, "attempts.json"), `${JSON.stringify(attempts, null, 2)}\n`);
  writeFileSync(path.join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
