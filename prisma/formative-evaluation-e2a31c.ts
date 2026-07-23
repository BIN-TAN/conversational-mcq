import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  E2A31C_ARTIFACT_NAMES,
  E2A31C_SOURCE_RUN_DIR,
  E2A31C_SOURCE_RUN_ID,
  E2A31C_STATUS,
  executeE2A31C,
  loadE2A31CRun,
  removeTemporaryE2A31CArtifactRoot,
  temporaryE2A31CArtifactRoot,
  validateE2A31CArtifacts
} from "@/lib/evaluation/formative/e2a31c-turn5-sound-adjudication";

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

async function runSmoke(suite: string) {
  const artifactRoot = temporaryE2A31CArtifactRoot();
  const sourceSummaryPath = path.join(
    E2A31C_SOURCE_RUN_DIR,
    "canary-summary.json"
  );
  const sourceHumanReviewPath = path.join(
    E2A31C_SOURCE_RUN_DIR,
    "human-review-packet.json"
  );
  const sourceSummaryBefore = readFileSync(sourceSummaryPath);
  const sourceHumanReviewBefore = readFileSync(sourceHumanReviewPath);
  try {
    const result = await executeE2A31C({ artifactRoot });
    assert(result.summary.status === E2A31C_STATUS,
      "e2a31c summary status mismatch");
    assert(result.turns.length === 5,
      "e2a31c reconstruction did not include turns 1 through 5");
    const turn3 = result.turns.find((entry) => entry.turn === 3);
    const turn5 = result.turns.find((entry) => entry.turn === 5);
    assert(turn3 && !turn3.sound_gate_result.passed &&
      turn3.anchor_evidence.propagated_stance === "endorses_distractor" &&
      turn3.contradiction_status.blocking,
    "e2a31c turn 3 repaired boundary was not preserved");
    assert(turn5 && turn5.sound_gate_result.passed &&
      turn5.mapped_profile.reasoning_quality === "sound" &&
      turn5.mapped_profile.revision_readiness &&
      turn5.anchor_evidence.propagated_application === "explicit" &&
      turn5.anchor_evidence.propagated_stance === "rejects_distractor" &&
      turn5.anchor_evidence.propagated_consistency ===
        "consistent_with_conceptual_reasoning" &&
      turn5.anchor_evidence.propagated_resolution_status ===
        "resolved_against_distractor" &&
      turn5.mapped_profile.essential_missing_links.length === 0 &&
      turn5.contradiction_status.observation_contradictions.length === 0,
    "e2a31c turn 5 production sound-gate replay failed");
    assert(!turn5.frozen_oracle_comparison.inside_frozen_semantic_envelope &&
      turn5.frozen_oracle_comparison.simulator_instruction_adherence ===
        "violated_no_final_stance_constraint",
    "e2a31c frozen trajectory mismatch was not isolated");
    assert(result.aiAdjudication.selected_outcome ===
      "frozen_trajectory_oracle_overconstraint" &&
      result.aiAdjudication.human_review_complete === false &&
      result.aiAdjudication.human_reviewer === null,
    "e2a31c adjudication provenance is invalid");
    assert(result.oracleDiagnosis.responsibility_split.evaluator_accuracy ===
      "passed" &&
      result.oracleDiagnosis.responsibility_split
        .simulator_trajectory_adherence === "failed" &&
      !result.oracleDiagnosis.responsibility_split.tutor_candidate_implicated &&
      !result.oracleDiagnosis.responsibility_split.evaluator_v5_implicated,
    "e2a31c semantic-oracle responsibility diagnosis failed");
    assert(result.humanReviewEnhancement.source_packet_binding
      .source_packet_mutated === false &&
      result.humanReviewEnhancement.turn_review_rows.length === 5 &&
      result.humanReviewEnhancement.human_review_complete === false &&
      result.humanReviewEnhancement.human_reviewer === null,
    "e2a31c human-review enhancement boundary failed");
    assert(result.e2a32Decision.preparation_allowed &&
      !result.e2a32Decision.live_execution_authorized &&
      !result.e2a32Decision.provider_dispatch_authorized &&
      !result.e2a32Decision.candidate_approved &&
      !result.e2a32Decision.candidate_activated,
    "e2a31c E2A.32 decision boundary failed");
    assert(result.artifactValidation.passed &&
      result.artifactValidation.actual_artifact_count ===
        E2A31C_ARTIFACT_NAMES.length &&
      validateE2A31CArtifacts(result.runDir).passed,
    "e2a31c artifact validation failed");
    assert(Buffer.compare(
      sourceSummaryBefore,
      readFileSync(sourceSummaryPath)
    ) === 0 && Buffer.compare(
      sourceHumanReviewBefore,
      readFileSync(sourceHumanReviewPath)
    ) === 0, "e2a31c immutable source evidence changed");
    assert(result.summary.provider_calls_made === 0 &&
      result.summary.network_requests_made === 0 &&
      result.summary.live_rerun_executed === false,
    "e2a31c no-live boundary failed");
    console.log(JSON.stringify({
      status: "passed",
      suite,
      source_run_id: E2A31C_SOURCE_RUN_ID,
      adjudication_run_id: result.runId,
      selected_outcome: result.aiAdjudication.selected_outcome,
      turn5_sound_gate_passed: turn5.sound_gate_result.passed,
      turn5_revision_readiness: turn5.mapped_profile.revision_readiness,
      e2a32_preparation_allowed:
        result.e2a32Decision.preparation_allowed,
      e2a32_live_execution_authorized:
        result.e2a32Decision.live_execution_authorized,
      source_evidence_unchanged:
        result.summary.source_evidence_unchanged,
      artifact_count: result.artifactValidation.actual_artifact_count,
      provider_calls_made: 0,
      network_requests_made: 0
    }, null, 2));
  } finally {
    removeTemporaryE2A31CArtifactRoot(artifactRoot);
  }
}

