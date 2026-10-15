import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { AgentInputByName, AgentOutputByName } from "../src/lib/agents/contracts";
import { ProductionStudentProfileOutputV5, ProductionStudentProfileOutputV6 } from "../src/lib/agents/contracts";
import { buildProductionAgentRequest, compileProductionAgentRequest } from "../src/lib/agents/provider-request";
import { studentProfileSealedCorrectness, validateStudentProfileOutputSemantics } from "../src/lib/agents/student-profiling/semantic-validation";
import { STUDENT_PROFILE_REQUEST_SCHEMA_VERSION, studentProfileRequestOutputSchema } from "../src/lib/agents/student-profiling/output-schema";
import { buildCanonicalEvidenceCatalog } from "../src/lib/domain/canonical-evidence-identity";

let checks = 0;
globalThis.fetch = async () => { throw new Error("No provider/network calls in request-schema smoke"); };
type Input = AgentInputByName["student_profiling_agent"];
function input(correctness: Array<string | null | undefined> = ["incorrect"]): Input {
  return { profile_type: "initial", concept_unit_metadata: {}, profiling_constraints: {},
    allowed_evidence_catalog: buildCanonicalEvidenceCatalog({ evidence_namespace_public_id: "synthetic-profile-schema",
      assessment_public_id: "synthetic-assessment", concept_unit_public_id: "synthetic-concept",
      assessment_responses: [{ item_public_id: "synthetic_0", selected_option: "B", correctness: "incorrect",
        written_reasoning: "Consistent scores alone do not establish validity.", confidence: "low",
        tempting_option: null, tempting_option_reason: null }] }),
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
  items?: SchemaNode; additionalProperties?: boolean; required?: string[]; properties?: Record<string, SchemaNode> };
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
  assert.deepEqual(Object.keys(schema.properties).slice(0, 13), [
    "agent_name", "agent_version", "prompt_version", "schema_version", "output_status",
    "warnings", "profile_type", "item_level_evidence", "strong_partial_reasoning_support",
    "misconception_indicators", "reasoning_quality_summary", "engagement_summary",
    "process_interpretation_cautions"
  ], "Actual Responses schema generates evidence and reasoning before aggregate flags");
  assert(Object.keys(schema.properties).indexOf("ability_pattern_flags") >
    Object.keys(schema.properties).indexOf("reasoning_quality_summary"));
  const production = buildProductionAgentRequest(request(value));
  assert.equal(production.metadata?.request_schema_guard, STUDENT_PROFILE_REQUEST_SCHEMA_VERSION);
  checks++;
  return { schema, ability: ajv.compile(schema.properties.ability_pattern_flags),
    engagement: ajv.compile(schema.properties.engagement_pattern_flags), production };
}
const zero = compile(input());
const reorderedFields = studentProfileRequestOutputSchema(input()).shape;
for (const key of Object.keys(reorderedFields) as Array<keyof typeof reorderedFields>) {
  if (["ability_pattern_flags", "engagement_pattern_flags", "misconception_indicators", "strong_partial_reasoning_support"].includes(key)) continue;
  assert.deepEqual(zodTextFormat(z.object({ value: reorderedFields[key] }), "field").schema,
    zodTextFormat(z.object({ value: ProductionStudentProfileOutputV6.shape[key] }), "field").schema,
    `Request ordering preserves the complete canonical field schema: ${key}`);
  checks++;
}
assert.deepEqual(Object.keys(zero.schema.properties.item_level_evidence.items!.properties!), [
  "item_public_id", "evidence_summary", "correctness", "reasoning_quality", "confidence_rating", "reasoning_basis"
]);
assert.deepEqual(Object.keys(zero.schema.properties.item_level_evidence.items!.properties!.reasoning_basis.properties!), [
  "assessment", "source_quote", "diagnostic_limitation"
]);
assert.deepEqual(Object.keys(zero.schema.properties.strong_partial_reasoning_support.items!.properties!), [
  "item_public_id", "source_evidence_id", "source_quote", "correct_component", "remaining_error"
]);
assert.equal(STUDENT_PROFILE_REQUEST_SCHEMA_VERSION, "student-profile-request-schema-v4");
checks += 4;
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
  schema_version: "student-profile-output-v6", strong_partial_reasoning_support: [], output_status: "ok", warnings: [], profile_type: "initial",
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
assert.deepEqual(zero.production.output_schema.parse(valid), ProductionStudentProfileOutputV6.parse(valid),
  "Request ordering preserves every canonical V6 parsed field and value");
