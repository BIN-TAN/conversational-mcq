import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { FormativeConversationV18R2AgentInputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";

async function main() {
  const option = (name: string) => process.argv[process.argv.indexOf(name) + 1];
  assert(process.argv.includes("--allow-live-synthetic") && process.argv.includes("--runtime-env")
    && process.argv.includes("--report") && process.argv.includes("--case"));
  const reportPath = path.resolve(option("--report"));
  const source = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(source.synthetic_only, true);
  const id = option("--case");
  assert(source.results.some((row: { case_id: string; outcome: string }) => row.case_id === id && row.outcome === "failed"));
  assert(/^[a-z0-9_]+$/.test(id));
  const calls = JSON.parse(readFileSync(path.join(path.dirname(reportPath), `${id}-agent-calls.json`), "utf8"));
  const failed = calls.find((row: { agent_name: string; error_category: string }) =>
    row.agent_name === "formative_conversation_agent" && row.error_category === "semantic_regeneration_exhausted");
  assert(failed, "Only an observed synthetic semantic failure can be replayed.");
  const context = FormativeConversationV18R2AgentInputSchema.parse(failed.input_payload);
  loadEnvConfig(process.cwd(), true);
  const runtime = JSON.parse(readFileSync(option("--runtime-env"), "utf8")) as Record<string, string>;
  for (const [key, value] of Object.entries(runtime)) {
    if (/^(OPENAI_(MODEL_|REASONING_EFFORT_|MAX_OUTPUT_TOKENS_|REQUEST_TIMEOUT_MS$|MAX_RETRIES$)|OPERATIONAL_|FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED$)/.test(key)) process.env[key] = value;
  }
  Object.assign(process.env, { NODE_ENV: "production", APP_ENV: "development", LLM_PROVIDER: "openai", LLM_LIVE_CALLS_ENABLED: "true", FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "true" });
  const { createLiveFormativeConversationV18R2AgentRunner, FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH } = await import("../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2");
  const root = `.data/conversation-failed-replays/${randomUUID()}`;
  mkdirSync(root, { recursive: true });
  const report = { source_report: reportPath, source_case: id, synthetic_only: true,
    prompt_hash: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
    context_sha256: createHash("sha256").update(JSON.stringify(context)).digest("hex"),
    results: [] as Record<string, unknown>[] };
  for (let trial = 1; trial <= 3; trial++) {
    try {
      const execution = await createLiveFormativeConversationV18R2AgentRunner().execute({
        agent_call_db_id: `synthetic-unpersisted-${randomUUID()}`,
        invocation_key: `synthetic-failure-replay:${randomUUID()}`, context: structuredClone(context)
      });
      report.results.push({ trial, status: "passed_requires_teaching_review", execution });
    } catch (error) {
      report.results.push({ trial, status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
    writeFileSync(`${root}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ trial, status: report.results.at(-1)!.status }));
  }
  console.log(JSON.stringify({ root }));
  process.exitCode = report.results.every(row => row.status === "passed_requires_teaching_review") ? 0 : 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
