import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  E2A33C_ARTIFACT_NAMES,
  E2A33C_SOURCE_RUN_DIR,
  E2A33C_SOURCE_RUN_ID,
  E2A33C_STATUS,
  executeE2A33C,
  loadE2A33CRun,
  removeTemporaryE2A33CArtifactRoot,
  runE2A33CDeterministicRegressions,
  temporaryE2A33CArtifactRoot,
  validateE2A33CArtifacts
} from "@/lib/evaluation/formative/e2a33c-false-sound-adjudication";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function runSmoke(suite: string) {
  const artifactRoot = temporaryE2A33CArtifactRoot();
  const sourceSummaryPath = path.join(
    E2A33C_SOURCE_RUN_DIR,
    "canary-summary.json"
  );
  const sourceHumanReviewPath = path.join(
    E2A33C_SOURCE_RUN_DIR,
    "human-review-packet.json"
  );
  const sourceSummaryBefore = readFileSync(sourceSummaryPath);
  const sourceHumanReviewBefore = readFileSync(sourceHumanReviewPath);
  try {
    const result = await executeE2A33C({ artifactRoot });
    const trace = result.trace;
    assert(result.summary.status === E2A33C_STATUS,
      "e2a33c summary status mismatch");
    assert(trace.reconstruction.exact_student_response ===
      "1. More motivated students might use the app more and also study harder outside the app. 2. Therefore, option D is not justified because the higher scores could be from motivation, not just the app. 3. The researcher could compare students who use the app with students who do not.",
    "e2a33c exact Turn 3 response mismatch");
    assert(trace.reconstruction.essential_missing_links.length === 2 &&
      trace.reconstruction.anchor_stance.canonical_stance ===
        "rejects_distractor" &&
      trace.reconstruction.anchor_stance.parity_passed,
    "e2a33c evaluator or anchor reconstruction mismatch");
    assert(trace.mapperTrace.ordering_defect.detected &&
      trace.mapperTrace.legacy_v3_sound_gate_decision.passed &&
      trace.mapperTrace.legacy_v3_mapper_output_before_structured_merge
        .reasoning_quality === "sound" &&
      trace.mapperTrace.v6_mapper_output_after_structured_merge
        .reasoning_quality === "sound" &&
      trace.mapperTrace.v6_mapper_output_after_structured_merge
        .essential_missing_links.length === 2,
    "e2a33c mapper ordering defect was not reproduced");
    assert(trace.soundGateReplay.legacy_mapper_decision.passed &&
      !trace.soundGateReplay.evidence_complete_decision.passed &&
      trace.soundGateReplay.evidence_complete_decision.failure_codes
        .includes("essential_missing_links_present") &&
      !trace.soundGateReplay.criteria_weakened,
    "e2a33c evidence-complete sound gate failed");
    assert(!trace.consistencyReplay.decision.passed &&
      trace.consistencyReplay.decision.issue_codes.includes("false_sound") &&
      trace.consistencyReplay.fail_closed_before_profile_finalization &&
      !trace.consistencyReplay.turn3_tutor_dispatched,
    "e2a33c consistency guard replay failed");
    assert(result.rootCause.selected_root_cause.code === "B" &&
      result.rootCause.selected_root_cause.label ===
        "mapper_dropped_evidence" &&
      !result.rootCause.evaluator_v5_assessment.implicated &&
      !result.rootCause.sound_gate_assessment.implicated,
    "e2a33c root-cause adjudication mismatch");
    assert(result.regressions.case_count === 4 &&
      result.regressions.passed_case_count === 4 &&
      result.regressions.passed &&
      !result.regressions.criteria_weakened,
    "e2a33c deterministic regressions failed");
    assert(result.humanReview.source_packet_binding
      .source_packet_mutated === false &&
      result.humanReview.human_review_complete === false &&
      result.humanReview.human_reviewer === null,
    "e2a33c human-review boundary failed");
    assert(result.artifactValidation.passed &&
      result.artifactValidation.actual_artifact_count ===
        E2A33C_ARTIFACT_NAMES.length &&
      validateE2A33CArtifacts(result.runDir).passed,
    "e2a33c artifact validation failed");
    assert(Buffer.compare(
      sourceSummaryBefore,
      readFileSync(sourceSummaryPath)
    ) === 0 && Buffer.compare(
      sourceHumanReviewBefore,
      readFileSync(sourceHumanReviewPath)
    ) === 0, "e2a33c immutable source evidence changed");
    assert(result.summary.provider_calls_made === 0 &&
      result.summary.network_requests_made === 0 &&
      result.summary.e2a33b_rerun === false &&
      result.summary.e2a34_executed === false,
    "e2a33c no-live boundary failed");
    console.log(JSON.stringify({
      status: "passed",
      suite,
      source_run_id: E2A33C_SOURCE_RUN_ID,
      adjudication_run_id: result.runId,
      selected_root_cause:
        result.rootCause.selected_root_cause,
      evaluator_v5_implicated:
        result.rootCause.evaluator_v5_assessment.implicated,
      legacy_incomplete_gate_passed:
        trace.soundGateReplay.legacy_mapper_decision.passed,
      evidence_complete_gate_passed:
        trace.soundGateReplay.evidence_complete_decision.passed,
      consistency_guard_issue_codes:
        trace.consistencyReplay.decision.issue_codes,
      deterministic_regressions:
        `${result.regressions.passed_case_count}/${result.regressions.case_count}`,
      source_evidence_unchanged:
        result.summary.source_evidence_unchanged,
      artifact_count: result.artifactValidation.actual_artifact_count,
      provider_calls_made: 0,
      network_requests_made: 0
    }, null, 2));
  } finally {
    removeTemporaryE2A33CArtifactRoot(artifactRoot);
  }
}

