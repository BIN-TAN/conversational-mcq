import assert from "node:assert/strict";
import type { AgentInputByName, AgentOutputByName } from "../src/lib/agents/contracts";
import { ProductionStudentProfileOutput, ProductionStudentProfileOutputV5, StoredStudentProfileOutput } from "../src/lib/agents/contracts";
import { STUDENT_PROFILE_FACT_BINDING_VERSION, validateStudentProfileOutputSemantics } from "../src/lib/agents/student-profiling/semantic-validation";
import { executeStudentProfileWithSemanticRepair, studentProfileReusableInvocationKeys, studentProfileSealedInputMatches } from "../src/lib/agents/student-profiling/semantic-repair";

type Input = AgentInputByName["student_profiling_agent"];
type Output = AgentOutputByName["student_profiling_agent"];
function fixture() {
  const input: Input = { concept_unit_metadata: {}, profile_type: "initial",
    initial_response_package: { payload: { item_responses: [
      { item_public_id: "synthetic_item", correctness: "correct", reasoning_text: "Consistent scores can measure the wrong skill.",
        confidence_rating: "low", skipped_reasoning: false, skipped_confidence: false }
    ] } }, previous_profile: null, followup_evidence_package: null,
    profiling_constraints: { fact_binding_version: STUDENT_PROFILE_FACT_BINDING_VERSION } };
  const output: Output = {
    agent_name: "student_profiling_agent", agent_version: "7-draft", prompt_version: "student-profiling-v7",
    schema_version: "student-profile-output-v5", output_status: "ok", warnings: [], profile_type: "initial",
    ability_profile: "mostly_correct_understanding", ability_pattern_flags: ["no_clear_pattern"],
    engagement_profile: "adequate_engagement", engagement_pattern_flags: ["sustained_engagement"],
    integrated_diagnostic_profile: "underconfident_but_reasoning_supported", integrated_profile_confidence: "medium",
    integrated_profile_rationale: "Observed reasoning supports the administered distinction. Independent transfer remains uncertain.",
    evidence_sufficiency: "adequate", confidence_alignment: "underconfident",
    independence_interpretability: "independent_understanding_likely", misconception_indicators: [],
    item_level_evidence: [{ item_public_id: "synthetic_item", evidence_summary: "A concise correct distinction.",
      correctness: "correct", reasoning_quality: "Concise and accurate for this item.", confidence_rating: "low",
      reasoning_basis: { assessment: "adequate_for_item", source_quote: "Consistent scores can measure the wrong skill.", diagnostic_limitation: null } }],
    reasoning_quality_summary: "Concise accurate reasoning; transfer has not been assessed.", engagement_summary: "All requested evidence was submitted.",
    process_interpretation_cautions: [], profile_confidence: "medium", rationale: "Observed evidence supports the distinction, with uncertainty about transfer.",
    recommended_next_evidence: []
  };
  return { input, output };
}
function validate(value: ReturnType<typeof fixture>) {
  return validateStudentProfileOutputSemantics({ providerInput: value.input, output: value.output });
}
function rejects(mutator: (value: ReturnType<typeof fixture>) => void, message: string) {
  const value = fixture(); mutator(value);
  const result = validate(value);
  assert(result.issues.some(issue => issue.includes(message)), JSON.stringify(result));
}
function response(value: ReturnType<typeof fixture>) {
  return (value.input.initial_response_package.payload as { item_responses: Array<Record<string, unknown>> }).item_responses[0];
}