async function main() {
  const command = process.argv[2] ?? "report";
  const suite = argument("--suite") ?? "all";
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a31c_network_request_prohibited");
  }) as typeof fetch;
  try {
    assert(existsSync(E2A31C_SOURCE_RUN_DIR),
      "e2a31c immutable source run is missing");
    if (command === "run") {
      const result = await executeE2A31C();
      assert(networkRequestCount === 0,
        "e2a31c run attempted a network request");
      console.log(JSON.stringify({
        status: result.summary.status,
        run_id: result.runId,
        run_directory: result.runDir,
        source_run_id: E2A31C_SOURCE_RUN_ID,
        selected_outcome: result.aiAdjudication.selected_outcome,
        production_sound_gate_passed:
          result.summary.production_sound_gate_passed,
        human_review_complete: result.summary.human_review_complete,
        e2a32_preparation_allowed:
          result.e2a32Decision.preparation_allowed,
        e2a32_live_execution_authorized:
          result.e2a32Decision.live_execution_authorized,
        source_evidence_unchanged:
          result.summary.source_evidence_unchanged,
        provider_calls_made: 0,
        network_requests_made: networkRequestCount
      }, null, 2));
      return;
    }
    if (command === "smoke") {
      await runSmoke(suite);
      assert(networkRequestCount === 0,
        "e2a31c smoke attempted a network request");
      return;
    }
    if (command === "report") {
      const runId = argument("--run");
      if (!runId) throw new Error("e2a31c_run_id_required");
      const result = loadE2A31CRun(runId);
      assert(networkRequestCount === 0,
        "e2a31c report attempted a network request");
      console.log(JSON.stringify({
        run_id: runId,
        run_directory: result.runDir,
        summary: result.summary,
        ai_adjudication: result.aiAdjudication,
        semantic_oracle_diagnosis: result.oracleDiagnosis,
        human_review_packet_enhancement:
          result.humanReviewEnhancement,
        e2a32_preparation_decision: result.e2a32Decision,
        artifact_validation: result.artifactValidation,
        provider_calls_made: 0,
        network_requests_made: networkRequestCount
      }, null, 2));
      return;
    }
    if (command === "inspect-source") {
      const summary = readJson<Record<string, unknown>>(
        path.join(E2A31C_SOURCE_RUN_DIR, "canary-summary.json")
      );
      console.log(JSON.stringify({
        source_run_id: E2A31C_SOURCE_RUN_ID,
        source_summary: summary,
        source_evidence_mutated: false,
        provider_calls_made: 0,
        network_requests_made: networkRequestCount
      }, null, 2));
      return;
    }
    throw new Error(`e2a31c_unknown_command:${command}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a31c_command_failed");
  process.exitCode = 1;
});