async function main() {
  const command = process.argv[2] ?? "report";
  const suite = argument("--suite") ?? "all";
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a33c_network_request_prohibited");
  }) as typeof fetch;
  try {
    assert(existsSync(E2A33C_SOURCE_RUN_DIR),
      "e2a33c immutable source run is missing");
    if (command === "run") {
      const result = await executeE2A33C();
      assert(networkRequestCount === 0,
        "e2a33c run attempted a network request");
      console.log(JSON.stringify({
        status: result.summary.status,
        run_id: result.runId,
        run_directory: result.runDir,
        source_run_id: E2A33C_SOURCE_RUN_ID,
        selected_root_cause:
          result.rootCause.selected_root_cause,
        legacy_incomplete_gate_passed:
          result.trace.soundGateReplay.legacy_mapper_decision.passed,
        evidence_complete_gate_passed:
          result.trace.soundGateReplay.evidence_complete_decision.passed,
        human_review_complete:
          result.humanReview.human_review_complete,
        source_evidence_unchanged:
          result.summary.source_evidence_unchanged,
        provider_calls_made: 0,
        network_requests_made: networkRequestCount
      }, null, 2));
      return;
    }
    if (command === "smoke") {
      if (suite === "regressions") {
        const regressions = runE2A33CDeterministicRegressions();
        assert(regressions.passed,
          "e2a33c deterministic regressions failed");
        console.log(JSON.stringify({
          status: "passed",
          suite,
          case_count: regressions.case_count,
          passed_case_count: regressions.passed_case_count,
          provider_calls_made: 0,
          network_requests_made: networkRequestCount
        }, null, 2));
        return;
      }
      await runSmoke(suite);
      assert(networkRequestCount === 0,
        "e2a33c smoke attempted a network request");
      return;
    }
    if (command === "report") {
      const runId = argument("--run");
      if (!runId) throw new Error("e2a33c_run_id_required");
      const result = loadE2A33CRun(runId);
      assert(networkRequestCount === 0,
        "e2a33c report attempted a network request");
      console.log(JSON.stringify({
        run_id: runId,
        run_directory: result.runDir,
        summary: result.summary,
        root_cause_adjudication: result.rootCause,
        human_review_packet_enhancement: result.humanReview,
        artifact_validation: result.artifactValidation,
        provider_calls_made: 0,
        network_requests_made: networkRequestCount
      }, null, 2));
      return;
    }
    throw new Error(`e2a33c_unknown_command:${command}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a33c_command_failed");
  process.exitCode = 1;
});
