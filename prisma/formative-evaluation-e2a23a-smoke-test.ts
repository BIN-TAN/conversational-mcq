import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildNoLiveActivityMisconceptionEvidenceFixture
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  createTopicDialogueTurnEvidenceProfile,
  integrateTopicDialogueEvidenceProfile,
  selectEvidenceFirstTopicDialogueRoute
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  assertTargetEvidenceObservationConsistent,
  buildActivityTargetEvidenceContract,
  buildTargetEvidenceAdjudicationFromActivityPacket,
  mapTargetEvidenceAdjudicationToObservation,
  TargetEvidenceConsistencyError
} from "@/lib/services/student-assessment/target-evidence-contract";
import {
  E2A23A_ARTIFACT_NAMES,
  E2A23A_ALLOWED_STATUS,
  executeE2A23A,
  reconcileHistoricalE2A23,
  validateE2A23AArtifacts
} from "@/lib/evaluation/formative/e2a23a-turn-profile-reconciliation";
import {
  buildE2A23ACalibrationCorpus,
  item16TargetEvidenceContract,
  reconcileMessageToProfile,
  runE2A23ACalibration
} from "@/lib/evaluation/formative/e2a23a-evidence-reconciliation";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function liveLikeEvidencePacket() {
  return buildNoLiveActivityMisconceptionEvidenceFixture({
    case_id: "e2a23a_production_mapper",
    activity_family: "distractor_contrast",
    selected_formative_value: "reasoning_refinement",
    profile_condition: "sound_anchor_specific_evidence",
    source_diagnostic_purpose: "reasoning_boundary_repair",
    response_kind: "substantive",
    response_length_band: "medium",
    response_summary: "Student explained the boundary and repaired the reasoning link.",
    primary_target: "target_boundary",
    secondary_targets: ["reasoning_link"],
    evidence_types: [
      "target_boundary_explained",
      "reasoning_link_repaired"
    ],
    update_status: "boundary_understanding_improved",
    evidence_quality: "high",
    confidence: "high",
    safe_internal_rationale:
      "The structured evaluator accepted the target boundary and mechanism."
  });
}