assert(validate(fixture()).ok, "Brief accurate low-confidence reasoning remains valid.");
rejects(v => { v.output.item_level_evidence[0].confidence_rating = "medium"; }, "confidence_rating");
rejects(v => { v.output.item_level_evidence[0].confidence_rating = null; }, "confidence_rating");
rejects(v => { v.output.item_level_evidence[0].correctness = null; }, "correctness");
for (const flag of ["skipped_reasoning", "skipped_confidence"] as const) {
  rejects(v => { v.output.engagement_pattern_flags.push(flag); }, "explicitly recorded skip");
  rejects(v => { delete response(v)[flag]; v.output.engagement_pattern_flags.push(flag); }, "explicitly recorded skip");
  const skipped = fixture(); response(skipped)[flag] = true;
  skipped.output.engagement_pattern_flags.push(flag);
  assert(validate(skipped).ok, "A recorded historical skip may coexist with later supplied evidence.");
}
rejects(v => { response(v).confidence_rating = null; response(v).skipped_confidence = true; }, "confidence_rating");
const absent = fixture(); response(absent).confidence_rating = null;
absent.output.item_level_evidence[0].confidence_rating = null;
assert(validate(absent).ok, "Recorded null confidence is preserved.");
const staleDuplicate = fixture();
staleDuplicate.input.initial_response_package.item_evidence = [{ item_public_id: "synthetic_item", response: { confidence_rating: "high" } }];
response(staleDuplicate).confidence_rating = null;
staleDuplicate.output.item_level_evidence[0].confidence_rating = null;
assert(validate(staleDuplicate).ok, "A sealed null must not fall back to stale duplicated confidence.");
rejects(v => { v.output.ability_pattern_flags = ["no_clear_pattern", "correct_answer_weak_reasoning"]; }, "must not combine no_clear_pattern");
rejects(v => { v.output.engagement_pattern_flags.push("no_clear_pattern"); }, "must not combine no_clear_pattern");
rejects(v => { v.output.ability_pattern_flags = ["correct_answer_weak_reasoning"]; }, "supported reasoning limitation");
rejects(v => { v.output.ability_pattern_flags = ["correct_answer_weak_reasoning"]; v.output.item_level_evidence[0].reasoning_basis!.assessment = "recognition_only"; }, "supported reasoning limitation");
rejects(v => { v.output.item_level_evidence[0].reasoning_basis!.source_quote = "This is fabricated."; }, "quote the submitted reasoning verbatim");
rejects(v => { v.output.item_level_evidence[0].reasoning_basis!.assessment = "not_provided"; }, "cannot classify submitted reasoning");
rejects(v => { delete v.output.item_level_evidence[0].reasoning_basis; }, "requires reasoning_basis");
rejects(v => { v.output.item_level_evidence = []; }, "omits submitted item");
rejects(v => { v.output.item_level_evidence.push(structuredClone(v.output.item_level_evidence[0])); }, "duplicates item");
const guessing = fixture(); response(guessing).reasoning_text = "I guessed; I do not understand this yet.";
guessing.output.item_level_evidence[0].reasoning_basis = { assessment: "explicit_guess", source_quote: "I guessed", diagnostic_limitation: "The student explicitly reports guessing without understanding." };
guessing.output.ability_pattern_flags = ["correct_answer_weak_reasoning"];
assert(validate(guessing).ok, "Explicit guessing supports a weak-reasoning claim without inventing a skip.");
const missing = fixture(); response(missing).reasoning_text = null;
response(missing).skipped_reasoning = true;
missing.output.item_level_evidence[0].reasoning_basis = { assessment: "not_provided", source_quote: null, diagnostic_limitation: null };
missing.output.ability_pattern_flags = ["correct_answer_weak_reasoning"];
assert(validate(missing).ok, "Actual absent reasoning is supported.");
assert(ProductionStudentProfileOutputV5.safeParse(fixture().output).success);
const historical = fixture().output; historical.schema_version = "student-profile-output-v4";
delete historical.item_level_evidence[0].reasoning_basis;
assert(ProductionStudentProfileOutput.safeParse(historical).success, "V4 remains available unchanged.");
assert(!ProductionStudentProfileOutputV5.safeParse(historical).success, "Active V5 requires structured support.");
assert(StoredStudentProfileOutput.safeParse(historical).success);
assert(StoredStudentProfileOutput.safeParse(fixture().output).success);

function incorrectReasoningFixture() {
  const value = fixture();
  response(value).correctness = "incorrect";
  response(value).reasoning_text = "Consistency alone proves validity.";
  value.output.item_level_evidence[0].correctness = "incorrect";
  value.output.item_level_evidence[0].reasoning_basis = { assessment: "incorrect_explanation",
    source_quote: "Consistency alone proves validity.", diagnostic_limitation: "Consistency does not establish the intended interpretation." };
  value.output.ability_profile = "misconception_based_understanding";
  value.output.integrated_diagnostic_profile = "misconception_with_sufficient_engagement";
  value.output.confidence_alignment = "well_calibrated";
  value.output.ability_pattern_flags = ["conceptual_error_possible", "correctness_reasoning_mismatch"];
  return value;
}
const wrongWithWrongReasoning = incorrectReasoningFixture();
assert(validate(wrongWithWrongReasoning).issues.some(issue => issue.includes("incorrect answers with incorrect explanations alone")),
  "V5 rejects a mismatch flag unsupported by its own all-incorrect reasoning classifications.");
