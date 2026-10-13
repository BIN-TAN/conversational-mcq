import assert from "node:assert/strict";
import Ajv from "ajv";
import type { AgentInputByName } from "../src/lib/agents/contracts";
import { ProductionStudentProfileOutputV5 } from "../src/lib/agents/contracts";
import { buildProductionAgentRequest, compileProductionAgentRequest } from "../src/lib/agents/provider-request";
import { studentProfileSealedCorrectness } from "../src/lib/agents/student-profiling/semantic-validation";
import { STUDENT_PROFILE_REQUEST_SCHEMA_VERSION } from "../src/lib/agents/student-profiling/output-schema";

let checks = 0;
globalThis.fetch = async () => { throw new Error("No provider/network calls in request-schema smoke"); };
type Input = AgentInputByName["student_profiling_agent"];
function input(correctness: Array<string | null | undefined> = ["incorrect"]): Input {
  return { profile_type: "initial", concept_unit_metadata: {}, profiling_constraints: {},
    initial_response_package: { payload: { item_responses: correctness.map((value, index) => ({
      item_public_id: `synthetic_${index}`, ...(value !== undefined ? { correctness: value } : {})
    })) } }, followup_evidence_package: null, previous_profile: null };
}
function request(value: Input) {
  return { agent_name: "student_profiling_agent" as const, model_config: { model_name: "gpt-5.6-luna", reasoning_effort: "medium" as const,
    max_output_tokens: 4000 }, input: value, client_request_id: "synthetic-profile-schema", timeout_ms: 60000 };
}
const ajv = new Ajv({ allErrors: true });
type SchemaNode = { type?: string; anyOf?: SchemaNode[]; minItems?: number; maxItems?: number;
  additionalProperties?: boolean; required?: string[]; properties?: Record<string, SchemaNode> };
function compile(value: Input) {
  const before = JSON.stringify(value);
  const body = compileProductionAgentRequest(request(value));
  const schema = body.text.format.schema as SchemaNode & { required: string[]; properties: Record<string, SchemaNode> };
  assert.equal(JSON.stringify(value), before, "Compilation never mutates sealed input");
  assert.equal(schema.type, "object"); assert.equal(schema.anyOf, undefined);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  assert.equal(body.text.format.strict, true); assert.equal(body.model, "gpt-5.6-luna");
  assert.equal(body.max_output_tokens, 4000); assert.deepEqual(body.reasoning, { effort: "medium" });
  const production = buildProductionAgentRequest(request(value));
  assert.equal(production.metadata?.request_schema_guard, STUDENT_PROFILE_REQUEST_SCHEMA_VERSION);
  checks++;
  return { schema, ability: ajv.compile(schema.properties.ability_pattern_flags),
    engagement: ajv.compile(schema.properties.engagement_pattern_flags), production };
}
const zero = compile(input());
assert(Array.isArray(zero.schema.properties.ability_pattern_flags.anyOf));
assert(Array.isArray(zero.schema.properties.engagement_pattern_flags.anyOf));
assert.equal(zero.schema.properties.ability_pattern_flags.anyOf[0].minItems, 1);
assert.equal(zero.schema.properties.ability_pattern_flags.anyOf[0].maxItems, 1);
checks++;
for (const [validate, specific] of [[zero.ability, "misconception_indicator_present"], [zero.engagement, "sustained_engagement"]] as const) {
  assert.equal(validate(["no_clear_pattern", specific]), false);
  assert.equal(validate([specific, "no_clear_pattern"]), false);
  assert.equal(validate(["no_clear_pattern", "no_clear_pattern"]), false);
  assert.equal(validate(["no_clear_pattern"]), true);
  assert.equal(validate([]), true);
  assert.equal(validate([specific]), true);
  checks += 6;
}
assert.equal(zero.ability(["correct_answer_weak_reasoning"]), false); checks++;
assert.equal(zero.ability(["misconception_indicator_present", "distractor_aligned_reasoning"]), true);
assert.equal(zero.engagement(["sustained_engagement", "productive_struggle"]), true);
assert.equal(buildProductionAgentRequest({ ...request(input()), metadata: { request_schema_guard: "misleading-caller-version" } })
  .metadata?.request_schema_guard, STUDENT_PROFILE_REQUEST_SCHEMA_VERSION); checks += 3;
