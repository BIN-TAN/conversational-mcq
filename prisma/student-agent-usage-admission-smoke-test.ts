import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createResponseCollectionFixture } from "./response-collection-smoke-fixture";
import { cleanupFollowupSmoke } from "./followup-smoke-fixture";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_"));
const db = new PrismaClient();
const prefix = `usage_admission_${randomUUID().replaceAll("-", "")}`;
const originalEnv = { ...process.env };
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("no_network_allowed"); };

async function main() {
  const { assertAgentCallUsageAllowed, LlmUsageBlockedError } = await import("../src/lib/llm/usage/agent-call-guard");
  const { prisma } = await import("../src/lib/db");
  try {
    const fixture = await createResponseCollectionFixture({ prisma: db, prefix, responseCollectionMode: "deterministic" });
    Object.assign(process.env, {
      LLM_PROVIDER: "openai", LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: "synthetic-usage-admission-not-a-real-key",
      LLM_DAILY_CLASS_CALL_LIMIT: "1000000", LLM_DAILY_CLASS_TOKEN_LIMIT: "1000000000",
      LLM_DAILY_STUDENT_CALL_LIMIT: "1000", LLM_DAILY_STUDENT_TOKEN_LIMIT: "1000000",
      LLM_SESSION_CALL_LIMIT: "1000", LLM_SESSION_TOKEN_LIMIT: "1000000",
      LLM_AGENT_CALL_LIMIT_PER_SESSION: "1", LLM_USAGE_TIMEZONE: "UTC",
      LLM_COST_WARNING_LIMIT_USD: "", LLM_COST_HARD_LIMIT_USD: ""
    });
    const createCall = (role: string, provider = "openai") => db.agentCall.create({ data: {
      assessment_session_db_id: fixture.session.id, agent_name: role, agent_version: "synthetic",
      model_name: "synthetic-model", provider, agent_invocation_key: `${prefix}_${randomUUID()}`,
      prompt_hash: "synthetic", prompt_version: "synthetic", schema_version: "synthetic",
      input_payload: { synthetic: true }, call_status: "started"
    } });
    for (const role of ["formative_conversation_agent", "profile_integration_agent", "formative_value_and_planning_agent"]) {
      const first = await createCall(role);
      await assertAgentCallUsageAllowed(first.id);
      assert.equal((await db.agentCall.findUniqueOrThrow({ where: { id: first.id } })).call_status, "started");
      const second = await createCall(role);
      await assert.rejects(assertAgentCallUsageAllowed(second.id), (error: unknown) => error instanceof LlmUsageBlockedError && error.reason === "agent_session_call_limit_exceeded");
      const blocked = await db.agentCall.findUniqueOrThrow({ where: { id: second.id } });
      assert.equal(blocked.call_status, "failed");
      assert.equal(blocked.live_call_allowed, false);
      assert.equal(blocked.provider_response_id, null);
      assert.equal(blocked.error_category, "usage_guard_blocked");
      assert(blocked.usage_guard_snapshot);
      await db.agentCall.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    }
    process.env.LLM_AGENT_CALL_LIMIT_PER_SESSION = "100";
    process.env.LLM_DAILY_STUDENT_TOKEN_LIMIT = "100";
    const consumed = await createCall("student_profiling_agent");
    await db.agentCall.update({ where: { id: consumed.id }, data: { call_status: "succeeded", input_tokens: 90, output_tokens: 10, total_tokens: 100, completed_at: new Date() } });
    const tutor = await createCall("formative_conversation_agent");
    await assert.rejects(assertAgentCallUsageAllowed(tutor.id), (error: unknown) => error instanceof LlmUsageBlockedError && error.reason === "student_daily_token_limit_exceeded");
    const mock = await createCall("formative_conversation_agent", "mock");
    await assertAgentCallUsageAllowed(mock.id);
    assert.equal(networkCalls, 0);
    console.log("PASS: tutoring, integration and planning share usage admission; own reservation excluded, other pending calls counted, cumulative student tokens enforced, no provider dispatch");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await db.agentCall.deleteMany({ where: { agent_invocation_key: { startsWith: prefix } } });
    await cleanupFollowupSmoke(db, prefix);
    await db.$disconnect();
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
