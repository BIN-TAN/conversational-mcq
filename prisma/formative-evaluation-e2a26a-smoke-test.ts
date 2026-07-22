import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  E2A24_CANDIDATE_CONFIGURATION_HASH,
  E2A24_CANDIDATE_FILE_SHA256,
  E2A26A_ARTIFACT_NAMES,
  E2A26A_STATUS,
  buildE2A26ACalibrationCorpus,
  executeE2A26A,
  runE2A26ACalibration
} from "@/lib/evaluation/formative/e2a26a-anchor-conclusion-consistency";

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

async function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), "e2a26a-smoke-"));
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a26a_smoke_network_request_prohibited");
  }) as typeof fetch;
  try {
    const corpus = buildE2A26ACalibrationCorpus();
    const calibration = runE2A26ACalibration();
    assert.ok(corpus.length >= 96);
    assert.ok(corpus.filter((entry) => entry.non_irt).length >= 60);
    assert.equal(calibration.length, corpus.length);
    assert.ok(calibration.every((entry) => entry.passed),
      JSON.stringify(calibration.filter((entry) => !entry.passed), null, 2));
    assert.ok(calibration.filter((entry) =>
      entry.interpretation.anchor_application === "explicit"
    ).every((entry) => entry.interpretation.anchor_application !== "absent"));
    assert.ok(calibration.filter((entry) =>
      entry.interpretation.anchor_stance === "endorses_distractor"
    ).every((entry) => !entry.sound_gate.passed));
    assert.ok(calibration.filter((entry) =>
      entry.interpretation.anchor_consistency ===
        "contradictory_to_conceptual_reasoning"
    ).every((entry) => !entry.sound_gate.passed &&
      entry.interpretation.contradictions.includes(
        "anchor_conclusion_conceptual_explanation_conflict"
      )));

    const result = await executeE2A26A({
      root,
      networkRequestCount: () => networkRequestCount
    });
    assert.equal(result.summary.status, E2A26A_STATUS);
    assert.equal(result.validation.artifact_count,
      E2A26A_ARTIFACT_NAMES.length);
    assert.equal(result.validation.exact_artifact_contract, true);
    assert.equal(result.summary.calibration_case_count, corpus.length);
    assert.equal(result.summary.calibration_failed_count, 0);
    assert.equal(result.summary.session_b_turn2_anchor_application, "explicit");
    assert.equal(result.summary.session_b_turn3_anchor_application, "explicit");
    assert.deepEqual(result.summary.session_b_turn4_corrected, {
      reasoning_quality: "partial",
      anchor_application: "explicit",
      anchor_stance: "endorses_distractor",
      anchor_consistency: "contradictory_to_conceptual_reasoning",
      anchor_resolution_status: "contradictory",
      contradictions: [
        "anchor_conclusion_conceptual_explanation_conflict"
      ],
      revision_readiness: false,
      platform_mode: "remain_in_dialogue"
    });
    assert.equal(result.summary.session_a_sound_remains_sound, true);
    assert.equal(result.summary.session_c_oracle_diagnosis_intact, true);
    assert.equal(result.summary.candidate_configuration_hash,
      E2A24_CANDIDATE_CONFIGURATION_HASH);
    assert.equal(result.summary.candidate_file_sha256,
      E2A24_CANDIDATE_FILE_SHA256);
    assert.equal(result.summary.protected_evidence_unchanged, true);
    assert.equal(result.summary.provider_call_count, 0);
    assert.equal(result.summary.network_request_count, 0);
    assert.equal(result.summary.e2a27_live_execution_authorized, false);
    assert.equal(result.summary.e2a27_live_execution_performed, false);

    const reconstruction = readJson<{
      turns: Array<{ turn: number; exact_student_response: string }>;
    }>(path.join(result.runDir, "session-b-exact-reconstruction.json"));
    const b4 = reconstruction.turns.find((entry) => entry.turn === 4);
    assert.ok(b4);
    assert.ok(b4.exact_student_response.endsWith(
      "Therefore, for economics item 11, option D is appropriate because the original spending cannot make continuing worthwhile when the remaining costs exceed the remaining benefits."
    ));
    const human = readJson<{
      reviewer_aliases: string[];
      provenance: string;
      inter_rater_reliability_claimed: boolean;
    }>(path.join(result.runDir, "human-review-attestation.json"));
    assert.deepEqual(human.reviewer_aliases,
      ["primary_project_owner", "secondary_human_reviewer"]);
    assert.equal(human.provenance,
      "user_supplied_human_review_attestation");
    assert.equal(human.inter_rater_reliability_claimed, false);
    const protocol = readJson<{
      execution_authorized: boolean;
      live_execution_performed: boolean;
      session: { academic_domain: string; frozen_student_trajectory: unknown[] };
    }>(path.join(result.runDir, "e2a27-frozen-protocol.json"));
    assert.equal(protocol.execution_authorized, false);
    assert.equal(protocol.live_execution_performed, false);
    assert.equal(protocol.session.academic_domain, "geometrical_optics");
    assert.equal(protocol.session.frozen_student_trajectory.length, 6);
    assert.equal(networkRequestCount, 0);
    console.log(JSON.stringify({
      status: "passed",
      suite: process.argv.includes("--suite")
        ? process.argv[process.argv.indexOf("--suite") + 1]
        : "all",
      artifact_count: result.validation.artifact_count,
      calibration_case_count: corpus.length,
      calibration_non_irt_count:
        corpus.filter((entry) => entry.non_irt).length,
      provider_call_count: 0,
      network_request_count: 0,
      e2a25_rerun: false,
      e2a27_run: false
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a26a_smoke_failed");
  process.exitCode = 1;
});