assert.deepEqual([...zero.schema.required].sort(), Object.keys(ProductionStudentProfileOutputV6.shape).sort(),
  "Request ordering adds or removes no canonical fields");
const impossible = { ...valid, ability_pattern_flags: ["correct_answer_weak_reasoning"] };
assert.equal(full(impossible), false);
assert.equal(zero.production.output_schema.safeParse(impossible).success, false);
assert.equal(ProductionStudentProfileOutputV6.safeParse(impossible).success, true, "Request-only exclusions do not narrow the stored V6 flags");
const mixed = { ...valid, engagement_pattern_flags: ["sustained_engagement", "no_clear_pattern"] };
assert.equal(full(mixed), false); assert.equal(ProductionStudentProfileOutputV6.safeParse(mixed).success, true);
const { strong_partial_reasoning_support: _support, ...historical } = impossible;
assert.equal(_support.length, 0);
assert.equal(ProductionStudentProfileOutputV5.safeParse({ ...historical, schema_version: "student-profile-output-v5" }).success, true,
  "Global stored V5 remains unchanged");
checks += 9;

// Recompile the two byte-preserved native rejections. Ordering cannot turn
// structurally valid but semantically unsupported flags into accepted output.
const nativeBytes = readFileSync("prisma/fixtures/student-profile-mismatch-native-v18.json");
const fixtureHash = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
const nativeText = nativeBytes.toString("utf8");
const nativeHash = fixtureHash(nativeText);
assert.equal(nativeHash, "8519601ec225ab20bc0b0578e0f1e7417653ba3e0bde12692af06d62db8cbf09");
assert.equal(fixtureHash(nativeText.replace(/\r?\n/g, "\r\n")), nativeHash,
  "Git checkout line endings do not change fixture identity or escaped student text");
const native = JSON.parse(nativeText) as {
  synthetic_only: boolean; real_student_records_used: boolean;
  drafts: Array<{ disposition: string; input: Input; output: AgentOutputByName["student_profiling_agent"] }>;
};
assert.equal(native.synthetic_only, true); assert.equal(native.real_student_records_used, false);
assert.equal(native.drafts.length, 2);
const nativeBefore = JSON.stringify(native);
for (const [index, draft] of native.drafts.entries()) {
  const compiled = compile(draft.input);
  const validate = ajv.compile(compiled.schema);
  assert.equal(draft.disposition, "rejected");
  // The first historical draft also copied a nonexistent evidence ID. V4 now
  // prevents that structure; the second draft still reaches the unchanged
  // semantic mismatch guard. Neither historical output is rewritten.
  assert.equal(validate(draft.output), index === 1, JSON.stringify(validate.errors));
  assert.equal(compiled.production.output_schema.safeParse(draft.output).success, index === 1);
  if (index === 1) assert.deepEqual(compiled.production.output_schema.parse(draft.output), ProductionStudentProfileOutputV6.parse(draft.output));
  const semantic = validateStudentProfileOutputSemantics({ providerInput: draft.input, output: draft.output });
  assert.equal(semantic.ok, false);
  assert(semantic.issues.some(issue => issue.includes("incorrect answers with incorrect explanations alone")));
  checks += 5;
}

