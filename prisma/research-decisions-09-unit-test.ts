/**
 * Release CMCQ-20261024-09: the eight decisions the researcher approved on 24 Oct.
 * Server side (this file): 2 tempting prompts (generator v5), 6 wait before feedback v8 attempt 2,
 * 7 the 6-minute v8 stale window (stale_reply_sweep_v2), 8 connection pool settings.
 * Client side (1, 3, 4, 5) is checked in the same file once merged.
 * No database or provider calls. Run with: npx tsx prisma/research-decisions-09-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { LlmProvider, StructuredAgentRequest, StructuredAgentResult } from "../src/lib/llm/providers/types";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

async function main() {
  const prompts = await import("../src/lib/student-assessment/initial-admin-prompts");
  await check("2. Tempting-option prompts ask for a choice only, and the generator is v5", () => {
    assert.equal(prompts.INITIAL_ADMIN_PROMPT_GENERATOR_VERSION, "initial-admin-prompt-generator-v5");
    const variants = new Set<string>();
    for (let order = 1; order <= 30; order += 1) {
      for (const selectedOption of ["A", "C", "E"]) {
        const prompt = prompts.buildInitialAdminPrompt({ kind: "tempting_option_prompt", assessmentState: "AWAIT_TEMPTING_OPTION", itemPublicId: `item_${order}`, itemOrder: order, selectedOption });
        variants.add(prompt.prompt_variant);
        assert.match(prompt.prompt_text, /If so, choose it\. If not, choose No\.$/);
        assert.doesNotMatch(prompt.prompt_text, /what made|which one|why/i);
      }
    }
    for (const variant of variants) assert.match(variant, /^tempting_(1|2|3|selected_e)$/, "Variant IDs are unchanged");
  });

  const runner = await import("../src/lib/services/student-assessment/feedback-v8/runner");
  const interpretation = await import("../src/lib/services/student-assessment/interpretation-v8/generate");
  await check("6. Feedback v8 waits before attempt 2 after a provider failure, by the interpretation rule", async () => {
    const run = async (fail: (attempt: number) => StructuredAgentResult<unknown> | "throw") => {
      let calls = 0;
      const waits: Array<{ ms: number; before_call: number }> = [];
      const provider: LlmProvider = {
        async executeStructured<TInput, TOutput>(request: StructuredAgentRequest<TInput, TOutput>) {
          calls += 1;
          const outcome = fail(calls);
          if (outcome === "throw") throw new Error("socket hang up");
          return { ...outcome, client_request_id: request.client_request_id } as StructuredAgentResult<TOutput>;
        }
      };
      await assert.rejects(runner.generateFeedbackV8({
        provider,
        model_config: { model: "mock" } as never,
        invocation_key: "test",
        context: { mode: "conversation" } as never,
        sleep: async (ms) => { waits.push({ ms, before_call: calls + 1 }); }
      }), runner.FeedbackV8ExecutionError);
      return { calls, waits };
    };
    const thrown = await run(() => "throw");
    assert.deepEqual(thrown, { calls: 2, waits: [{ ms: 3_000, before_call: 2 }] });
    const rateLimited = await run(() => ({
      provider: "mock", client_request_id: "", status: "failed", parsed_output: null, latency_ms: 1,
      error: { category: "rate_limit", retryable: true, message: "rate limited" },
      transport_telemetry: { retry_after_ms: 12_000 }
    }) as never);
    assert.deepEqual(rateLimited.waits, [{ ms: 12_000, before_call: 2 }]);
    assert.equal(interpretation.providerFailureBackoffMs(null), 3_000);
    const notRetryable = await run(() => ({
      provider: "mock", client_request_id: "", status: "failed", parsed_output: null, latency_ms: 1,
      error: { category: "invalid_request", retryable: false, message: "bad request" }
    }) as never);
    assert.deepEqual(notRetryable, { calls: 1, waits: [] }, "A non-retryable failure stops without waiting");
    const body = source("src/lib/services/student-assessment/feedback-v8/runner.ts");
    const invalidBranch = body.slice(body.indexOf("if (!parsed.success || issues.length) {"), body.indexOf("const completedAt"));
    assert(!invalidBranch.includes("waitBeforeNext"), "A regeneration after invalid output does not wait");
  });

  const projection = await import("../src/lib/services/student-assessment/formative-conversation/projection");
  await check("7. A v8 reply pending for 6 minutes is stale (policy v2); other conversations keep 15 minutes (v1)", () => {
    assert.equal(projection.FEEDBACK_V8_STALE_RESPONSE_MS, 6 * 60_000);
    assert.equal(projection.FORMATIVE_CONVERSATION_STALE_RESPONSE_MS, 15 * 60_000);
    assert.deepEqual(projection.STALE_REPLY_SWEEP_POLICY.feedback_v8, { threshold_ms: 6 * 60_000, policy: "stale_reply_sweep_v2" });
    assert.deepEqual(projection.STALE_REPLY_SWEEP_POLICY.legacy, { threshold_ms: 15 * 60_000, policy: "stale_reply_sweep_v1" });
    const now = new Date("2026-10-24T12:00:00Z");
    const receipt = (minutesAgo: number) => ({
      id: "r", client_message_id: "student-1", student_turn_db_id: "t1", assistant_turn_db_id: null,
      assistant_response_status: "pending", updated_at: new Date(now.getTime() - minutesAgo * 60_000)
    });
    assert.equal(projection.isStaleFormativeConversationResponse(receipt(7), now, projection.FEEDBACK_V8_STALE_RESPONSE_MS), true);
    assert.equal(projection.isStaleFormativeConversationResponse(receipt(5), now, projection.FEEDBACK_V8_STALE_RESPONSE_MS), false);
    assert.equal(projection.isStaleFormativeConversationResponse(receipt(7), now), false, "The default stays 15 minutes");
    const body = source("src/lib/services/student-assessment/formative-conversation/projection.ts");
    assert(body.includes("policy: sweep.policy"));
    assert(body.includes("updated_at: { lt: new Date(now.getTime() - sweep.threshold_ms) }"));
    assert(body.includes("updated_at: { lt: new Date(Date.now() - FEEDBACK_V8_STALE_RESPONSE_MS) }"), "The message gate defers to the full projection from 6 minutes");
    assert.match(source("src/lib/services/teacher-research-data/dictionary.ts"), /stale_reply_sweep_v2, from release CMCQ-20261024-09/);
  });

  const db = await import("../src/lib/db");
  await check("8. Connection pool settings are added only when set and not already in the connection string", () => {
    const base = "postgresql://user:secret@db.example:5432/app?sslmode=require";
    assert.equal(db.databaseUrlWithPoolSettings(base, {}), undefined, "Unset: Prisma defaults");
    const url = new URL(db.databaseUrlWithPoolSettings(base, { connection_limit: "10", pool_timeout_seconds: "20" })!);
    assert.equal(url.searchParams.get("connection_limit"), "10");
    assert.equal(url.searchParams.get("pool_timeout"), "20");
    assert.equal(url.searchParams.get("sslmode"), "require");
    assert.equal(url.password, "secret");
    assert.equal(db.databaseUrlWithPoolSettings(`${base}&connection_limit=3`, { connection_limit: "10" }), undefined, "A stated value wins");
    assert.equal(db.databaseUrlWithPoolSettings(base, { connection_limit: "0" }), undefined);
    assert.equal(db.databaseUrlWithPoolSettings(base, { connection_limit: "ten" }), undefined);
    assert.equal(db.databaseUrlWithPoolSettings("not a url", { connection_limit: "10" }), undefined);
    const start = source("scripts/start-app.mjs");
    assert(start.includes("DATABASE_CONNECTION_LIMIT: process.env.PREPARATION_WORKER_DATABASE_CONNECTION_LIMIT"));
    const render = source("render.yaml");
    for (const [key, value] of [["DATABASE_CONNECTION_LIMIT", "10"], ["PREPARATION_WORKER_DATABASE_CONNECTION_LIMIT", "8"], ["DATABASE_POOL_TIMEOUT_SECONDS", "20"]]) {
      assert.match(render, new RegExp(`- key: ${key}\\n\\s+value: "${value}"`));
    }
    assert.match(render, /^\s*plan: basic-1gb\s*$/m);
    assert(!source("src/lib/db.ts").includes("console."), "The connection string is never logged");
  });

  console.log(`\n${passed} research-decision checks passed; no database or provider calls.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
