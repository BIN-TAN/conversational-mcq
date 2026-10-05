import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLlmProvider } from "../src/lib/llm/providers/provider-factory";
import { getLlmRuntimeConfig, resolveAgentModelConfig, resolveOpenAIModelConfigForRole } from "../src/lib/llm/config";
import { ChatNativeLiveFormativeProfileOutputSchema, CHAT_NATIVE_PROFILE_INSTRUCTIONS, validateChatNativeProfileStudentOutput } from "../src/lib/services/student-assessment/formative-profile";
import { normalizeChoiceOnlyAnnotations, validateSemanticItemReviews } from "../src/lib/services/student-assessment/semantic-item-review";
import { ITEM_ADMINISTRATION_TUTOR_INSTRUCTIONS, ItemAdministrationTutorOutputSchema, buildItemAdministrationTutorStatePacket, canonicalizeTutorOutput, validateTutorOutput, type ItemAdministrationTutorStatePacket } from "../src/lib/services/student-assessment/item-administration-tutor";

// Opt-in, bounded synthetic provider test. No database reads or student writes.
async function main() {
  assert(process.argv.includes("--allow-live-synthetic"), "Explicit live opt-in required");
  const runtime = getLlmRuntimeConfig();
  assert(runtime.live_calls_enabled && runtime.provider === "openai");
  const provider = createLlmProvider();
  let passed = 0;
  for (const mixed of [true, false]) {
    const state: ItemAdministrationTutorStatePacket = {
      assessment_state: "AWAIT_REASON", item_public_id: "synthetic-alpha", item_order: 1,
      item_role: "initial", required_evidence_type: "reasoning", selected_option: "A",
      latest_student_message: mixed
        ? "Alpha describes internal consistency, not whether one dimension explains the items. Could you explain dimensionality after I finish?"
        : "Could you explain dimensionality?",
      correctness_feedback_prohibited: true, prior_uncertainty: false
    };
    const result = await provider.executeStructured({ agent_name: "response_collection_agent",
      model_config: resolveOpenAIModelConfigForRole("item_administration_tutor_agent"),
      instructions: ITEM_ADMINISTRATION_TUTOR_INSTRUCTIONS, input: buildItemAdministrationTutorStatePacket(state),
      output_schema: ItemAdministrationTutorOutputSchema, schema_name: "session_review_tutor_probe",
      client_request_id: randomUUID(), timeout_ms: runtime.request_timeout_ms });
    assert.equal(result.status, "completed");
    const parsed = ItemAdministrationTutorOutputSchema.parse(result.parsed_output);
    const output = canonicalizeTutorOutput({ output: parsed, state_packet: state });
    assert(validateTutorOutput({ output, state_packet: state }).ok);
    assert.equal(output.should_advance, mixed);
    assert(output.should_store_deferred_concern && output.deferred_concern_summary);
    console.log(JSON.stringify({ scenario: mixed ? "reasoning_plus_question" : "question_only", passed: true,
      response_id: result.provider_response_id, latency_ms: result.latency_ms, output }));
    passed++;
  }
  for (const reasoning of [".", "I cannot explain why yet."]) {
    const items = [
      { item_public_id: "synthetic-mean", item_stem: "Is the mean of three independent scores necessarily the exact true score?",
        options: [{ label: "A", text: "Yes, three scores remove all random error." }, { label: "B", text: "No, it is an estimate; finite sampling error remains." }] },
      { item_public_id: "synthetic-alpha", item_stem: "Does high alpha alone establish validity?",
        options: [{ label: "A", text: "No, internal consistency does not establish the intended interpretation." }, { label: "B", text: "Yes, alpha proves validity." }] },
      { item_public_id: "synthetic-percentile", item_stem: "Does changing a reference group change an unchanged raw score?",
        options: [{ label: "A", text: "No, relative standing can change while the raw score stays the same." }, { label: "B", text: "Yes, the raw score must rise." }] }
    ];
    const responses = items.map((item, index) => ({ item_public_id: item.item_public_id, item_order: index + 1,
      selected_answer_final: index === 0 ? "B" : "A", confidence_final: "high", correctness: true,
      reasoning_text_final: index === 0 ? reasoning : index === 1
        ? "Consistent items could all measure the wrong construct, so alpha alone cannot establish validity."
        : "Changing who I am compared with changes relative standing, not my unchanged raw score.",
      no_tempting_option: true, tempting_option: null, tempting_option_reason: null }));
    const pkg = { included_items: items, item_responses: responses };
    const result = await provider.executeStructured({ agent_name: "formative_value_and_planning_agent",
      model_config: resolveAgentModelConfig("formative_value_and_planning_agent"),
      instructions: CHAT_NATIVE_PROFILE_INSTRUCTIONS, input: { task: "Prepare formative feedback for this synthetic completed package.", response_package: pkg },
      output_schema: ChatNativeLiveFormativeProfileOutputSchema, schema_name: "session_review_profile_probe",
      client_request_id: randomUUID(), timeout_ms: runtime.request_timeout_ms });
    assert.equal(result.status, "completed");
    const output = ChatNativeLiveFormativeProfileOutputSchema.parse(result.parsed_output);
    const normalized = normalizeChoiceOnlyAnnotations(pkg, output.semantic_item_reviews);
    const evidence = validateSemanticItemReviews(pkg, normalized.reviews, true);
    assert(evidence.valid, JSON.stringify(evidence.issues));
    assert(validateChatNativeProfileStudentOutput({ output, correct_options: ["B", "A", "A"] }).ok);
    assert.equal(evidence.reviews.find(r => r.item_public_id === "synthetic-mean")?.reasoning_judgment, "insufficient");
    console.log(JSON.stringify({ scenario: reasoning === "." ? "punctuation_reason" : "uncertain_reason", passed: true,
      response_id: result.provider_response_id, latency_ms: result.latency_ms,
      normalizations: normalized.removed.length, output }));
    passed++;
  }
  console.log(JSON.stringify({ passed, synthetic_only: true, database_reads: 0, database_writes: 0, full_dialogue_test: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