for (const values of [["correct"], ["correct", "incorrect"], [null], [undefined], ["unrecognized"], [], ["incorrect", null]] as const) {
  const current = input([...values]);
  assert.equal(studentProfileSealedCorrectness(current).all_known_incorrect, false);
  assert.equal(compile(current).ability(["correct_answer_weak_reasoning"]), true); checks++;
}
const authoritativeNull = input([null]);
authoritativeNull.initial_response_package.item_evidence = [{ item_public_id: "synthetic_0", response: { correctness: "incorrect" } }];
assert.equal(compile(authoritativeNull).ability(["correct_answer_weak_reasoning"]), true); checks++;
const normalizedWrong = input([" INCORRECT "]);
assert.equal(compile(normalizedWrong).ability(["correct_answer_weak_reasoning"]), false); checks++;
const updatedCorrect = input(["incorrect"]); updatedCorrect.profile_type = "updated";
updatedCorrect.followup_evidence_package = { payload: { item_responses: [{ item_public_id: "synthetic_0", correctness: "correct" }] } };
assert.equal(compile(updatedCorrect).ability(["correct_answer_weak_reasoning"]), true); checks++;
const updatedUnknown = structuredClone(updatedCorrect);
updatedUnknown.followup_evidence_package = { payload: { item_responses: [{ item_public_id: "synthetic_0", correctness: null }] } };
assert.equal(compile(updatedUnknown).ability(["correct_answer_weak_reasoning"]), true); checks++;
const updatedIncorrect = input(["correct"]); updatedIncorrect.profile_type = "updated";
updatedIncorrect.followup_evidence_package = { payload: { item_responses: [{ item_public_id: "synthetic_0", correctness: "incorrect" }] } };
assert.equal(compile(updatedIncorrect).ability(["correct_answer_weak_reasoning"]), false); checks++;
const retainedOnly = input([]); retainedOnly.profile_type = "updated"; retainedOnly.previous_profile = { ability_profile: "mostly_correct_understanding" };
assert.equal(compile(retainedOnly).ability(["correct_answer_weak_reasoning"]), true); checks++;
const metadataOnly = input([]); metadataOnly.initial_response_package.item_evidence = [{ item_public_id: "synthetic_0", response: { correctness: "incorrect" } }];
assert.equal(compile(metadataOnly).ability(["correct_answer_weak_reasoning"]), false); checks++;
for (const duplicateValues of [["correct", "incorrect"], ["incorrect", "correct"], [null, "incorrect"], ["incorrect", null],
  ["correct", "incorrect", "incorrect"], ["incorrect", "correct", "incorrect"], ["incorrect", "incorrect", "correct"]] as const) {
  const ambiguous = input([]);
  ambiguous.initial_response_package.payload = { item_responses: duplicateValues.map(correctness => ({ item_public_id: "synthetic_0", correctness })) };
  assert.equal(compile(ambiguous).ability(["correct_answer_weak_reasoning"]), true,
    "Conflicting duplicate sealed facts do not imply known incorrect correctness"); checks++;
}
const duplicateKnown = input([]);
duplicateKnown.initial_response_package.payload = { item_responses: [1, 2].map(() => ({ item_public_id: "synthetic_0", correctness: "incorrect" })) };
assert.equal(compile(duplicateKnown).ability(["correct_answer_weak_reasoning"]), false); checks++;

// Use the real compiled full JSON schema and production Zod schema, not a
// handwritten evaluator. Stored canonical V5 still accepts its original set.
const valid = { agent_name: "student_profiling_agent", agent_version: "7-draft", prompt_version: "student-profiling-v7",
  schema_version: "student-profile-output-v5", output_status: "ok", warnings: [], profile_type: "initial",
  ability_profile: "mostly_correct_understanding", ability_pattern_flags: ["no_clear_pattern"],
  engagement_profile: "adequate_engagement", engagement_pattern_flags: ["sustained_engagement"],
  integrated_diagnostic_profile: "underconfident_but_reasoning_supported", integrated_profile_confidence: "medium",
  integrated_profile_rationale: "Synthetic contract fixture only.", evidence_sufficiency: "adequate", confidence_alignment: "underconfident",
  independence_interpretability: "independent_understanding_likely", misconception_indicators: [], item_level_evidence: [],
  reasoning_quality_summary: "Synthetic.", engagement_summary: "Synthetic.", process_interpretation_cautions: [],
  profile_confidence: "medium", rationale: "Synthetic.", recommended_next_evidence: [] };
const full = ajv.compile(zero.schema);
assert.equal(full(valid), true, JSON.stringify(full.errors));
assert(zero.production.output_schema.safeParse(valid).success);
const impossible = { ...valid, ability_pattern_flags: ["correct_answer_weak_reasoning"] };
assert.equal(full(impossible), false);
assert.equal(zero.production.output_schema.safeParse(impossible).success, false);
assert.equal(ProductionStudentProfileOutputV5.safeParse(impossible).success, true, "Global stored V5 remains unchanged");
const mixed = { ...valid, engagement_pattern_flags: ["sustained_engagement", "no_clear_pattern"] };
assert.equal(full(mixed), false); assert.equal(ProductionStudentProfileOutputV5.safeParse(mixed).success, true);
checks += 7;
console.log(JSON.stringify({ status: "passed", checks, provider_calls: 0, database_calls: 0,
  source_mutation: false, scope: "Actual Responses compiled JSON schema, request parsing and unchanged stored V5" }));