// Authored control: a wrong selection can coexist with a sound explanation.
// It remains an available mismatch, even when all sealed selections are wrong.
const wrongWithAdequateInput = input();
wrongWithAdequateInput.initial_response_package.payload = { item_responses: [{
  item_public_id: "synthetic_0", correctness: "incorrect",
  reasoning_text: "Consistent scores alone do not establish validity.", confidence_rating: "low"
}] };
const wrongWithAdequateOutput = ProductionStudentProfileOutputV6.parse({ ...valid,
  ability_pattern_flags: ["correctness_reasoning_mismatch"],
  integrated_diagnostic_profile: "conflicting_evidence_needs_clarification",
  integrated_profile_rationale: "The selected option is wrong but the submitted explanation is sound; their disagreement needs clarification.",
  item_level_evidence: [{
    item_public_id: "synthetic_0", evidence_summary: "Wrong selected option with an accurate distinction.",
    correctness: "incorrect", reasoning_quality: "Accurate explanation despite the wrong selected option.", confidence_rating: "low",
    reasoning_basis: { assessment: "adequate_for_item", source_quote: "Consistent scores alone do not establish validity.", diagnostic_limitation: null }
  }] });
const adequateSchema = compile(wrongWithAdequateInput);
const adequateJson = ajv.compile(adequateSchema.schema);
assert.equal(adequateJson(wrongWithAdequateOutput), true, JSON.stringify(adequateJson.errors));
assert(adequateSchema.production.output_schema.safeParse(wrongWithAdequateOutput).success);
const adequateSemantics = validateStudentProfileOutputSemantics({ providerInput: wrongWithAdequateInput, output: wrongWithAdequateOutput });
assert.equal(adequateSemantics.ok, true, JSON.stringify(adequateSemantics));
assert.equal(JSON.stringify(native), nativeBefore, "The actual rejected drafts and source inputs remain unchanged");
assert.deepEqual(readFileSync("prisma/fixtures/student-profile-mismatch-native-v18.json"), nativeBytes);
checks += 10;

// Request-only citation choices cover every V6 source-ID leaf. These controls
// use the actual V25 partial01 typo strings (native AgentCalls SHA
// 2f5b5e88483e75f77995afa076e29ee9c09b763304e7d936204d7ad8109c112e),
// in an explicitly authored minimal profile, not a relabeled native acceptance.
const citationInput = input();
const reasoning = citationInput.allowed_evidence_catalog!.evidence.find(entry => entry.evidence_kind === "assessment_reasoning")!;
const actualId = "ev_608f44fd0bab01754117ec9e";
const actualTypo = "ev_608f44fd0bab01754117ec9e9";
reasoning.evidence_id = actualId;
const foreignId = "ev_ffffffffffffffffffffffff";
const citationBefore = JSON.stringify(citationInput);
const cited = { ...valid, misconception_indicators: [{ indicator: "Synthetic misconception control.",
  evidence_reference: actualId, confidence: "medium", rationale: "Synthetic source binding only.",
  atomic_claims: [{ claim_text: "Synthetic claim.", source_evidence_references: [actualId] }] }] };
const citationRequest = compile(citationInput);
const citationJson = ajv.compile(citationRequest.schema);
assert(citationJson(cited), JSON.stringify(citationJson.errors));
assert(citationRequest.production.output_schema.safeParse(cited).success);
assert(citationJson({ ...cited, misconception_indicators: [{ ...cited.misconception_indicators[0], evidence_reference: null }] }));
assert(citationJson(valid), "Empty citation arrays remain valid where the unchanged V6 contract permits them");
checks += 4;
for (const badId of [actualTypo, foreignId]) {
  for (const field of ["indicator", "atomic", "strong_partial"] as const) {
    const bad = structuredClone(cited);
    if (field === "indicator") bad.misconception_indicators[0].evidence_reference = badId;
    else if (field === "atomic") bad.misconception_indicators[0].atomic_claims[0].source_evidence_references = [badId];
    const candidate = field === "strong_partial" ? { ...bad, strong_partial_reasoning_support: [{
      item_public_id: "synthetic_0", source_evidence_id: badId, source_quote: reasoning.content,
      correct_component: "Synthetic component.", remaining_error: "Synthetic limitation."
    }] } : bad;
    assert.equal(citationJson(candidate), false, `${field} must reject ${badId}`);
    assert.equal(citationRequest.production.output_schema.safeParse(candidate).success, false);
    assert(ProductionStudentProfileOutputV6.safeParse(candidate).success,
      "The canonical stored V6 shape is unchanged and does not silently repair references");
    checks += 3;
  }
}
const support = { ...valid, strong_partial_reasoning_support: [{ item_public_id: "synthetic_0",
  source_evidence_id: actualId, source_quote: reasoning.content, correct_component: "Synthetic component.", remaining_error: "Synthetic limitation." }] };
