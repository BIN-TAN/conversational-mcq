import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildE2A18CalibrationCorpus,
  buildE2A18MutationResults,
  executeE2A18Adjudication,
  evaluateE2A18CalibrationCorpus,
  validateE2A19BudgetDraft,
  validateE2A19ProtocolDraft
} from "@/lib/evaluation/formative/e2a18-simulator-contract-adjudication";
import { validateLlmStudentSimulatorOutputV2 } from
  "@/lib/evaluation/formative/e2a18-student-simulator-contract-v2";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function executeTemporary() {
  const root = path.join(os.tmpdir(), `e2a18-smoke-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    return await executeE2A18Adjudication({
      artifactRoot: root,
      runId: "e2a18_no_live_smoke",
      generatedAt: "2026-07-20T00:00:00.000Z"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runSuite(suite: string) {
  if (["calibration", "evidence-span"].includes(suite)) {
    const corpus = buildE2A18CalibrationCorpus();
    const results = evaluateE2A18CalibrationCorpus(corpus);
    assert(corpus.length >= 48, "e2a18_calibration_corpus_too_small");
    assert(results.every((row) => row.passed),
      "e2a18_calibration_case_failed");
    assert(results.filter((row) => !row.actual_accept).every((row) =>
      row.rejection_grounded_by_exact_span === true),
    "e2a18_rejection_without_exact_span");
    const contractResults = corpus.map((testCase) => {
      const result = validateLlmStudentSimulatorOutputV2({
        conceptual_anchor: testCase.conceptual_anchor,
        simulator_input: {
          scenario_id: testCase.case_id,
          scenario_version: "e2a18-calibration-v1",
          expression_variant: 1,
          student_persona: {
            conceptual_state: testCase.hidden_misconception_category,
            task_understanding: "clear",
            engagement: "adequate",
            confidence: "medium",
            communication_style: "concise"
          },
          misconception_context: {
            misconception_id: testCase.hidden_misconception_category,
            student_belief_description:
              testCase.hidden_misconception_category,
            focus_item_reference: "Calibration item",
            focus_option_reference: "Z"
          },
          permitted_response: {
            intent: "partial_explanation",
            substantive_evidence_level:
              testCase.authorized_evidence_ceiling,
            may_show_task_improvement: true,
            may_show_conceptual_improvement: true,
            must_preserve_misconception: false,
            must_remain_off_topic: false,
            must_request_clarification: false,
            must_avoid_claiming_resolution: false
          },
          visible_conversation: [],
          latest_assistant_message: "Explain your current thinking.",
          style_constraints: {
            maximum_sentences: 5,
            preferred_length: "medium",
            avoid_expert_language: false,
            allow_grammar_imperfection: true,
            avoid_excessive_cooperation: true
          }
        },
        output: {
          student_message: testCase.visible_student_message,
          rendered_intent: "partial_explanation",
          expressed_evidence_level: testCase.expected_observed_level,
          mentions_focus_option: false,
          asks_for_clarification: false,
          claims_understanding: false,
          off_topic: false,
          simulator_warnings: []
        }
      });
      return result.evidence_adjudication.accepted ===
        testCase.expected_accept;
    });
    assert(contractResults.every(Boolean),
      "e2a18_contract_wrapper_calibration_failed");
    const categories = new Set(corpus.map((row) => row.category));
    assert(categories.size === 6, "e2a18_calibration_category_missing");
    return {
      corpus_size: corpus.length,
      pass_count: results.filter((row) => row.passed).length,
      rejected_count: results.filter((row) => !row.actual_accept).length,
      all_rejections_span_grounded: true,
      contract_wrapper_case_count: contractResults.length
    };
  }
  if (suite === "mutation") {
    const results = buildE2A18MutationResults();
    assert(results.every((row) => row.passed), "e2a18_mutation_failed");
    return { mutation_count: results.length, pass_count: results.length };
  }
  if (suite === "e2a19-protocol") {
    const result = validateE2A19ProtocolDraft();
    assert(result.passed, "e2a19_protocol_invalid");
    return {
      protocol_hash: result.protocol.frozen_protocol_hash,
      session_count: result.protocol.session_count,
      maximum_student_turns: result.protocol.maximum_student_turns
    };
  }
  if (suite === "e2a19-budget") {
    const result = validateE2A19BudgetDraft();
    assert(result.passed, "e2a19_budget_invalid");
    return result.budget;
  }
  const result = await executeTemporary();
  assert(result.summary.provider_calls_made === 0,
    "e2a18_provider_call_detected");
  assert(result.summary.tutor_candidate_unchanged === true,
    "e2a18_tutor_candidate_changed");
  assert(result.summary.protected_evidence_unchanged === true,
    "e2a18_protected_evidence_changed");
  assert(result.artifactValidation.passed,
    "e2a18_artifact_validation_failed");
  if (suite === "replay") {
    assert(result.summary.same_exact_output_now_accepted === true,
      "e2a18_historical_output_not_accepted");
    assert(result.summary.original_observed_level === "substantive",
      "e2a18_original_level_mismatch");
    assert(result.summary.independently_adjudicated_level === "partial",
      "e2a18_corrected_level_mismatch");
  }
  if (suite === "hidden-state") {
    assert(result.summary.hidden_state_mapping_tests_passed === true,
      "e2a18_hidden_state_mapping_failed");
  }
  if (suite === "artifact-integrity") {
    assert(result.summary.abort_aware_integrity_result ===
      "evidence_complete_for_documented_early_abort",
    "e2a18_abort_aware_integrity_failed");
  }
  if (suite === "request-compilation") {
    assert(result.summary.request_compilation_passed === true,
      "e2a18_request_compilation_failed");
  }
  if (suite === "provider-guard") {
    assert(result.summary.provider_calls_made === 0,
      "e2a18_provider_guard_failed");
  }
  return {
    status: result.summary.status,
    artifact_count: result.artifactValidation.actual_artifact_count,
    historical_output_accepted:
      result.summary.same_exact_output_now_accepted,
    abort_aware_integrity_result:
      result.summary.abort_aware_integrity_result,
    request_compilation_passed:
      result.summary.request_compilation_passed
  };
}

async function main() {
  const suite = argument("--suite") ?? "all";
  const result = await runSuite(suite);
  console.log(JSON.stringify({
    status: "passed",
    suite,
    provider_calls_made: 0,
    result
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a18_smoke_failed");
  process.exitCode = 1;
});
