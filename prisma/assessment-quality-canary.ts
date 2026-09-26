import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { OpenAIResponsesProvider } from "../src/lib/llm/providers/openai-responses-provider";
import { CHAT_NATIVE_PROFILE_INSTRUCTIONS, ChatNativeLiveFormativeProfileOutputSchema, validateChatNativeProfileStudentOutput } from "../src/lib/services/student-assessment/formative-profile";
import { validateSemanticItemReviews } from "../src/lib/services/student-assessment/semantic-item-review";
import { ASSESSMENT_QUALITY_CASES, checkAssessmentQualityCase } from "../src/lib/evaluation/assessment-quality-cases";
import { STANCE_QUALITY_CASES } from "../src/lib/evaluation/stance-quality-cases";

async function main() {
  assert.equal(process.env.RUN_ASSESSMENT_QUALITY_CANARY, "true", "Explicit opt-in required: four bounded paid synthetic calls, no student data.");
  loadEnvConfig(process.cwd(), true);
  const model = process.env.ASSESSMENT_QUALITY_MODEL;
  assert(model, "An explicit evaluation model is required.");
  const output = mkdtempSync(join(tmpdir(), "cmcq-assessment-quality-"));
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const config = { model_name: model, reasoning_effort: "medium" as const, max_output_tokens: 16000 };
  const referenceCases = [...ASSESSMENT_QUALITY_CASES, ...STANCE_QUALITY_CASES];
  const frozenAt = new Date().toISOString();
  const sourcePaths = ["prisma/assessment-quality-canary.ts", "src/lib/services/student-assessment/formative-profile.ts",
    "src/lib/services/student-assessment/semantic-item-review.ts", "src/lib/evaluation/assessment-quality-cases.ts", "src/lib/evaluation/stance-quality-cases.ts"];
  const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
  writeFileSync(join(output, "reference-cases.json"), JSON.stringify(referenceCases, null, 2));
  const provider = new OpenAIResponsesProvider({ isolated_evaluation_runtime: {
    purpose: "bounded_candidate_evaluation", request_timeout_ms: 120000
  } });
  const results = [];
  for (let repeat = 0; repeat < 4; repeat++) {
    const bank = repeat % 2 ? STANCE_QUALITY_CASES : ASSESSMENT_QUALITY_CASES;
    const cases = repeat >= 2 ? [...bank].reverse() : bank;
    const payload = { assessment: { assessment_public_id: "synthetic_quality", title: "Synthetic measurement cases" },
      concept_unit: { learning_objective: "Interpret score evidence, scales, reliability and validity." },
      included_items: cases.map(entry => ({ item_public_id: entry.id, item_stem: entry.stem,
        options: entry.options.map((text, index) => ({ label: String.fromCharCode(65 + index), text })) })),
      item_responses: cases.map(entry => ({ item_public_id: entry.id, selected_answer_final: entry.selected,
        correct_option_snapshot: entry.correct, correctness: entry.selected === entry.correct ? "correct" : "incorrect",
        reasoning_text_final: entry.reasoning, confidence_final: "medium",
        no_tempting_option: !entry.tempting_reason, tempting_option_reason: entry.tempting_reason ?? null })) };
    const started = new Date().toISOString();
    const result = await provider.executeStructured({ agent_name: "formative_value_and_planning_agent",
      model_config: config, instructions: CHAT_NATIVE_PROFILE_INSTRUCTIONS,
      input: { task: "synthetic_assessment_quality_probe", response_package: payload },
      output_schema: ChatNativeLiveFormativeProfileOutputSchema, schema_name: "assessment_quality_probe",
      client_request_id: `synthetic_quality_${randomUUID()}`, timeout_ms: 150000 });
    const parsed = ChatNativeLiveFormativeProfileOutputSchema.safeParse(result.parsed_output);
    const verified = validateSemanticItemReviews(payload, parsed.success ? parsed.data.semantic_item_reviews : null, true);
    const studentOutput = parsed.success ? validateChatNativeProfileStudentOutput({
      output: parsed.data, correct_options: cases.map(entry => entry.correct)
    }) : null;
    const checks = cases.map(entry => {
      const review = verified.reviews.find(review => review.item_public_id === entry.id);
      return checkAssessmentQualityCase(entry, review);
    });
    results.push({ repeat, bank: repeat % 2 ? "stance" : "conceptual", order: repeat >= 2 ? "reverse" : "forward", started_at: started,
      status: result.status, provenance_valid: verified.valid, validation_issues: verified.issues,
      student_output_valid: studentOutput?.ok ?? false,
      student_output_issues: studentOutput?.issues ?? parsed.error?.issues ?? [],
      latency_ms: result.latency_ms, usage: result.usage && { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
      error_category: result.error?.category ?? null, checks, output: result.parsed_output ?? null });
    writeFileSync(join(output, "results.json"), JSON.stringify({ version: "assessment-quality-probe-v2", criteria_frozen_at: frozenAt, source_hashes: sourceHashes,
      config, config_sha256: hash(config), prompt_sha256: hash(CHAT_NATIVE_PROFILE_INSTRUCTIONS),
      cases_sha256: hash(referenceCases), reference_standard: "developer_proposed_not_expert_validated",
      high_stakes_authorized: false, results }, null, 2));
    console.log(JSON.stringify({ repeat, status: result.status, provenance_valid: verified.valid,
      student_output_valid: studentOutput?.ok ?? false,
      checks_met: checks.filter(check => check.expectation_met).length, cases: checks.length, latency_ms: result.latency_ms }));
    // Provider failure is evidence to investigate, not permission for extra calls.
    if (result.status !== "completed") break;
  }
  console.log(`Synthetic review packet: ${output}. Independent review required; this is not evidence of student learning gains.`);
  process.exitCode = results.length === 4 && results.every(result => result.provenance_valid && result.student_output_valid && result.checks.every(check => check.expectation_met)) ? 0 : 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "quality_canary_failed"); process.exitCode = 1; });