assert(citationJson(support), JSON.stringify(citationJson.errors));
const confidenceId = citationInput.allowed_evidence_catalog!.evidence.find(entry => entry.evidence_kind === "assessment_confidence")!.evidence_id;
assert.equal(citationJson({ ...cited, misconception_indicators: [{ ...cited.misconception_indicators[0], evidence_reference: confidenceId }] }), false,
  "Existing baseline understanding eligibility excludes confidence/context-only evidence");
const wrongQuote = ProductionStudentProfileOutputV6.parse({ ...support,
  ability_pattern_flags: ["incorrect_answer_strong_partial_reasoning"],
  strong_partial_reasoning_support: [{ ...support.strong_partial_reasoning_support[0], source_quote: "Unwritten words." }] });
assert(citationJson(wrongQuote), "A valid ID is not proof that its quote or interpretation is correct");
assert(validateStudentProfileOutputSemantics({ providerInput: citationInput, output: wrongQuote }).issues
  .some(issue => issue.includes("source_quote must quote")), "Exact quote checks remain enforced");
checks += 4;
const noCatalog = input(); delete noCatalog.allowed_evidence_catalog;
const malformedCatalog = input(); malformedCatalog.allowed_evidence_catalog!.evidence[0].evidence_scope_id = "es_ffffffffffffffffffffffff";
const emptyCatalog = input(); emptyCatalog.allowed_evidence_catalog!.evidence = [];
const contextOnlyCatalog = input(); contextOnlyCatalog.allowed_evidence_catalog!.evidence =
  contextOnlyCatalog.allowed_evidence_catalog!.evidence.filter(entry => entry.eligibility === "evidence_quality_context");
assert.throws(() => buildProductionAgentRequest(request(noCatalog)), "Missing catalog has no unconstrained fallback"); checks++;
assert.throws(() => buildProductionAgentRequest(request(malformedCatalog)), "Malformed scope is not treated as an empty catalog"); checks++;
for (const noSources of [emptyCatalog, contextOnlyCatalog]) {
  const empty = compile(noSources);
  const emptyJson = ajv.compile(empty.schema);
  assert.equal(empty.schema.properties.misconception_indicators.maxItems, 0);
  assert.equal(empty.schema.properties.strong_partial_reasoning_support.maxItems, 0);
  assert(emptyJson(valid), "The empty branch retains ordinary no-citation outputs");
  assert.equal(emptyJson(cited), false);
  assert.equal(emptyJson(support), false);
  assert.equal(empty.production.output_schema.safeParse(cited).success, false);
  assert.equal(empty.production.output_schema.safeParse(support).success, false);
  checks += 7;
}
// Production submitItemResponse can seal fully skipped items with null answer
// and reasoning. The real catalog builder consequently emits no understanding
// sources; process observations remain context-only, not invented answer IDs.
const skipped = input([]);
const skippedItems = [0, 1, 2].map(index => ({ item_public_id: `skipped_${index}`,
  selected_option: null, correctness: "not_scored", reasoning_text: null,
  confidence_rating: null, skipped_item: true, skipped_reasoning: true, skipped_confidence: true }));
