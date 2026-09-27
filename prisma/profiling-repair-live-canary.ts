import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { OpenAIResponsesProvider } from "../src/lib/llm/providers/openai-responses-provider";
import { CHAT_NATIVE_PROFILE_INSTRUCTIONS, ChatNativeLiveFormativeProfileOutputSchema } from "../src/lib/services/student-assessment/formative-profile";
import { validateSemanticItemReviews } from "../src/lib/services/student-assessment/semantic-item-review";
import { getPromptForAgent } from "../src/lib/agents/prompts/registry";
import { agentOutputSchemas, ProductionStudentProfilingInput } from "../src/lib/agents/contracts";
import { validateStudentProfileOutputSemantics } from "../src/lib/agents/student-profiling/semantic-validation";
import { buildCanonicalEvidenceCatalog } from "../src/lib/domain/canonical-evidence-identity";
import { argValue } from "./operational-model-upgrade-cli-args";

async function main() {
  assert.equal(process.env.RUN_PROFILING_REPAIR_CANARY, "true", "Explicit opt-in for three paid synthetic calls required.");
  loadEnvConfig(process.cwd(), true);
  const directory = path.resolve(argValue("--output-directory") ?? "");
  assert(argValue("--output-directory"));
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const prompt = getPromptForAgent("student_profiling_agent");
  const report = { version: "profiling-v6-scoped-budget-validation-v1", synthetic_only: true, real_student_data_used: false,
    profiling_prompt_hash: prompt.prompt_hash, initial_feedback_prompt_hash: createHash("sha256").update(CHAT_NATIVE_PROFILE_INSTRUCTIONS).digest("hex"),
    regression_passed: false, regression_logs: [] as Array<{ test: string; sha256: string }>,
    calls: [] as Array<Record<string, unknown>> };
  const save = () => writeFileSync(path.join(directory, "validation.json"), JSON.stringify(report, null, 2) + "\n");
  save();
  for (const test of ["stance-evidence-smoke-test", "student-profiling-semantic-validation-smoke-test", "profiling-repair-smoke-test"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", `prisma/${test}.ts`], { encoding: "utf8", timeout: 120000 });
    const log = `${result.stdout}\n${result.stderr}`;
    writeFileSync(path.join(directory, `${test}.log`), log);
    assert.equal(result.status, 0, log);
    report.regression_logs.push({ test, sha256: createHash("sha256").update(log).digest("hex") });
  }
  report.regression_passed = true; save();
  const provider = new OpenAIResponsesProvider({ isolated_evaluation_runtime: {
    purpose: "bounded_candidate_evaluation", request_timeout_ms: 90000 } });
  for (const count of [3, 12]) {
    const responses = Array.from({ length: count }, (_, index) => ({ item_public_id: `synthetic_item_${index + 1}`,
      selected_answer_final: "B", correctness: "correct", confidence_final: "medium", no_tempting_option: true,
      tempting_option_reason: null, reasoning_text_final: [
        "Reliability requires a normal score distribution. Without normality a test cannot be reliable.",
        "Consistency alone does not establish evidence for the intended interpretation.", "I do not know why; I guessed."
      ][index % 3] }));
    const payload = { assessment: { assessment_public_id: "synthetic", title: "Synthetic measurement questions" },
      concept_unit: { learning_objective: "Distinguish reliability and validity." }, item_responses: responses,
      included_items: responses.map(item => ({ item_public_id: item.item_public_id,
        item_stem: "Does high reliability alone establish validity for the intended interpretation?",
        options: [{ label: "A", text: "Yes" }, { label: "B", text: "No" }] })) };
    const result = await provider.executeStructured({ agent_name: "formative_value_and_planning_agent",
      model_config: { model_name: "gpt-5.6-sol", reasoning_effort: "medium", max_output_tokens: 30000 },
      instructions: CHAT_NATIVE_PROFILE_INSTRUCTIONS, input: { response_package: payload },
      output_schema: ChatNativeLiveFormativeProfileOutputSchema, schema_name: "scoped_budget_canary",
      client_request_id: `synthetic_${randomUUID()}`, timeout_ms: 90000 });
    writeFileSync(path.join(directory, `planning-${count}.json`), JSON.stringify(result, null, 2));
    const record = { role: "formative_value_and_planning_agent", model: "gpt-5.6-sol", reasoning_effort: "medium",
      max_output_tokens: 30000, item_count: count, status: result.status, checks_passed: false,
      latency_ms: result.latency_ms, usage: result.usage };
    report.calls.push(record); save();
    assert.equal(result.status, "completed", JSON.stringify(result.error));
    const output = ChatNativeLiveFormativeProfileOutputSchema.parse(result.parsed_output);
    const check = validateSemanticItemReviews(payload, output.semantic_item_reviews, true);
    assert(check.valid, check.issues.join("; "));
    for (const [index, response] of responses.entries()) {
      const review = check.reviews.find(item => item.item_public_id === response.item_public_id)!;
      if (index % 3 === 0) assert(review.misconceptions.length > 0);
      if (index % 3 === 1) { assert(["supported_concise", "supported_precise"].includes(review.reasoning_judgment)); assert.equal(review.misconceptions.length, 0); }
      if (index % 3 === 2) assert.equal(review.reasoning_judgment, "insufficient");
    }
    assert.equal(output.should_reveal_correct_answer, false);
    record.checks_passed = true; save(); console.log(JSON.stringify(record));
  }
  const responses = [
    { item_public_id: "recognition", selected_answer_final: "B", correctness: "correct", reasoning_text_final: "I agree with B's explanation." },
    { item_public_id: "rejection", selected_answer_final: "B", correctness: "correct", reasoning_text_final: "A was tempting but I reject it. Consistency does not establish the intended interpretation." },
    { item_public_id: "endorsement", selected_answer_final: "A", correctness: "incorrect", reasoning_text_final: "I agree with A's explanation: high alpha proves validity." }
  ].map(item => ({ ...item, reasoning_text: item.reasoning_text_final, confidence_rating: "medium", confidence_final: "medium", no_tempting_option: true }));
  const catalog = buildCanonicalEvidenceCatalog({ evidence_namespace_public_id: "synthetic-v6", assessment_public_id: "synthetic",
    concept_unit_public_id: "synthetic-unit", assessment_responses: responses.map(item => ({ item_public_id: item.item_public_id,
      selected_option: item.selected_answer_final, correctness: item.correctness, written_reasoning: item.reasoning_text_final,
      confidence: "medium", tempting_option: null, tempting_option_reason: null })) });
  const input = ProductionStudentProfilingInput.parse({ concept_unit_metadata: { concept_unit_public_id: "synthetic-unit" },
    initial_response_package: { package_type: "initial_concept_unit_response_package", payload: { item_responses: responses,
      included_items: responses.map(item => ({ item_public_id: item.item_public_id,
        item_stem: "Does high alpha by itself establish validity?", correct_option: "B",
        options: [{ label: "A", text: "High alpha proves validity." }, { label: "B", text: "Consistency alone does not establish validity." }] })) } },
    allowed_evidence_catalog: catalog, previous_profile: null, followup_evidence_package: null,
    profile_type: "initial", profiling_constraints: { conservative_inference_required: true } });
  const result = await provider.executeStructured({ agent_name: "student_profiling_agent",
    model_config: { model_name: "gpt-5.6-terra", reasoning_effort: "medium", max_output_tokens: 4000 },
    instructions: prompt.instructions, input, output_schema: agentOutputSchemas.student_profiling_agent,
    schema_name: "profiling_v6_canary", client_request_id: `synthetic_${randomUUID()}`, timeout_ms: 90000 });
  writeFileSync(path.join(directory, "profiling-v6.json"), JSON.stringify(result, null, 2));
  const record = { role: "student_profiling_agent", model: "gpt-5.6-terra", reasoning_effort: "medium", max_output_tokens: 4000,
    item_count: 3, status: result.status, checks_passed: false, latency_ms: result.latency_ms, usage: result.usage };
  report.calls.push(record); save();
  assert.equal(result.status, "completed", JSON.stringify(result.error));
  const output = agentOutputSchemas.student_profiling_agent.parse(result.parsed_output);
  const validation = validateStudentProfileOutputSemantics({ providerInput: input, output });
  assert(validation.ok, validation.issues.join("; "));
  assert.equal(output.item_level_evidence.length, 3);
  assert(output.misconception_indicators.length > 0);
  for (const indicator of output.misconception_indicators) for (const claim of indicator.atomic_claims) {
    assert(claim.source_evidence_references.length > 0);
    for (const id of claim.source_evidence_references) assert(catalog.evidence.some(e => e.evidence_id === id &&
      e.item_public_id === "endorsement" && e.eligibility === "student_understanding"), "A rejection or recognition must not become a misconception.");
  }
  assert.notEqual(output.ability_profile, "robust_transfer_ready_understanding");
  record.checks_passed = true; save(); console.log(JSON.stringify(record));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
