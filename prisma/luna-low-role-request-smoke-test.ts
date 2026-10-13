import assert from "node:assert/strict";
import { z } from "zod";
import { LiveModelRole, modelConfigCompatibilityIssues } from "../src/lib/llm/config";
import { compileOpenAIResponsesRequestBody } from "../src/lib/llm/providers/openai-responses-provider";
import { MIXED_TUTOR_MODEL, MIXED_TUTOR_ROLE, lunaCandidateModelForRole } from "../src/lib/operational/mixed-tutor-identity";

// Compile the real adapter's request without network access. Approval, runtime
// isolation and immutable parent settings have separate amendment regressions.
for (const reasoningEffort of ["low", "medium"] as const) {
for (const role of LiveModelRole.options) {
  const config = { model_name: "gpt-5.6-luna", reasoning_effort: reasoningEffort, max_output_tokens: 3000 };
  assert.deepEqual(modelConfigCompatibilityIssues(role, config), [], role);
  const body = compileOpenAIResponsesRequestBody({
    agent_name: role, model_config: config, instructions: "Synthetic compatibility check",
    input: { message: "Synthetic input" }, output_schema: z.object({ message: z.string() }).strict(),
    schema_name: "luna_effort_compatibility", client_request_id: `synthetic-${reasoningEffort}-${role}`,
    timeout_ms: 60000, cache_static_instructions: true
  });
  assert.equal(body.model, "gpt-5.6-luna", role);
  assert.deepEqual(body.reasoning, { effort: reasoningEffort }, role);
  assert.equal(body.max_output_tokens, config.max_output_tokens, role);
  assert.equal(body.store, false, role);
  assert.equal(body.text.format.type, "json_schema", role);
  assert.equal(body.text.format.strict, true, role);
  assert.equal(body.input, JSON.stringify({ message: "Synthetic input" }), role);
  assert.equal("prompt_cache_options" in body, false, role);
  assert.equal("temperature" in body, false, role);
}
}
assert(modelConfigCompatibilityIssues("student_profiling_agent", {
  model_name: "gpt-5.6-luna", reasoning_effort: "low", max_output_tokens: 0
}).includes("max_output_tokens_not_positive"));
assert(modelConfigCompatibilityIssues("student_profiling_agent", {
  model_name: "gpt-5.6-unapproved", reasoning_effort: "low", max_output_tokens: 3000
}).includes("model_not_allowed_for_agent"));
for (const role of LiveModelRole.options) {
  const config = { model_name: lunaCandidateModelForRole(role, MIXED_TUTOR_MODEL), reasoning_effort: "medium" as const,
    max_output_tokens: role === MIXED_TUTOR_ROLE ? 7000 : 3000 };
  assert.deepEqual(modelConfigCompatibilityIssues(role, config), [], role);
  const request = { agent_name: role, model_config: config, instructions: "Synthetic compatibility check",
    input: { message: "Synthetic input" }, output_schema: z.object({ message: z.string() }).strict(),
    schema_name: "mixed_tutor_compatibility", client_request_id: `synthetic-mixed-${role}`, timeout_ms: 60000 };
  const body = compileOpenAIResponsesRequestBody(request);
  const unchanged = compileOpenAIResponsesRequestBody({ ...request, model_config: { ...config, model_name: "gpt-5.6-luna" } });
  assert.deepEqual(body, { ...unchanged, model: config.model_name }, role);
  assert.deepEqual(body.reasoning, { effort: "medium" }, role);
  assert.equal(body.max_output_tokens, config.max_output_tokens, role);
  assert.equal(body.text.format.strict, true, role);
  assert.equal(body.store, false, role);
  if (role !== MIXED_TUTOR_ROLE) {
    assert(modelConfigCompatibilityIssues(role, { ...config, model_name: MIXED_TUTOR_MODEL }).includes("model_not_allowed_for_agent"), role);
  }
}
assert(modelConfigCompatibilityIssues(MIXED_TUTOR_ROLE, {
  model_name: MIXED_TUTOR_MODEL, reasoning_effort: "none", max_output_tokens: 7000
}).includes("reasoning_effort_not_supported_by_model"));
console.log(JSON.stringify({ passed: true, roles_checked: LiveModelRole.options.length,
  efforts_checked: ["low", "medium"], mixed_tutor_model: MIXED_TUTOR_MODEL,
  requests_compiled: LiveModelRole.options.length * 3, provider_calls: 0 }));