async function main() {
  const suite = argument("--suite") ?? "all";
  const originalFetch = globalThis.fetch;
  let networkRequestCount = 0;
  globalThis.fetch = (async () => {
    networkRequestCount += 1;
    throw new Error("e2a23a_network_request_prohibited");
  }) as typeof fetch;
  const artifactRoot = path.join(
    os.tmpdir(), `e2a23a-smoke-${process.pid}-${Date.now()}`
  );
  try {
    const replay = reconcileHistoricalE2A23();
    assert.equal(replay.comparisons.length, 6);
    assert.deepEqual(
      replay.comparisons.map((entry) => entry.corrected_profile.reasoning_quality),
      ["misconception", "partial", "sound", "sound", "sound", "sound"]
    );
    assert.deepEqual(
      replay.comparisons.map((entry) => entry.corrected_profile.anchor_application),
      ["explicit", "explicit", "explicit", "explicit", "explicit", "explicit"]
    );
    assert.deepEqual(
      replay.comparisons.map((entry) => entry.corrected_profile.revision_readiness),
      [false, false, true, true, true, true]
    );
    assert.deepEqual(
      replay.comparisons.map((entry) => entry.corrected_route.selected_mode),
      [
        "remain_in_dialogue", "remain_in_dialogue", "request_revision",
        "request_revision", "request_revision", "request_revision"
      ]
    );
    assert.deepEqual(
      replay.comparisons.slice(0, 2).map((entry) =>
        entry.corrected_route.selected_operation
      ),
      ["clarify_concept_with_new_strategy", "refine_partial_reasoning"]
    );
    assert.equal(replay.earliestRevision, 3);
    assert.equal(replay.firstDivergence, 1);
    assert.ok(replay.comparisons.every((entry) =>
      entry.human_attestation_comparison.agrees &&
      entry.ai_review_comparison.agrees
    ));

    assert.deepEqual(
      replay.comparisons.map((entry) =>
        (entry.simulator_classifier_v3 as { observed_level: string })
          .observed_level
      ),
      ["partial", "partial", "substantive", "partial", "partial", "substantive"]
    );
    assert.deepEqual(
      replay.comparisons.map((entry) =>
        entry.simulator_classifier_v4.observed_level
      ),
      ["partial", "partial", "substantive", "substantive", "substantive", "substantive"]
    );

    const browserRuntimeSource = readFileSync(path.join(
      process.cwd(),
      "src/lib/services/student-assessment/activity-runtime-ui.ts"
    ), "utf8");
    const genericMapperSource = readFileSync(path.join(
      process.cwd(),
      "src/lib/services/student-assessment/target-evidence-contract.ts"
    ), "utf8");
    const historicalRunnerSource = readFileSync(path.join(
      process.cwd(),
      "src/lib/evaluation/formative/e2a23-evidence-first-micro-canary.ts"
    ), "utf8");
    assert.ok(browserRuntimeSource.includes(
      "buildActivityTargetEvidenceContract"
    ));
    assert.ok(!browserRuntimeSource.includes("evaluateThetaInformationTurn"));
    assert.ok(historicalRunnerSource.includes("evaluateThetaInformationTurn"));
    assert.ok(!/theta|item_16/iu.test(genericMapperSource));

    const turnThree = replay.comparisons[2]!;
    const satisfied = new Set(turnThree.corrected_evaluator.criterion_results
      .filter((entry) => entry.satisfied)
      .map((entry) => entry.criterion_id));
    assert.ok(satisfied.has("item_16_option_a_application"));
    assert.ok(!turnThree.corrected_profile.essential_missing_links.includes(
      "item_16_option_a_application"
    ));
    assert.equal(turnThree.corrected_profile.anchor_application, "explicit");

    assert.throws(() => assertTargetEvidenceObservationConsistent({
      contract: replay.contract,
      adjudication: turnThree.corrected_evaluator,
      observation: {
        ...turnThree.corrected_observation,
        essential_missing_links: ["item_16_option_a_application"]
      }
    }), TargetEvidenceConsistencyError);
    assert.ok(turnThree.corrected_profile.evidence_limitations.some((entry) =>
      entry.startsWith("optional_deepening_missing:")
    ));
    assert.equal(turnThree.corrected_profile.revision_readiness, true);

    const corpus = buildE2A23ACalibrationCorpus();
    const calibration = runE2A23ACalibration();
    assert.equal(corpus.rows.length, 64);
    assert.ok(corpus.rows.every((entry) => entry.concept_id !== "theta_information"));
    assert.equal(calibration.pass_count, 64);
    assert.equal(calibration.fail_count, 0);
    assert.equal(calibration.provider_call_count, 0);
    const bySuffix = (suffix: string) => calibration.results.filter((entry) =>
      entry.case_id.endsWith(suffix)
    );
    assert.ok(bySuffix("_vocabulary").every((entry) =>
      entry.actual.profile.reasoning_quality === "insufficient"
    ));
    assert.ok(bySuffix("_relationship_mechanism_no_anchor").every((entry) =>
      entry.actual.profile.reasoning_quality === "partial" &&
      entry.actual.profile.anchor_application === "absent"
    ));
    assert.ok(bySuffix("_sound_optional_missing").every((entry) =>
      entry.actual.profile.revision_readiness &&
      entry.actual.route.selected_mode === "request_revision"
    ));
    assert.ok(bySuffix("_sound_after_misconception").every((entry) =>
      entry.actual.cumulative.current_misconception_status ===
        "resolved_for_current_anchor" &&
      entry.actual.route.selected_mode === "request_revision"
    ));
    assert.ok(bySuffix("_later_contradiction").every((entry) =>
      entry.actual.cumulative.current_misconception_status === "persists" &&
      entry.actual.cumulative.misconception_reopened_count === 1
    ));

    const packet = liveLikeEvidencePacket();
    const productionContract = buildActivityTargetEvidenceContract({
      concept_id: "teacher_uploaded_reliability_validity",
      item_id: "item_2",
      distractor_option: "A",
      distractor_claim: "Reliability alone proves validity.",
      packet
    });
    const productionAdjudication =
      buildTargetEvidenceAdjudicationFromActivityPacket({
        latest_student_message:
          "For Item 2, option A is too strong because reliable scores can still support the wrong interpretation.",
        packet,
        contract: productionContract
      });
    const productionObservation = mapTargetEvidenceAdjudicationToObservation({
      contract: productionContract,
      adjudication: productionAdjudication,
      interaction_intent: "ordinary_conceptual_response",
      confidence_evidence: "high"
    });
    assert.equal(productionContract.concept_id,
      "teacher_uploaded_reliability_validity");
    assert.equal(productionObservation.reasoning_quality, "sound");
    assert.equal(productionObservation.anchor_application, "explicit");
    assert.equal(productionObservation.essential_missing_links.length, 0);

    const protectedObservation = mapTargetEvidenceAdjudicationToObservation({
      contract: replay.contract,
      adjudication: turnThree.corrected_evaluator,
      interaction_intent: "protected_request"
    });
    const protectedProfile = createTopicDialogueTurnEvidenceProfile({
      source_student_turn_id: "protected_after_sound",
      source_sequence_index: turnThree.source_sequence_index + 1,
      concept_id: replay.contract.concept_id,
      distractor_anchor: "item_16 option A",
      observation: protectedObservation,
      created_at: "2026-07-20T20:30:00.000Z"
    });
    const protectedCumulative = integrateTopicDialogueEvidenceProfile({
      prior: turnThree.corrected_cumulative_profile,
      current: protectedProfile
    });
    const protectedRoute = selectEvidenceFirstTopicDialogueRoute({
      profile: protectedProfile,
      cumulative: protectedCumulative
    });
    assert.equal(protectedRoute.selected_operation, "protected_redirect");
    assert.equal(protectedCumulative.current_revision_readiness, true);
    assert.equal(
      protectedCumulative.current_conceptual_profile_snapshot_id,
      turnThree.corrected_profile.profile_snapshot_id
    );
    const nextOrdinary = reconcileMessageToProfile({
      message: turnThree.student_message,
      contract: item16TargetEvidenceContract(),
      sourceStudentTurnId: "ordinary_after_protected",
      sourceSequenceIndex: turnThree.source_sequence_index + 2,
      prior: protectedCumulative,
      createdAt: "2026-07-20T20:31:00.000Z"
    });
    assert.equal(nextOrdinary.route.selected_mode, "request_revision");

    const repeat = reconcileHistoricalE2A23();
    assert.deepEqual(
      repeat.comparisons.map((entry) => ({
        profile: entry.corrected_profile.profile_snapshot_id,
        mode: entry.corrected_route.selected_mode,
        operation: entry.corrected_route.selected_operation
      })),
      replay.comparisons.map((entry) => ({
        profile: entry.corrected_profile.profile_snapshot_id,
        mode: entry.corrected_route.selected_mode,
        operation: entry.corrected_route.selected_operation
      }))
    );

    const result = await executeE2A23A({ artifactRoot });
    assert.equal(result.summary.status, E2A23A_ALLOWED_STATUS);
    assert.equal(result.summary.provider_call_count, 0);
    assert.equal(result.summary.network_request_count, 0);
    assert.equal(result.summary.e2a24_executed, false);
    assert.equal(result.summary.candidate_approved, false);
    assert.equal(result.summary.candidate_activated, false);
    assert.equal(E2A23A_ARTIFACT_NAMES.length, 26);
    assert.ok(validateE2A23AArtifacts(result.runDir).passed);
    const human = readJson<Record<string, unknown>>(path.join(
      result.runDir, "human-review-attestation.json"
    ));
    const ai = readJson<Record<string, unknown>>(path.join(
      result.runDir, "ai-review-reference.json"
    ));
    const protocol = readJson<Record<string, unknown>>(path.join(
      result.runDir, "e2a24-micro-canary-protocol-draft.json"
    ));
    const budget = readJson<Record<string, unknown>>(path.join(
      result.runDir, "e2a24-budget-draft.json"
    ));
    assert.equal(human.evidence_source,
      "user_supplied_primary_human_review_attestation");
    assert.equal(human.item_level_ratings, null);
    assert.equal(ai.human_evidence, false);
    assert.equal(protocol.held_out_concept, "correlation_causation");
    assert.equal(protocol.authorized_for_execution, false);
    assert.equal(budget.maximum_logical_generation_calls, 14);
    assert.equal(budget.maximum_adapter_attempts, 42);
    assert.equal(budget.execution_authorized, false);
    assert.equal(networkRequestCount, 0);

    console.log(JSON.stringify({
      status: "passed",
      suite,
      exact_turn_count: replay.comparisons.length,
      corrected_turn_qualities: replay.comparisons.map((entry) =>
        entry.corrected_profile.reasoning_quality
      ),
      simulator_v4_levels: replay.comparisons.map((entry) =>
        entry.simulator_classifier_v4.observed_level
      ),
      earliest_revision_ready_turn: replay.earliestRevision,
      first_route_divergence: replay.firstDivergence,
      calibration_case_count: calibration.corpus_size,
      calibration_pass_count: calibration.pass_count,
      artifact_count: E2A23A_ARTIFACT_NAMES.length,
      provider_call_count: 0,
      network_request_count: networkRequestCount,
      e2a24_executed: false,
      candidate_approved: false,
      candidate_activated: false
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(artifactRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message :
    "e2a23a_smoke_failed");
  process.exitCode = 1;
});
