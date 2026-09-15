import assert from "node:assert/strict";
import { z } from "zod";
import { prepareAssessmentContext } from "../src/lib/services/content/prepared-assessment-context";
import { compactRepeatedDiagnosticContext } from "../src/lib/services/student-assessment/compact-provider-context";
import { runParallelInitialInterpretation } from "../src/lib/services/student-assessment/parallel-initial-interpretation";
import { compileOpenAIResponsesRequestBody } from "../src/lib/llm/providers/openai-responses-provider";
import { canonicalStructuredAgentRequestHash } from "../src/lib/llm/provider-transport-retry";
import { FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";

globalThis.fetch = async () => { throw new Error("network_not_allowed"); };
const checks: string[] = [];
const pass = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };
const source = {
  assessment_public_id: "assessment-a", diagnostic_focus: "Validity and reliability",
  concept_unit_public_id: "section-a", title: "Measurement", learning_objective: "Interpret evidence",
  related_concept_description: "Use context", version: 1, administration_rules: {},
  items: [{
    item_public_id: "item-a", item_order: 13, item_stem: "Which interpretation follows?",
    options: [{ label: "A", text: "Evidence" }, { label: "B", text: "Overclaim" }],
    version: 1, status: "published", included_in_published_set: true,
    administration_rules: {}, distractor_rationales: { B: "Does not address context" },
    expected_reasoning_patterns: ["Consider the population"], possible_misconception_indicators: [], media_assets: []
  }]
};

