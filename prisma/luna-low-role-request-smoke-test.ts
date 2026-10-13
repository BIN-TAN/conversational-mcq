import assert from "node:assert/strict";
import { z } from "zod";
import { LiveModelRole, modelConfigCompatibilityIssues } from "../src/lib/llm/config";
import { compileOpenAIResponsesRequestBody } from "../src/lib/llm/providers/openai-responses-provider";

// Compile the real adapter's request without network access. Approval, runtime
// isolation and immutable parent settings have separate amendment regressions.
for (const role of LiveModelRole.options) {
  const config = { model_name: "gpt-5.6-luna", reasoning_effort: "low" as const, max_output_tokens: 3000 };
  assert.deepEqual(modelConfigCompatibilityIssues(role, config), [], role);
  const body = compileOpenAIResponsesRequestBody({
    agent_name: role, model_config: config, instructions: "Synthetic compatibility check",
    input: { message: "Synthetic input" }, output_schema: z.object({ message: z.string() }).strict(),
    schema_name: "luna_low_compatibility", client_request_id: `synthetic-${role}`,
    timeout_ms: 60000, cache_static_instructions: true
  });
  assert.equal(body.model, "gpt-5.6-luna", role);
  assert.deepEqual(body.reasoning, { effort: "low" }, role);
  assert.equal(body.max_output_tokens, config.max_output_tokens, role);
  assert.equal(body.store, false, role);
  assert.equal(body.text.format.type, "json_schema", role);
  assert.equal(body.text.format.strict, true, role);
  assert.equal(body.input, JSON.stringify({ message: "Synthetic input" }), role);
  assert.equal("prompt_cache_options" in body, false, role);
  assert.equal("temperature" in body, false, role);
}
assert(modelConfigCompatibilityIssues("student_profiling_agent", {
  model_name: "gpt-5.6-luna", reasoning_effort: "low", max_output_tokens: 0
}).includes("max_output_tokens_not_positive"));
assert(modelConfigCompatibilityIssues("student_profiling_agent", {
  model_name: "gpt-5.6-unapproved", reasoning_effort: "low", max_output_tokens: 3000
}).includes("model_not_allowed_for_agent"));
console.log(JSON.stringify({ passed: true, roles_checked: LiveModelRole.options.length, provider_calls: 0 }));