const wrongWithAdequateReasoning = incorrectReasoningFixture();
wrongWithAdequateReasoning.output.item_level_evidence[0].reasoning_basis!.assessment = "adequate_for_item";
assert(!validate(wrongWithAdequateReasoning).issues.some(issue => issue.includes("incorrect answers with incorrect explanations alone")),
  "The narrow guard leaves a wrong selection with model-classified adequate reasoning available for semantic review.");
const unknownReasoningBasis = incorrectReasoningFixture();
unknownReasoningBasis.output.item_level_evidence[0].reasoning_basis!.assessment = "not_assessable";
assert(!validate(unknownReasoningBasis).issues.some(issue => issue.includes("incorrect answers with incorrect explanations alone")),
  "Unassessed reasoning is not silently classified as incorrect reasoning.");
const unknownCorrectness = incorrectReasoningFixture();
response(unknownCorrectness).correctness = null;
assert(!validate(unknownCorrectness).issues.some(issue => issue.includes("incorrect answers with incorrect explanations alone")),
  "Unknown sealed correctness does not activate the all-incorrect condition.");
const historicalMismatch = incorrectReasoningFixture();
historicalMismatch.output.schema_version = "student-profile-output-v4";
historicalMismatch.input.profiling_constraints = {};
delete historicalMismatch.output.item_level_evidence[0].reasoning_basis;
assert(validate(historicalMismatch).ok, "Historical V4 mismatch handling is unchanged.");