async function main() {
  const cold = prepareAssessmentContext(source);
  const saved = JSON.parse(JSON.stringify(cold.envelope));
  const warm = prepareAssessmentContext(source, saved);
  assert.equal(warm.cache_hit, true);
  assert.deepEqual(warm.content, cold.content);
  assert.equal(warm.content.included_items[0].initial_item_position, 1);
  assert.equal(warm.content.included_items[0].item_order, 13);
  warm.content.included_items[0].item_stem = "Mutated caller";
  assert.deepEqual(prepareAssessmentContext(source, saved).content, cold.content);
  pass("warm content equals fresh compilation and callers cannot mutate the saved cache");
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) :
    value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorder(entry)])) : value;
  assert(prepareAssessmentContext(source, reorder(saved)).cache_hit);
  pass("JSONB key ordering preserves cache hits");
  for (const changed of [
    { ...source, assessment_public_id: "assessment-b" }, { ...source, version: 2 },
    { ...source, diagnostic_focus: "New focus" }, { ...source, learning_objective: "New objective" },
    { ...source, items: [{ ...source.items[0], item_stem: "Revised item" }] },
    { ...source, items: [{ ...source.items[0], options: [{ label: "A", text: "Changed option" }] }] },
    { ...source, items: [{ ...source.items[0], expected_reasoning_patterns: ["New guidance"] }] },
    { ...source, items: [] }
  ]) assert.equal(prepareAssessmentContext(changed, saved).cache_hit, false);
  saved.content.included_items[0].item_stem = "Corrupted cache";
  assert.equal(prepareAssessmentContext(source, saved).cache_hit, false);
  assert.equal(prepareAssessmentContext(source, { ...cold.envelope, version: "old" }).cache_hit, false);
  pass("changed ownership, revisions, content, objectives, options, guidance and corrupt caches rebuild");
  const extra = { ...source, student_response: "STUDENT_SECRET", session_public_id: "PRIVATE_SESSION" };
  assert.deepEqual(prepareAssessmentContext(extra).envelope, cold.envelope);
  assert(!JSON.stringify(cold.envelope).includes("STUDENT_SECRET"));
  pass("shared cache excludes session and student information");

  const request = {
    agent_name: "student_profiling_agent", model_config: { model_name: "gpt-5.6-terra", reasoning_effort: "medium" as const, max_output_tokens: 7000 },
    instructions: "Static instructions", input: { student_evidence: "Private answer" },
    output_schema: z.object({ message: z.string() }), schema_name: "latency_test", client_request_id: "local",
    timeout_ms: 60000, cache_static_instructions: true, metadata: { purpose: "no_provider_test" }
  };
  const cached = compileOpenAIResponsesRequestBody(request);
  assert(Array.isArray(cached.input));
  assert("prompt_cache_options" in cached);
  assert.deepEqual(cached.prompt_cache_options, { mode: "explicit" });
  assert(!JSON.stringify(cached.input[0]).includes("Private answer"));
  assert(Array.isArray(cached.input[0].content));
  assert.equal(cached.input[0].content[0].text, request.instructions);
  assert.equal(cached.input[1].content, JSON.stringify(request.input));
  assert.equal(cached.store, false);
  assert.equal(cached.max_output_tokens, 7000);
  assert.deepEqual(cached.reasoning, { effort: "medium" });
  const next = compileOpenAIResponsesRequestBody({ ...request, input: { student_evidence: "Other student" } });
  assert(Array.isArray(next.input));
  assert.deepEqual(next.input[0], cached.input[0]);
  assert(!JSON.stringify(cached).includes("prompt_cache_retention"));
  pass("explicit prompt cache contains only static instructions; private suffix, retention and model settings preserved");
  for (const plain of [
    { ...request, cache_static_instructions: false },
    { ...request, cache_static_instructions: undefined },
    { ...request, model_config: { ...request.model_config, model_name: "gpt-5.5" } }
  ]) {
    const body = compileOpenAIResponsesRequestBody(plain);
    assert("instructions" in body);
    assert.equal(body.instructions, request.instructions);
    assert.equal(body.input, JSON.stringify(request.input));
    assert(!("prompt_cache_options" in body));
    assert.deepEqual(body.text, cached.text);
  }
  assert.notEqual(canonicalStructuredAgentRequestHash(request), canonicalStructuredAgentRequestHash({ ...request, cache_static_instructions: false }));
  pass("cache opt-in is fail-closed and included in request provenance");

  const guidance = { long_note: "Consider the evidence and the context. ".repeat(100) };
  const original = { included_items: [{ item_public_id: "item-a", teacher_diagnostic_context: guidance }],
    item_responses: [
      { item_public_id: "item-a", teacher_diagnostic_context: guidance, reasoning: "Please explain again", confidence: "low" },
      { item_public_id: "item-b", teacher_diagnostic_context: guidance, reasoning: "Other evidence" },
      { item_public_id: "item-a", teacher_diagnostic_context: { long_note: "Different historical guidance" } }
    ] };
  const compact = compactRepeatedDiagnosticContext(original);
  assert(JSON.stringify(compact).length < JSON.stringify(original).length);
  assert.equal(compact.item_responses[0].reasoning, original.item_responses[0].reasoning);
  assert.equal(compact.item_responses[0].confidence, "low");
  assert.deepEqual(compact.item_responses[1], original.item_responses[1]);
  assert.deepEqual(compact.item_responses[2], original.item_responses[2]);
  assert.deepEqual(original.item_responses[0].teacher_diagnostic_context, guidance);
  assert.match(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, /do not shorten useful instruction/);
  assert.match(FORMATIVE_CONVERSATION_V18R2_INSTRUCTIONS, /Do not follow a fixed or preferred word count/);
  pass("only identical diagnostic context is referenced; evidence, requests for repetition, and teaching flexibility remain");

  const events: string[] = [];
  let activityStarted!: () => void;
  const started = new Promise<void>((resolve) => { activityStarted = resolve; });
  await runParallelInitialInterpretation({
    integration: async (ready) => {
      events.push("source_frozen"); ready(); events.push("integration_request");
      await started; events.push("integration_persisted");
    },
    activity: async (beforePersistence) => {
      events.push("activity_request"); activityStarted(); await beforePersistence(); events.push("activity_persisted");
    }
  });
  assert.deepEqual(events, ["source_frozen", "integration_request", "activity_request", "integration_persisted", "activity_persisted"]);
  pass("independent requests overlap only after evidence capture and join before state changes");
  let writes = 0;
  await assert.rejects(runParallelInitialInterpretation({
    integration: async (ready) => { ready(); throw new Error("integration_failed"); },
    activity: async (barrier) => { await barrier(); writes++; }
  }), /integration_failed/);
  assert.equal(writes, 0);
  await assert.rejects(runParallelInitialInterpretation({
    integration: async () => { throw new Error("source_failed"); },
    activity: async () => { writes++; }
  }), /source_failed/);
  assert.equal(writes, 0);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let drained = false;
  const failed = runParallelInitialInterpretation({
    integration: async (ready) => { ready(); await delayed; drained = true; },
    activity: async () => { release(); throw new Error("activity_failed"); }
  });
  await assert.rejects(failed, /activity_failed/);
  assert(drained);
  pass("failures cannot publish partial results or leave a provider branch detached");
  console.log(JSON.stringify({ passed: checks.length, provider_calls: 0, model_auth_requests: 0 }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
