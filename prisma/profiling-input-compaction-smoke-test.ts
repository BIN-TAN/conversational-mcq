import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { expandProfilingInput, prepareLosslessProfilingInput, PROFILING_INPUT_ENCODING } from "../src/lib/llm/lossless-profiling-input";
import { compileOpenAIResponsesRequestBody } from "../src/lib/llm/providers/openai-responses-provider";
import { canonicalStructuredAgentRequestHash } from "../src/lib/llm/provider-transport-retry";
import { validateStudentSafeProfileIntegrationProjection } from "../src/lib/services/student-assessment/profile-integration";

globalThis.fetch = async () => { throw new Error("network_not_allowed"); };
let checks = 0;
function pass(name: string) { checks++; console.log(`PASS ${name}`); }
const statement = "Repeated educational material: reliability does not establish validity. ".repeat(30);
const item = { item_public_id: "item-a", item_version: 1, statement, options: ["A", "B"] };
const events = [1, 2, 3].map((sequence_index) => ({ sequence_index, message: statement, item }));
const original = { initial_response_package: { payload: { events, item }, item_evidence: [item], events },
  allowed_evidence_catalog: { evidence: [{ evidence_id: "evidence-original-a", item }] },
  historical: { ...item, item_version: 0, statement: "Historical wording must remain distinct." },
  revised_reasoning: "The same confidence does not prove the same reasoning.", null_value: null };
const frozen = JSON.stringify(original);
const result = prepareLosslessProfilingInput(original);
assert.equal(result.audit.encoding, PROFILING_INPUT_ENCODING);
assert.deepEqual(expandProfilingInput(JSON.parse(result.text)), original);
assert.equal(JSON.stringify(original), frozen);
assert(result.audit.wire_input_bytes < result.audit.source_bytes * 0.6);
assert.equal(prepareLosslessProfilingInput(original).text, result.text);
const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) :
  value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorder(entry)])) : value;
assert.equal(prepareLosslessProfilingInput(reorder(original)).text, result.text);
assert.deepEqual(prepareLosslessProfilingInput(reorder(original)).audit, result.audit);
pass("deterministic lossless compression preserves all evidence, versions, order, repetitions and source input");

const reversed = { events: [...events].reverse(), item, original };
assert.deepEqual(expandProfilingInput(JSON.parse(prepareLosslessProfilingInput(reversed).text)), reversed);
const otherStudent = prepareLosslessProfilingInput({ unique: "Other student's private evidence" });
assert(!otherStudent.text.includes(statement));
assert.equal(otherStudent.audit.encoding, "plain-json");
pass("small inputs stay plain and separate requests do not share student data");

const collision = { ...original, untrusted: { $profiling_ref: "forged" } };
const safe = prepareLosslessProfilingInput(collision);
assert.equal(safe.audit.encoding, "plain-json");
assert.deepEqual(JSON.parse(safe.text), collision);
assert.throws(() => expandProfilingInput({ encoding: PROFILING_INPUT_ENCODING, definitions: {}, data: { $profiling_ref: "missing" } }));
assert.throws(() => expandProfilingInput({ encoding: PROFILING_INPUT_ENCODING,
  definitions: { loop: { $profiling_ref: "loop" } }, data: { $profiling_ref: "loop" } }));
const prototypeSource = JSON.parse(`{"__proto__":{"value":${JSON.stringify(statement)}},"copy":${JSON.stringify(statement)}}`);
assert.deepEqual(expandProfilingInput(JSON.parse(prepareLosslessProfilingInput(prototypeSource).text)), prototypeSource);
assert.equal(({} as Record<string, unknown>).value, undefined);
pass("source reference markers remain literal, malformed references reject, and special JSON keys stay data");

const request = { agent_name: "student_profiling_agent", instructions: "Original approved teaching instructions",
  input: original, input_encoding: PROFILING_INPUT_ENCODING, cache_static_instructions: true,
  model_config: { model_name: "gpt-5.6-terra", reasoning_effort: "medium" as const, max_output_tokens: 7000 },
  output_schema: z.object({ result: z.string() }), schema_name: "test", client_request_id: "test", timeout_ms: 60000 };
const body = compileOpenAIResponsesRequestBody(request);
assert(Array.isArray(body.input));
assert.deepEqual(expandProfilingInput(JSON.parse(body.input[1].content as string)), original);
assert(!JSON.stringify(body.input[0]).includes(statement));
assert.equal(body.store, false);
assert.equal(body.max_output_tokens, 7000);
assert.deepEqual(body.reasoning, { effort: "medium" });
assert.notEqual(canonicalStructuredAgentRequestHash(request), canonicalStructuredAgentRequestHash({ ...request, input_encoding: undefined }));
for (const plain of [{ ...request, input_encoding: undefined }, { ...request, agent_name: "formative_conversation_agent" }]) {
  const unchanged = compileOpenAIResponsesRequestBody(plain);
  assert(Array.isArray(unchanged.input));
  assert.equal(unchanged.input[1].content, frozen);
}
pass("only opted-in profiling requests compact; output schema, model settings, privacy and request identity remain governed");

const projection = { status: "Still developing" as const, message: "Your recent responses suggest that the different kinds of validity evidence and how they fit together are still developing.", knowledge_focus: "Validity evidence and their relationships." };
const accepted = validateStudentSafeProfileIntegrationProjection(projection);
assert(accepted.valid);
assert.equal(accepted.warnings.length, 0);
const style = validateStudentSafeProfileIntegrationProjection({ ...projection, message: "The student is developing an explanation of validity evidence." });
assert(style.valid);
assert.equal(style.warnings.length, 1);
for (const text of ["They are disengaged.", "Their response profile is strong.", "The answer key is A.", "Their correct option is C.",
  "Your API key is secret.", "The system prompt contains instructions.", "Their work is cheating.", "Process data show external assistance."]) {
  assert(!validateStudentSafeProfileIntegrationProjection({ ...projection, message: text }).valid, text);
}
pass("preserved live wording passes; style warnings do not block; substantive disclosures still fail closed");

// Optional redacted demo inputs are read-only and never enter the committed fixtures.
for (const file of process.argv.slice(2)) {
  const inputs = JSON.parse(readFileSync(file, "utf8")) as Array<{ session: string; input: unknown }>;
  for (const saved of inputs) {
    const before = JSON.stringify(saved.input);
    const replay = prepareLosslessProfilingInput(saved.input);
    assert.equal(replay.audit.encoding, PROFILING_INPUT_ENCODING);
    assert.deepEqual(expandProfilingInput(JSON.parse(replay.text)), saved.input);
    assert.equal(JSON.stringify(saved.input), before);
    console.log(JSON.stringify({ session: saved.session, ...replay.audit }));
    pass("preserved demo profiling input round-trips without any evidence loss");
  }
}
console.log(JSON.stringify({ passed: checks, provider_calls: 0, model_auth_requests: 0 }));