async function testRepair() {
  const value = fixture(); const invalid = structuredClone(value.output);
  invalid.engagement_pattern_flags = ["no_clear_pattern", "sustained_engagement"];
  const immutable = JSON.stringify(invalid);
  const request = { agentName: "student_profiling_agent" as const, invocationKey: "synthetic_original",
    allowlistedInput: value.input, operationalContext: {} };
  let calls = 0; const rejected: string[] = [];
  const result = await executeStudentProfileWithSemanticRepair({ request,
    execute: async r => {
      calls++;
      if (calls === 2) {
        assert.equal(r.invocationKey, "synthetic_original:semantic-repair:1");
        assert.deepEqual(r.allowlistedInput.initial_response_package, request.allowlistedInput.initial_response_package);
        assert(r.allowlistedInput.profiling_constraints.semantic_repair);
        assert.equal(r.forceNewInvocation, false);
      }
      return { status: "succeeded", output: calls === 1 ? invalid : value.output, agent_call_id: `synthetic_call_${calls}`, retry_count: 0 };
    }, recordRejected: async r => { rejected.push(r.agent_call_id); } });
  assert.equal(result.status, "succeeded"); assert.equal(calls, 2); assert.deepEqual(rejected, ["synthetic_call_1"]);
  assert.equal(JSON.stringify(invalid), immutable, "Rejected provider draft is never rewritten.");
  calls = 0; rejected.length = 0;
  const exhausted = await executeStudentProfileWithSemanticRepair({ request,
    execute: async () => { calls++; return { status: "succeeded", output: invalid, agent_call_id: `rejected_${calls}`, retry_count: 0 }; },
    recordRejected: async r => { rejected.push(r.agent_call_id); } });
  assert.equal(exhausted.status, "semantic_validation_failed"); assert.equal(calls, 2); assert.equal(rejected.length, 2);
  calls = 0;
  const interrupted = await executeStudentProfileWithSemanticRepair({ request,
    execute: async () => { calls++; return calls === 1 ? { status: "succeeded", output: invalid, agent_call_id: "invalid", retry_count: 0 } :
      { status: "failed", error: { category: "invalid_request", message: "test guard blocked", retryable: false }, retry_count: 0 }; },
    recordRejected: async () => {} });
  assert.equal(interrupted.status, "semantic_validation_failed", "Failed repair cannot enter fallback persistence.");
  calls = 0;
  await executeStudentProfileWithSemanticRepair({ request,
    execute: async () => { calls++; return { status: "succeeded", output: value.output, agent_call_id: "valid", retry_count: 0 }; },
    recordRejected: async () => { throw new Error("Valid output was rejected"); } });
  assert.equal(calls, 1, "Valid first draft gets no extra paid call.");
  calls = 0;
  const reviewDraft = { ...invalid, output_status: "needs_review" as const };
  const needsReview = await executeStudentProfileWithSemanticRepair({ request,
    execute: async () => { calls++; return { status: "succeeded", output: reviewDraft, agent_call_id: "needs_review", retry_count: 0 }; },
    recordRejected: async () => {} });
  assert.equal(needsReview.status, "semantic_validation_failed");
  assert.equal(calls, 1, "An explicit review outcome does not trigger regeneration.");

  const retained = { agent_call_id: "original_rejected", provider_input: value.input, output: invalid };
  const rebuilt = structuredClone(value.input);
  rebuilt.initial_response_package.process_events = [{ event_type: "schema_validation_failed" }];
  assert(studentProfileSealedInputMatches(value.input, rebuilt), "New operational events do not rewrite the retained input.");
  response({ input: rebuilt, output: value.output }).confidence_rating = "high";
  assert(!studentProfileSealedInputMatches(value.input, rebuilt), "Changed submitted facts block resume.");
  let paidCalls = 0;
  let repairStored = false;
  const resumeEffects = {
    request,
    readPriorSemanticRejection: async () => retained,
    execute: async (r: typeof request) => {
      assert.equal(r.invocationKey, "synthetic_original:semantic-repair:1", "Restart must never redispatch the original rejected key.");
      assert.deepEqual(r.allowlistedInput.initial_response_package, retained.provider_input.initial_response_package);
      if (!repairStored) { paidCalls++; repairStored = true; }
      return { status: "succeeded" as const, output: value.output, agent_call_id: "stored_repair", retry_count: 0, idempotent_replay: paidCalls > 0 };
    },
    recordRejected: async () => { throw new Error("Retained rejection was rewritten"); }
  };
  const resumedBeforeRepair = await executeStudentProfileWithSemanticRepair(resumeEffects);
  assert.equal(resumedBeforeRepair.status, "succeeded");
  assert.equal(paidCalls, 1, "Interruption before repair creates only the deterministic repair call.");
  const resumedBeforeProfilePersistence = await executeStudentProfileWithSemanticRepair(resumeEffects);
  assert.equal(resumedBeforeProfilePersistence.status, "succeeded");
  assert.equal(paidCalls, 1, "Stored successful repair replays after interruption before profile persistence.");
  assert.deepEqual(studentProfileReusableInvocationKeys(request.invocationKey), ["synthetic_original", "synthetic_original:semantic-repair:1"],
    "Persisted-profile lookup recognizes the successful repair key as well as the original.");
  const failedStoredRepair = await executeStudentProfileWithSemanticRepair({ ...resumeEffects,
    execute: async r => {
      assert.equal(r.invocationKey, "synthetic_original:semantic-repair:1");
      return { status: "failed", agent_call_id: "stored_failed_repair", retry_count: 0,
        error: { category: "invalid_request", message: "Already attempted; not replayable", retryable: false } };
    } });
  assert.equal(failedStoredRepair.status, "semantic_validation_failed", "A failed retained repair does not fall into fallback or start a third attempt.");
  assert.equal(paidCalls, 1);
  const badIdentity = await executeStudentProfileWithSemanticRepair({ ...resumeEffects,
    readPriorSemanticRejection: async () => ({ agent_call_id: "wrong_identity", provider_input: null, output: null }),
    execute: async () => { throw new Error("Invalid retained identity must not dispatch"); } });
  assert.equal(badIdentity.status, "semantic_validation_failed");
}
testRepair().then(() => {
  console.log("Student profiling fact binding and bounded semantic repair passed offline; no provider or database calls.");
}).catch(error => { console.error(error); process.exitCode = 1; });
