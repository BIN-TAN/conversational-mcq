import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { OpenAIResponsesProvider } from "../src/lib/llm/providers/openai-responses-provider";
import { CHAT_NATIVE_PROFILE_INSTRUCTIONS, ChatNativeLiveFormativeProfileOutputSchema, type ChatNativeFormativeProfileOutput } from "../src/lib/services/student-assessment/formative-profile";
import type { StructuredAgentResult } from "../src/lib/llm/providers/types";
import { validateSemanticItemReviews } from "../src/lib/services/student-assessment/semantic-item-review";

async function main() {
  assert.equal(process.env.RUN_SEMANTIC_REVIEW_CANARY, "true", "Explicit opt-in required for two paid calls with synthetic text only.");
  loadEnvConfig(process.cwd(), true);
  const model = process.env.SEMANTIC_REVIEW_CANARY_MODEL;
  assert(model, "Choose the model explicitly; this test never changes runtime settings.");
  const tokens = Number(process.env.SEMANTIC_REVIEW_CANARY_TOKENS ?? 3000);
  assert(Number.isInteger(tokens) && tokens >= 3000 && tokens <= 16000);
  const provider = new OpenAIResponsesProvider({ isolated_evaluation_runtime: {
    purpose: "bounded_candidate_evaluation", request_timeout_ms: 120000
  } });
  for (const count of [3, 12]) {
    const responses = Array.from({ length: count }, (_, index) => ({
      item_public_id: `synthetic_item_${index + 1}`, selected_answer_final: "B", correctness: "correct",
      confidence_final: "medium", no_tempting_option: true, tempting_option_reason: null,
      reasoning_text_final: [
        "Reliability requires a normal score distribution. Without normality a test cannot be reliable.",
        "Consistency alone does not establish evidence for the intended interpretation.",
        "I do not know why; I guessed."
      ][index % 3]
    }));
    const payload = {
      assessment: { assessment_public_id: "synthetic_canary", title: "Synthetic measurement questions" },
      concept_unit: { learning_objective: "Distinguish reliability and validity evidence." },
      item_responses: responses,
      included_items: responses.map(item => ({ item_public_id: item.item_public_id,
        item_stem: "Does high score reliability by itself establish validity for the intended interpretation?",
        options: [{ label: "A", text: "Yes" }, { label: "B", text: "No" }] }))
    };
    const result: StructuredAgentResult<ChatNativeFormativeProfileOutput> = await provider.executeStructured({
      agent_name: "formative_value_and_planning_agent", model_config: { model_name: model, reasoning_effort: "medium", max_output_tokens: tokens },
      instructions: CHAT_NATIVE_PROFILE_INSTRUCTIONS, input: { task: "synthetic_semantic_review_canary", response_package: payload },
      output_schema: ChatNativeLiveFormativeProfileOutputSchema, schema_name: "semantic_review_canary",
      client_request_id: `synthetic_semantic_${randomUUID()}`, timeout_ms: 180000
    });
    console.log(JSON.stringify({ count, model, tokens, status: result.status, usage: result.usage && { input: result.usage.input_tokens, output: result.usage.output_tokens }, latency_ms: result.latency_ms, error: result.error?.category }));
    assert.equal(result.status, "completed", "Synthetic review must finish within the configured output budget.");
    const parsed = ChatNativeLiveFormativeProfileOutputSchema.parse(result.parsed_output);
    const validated = validateSemanticItemReviews(payload, parsed.semantic_item_reviews);
    assert.equal(validated.valid, true, validated.issues.join(", "));
    for (const [index, response] of responses.entries()) {
      const review = validated.reviews.find(item => item.item_public_id === response.item_public_id)!;
      if (index % 3 === 0) assert(review.misconceptions.length > 0, "Correct choice must not erase a false normality requirement.");
      if (index % 3 === 1) {
        assert(["supported_concise", "supported_precise"].includes(review.reasoning_judgment));
        assert.equal(review.misconceptions.length, 0);
      }
      if (index % 3 === 2) assert.equal(review.reasoning_judgment, "insufficient");
    }
    console.log(`PASS ${count}-item semantic evidence canary`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
