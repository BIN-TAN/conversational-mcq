import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildSourceQuoteRepairInput, executeWithSourceQuoteRepair, sourceQuoteRepairInputMatches,
  sourceQuoteRepairInvocationKey, sourceQuoteRepairIssues, FORMATIVE_PROFILE_QUOTE_REPAIR_VERSION } from "../src/lib/services/student-assessment/formative-profile-quote-repair";
import { validateSemanticItemReviews } from "../src/lib/services/student-assessment/semantic-item-review";

let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${name}`); };
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("network_forbidden_in_quote_repair_smoke"); };
const messages = ["semantic_item_review_quote_mismatch:item_synthetic", "semantic_item_review_interpretation_quote_mismatch:item_synthetic"];
const failure = (values = messages) => JSON.stringify({ category: "student_facing_validation", issue_count: values.length,
  issues: values.map(message => ({ field_path: "semantic_item_reviews", rule_code: "semantic_item_evidence_invalid", message })) });
const original = { task: "synthetic_quote_repair_test", response_package: { item_responses: [{
  item_public_id: "item_synthetic", reasoning_text_final: "Consistency alone does not establish validity for a particular hiring interpretation; relevant job-performance evidence is needed."
}] }, constraints: { app_controls_state_transitions: true } };

async function main() {
  check("only the two exact quote failure prefixes qualify", () => assert.deepEqual(sourceQuoteRepairIssues(failure()), messages));
  for (const invalid of [null, "invalid", failure([]), failure(["semantic_item_review_claim_quote_mismatch:item_synthetic"]),
    failure([...messages, "semantic_item_review_coverage_mismatch"]), failure([messages[0] + " invented text"]),
    failure().replace("student_facing_validation", "schema_validation"), failure().replace('"issue_count":2', '"issue_count":1')]) {
    check("unrelated or malformed failures do not qualify", () => assert.equal(sourceQuoteRepairIssues(invalid), null));
  }
  check("sealed inputs ignore only audit budget metadata", () => {
    assert(sourceQuoteRepairInputMatches({ ...original, runtime_budget: { cap: 3000 } }, original));
    assert(!sourceQuoteRepairInputMatches(original, { ...original, task: "changed" }));
    const changed = structuredClone(original); changed.response_package.item_responses[0].reasoning_text_final += " changed";
    assert(!sourceQuoteRepairInputMatches(original, changed));
  });
  const repaired = buildSourceQuoteRepairInput(original, "synthetic-original-call", messages);
  check("repair keeps the exact source and adds an explicit one-attempt instruction", () => {
    assert.deepEqual((repaired as Record<string, unknown>).response_package, original.response_package);
    assert.equal(repaired.constraints.source_quote_repair.policy_version, FORMATIVE_PROFILE_QUOTE_REPAIR_VERSION);
    assert.equal(repaired.constraints.source_quote_repair.maximum_regenerations, 1);
    assert.equal(repaired.constraints.source_quote_repair.original_agent_call_id, "synthetic-original-call");
    assert.equal(sourceQuoteRepairInvocationKey("original"), "original:source-quote-repair:1");
    assert(!("source_quote_repair" in original.constraints));
  });
  const source = original.response_package.item_responses[0].reasoning_text_final;
  const review = { item_public_id: "item_synthetic", reasoning_judgment: "supported_precise", reasoning_quote: source,
    explanation: "The explanation distinguishes consistency from interpretation validity.", misconceptions: [],
    interpretation_version: "semantic-item-review-v3", interpretations: [{ interpretation_id: "synthetic-interpretation",
      source_field: "reasoning", student_quote: source, proposition: "Consistency alone does not establish validity.",
      stance: "endorsed", basis: "student_explanation", correctness: "supported", scope: "specific_proposition",
      option_reference: null, rationale: "The submitted reasoning makes the distinction explicitly." }] };
  check("the real validator still rejects paraphrases and accepts the unchanged source quote", () => {
    assert(validateSemanticItemReviews(original.response_package, [review], true).valid);
    const bad = structuredClone(review);
    bad.reasoning_quote = bad.reasoning_quote.replace("for a particular hiring interpretation", "for the intended hiring decision");
    bad.interpretations[0].student_quote = bad.reasoning_quote;
    assert.deepEqual(validateSemanticItemReviews(original.response_package, [bad], true).issues, messages);
  });

  let retained: { id: string } | null = null;
  let originalCalls = 0, repairCalls = 0;
  let repairResult: { agent_call_id: string } | null = null;
  const effects = {
    readRejected: async () => retained,
    executeOriginal: async () => { originalCalls++; retained = { id: "original" }; return { agent_call_id: "original" }; },
    executeRepair: async () => { if (!repairResult) { repairCalls++; repairResult = { agent_call_id: "repair" }; } return repairResult; }
  };
  assert.equal((await executeWithSourceQuoteRepair(effects)).agent_call_id, "repair");
  assert.equal(originalCalls, 1); assert.equal(repairCalls, 1); checks++;
  assert.equal((await executeWithSourceQuoteRepair(effects)).agent_call_id, "repair");
  assert.equal(originalCalls, 1); assert.equal(repairCalls, 1); checks++;
  // A rejected original persisted before the process stopped resumes at repair.
  repairResult = null; repairCalls = 0;
  await executeWithSourceQuoteRepair(effects);
  assert.equal(originalCalls, 1); assert.equal(repairCalls, 1); checks++;
  let rejectedRepairCalls = 0;
  const failed = { ...effects, executeRepair: async () => {
    if (rejectedRepairCalls === 0) rejectedRepairCalls++;
    throw new Error("retained_failed_repair_requires_review");
  } };
  await assert.rejects(executeWithSourceQuoteRepair(failed), /requires_review/);
  await assert.rejects(executeWithSourceQuoteRepair(failed), /requires_review/);
  assert.equal(rejectedRepairCalls, 1); assert.equal(originalCalls, 1); checks++;
  await assert.rejects(executeWithSourceQuoteRepair({ ...effects, executeRepair: async () => { throw new Error("usage_blocked"); } }), /usage_blocked/);
  assert.equal(originalCalls, 1); checks++;
  let forbiddenRepair = 0;
  const untouched = await executeWithSourceQuoteRepair({ readRejected: async () => null,
    executeOriginal: async () => ({ agent_call_id: "non_quote_failure" }),
    executeRepair: async () => { forbiddenRepair++; throw new Error("must_not_run"); } });
  assert.equal(untouched.agent_call_id, "non_quote_failure"); assert.equal(forbiddenRepair, 0); checks++;
  let reads = 0, raceRepairs = 0;
  const race = await executeWithSourceQuoteRepair({ readRejected: async () => ++reads === 1 ? null : { id: "concurrently_rejected" },
    executeOriginal: async (): Promise<{ agent_call_id: string }> => { throw new Error("existing_call_requires_review"); },
    executeRepair: async () => { raceRepairs++; return { agent_call_id: "one_repair" }; } });
  assert.equal(race.agent_call_id, "one_repair"); assert.equal(raceRepairs, 1); checks++;
  await assert.rejects(executeWithSourceQuoteRepair({ readRejected: async () => null,
    executeOriginal: async (): Promise<{ agent_call_id: string }> => { throw new Error("non_quote_failure"); },
    executeRepair: async () => { throw new Error("must_not_run"); } }), /non_quote_failure/); checks++;

  if (process.argv.includes("--database")) await databaseChecks();
  assert.equal(networkCalls, 0);
  console.log(JSON.stringify({ status: "passed", checks, network_calls: networkCalls, synthetic_only: true,
    database_integration: process.argv.includes("--database") }));
}

async function databaseChecks() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  assert(url.pathname === "/conversational_mcq_windows_test" || url.pathname.startsWith("/conversational_mcq_classroom_audit_"));
  assert.equal(process.env.LLM_PROVIDER, "mock"); assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
  const { prisma } = await import("../src/lib/db");
  const { reserveFormativeCallAttempt } = await import("../src/lib/services/student-assessment/formative-call-attempts");
  const { createResponseCollectionFixture, cleanupResponseCollectionFixture } = await import("./response-collection-smoke-fixture");
  const { cleanupSmokeStudentSessions } = await import("./student-mvp-smoke-helpers");
  const prefix = `quote_repair_${randomUUID().replaceAll("-", "")}`;
  const fixture = await createResponseCollectionFixture({ prisma, prefix, responseCollectionMode: "deterministic" });
  try {
    const data = { assessment_session_db_id: fixture.session.id, concept_unit_session_db_id: fixture.conceptUnitSession.id,
      agent_name: "formative_value_and_planning_agent", agent_version: "synthetic-quote-repair-v1", model_name: "mock",
      provider: "mock", agent_invocation_key: `quote-repair-${randomUUID()}`, prompt_version: "synthetic-v1",
      schema_version: "synthetic-v1", input_payload: original, call_status: "started" as const };
    const first = await reserveFormativeCallAttempt(data);
    await prisma.agentCall.update({ where: { id: first.call.id }, data: { call_status: "invalid_output",
      error_category: "student_facing_validation", validation_error: failure(), raw_output: { synthetic: "retained original" },
      input_tokens: 11, output_tokens: 7, total_tokens: 18, output_validated: false } });
    const before = await prisma.agentCall.findUniqueOrThrow({ where: { id: first.call.id } });
    const racedOriginal = await reserveFormativeCallAttempt(data, { retryFailed: prior => !sourceQuoteRepairIssues(prior.validation_error) });
    assert.equal(racedOriginal.created, false); assert.equal(racedOriginal.call.id, first.call.id); checks++;
    const repairData = { ...data, agent_invocation_key: sourceQuoteRepairInvocationKey(data.agent_invocation_key),
      input_payload: buildSourceQuoteRepairInput(original, first.call.id, messages) };
    const reservations = await Promise.all(Array.from({ length: 4 }, () => reserveFormativeCallAttempt(repairData, { retryFailed: false })));
    assert.equal(reservations.filter(value => value.created).length, 1);
    assert.equal(new Set(reservations.map(value => value.call.id)).size, 1); checks++;
    const repair = reservations[0].call;
    await prisma.agentCall.update({ where: { id: repair.id }, data: { call_status: "invalid_output", validation_error: failure() } });
    for (let index = 0; index < 3; index++) {
      const replay = await reserveFormativeCallAttempt(repairData, { retryFailed: false });
      assert.equal(replay.created, false); assert.equal(replay.call.id, repair.id);
    }
    assert.equal(await prisma.agentCall.count({ where: { assessment_session_db_id: fixture.session.id } }), 2); checks++;
    assert.deepEqual(await prisma.agentCall.findUniqueOrThrow({ where: { id: first.call.id } }), before); checks++;
    await prisma.agentCall.update({ where: { id: repair.id }, data: { call_status: "succeeded", output_validated: true } });
    const successReplay = await reserveFormativeCallAttempt(repairData, { retryFailed: false });
    assert.equal(successReplay.created, false); assert.equal(successReplay.call.id, repair.id); checks++;
    const ordinaryRetry = await reserveFormativeCallAttempt(data);
    assert.equal(ordinaryRetry.created, true); assert(ordinaryRetry.call.agent_invocation_key?.endsWith(":retry:00000001")); checks++;
  } finally {
    await cleanupSmokeStudentSessions({ prisma, userDbId: fixture.student.id, sessionPublicIds: [fixture.session.session_public_id] });
    await cleanupResponseCollectionFixture(prisma, prefix);
    await prisma.$disconnect();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
