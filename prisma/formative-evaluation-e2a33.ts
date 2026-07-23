import {
  mkdtempSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  E2A33_ARTIFACT_ROOT,
  inspectE2A33Run,
  makeE2A33RunId,
  writeE2A33PreparationArtifacts
} from "../src/lib/evaluation/formative/e2a33-causal-inference-protocol";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a33_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function argumentValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function runPreparation() {
  const runId = makeE2A33RunId();
  const runDirectory = path.join(E2A33_ARTIFACT_ROOT, runId);
  const result = writeE2A33PreparationArtifacts({
    runDirectory,
    runId,
    networkRequestCount
  });
  console.log(JSON.stringify({
    status: result.summary.status,
    run_id: runId,
    run_directory: runDirectory,
    protocol_hash: result.all.protocol.protocol_hash,
    composite_runtime_identity_hash:
      result.all.identity.composite_runtime_identity_hash,
    held_out_domain: result.summary.held_out_domain,
    deterministic_regressions_passed:
      result.summary.deterministic_regressions_passed,
    e2a33_ready_for_separate_authorization:
      result.summary.e2a33_ready_for_separate_authorization,
    execution_authorized: false,
    live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  }, null, 2));
}

function reportPreparation() {
  const runId = argumentValue("--run");
  if (!runId) throw new Error("e2a33_report_run_id_required");
  const report = inspectE2A33Run(path.join(E2A33_ARTIFACT_ROOT, runId));
  console.log(JSON.stringify({
    ...report,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  }, null, 2));
}

function smoke() {
  const suite = argumentValue("--suite") ?? "all";
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "e2a33-protocol-smoke-")
  );
  const runId = "e2a33_deterministic_smoke";
  const runDirectory = path.join(temporaryRoot, runId);
  try {
    const result = writeE2A33PreparationArtifacts({
      runDirectory,
      runId,
      networkRequestCount
    });
    const report = inspectE2A33Run(runDirectory);
    const summary = report.summary;
    const protocol = report.protocol;
    const regressions = report.regressions;

    if (suite === "all" || suite === "trajectory-envelope") {
      assert(
        protocol.trajectory_envelope_version ===
          "trajectory-envelope-v1",
        "e2a33 trajectory envelope version mismatch"
      );
      assert(
        protocol.gates &&
          (protocol.gates as Record<string, unknown>)
            .exact_turn_reasoning_labels_absent === true,
        "e2a33 exact turn labels were not prohibited"
      );
      assert(
        regressions.case_count === 8 &&
          regressions.passed === true,
        "e2a33 deterministic trajectory regressions failed"
      );
      assert(
        regressions.evaluator_follows_evidence === true,
        "e2a33 trajectory changed evaluator evidence"
      );
      assert(
        regressions.exact_turn_reasoning_labels_absent === true &&
          regressions.exact_label_field_schema_rejection_passed === true,
        "e2a33 exact-label fields were not structurally rejected"
      );
      assert(
        regressions.sound_gate_overrides_trajectory_expectation ===
          true,
        "e2a33 sound gate did not override trajectory expectation"
      );
      assert(
        regressions.revision_immediate_when_sound_reached === true,
        "e2a33 revision was not immediate after sound"
      );
      assert(
        regressions.required_trajectory_roles_complete === true,
        "e2a33 required trajectory roles are incomplete"
      );
      assert(
        regressions
          .confidence_and_correctness_do_not_promote_incomplete_evidence ===
          true,
        "e2a33 confidence/correctness mismatch promoted incomplete evidence"
      );
    }

    if (suite === "all" || suite === "held-out-domain") {
      assert(
        summary.held_out_domain ===
          "introductory_statistics_and_causal_inference" &&
          summary.held_out_topic ===
            "correlation_versus_causation",
        "e2a33 held-out domain mismatch"
      );
      assert(
        (protocol.gates as Record<string, unknown>)
          .overlap_analysis_passed === true,
        "e2a33 held-out overlap analysis failed"
      );
      assert(
        (protocol.gates as Record<string, unknown>)
          .evaluator_v5_request_compiled === true,
        "e2a33 evaluator V5 request did not compile"
      );
      assert(
        summary.broad_concept_overlap_disclosed === true &&
          summary.no_prior_scenario_reuse === true,
        "e2a33 scenario novelty or overlap disclosure failed"
      );
    }

    if (suite === "all" || suite === "contradiction") {
      assert(
        summary.required_contradiction_passed === true &&
          (protocol.gates as Record<string, unknown>)
            .required_contradiction_passed === true,
        "e2a33 required contradiction case failed"
      );
    }

    if (suite === "all" || suite === "artifact") {
      assert(
        result.validation.passed &&
          report.validation.passed,
        "e2a33 artifact validation failed"
      );
      assert(
        summary.status ===
          "e2a33_protocol_frozen_not_authorized_not_executed",
        "e2a33 summary status mismatch"
      );
      assert(
        summary.execution_authorized === false &&
          summary.live_execution_performed === false,
        "e2a33 live execution state is not fail closed"
      );
    }

    if (suite === "all" || suite === "provider-call-guard") {
      assert(
        networkRequestCount === 0 &&
          summary.provider_calls_made === 0 &&
          summary.network_requests_made === 0,
        "e2a33 provider-call guard failed"
      );
    }

    console.log(JSON.stringify({
      status: "passed",
      suite,
      trajectory_envelope_version:
        protocol.trajectory_envelope_version,
      deterministic_case_count: regressions.case_count,
      required_trajectory_roles_complete:
        regressions.required_trajectory_roles_complete,
      early_sound_immediate_revision:
        regressions.revision_immediate_when_sound_reached,
      evaluator_follows_evidence:
        regressions.evaluator_follows_evidence,
      exact_label_fields_rejected:
        regressions.exact_label_field_schema_rejection_passed,
      held_out_domain: summary.held_out_domain,
      broad_concept_overlap_disclosed:
        summary.broad_concept_overlap_disclosed,
      no_prior_scenario_reuse: summary.no_prior_scenario_reuse,
      required_contradiction_passed:
        summary.required_contradiction_passed,
      overlap_analysis_passed:
        (protocol.gates as Record<string, unknown>)
          .overlap_analysis_passed,
      artifact_validation_passed: report.validation.passed,
      execution_authorized: false,
      provider_calls_made: 0,
      network_requests_made: networkRequestCount
    }, null, 2));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function main() {
  const command = process.argv[2] ?? "smoke";
  if (command === "run") return runPreparation();
  if (command === "report") return reportPreparation();
  if (command === "smoke") return smoke();
  throw new Error(`e2a33_unknown_command:${command}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
