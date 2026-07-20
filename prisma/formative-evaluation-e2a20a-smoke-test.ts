import { readFileSync } from "node:fs";
import path from "node:path";
import {
  E2A20A_ARTIFACT_NAMES,
  E2A20A_EXPECTED_CLASSIFIER_V2_SHA256,
  E2A20A_STATUS,
  E2A20A_TURN4_MESSAGE,
  buildE2A20AAdjudications,
  buildE2A20ACalibrationCorpus,
  buildE2A20AHistoricalRegressions,
  evaluateE2A20ACalibrationCorpus,
  executeE2A20A,
  loadE2A20ARun,
  removeTemporaryE2A20AArtifactRoot,
  temporaryE2A20AArtifactRoot,
  validateE2A20AArtifacts
} from "@/lib/evaluation/formative/e2a20a-turn4-classification-adjudication";
import {
  E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
  classifyStudentEvidenceV3
} from "@/lib/evaluation/formative/e2a20a-student-simulator-evidence-classifier-v3";
import {
  E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
  classifyStudentEvidenceV2
} from "@/lib/evaluation/formative/e2a18-student-simulator-contract-v2";
import {
  E2A14_CANDIDATE_FILE_SHA256,
  E2A14_CANDIDATE_HASH
} from "@/lib/evaluation/formative/e2a14-protected-request-validator-candidate";

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
  const artifactRoot = temporaryE2A20AArtifactRoot();
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a20a_network_request_prohibited");
  }) as typeof fetch;
  try {
    const v2 = classifyStudentEvidenceV2({
      message: E2A20A_TURN4_MESSAGE,
      conceptual_anchor: "theta_information"
    });
    const v3 = classifyStudentEvidenceV3({
      message: E2A20A_TURN4_MESSAGE,
      conceptual_anchor: "theta_information"
    });
    assert(v2.observed_level === "partial",
      "e2a20a did not reproduce classifier v2 result");
    assert(v3.observed_level === "substantive" &&
      v3.exact_evidence_spans.length === 2 &&
      v3.exact_evidence_spans.every((entry) =>
        E2A20A_TURN4_MESSAGE.includes(entry.span)
      ), "e2a20a target exact-span adjudication failed");

    const adjudications = buildE2A20AAdjudications();
    assert(Object.values(adjudications).every((entry) =>
      entry.level_assigned === "substantive" &&
      entry.revision_should_be_authorized &&
      entry.criteria_satisfied.length === 8 &&
      entry.criteria_missing.length === 0 &&
      entry.human_reviewer === null && entry.human_rating === null
    ), "e2a20a three-rubric agreement failed");

    const corpus = buildE2A20ACalibrationCorpus();
    const calibration = evaluateE2A20ACalibrationCorpus(corpus);
    assert(corpus.length === 36 && calibration.every((entry) => entry.passed),
      "e2a20a calibration failed");
    const categories = new Set(corpus.map((entry) => entry.category));
    assert(categories.size === 6 && [...categories].every((category) =>
      corpus.filter((entry) => entry.category === category).length === 6
    ), "e2a20a calibration category count mismatch");
    assert(corpus.filter((entry) =>
      entry.avoids_preferred_canonical_phrases &&
      entry.expected_level === "substantive"
    ).length >= 12, "e2a20a paraphrased case count mismatch");
    assert(calibration.filter((entry) => !entry.classifier_v2_agrees).length ===
      12, "e2a20a classifier v2 disagreement count mismatch");

    const historical = buildE2A20AHistoricalRegressions();
    assert(historical.length === 57 && historical.every((entry) =>
      entry.passed
    ), "e2a20a historical regression failed");
    const required = Object.fromEntries(historical.filter((entry) =>
      entry.source === "required_regression"
    ).map((entry) => [entry.case_id, entry]));
    assert(required.required_original_e2a17_misconception_preserving
      ?.actual_level === "partial" &&
      required.required_e2a19_turn4?.actual_level === "substantive" &&
      required.required_tentative_correct_vocabulary?.actual_level ===
        "partial" &&
      required.required_repeated_tutor_language?.actual_level === "partial" &&
      required.required_coherent_paraphrased_reasoning?.actual_level ===
        "substantive",
    "e2a20a required boundary regression failed");

    const result = await executeE2A20A({ artifactRoot });
    const summary = readJson<{
      status: string;
      final_classifier_version: string;
      final_classifier_file_sha256: string;
      classifier_v2_unchanged: boolean;
      tutor_candidate_unchanged: boolean;
      protected_evidence_unchanged: boolean;
      e2a21_protocol_validation_passed: boolean;
      provider_calls_made: number;
      network_requests_made: number;
      candidate_approved: boolean;
      candidate_activated: boolean;
      e2a21_executed: boolean;
    }>(path.join(result.runDir, "summary.json"));
    const delta = readJson<{
      from: { version: string; file_sha256: string };
      to: { version: string; file_sha256: string };
      tutor_candidate_changed: boolean;
      tutor_prompt_or_schema_changed: boolean;
    }>(path.join(result.runDir, "classifier-delta.json"));
    const readiness = readJson<{
      final_classifier_version: string;
      protocol_validation_passed: boolean;
      tutor_candidate_hash: string;
      dispatch_authorized: boolean;
      e2a21_executed: boolean;
    }>(path.join(result.runDir, "e2a21-readiness-update.json"));

    assert(summary.status === E2A20A_STATUS &&
      summary.final_classifier_version ===
        E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION &&
      summary.classifier_v2_unchanged && summary.tutor_candidate_unchanged &&
      summary.protected_evidence_unchanged &&
      summary.e2a21_protocol_validation_passed &&
      summary.provider_calls_made === 0 &&
      summary.network_requests_made === 0 &&
      !summary.candidate_approved && !summary.candidate_activated &&
      !summary.e2a21_executed,
    "e2a20a summary boundary failed");
    assert(delta.from.version === E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION &&
      delta.from.file_sha256 === E2A20A_EXPECTED_CLASSIFIER_V2_SHA256 &&
      delta.to.version === E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION &&
      delta.to.file_sha256 === summary.final_classifier_file_sha256 &&
      !delta.tutor_candidate_changed &&
      !delta.tutor_prompt_or_schema_changed,
    "e2a20a classifier delta mismatch");
    assert(readiness.final_classifier_version ===
      E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION &&
      readiness.protocol_validation_passed &&
      readiness.tutor_candidate_hash === E2A14_CANDIDATE_HASH &&
      !readiness.dispatch_authorized && !readiness.e2a21_executed,
    "e2a20a e2a21 readiness mismatch");
    assert(E2A14_CANDIDATE_FILE_SHA256 ===
      "a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8",
    "e2a20a tutor candidate file changed");
    assert(E2A20A_ARTIFACT_NAMES.length === 13 &&
      validateE2A20AArtifacts(result.runDir).passed &&
      loadE2A20ARun(result.runId, artifactRoot).artifactValidation.passed,
    "e2a20a artifact integrity failed");
    assert(networkRequestCount === 0, "e2a20a made a network request");

    console.log(JSON.stringify({
      status: "passed",
      suite,
      run_id: result.runId,
      turn4_v2_level: v2.observed_level,
      turn4_v3_level: v3.observed_level,
      revision_eligible: true,
      three_rubric_agreement: true,
      calibration_case_count: calibration.length,
      calibration_pass_count: calibration.filter((entry) => entry.passed)
        .length,
      classifier_v2_disagreement_count: calibration.filter((entry) =>
        !entry.classifier_v2_agrees
      ).length,
      historical_regression_count: historical.length,
      historical_regression_pass_count: historical.filter((entry) =>
        entry.passed
      ).length,
      final_classifier_version:
        E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      final_classifier_file_sha256: summary.final_classifier_file_sha256,
      provider_call_count: 0,
      network_request_count: networkRequestCount,
      candidate_approved: false,
      candidate_activated: false,
      e2a21_executed: false
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    removeTemporaryE2A20AArtifactRoot(artifactRoot);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a20a_smoke_failed");
  process.exitCode = 1;
});