skipped.initial_response_package.payload = { item_responses: skippedItems };
skipped.allowed_evidence_catalog = buildCanonicalEvidenceCatalog({ evidence_namespace_public_id: "skipped-package",
  assessment_public_id: "synthetic-assessment", concept_unit_public_id: "synthetic-concept",
  assessment_responses: skippedItems.map(item => ({ ...item, written_reasoning: null,
    confidence: null, tempting_option: null, tempting_option_reason: null })),
  assessment_process: [{ source_public_id: "synthetic-skip-event", event_type: "missing_evidence_skipped",
    event_category: "initial_administration", event_source: "backend", item_public_id: "skipped_0" }] });
assert(skipped.allowed_evidence_catalog.evidence.length > 0);
assert(skipped.allowed_evidence_catalog.evidence.every(entry => entry.eligibility === "evidence_quality_context"));
const skippedOutput = ProductionStudentProfileOutputV6.parse({ ...valid,
  ability_profile: "insufficient_evidence", engagement_profile: "insufficient_process_evidence",
  engagement_pattern_flags: ["skipped_reasoning", "skipped_confidence"],
  integrated_diagnostic_profile: "insufficient_evidence_for_formative_decision",
  evidence_sufficiency: "insufficient", confidence_alignment: "insufficient_evidence",
  independence_interpretability: "insufficient_evidence", profile_confidence: "low",
  integrated_profile_confidence: "low", integrated_profile_rationale: "Observed skips leave understanding and causes uncertain.",
  rationale: "No selected answers or written reasons were supplied; more evidence would be needed for interpretation.",
  item_level_evidence: skippedItems.map(item => ({ item_public_id: item.item_public_id,
    evidence_summary: "The item, reasoning and confidence were explicitly skipped.", correctness: "not_scored",
    reasoning_quality: "No reasoning supplied.", confidence_rating: null,
    reasoning_basis: { assessment: "not_provided", source_quote: null, diagnostic_limitation: "No submitted reasoning to assess." } })) });
const skippedRequest = compile(skipped);
assert(ajv.compile(skippedRequest.schema)(skippedOutput));
assert.deepEqual(skippedRequest.production.output_schema.parse(skippedOutput), ProductionStudentProfileOutputV6.parse(skippedOutput));
const skippedSemantic = validateStudentProfileOutputSemantics({ providerInput: skipped, output: skippedOutput });
assert(skippedSemantic.ok, JSON.stringify(skippedSemantic));
checks += 5;
const explicitUnknown = buildCanonicalEvidenceCatalog({ evidence_namespace_public_id: "unknown-package",
  assessment_public_id: "synthetic-assessment", concept_unit_public_id: "synthetic-concept",
  assessment_responses: [{ item_public_id: "unknown_0", selected_option: "E", correctness: "not_scored",
    written_reasoning: "I don't know the reason yet.", confidence: "low", tempting_option: null, tempting_option_reason: null }] });
assert.equal(explicitUnknown.evidence.filter(entry => entry.eligibility === "student_understanding").length, 2,
  "An explicit unknown answer/reason remains an actual source; it is not fabricated absence or mastery"); checks++;
const repairInput = structuredClone(citationInput);
repairInput.profiling_constraints.semantic_repair = { attempt: 1, maximum_regenerations: 1, validation_issues: ["Synthetic rejected field."] };
assert.deepEqual(compileProductionAgentRequest(request(repairInput)).text.format.schema, citationRequest.schema,
  "The same catalog constrains base and semantic-repair requests");
assert.equal(JSON.stringify(citationInput), citationBefore);
assert.equal(JSON.stringify(native), nativeBefore);
checks += 3;
console.log(JSON.stringify({ status: "passed", checks, provider_calls: 0, database_calls: 0,
  source_mutation: false, scope: "Actual Responses evidence-first order and context-bound V6 citation fields; unchanged canonical output/semantic checks and retained original rejections" }));
