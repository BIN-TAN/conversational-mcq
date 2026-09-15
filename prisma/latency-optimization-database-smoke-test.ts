import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createResponseCollectionFixture, cleanupResponseCollectionFixture } from "./response-collection-smoke-fixture";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { prepareAssessmentContext, preparePublishedAssessmentContext } from "../src/lib/services/content/prepared-assessment-context";
import { buildAbilityEvidencePacketForSession } from "../src/lib/services/student-assessment/ability-evidence";
import { buildEngagementEvidencePacketForSession } from "../src/lib/services/student-assessment/engagement-evidence";
import { buildProfileIntegrationAgentInput, callProfileIntegrationAgent, executeProfileIntegrationAgentWithProviderForTest } from "../src/lib/services/student-assessment/profile-integration";
import type { LlmProvider } from "../src/lib/llm/providers/types";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_"));
assert.equal(process.env.LLM_PROVIDER, "mock");
assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
assert(!process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY_FILE);
globalThis.fetch = async () => { throw new Error("network_not_allowed"); };
const prefix = `latency_${randomUUID().replaceAll("-", "")}`;
const results: string[] = [];
const pass = (name: string) => { results.push(name); console.log(`PASS ${name}`); };

async function main() {
  const fixture = await createResponseCollectionFixture({ prisma, prefix, responseCollectionMode: "deterministic" });
  await prisma.itemResponse.createMany({ data: fixture.items.map((item) => ({
    concept_unit_session_db_id: fixture.conceptUnitSession.id, item_db_id: item.id,
    selected_option: "A", correct_option_snapshot: "A", correctness: "correct" as const,
    reasoning_text: "Consider context before interpreting the evidence.", confidence_rating: "medium" as const,
    item_submitted_at: new Date(), item_version_snapshot: 1, item_snapshot: JSON.parse(JSON.stringify(item))
  })) });
  await prisma.$transaction((tx) => preparePublishedAssessmentContext(tx, fixture.conceptUnit.id));
  const warmed = await prisma.conceptUnit.findUniqueOrThrow({ where: { id: fixture.conceptUnit.id } });
  const source = { ...warmed, assessment_public_id: fixture.assessment.assessment_public_id,
    diagnostic_focus: fixture.assessment.diagnostic_focus, items: fixture.items.map((item) => ({ ...item, media_assets: [] })) };
  assert(prepareAssessmentContext(source, warmed.prepared_response_context).cache_hit);
  const response = await createResponsePackage({ concept_unit_session_db_id: fixture.conceptUnitSession.id });
  const payload = response.payload as Record<string, unknown>;
  assert.deepEqual(payload.included_items, prepareAssessmentContext(source).content.included_items);
  assert(!JSON.stringify(warmed.prepared_response_context).includes(fixture.student.user_id));
  assert(!JSON.stringify(warmed.prepared_response_context).includes("Consider context before"));
  pass("published context survives PostgreSQL storage and produces the same response evidence without caching student data");
  const original = JSON.stringify(response.payload);
  // Synthetic authoring mutation verifies invalidation without changing the saved package.
  await prisma.item.update({ where: { id: fixture.items[0].id }, data: { item_stem: "Revised synthetic stem" } });
  await createResponsePackage({ concept_unit_session_db_id: fixture.conceptUnitSession.id });
  const revised = await prisma.conceptUnit.findUniqueOrThrow({ where: { id: fixture.conceptUnit.id } });
  assert.notDeepEqual(revised.prepared_response_context, warmed.prepared_response_context);
  assert.equal(JSON.stringify((await prisma.responsePackage.findUniqueOrThrow({ where: { id: response.id } })).payload), original);
  pass("changed authoring content invalidates the cache without mutating historical response packages");

  const agentInput = buildProfileIntegrationAgentInput({
    ability_packet: await buildAbilityEvidencePacketForSession(fixture.session.session_public_id),
    engagement_packet: await buildEngagementEvidencePacketForSession(fixture.session.session_public_id)
  });
  const output = await callProfileIntegrationAgent(agentInput);
  let mockCalls = 0;
  const provider: LlmProvider = { executeStructured: async <TInput, TOutput>(request: import("../src/lib/llm/providers/types").StructuredAgentRequest<TInput, TOutput>) => {
    mockCalls++;
    return { provider: "mock", status: "completed", client_request_id: request.client_request_id, parsed_output: output as TOutput, latency_ms: 1 };
  } };
  const input = { agent_input: agentInput, provider, audit_context: {
    assessment_session_db_id: fixture.session.id, concept_unit_session_db_id: fixture.conceptUnitSession.id
  } };
  const first = await executeProfileIntegrationAgentWithProviderForTest(input);
  assert.equal(first.status, "succeeded");
  const replay = await executeProfileIntegrationAgentWithProviderForTest(input);
  assert.equal(replay.status, "succeeded");
  assert.equal(first.agent_call_id, replay.agent_call_id);
  assert.equal(mockCalls, 1);
  pass("a saved validated integration receipt is reused after a persistence interruption");
  await executeProfileIntegrationAgentWithProviderForTest({ ...input, model_config: { model_name: "mock-other-model", max_output_tokens: 3000 } });
  assert.equal(mockCalls, 2);
  await prisma.agentCall.update({ where: { id: first.agent_call_id! }, data: { output_validated: false } });
  await executeProfileIntegrationAgentWithProviderForTest(input);
  assert.equal(mockCalls, 3);
  const changedInput = structuredClone(agentInput);
  changedInput.session_context.session_public_id += "-different-source";
  await executeProfileIntegrationAgentWithProviderForTest({ ...input, agent_input: changedInput });
  assert(mockCalls > 3);
  pass("model changes, unvalidated output, and changed evidence never reuse a prior receipt");
  console.log(JSON.stringify({ passed: results.length, external_provider_calls: 0, model_auth_requests: 0 }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await cleanupResponseCollectionFixture(prisma, prefix);
  await prisma.$disconnect();
});
