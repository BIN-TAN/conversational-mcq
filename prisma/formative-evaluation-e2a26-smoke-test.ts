import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  E2A24_EXPECTED_CANDIDATE_HASH,
  E2A26_ARTIFACT_NAMES,
  E2A26_STATUS,
  executeE2A26
} from "@/lib/evaluation/formative/e2a26-failure-path-evidence";
import {
  buildE2A26CalibrationCorpus,
  evaluateSemanticProfileEnvelope,
  runE2A26Calibration,
  semanticExpectationForFrozenLabel
} from "@/lib/evaluation/formative/e2a26-semantic-oracle";

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

async function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), "e2a26-smoke-"));
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a26_smoke_network_request_prohibited");
  }) as typeof fetch;
  try {
    const copiedExpectation = semanticExpectationForFrozenLabel(
      "insufficient_copied_wording"
    );
    const copiedMisconception = evaluateSemanticProfileEnvelope({
      expectation: copiedExpectation,
      production: {
        reasoning_quality: "misconception",
        anchor_application: "absent",
        misconception_status: "persists",
        essential_missing_links: ["required_mechanism"],
        contradictions: ["active_distractor_claim_retained"],
        revision_readiness: false,
        transfer_readiness: false,
        completion_readiness: false,
        route_mode: "remain_in_dialogue"
      }
    });
    assert.equal(copiedMisconception.passed, true);
    assert.equal(copiedMisconception.exact_label_match, false);
    assert.deepEqual(copiedMisconception.review_flags,
      ["profile_label_mismatch_within_allowed_envelope"]);
    const falseSound = evaluateSemanticProfileEnvelope({
      expectation: copiedExpectation,
      production: {
        reasoning_quality: "sound",
        anchor_application: "explicit",
        misconception_status: "resolved_for_current_anchor",
        essential_missing_links: [],
        contradictions: [],
        revision_readiness: true,
        transfer_readiness: false,
        completion_readiness: false,
        route_mode: "request_revision"
      }
    });
    assert.equal(falseSound.failure_code, "genuine_false_sound");

    const corpus = buildE2A26CalibrationCorpus();
    const calibration = runE2A26Calibration();
    assert.equal(corpus.length, 72);
    assert.ok(corpus.filter((entry) => entry.non_irt).length >= 36);
    assert.equal(calibration.length, 72);
    assert.ok(calibration.every((entry) => entry.passed));

    const result = await executeE2A26({
      root,
      networkRequestCount: () => networkRequestCount
    });
    assert.equal(result.summary.status, E2A26_STATUS);
    assert.equal(result.summary.genuine_false_sound_factually_valid, false);
    assert.equal(result.summary
      .session_c_production_profile_inside_acceptance_envelope, true);
    assert.equal(result.summary.session_a_b_replay_passed, true);
    assert.equal(result.summary
      .session_c_replay_passed_through_available_turns, true);
    assert.equal(result.summary.historical_failure_path_evidence_incomplete,
      true);
    assert.equal(result.summary.complete_human_review_packet_item_count, 19);
    assert.equal(result.summary.candidate_configuration_hash,
      E2A24_EXPECTED_CANDIDATE_HASH);
    assert.equal(result.summary.candidate_approved, false);
    assert.equal(result.summary.candidate_activated, false);
    assert.equal(result.summary.e2a27_live_execution_authorized, false);
    assert.equal(result.summary.e2a27_live_execution_performed, false);
    assert.equal(result.summary.provider_call_count, 0);
    assert.equal(result.summary.network_request_count, 0);
    assert.equal(result.validation.artifact_count, E2A26_ARTIFACT_NAMES.length);
    assert.equal(result.validation.passed, true);

    const packet = readJson<{
        items: Array<Record<string, unknown>>;
        all_human_decisions_null: boolean;
      }>(path.join(result.runDir, "e2a25-complete-human-review-packet.json"));
    const c2Tutor = packet.items.find((entry) =>
      entry.session_id === "C" && entry.turn === 2 &&
      entry.actor_type === "agent"
    );
    assert.ok(c2Tutor);
    assert.equal(c2Tutor.provider_generated, true);
    assert.equal(c2Tutor.persisted, false);
    assert.equal(c2Tutor.displayed_to_student, false);
    assert.equal(c2Tutor.suppression_reason, "harness_oracle_abort");
    assert.equal(c2Tutor.human_review, null);
    assert.equal(packet.all_human_decisions_null, true);

    const reconstruction = readJson<{
      exact_visible_student_message: string;
      frozen_expected_profile: string;
      production_profile: {
        reasoning_quality: string;
        revision_readiness: boolean;
      };
      evidence_evaluator_request: { stage_status: string };
      evidence_evaluator_provider_output: { stage_status: string };
      student_display: {
        displayed_to_student: boolean;
        suppression_reason: string;
      };
    }>(path.join(result.runDir,
      "e2a25-session-c-turn2-reconstruction.json"));
    assert.equal(reconstruction.exact_visible_student_message,
      "the list’s order matters. midpoint value is 6, 8 > 6 and discards the left half.");
    assert.equal(reconstruction.frozen_expected_profile,
      "insufficient_copied_wording");
    assert.equal(reconstruction.production_profile.reasoning_quality,
      "misconception");
    assert.equal(reconstruction.production_profile.revision_readiness, false);
    assert.equal(reconstruction.evidence_evaluator_request.stage_status,
      "missing");
    assert.equal(reconstruction.evidence_evaluator_provider_output.stage_status,
      "missing");
    assert.equal(reconstruction.student_display.displayed_to_student, false);
    assert.equal(reconstruction.student_display.suppression_reason,
      "harness_oracle_abort");

    const tutorAdjudication = readJson<{
      classification: string;
      candidate_quality_blocker: boolean;
      privacy_scan: { passed: boolean };
      answer_key_safe: boolean;
      progression_safe: boolean;
    }>(path.join(result.runDir,
      "session-c-tutor-output-adjudication.json"));
    assert.equal(tutorAdjudication.classification, "suitable_for_display");
    assert.equal(tutorAdjudication.candidate_quality_blocker, false);
    assert.equal(tutorAdjudication.privacy_scan.passed, true);
    assert.equal(tutorAdjudication.answer_key_safe, true);
    assert.equal(tutorAdjudication.progression_safe, true);

    const replay = readJson<{
      turns: Array<{
        turn: number;
        corrected_oracle_result: {
          passed: boolean;
          inside_semantic_envelope: boolean;
        };
        execution_should_have_continued: boolean;
      }>;
      replay_boundary: {
        last_available_student_turn: number;
        later_session_c_behavior_evaluated: boolean;
      };
    }>(path.join(result.runDir, "session-c-read-only-replay.json"));
    const replayTurn2 = replay.turns.find((entry) => entry.turn === 2);
    assert.ok(replayTurn2);
    assert.equal(replayTurn2.corrected_oracle_result.passed, true);
    assert.equal(replayTurn2.corrected_oracle_result
      .inside_semantic_envelope, true);
    assert.equal(replayTurn2.execution_should_have_continued, true);
    assert.equal(replay.replay_boundary.last_available_student_turn, 2);
    assert.equal(replay.replay_boundary.later_session_c_behavior_evaluated,
      false);

    const taxonomy = readJson<{
      codes: Array<{ code: string }>;
    }>(path.join(result.runDir, "failure-code-taxonomy.json"));
    const failureCodes = new Set(taxonomy.codes.map((entry) => entry.code));
    for (const code of [
      "genuine_false_sound",
      "genuine_sound_false_negative",
      "premature_revision",
      "profile_semantically_outside_allowed_envelope",
      "profile_label_mismatch_within_allowed_envelope",
      "frozen_oracle_overconstraint",
      "context_integrity_failure",
      "evaluator_omission",
      "tutor_after_sound",
      "strategy_adaptation_failure",
      "failure_path_evidence_incomplete",
      "infrastructure_incomplete"
    ]) assert.ok(failureCodes.has(code), `missing failure code: ${code}`);

    const overlap = readJson<{
      exact_match_count: number;
      normalized_exact_match_count: number;
      maximum_token_jaccard: { score: number };
      passed: boolean;
    }>(path.join(result.runDir, "e2a27-overlap-analysis.json"));
    assert.equal(overlap.exact_match_count, 0);
    assert.equal(overlap.normalized_exact_match_count, 0);
    assert.ok(overlap.maximum_token_jaccard.score < 0.9);
    assert.equal(overlap.passed, true);
    assert.equal(networkRequestCount, 0);
    console.log(JSON.stringify({
      status: "passed",
      suite: process.argv.includes("--suite")
        ? process.argv[process.argv.indexOf("--suite") + 1]
        : "all",
      artifact_count: result.validation.artifact_count,
      calibration_case_count: calibration.length,
      human_review_item_count: packet.items.length,
      provider_call_count: 0,
      network_request_count: networkRequestCount,
      e2a25_rerun: false,
      e2a27_run: false
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a26_smoke_failed");
  process.exitCode = 1;
});
