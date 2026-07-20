import { readFileSync } from "node:fs";
import path from "node:path";
import {
  E2A20_ARTIFACT_NAMES,
  E2A20_EXPECTED_E2A19_STATUS,
  E2A20_ORCHESTRATION_VERSION,
  executeE2A20,
  loadE2A20Run,
  removeTemporaryE2A20ArtifactRoot,
  runE2A20DeterministicTransitionTests,
  temporaryE2A20ArtifactRoot,
  validateE2A20Artifacts,
  validateE2A21BudgetDraft,
  validateE2A21ProtocolDraft
} from "@/lib/evaluation/formative/e2a20-evidence-driven-transition-adjudication";
import {
  E2A18_SIMULATOR_CONTRACT_VERSION,
  E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION
} from "@/lib/evaluation/formative/e2a18-student-simulator-contract-v2";
import {
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH
} from "@/lib/evaluation/formative/e2a17-protocol";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

async function main() {
  const suite = argument("--suite") ?? "all";
  const artifactRoot = temporaryE2A20ArtifactRoot();
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a20_network_request_prohibited");
  }) as typeof fetch;
  try {
    const deterministic = runE2A20DeterministicTransitionTests();
    assert(deterministic.passed,
      "e2a20 deterministic transition policy failed");
    assert(deterministic.case_count === 8,
      "e2a20 deterministic transition case count mismatch");
    const protocol = validateE2A21ProtocolDraft();
    const budget = validateE2A21BudgetDraft();
    assert(protocol.passed, "e2a21 protocol validation failed");
    assert(budget.passed, "e2a21 budget validation failed");

    const result = await executeE2A20({ artifactRoot });
    const loaded = {
      summary: readJson<Record<string, unknown>>(
        path.join(result.runDir, "summary.json")
      ),
      reconstruction: readJson<{
        simulator_turn_count: number;
        completed_tutor_turn_count: number;
        simulator_turns: Array<{
          turn_number: number;
          within_evidence_ceiling: boolean;
          persisted: boolean;
        }>;
      }>(path.join(result.runDir, "e2a19-session-reconstruction.json")),
      turn4: readJson<{
        exact_student_message: string;
        observed_evidence_level: string;
        within_ceiling: boolean;
        turn_should_persist: boolean;
        fourth_tutor_response_should_be_generated: boolean;
        session_should_continue_to_remaining_turn_budget: boolean;
        legitimate_abort_rule_triggered: boolean;
      }>(path.join(result.runDir, "turn4-adjudication.json")),
      replay: readJson<{
        provider_call_count: number;
        historical_status_changed: boolean;
        counterfactual_result: {
          exact_indeterminate_point: string;
          fabricated_tutor_output: boolean;
        };
      }>(path.join(result.runDir, "historical-e2a19-replay.json")),
      integrity: readJson<{
        result: string;
        e2a19_passed: boolean;
        artifact_count: number;
      }>(path.join(
        result.runDir, "e2a19-derived-integrity-adjudication.json"
      )),
      review: readJson<{
        review_item_count: number;
        candidate_quality_blocker: boolean;
        rows: Array<{
          human_review: Record<string, unknown>;
        }>;
      }>(path.join(result.runDir, "tutor-output-review-packet.json")),
      compilation: readJson<{
        all_17_roles_compile: boolean;
        network_request_count: number;
        provider_call_count: number;
        passed: boolean;
      }>(path.join(result.runDir, "all-role-request-compilation.json")),
      delta: readJson<{
        orchestration_version: string;
        unchanged: {
          evidence_classifier_version: string;
          tutor_candidate_hash: string;
          tutor_candidate_file_sha256: string;
          tutor_prompts: boolean;
          tutor_schemas: boolean;
        };
      }>(path.join(result.runDir, "transition-policy-delta.json"))
    };

    assert(result.summary.status ===
      "e2a20_orchestration_corrected_e2a21_ready",
    "e2a20 final status mismatch");
    assert(result.summary.source_e2a19_status === E2A20_EXPECTED_E2A19_STATUS,
      "e2a20 historical status changed");
    assert(loaded.reconstruction.simulator_turn_count === 4 &&
      loaded.reconstruction.completed_tutor_turn_count === 3,
    "e2a20 exact reconstruction count mismatch");
    assert(loaded.reconstruction.simulator_turns.every((entry) =>
      entry.within_evidence_ceiling
    ), "e2a20 replay found an above-ceiling E2A.19 turn");
    assert(loaded.turn4.observed_evidence_level === "partial" &&
      loaded.turn4.within_ceiling && loaded.turn4.turn_should_persist &&
      loaded.turn4.fourth_tutor_response_should_be_generated &&
      loaded.turn4.session_should_continue_to_remaining_turn_budget &&
      !loaded.turn4.legitimate_abort_rule_triggered,
    "e2a20 turn-4 adjudication mismatch");
    assert(loaded.turn4.exact_student_message.includes(
      "The closer an examinee’s theta is to Item 16’s difficulty"
    ), "e2a20 exact turn-4 message mismatch");
    assert(loaded.replay.provider_call_count === 0 &&
      !loaded.replay.historical_status_changed &&
      !loaded.replay.counterfactual_result.fabricated_tutor_output &&
      loaded.replay.counterfactual_result.exact_indeterminate_point ===
      "after_turn_4_tutor_request_construction_before_tutor_provider_dispatch",
    "e2a20 replay boundary mismatch");
    assert(loaded.integrity.result ===
      "evidence_complete_for_documented_turn4_abort" &&
      loaded.integrity.e2a19_passed === false &&
      loaded.integrity.artifact_count === 26,
    "e2a20 derived integrity mismatch");
    assert(loaded.review.review_item_count === 3 &&
      !loaded.review.candidate_quality_blocker &&
      loaded.review.rows.every((entry) => Object.values(
        entry.human_review
      ).every((value) => value === null)),
    "e2a20 tutor review packet mismatch");
    assert(loaded.compilation.passed && loaded.compilation.all_17_roles_compile &&
      loaded.compilation.network_request_count === 0 &&
      loaded.compilation.provider_call_count === 0,
    "e2a20 request compilation failed");
    assert(loaded.delta.orchestration_version === E2A20_ORCHESTRATION_VERSION &&
      loaded.delta.unchanged.evidence_classifier_version ===
      E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION &&
      loaded.delta.unchanged.tutor_candidate_hash === E2A17_CANDIDATE_HASH &&
      loaded.delta.unchanged.tutor_candidate_file_sha256 ===
      E2A17_CANDIDATE_FILE_SHA256 && loaded.delta.unchanged.tutor_prompts &&
      loaded.delta.unchanged.tutor_schemas,
    "e2a20 protected contract delta mismatch");
    assert(E2A18_SIMULATOR_CONTRACT_VERSION ===
      "e2a18-student-simulator-contract-v2",
    "e2a20 simulator contract changed");
    assert(E2A20_ARTIFACT_NAMES.length === 17,
      "e2a20 artifact count mismatch");
    assert(validateE2A20Artifacts(result.runDir).passed,
      "e2a20 emitted artifact validation failed");
    assert(loadE2A20Run(result.runId, artifactRoot).artifactValidation.passed,
      "e2a20 report loader validation failed");
    assert(networkRequestCount === 0,
      "e2a20 made a network request");

    console.log(JSON.stringify({
      status: "passed",
      suite,
      run_id: result.runId,
      source_e2a19_status: result.summary.source_e2a19_status,
      orchestration_version: E2A20_ORCHESTRATION_VERSION,
      deterministic_transition_case_count: deterministic.case_count,
      deterministic_transition_pass_count: deterministic.pass_count,
      exact_turn4_reconstructed: true,
      historical_replay_indeterminate_after_turn4_tutor_request: true,
      derived_integrity_result: loaded.integrity.result,
      e2a21_protocol_valid: protocol.passed,
      e2a21_budget_valid: budget.passed,
      all_17_roles_compile: loaded.compilation.all_17_roles_compile,
      provider_call_count: 0,
      network_request_count: networkRequestCount,
      candidate_approved: false,
      candidate_activated: false
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    removeTemporaryE2A20ArtifactRoot(artifactRoot);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a20_smoke_failed");
  process.exitCode = 1;
});
