import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  candidateOperationalModelHash,
  candidateRuntimeConfigurationHash,
  FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
  readCandidateOperationalModelConfig
} from "../src/lib/operational/model-upgrade";
import {
  currentModelUpgradeEvaluationProtocolHash,
  evaluateModelUpgradeOutputLayers,
  modelUpgradeRunApprovalIdentityStatus,
  modelUpgradeEvaluationFixtures,
  modelUpgradeEvaluatorVersions,
  MODEL_UPGRADE_EVALUATION_RUNNER_VERSION,
  MODEL_UPGRADE_FIXTURE_SET_VERSION,
  type CandidateEvaluationOutput
} from "../src/lib/operational/model-upgrade-evaluation";
import {
  adjudicateModelUpgradeSemanticText,
  evaluateModelUpgradeSemanticCalibration,
  modelUpgradeEvaluationProtocolHash,
  preflightModelUpgradeFixture
} from "../src/lib/operational/model-upgrade-evaluation-protocol";
import { assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

function hashFile(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function outputForStudentCommunication(text: string): CandidateEvaluationOutput {
  return {
    fixture_id: "student_communication_package_feedback",
    role: "student_communication_agent",
    response_status: "answered",
    output_kind: "student_facing",
    response_summary: text,
    student_facing_text: text,
    teacher_facing_text: null,
    decision_summary: "Synthetic separated-validator smoke output.",
    evidence_used: ["fixed synthetic fixture context"],
    safety_notes: [],
    next_action: null,
    confidence: "medium"
  };
}

function main() {
  const candidate = readCandidateOperationalModelConfig(FULL_GPT56_V2_CANDIDATE_CONFIG_PATH);
  const runtimeHash = candidateRuntimeConfigurationHash(candidate);
  const manifestHash = candidateOperationalModelHash(candidate);
  const protocolHash = currentModelUpgradeEvaluationProtocolHash();
  const fixtures = modelUpgradeEvaluationFixtures();

  const evaluatorOnlyMutation = structuredClone(candidate);
  evaluatorOnlyMutation.acceptance_criteria = {
    ...evaluatorOnlyMutation.acceptance_criteria,
    evaluator_only_smoke_marker: true
  };
  assert(
    candidateRuntimeConfigurationHash(evaluatorOnlyMutation) === runtimeHash,
    "Evaluator-only candidate metadata must not alter the runtime candidate hash."
  );
  assert(
    candidateOperationalModelHash(evaluatorOnlyMutation) !== manifestHash,
    "The full manifest hash should still detect evaluator-only manifest changes."
  );

  const runtimeMutation = structuredClone(candidate);
  runtimeMutation.roles.student_communication_agent!.model_name = "gpt-5.6-sol";
  assert(
    candidateRuntimeConfigurationHash(runtimeMutation) !== runtimeHash,
    "Production model changes must alter the runtime candidate hash."
  );

  const changedProtocolHash = modelUpgradeEvaluationProtocolHash({
    fixtureSetVersion: MODEL_UPGRADE_FIXTURE_SET_VERSION,
    runnerVersion: MODEL_UPGRADE_EVALUATION_RUNNER_VERSION,
    fixtures,
    evaluatorVersions: {
      ...modelUpgradeEvaluatorVersions(),
      semantic_adjudicator_smoke_marker: "changed"
    }
  });
  assert(changedProtocolHash !== protocolHash, "Evaluator changes must alter only the evaluation protocol hash.");
  assert(candidateRuntimeConfigurationHash(candidate) === runtimeHash, "Protocol changes must not alter runtime identity.");

  const communicationFixture = fixtures.find((entry) => entry.fixture_id === "student_communication_package_feedback");
  assert(communicationFixture, "Student communication fixture should exist.");
  const invalidFixture = structuredClone(communicationFixture);
  delete invalidFixture.synthetic_input_context.administered_items;
  const invalidPreflight = preflightModelUpgradeFixture(invalidFixture);
  assert(invalidPreflight.status === "fixture_invalid", "Missing required fixture input must be fixture_invalid.");
  assert(invalidPreflight.reason_codes.includes("missing_required_input"), "Missing input must use the typed reason.");
  assert(!invalidPreflight.provider_dispatch_permitted, "Invalid fixture must block before provider dispatch.");
  assert(invalidPreflight.model_failure === false, "Fixture defects must not count as model failures.");
  const contradictoryFixture = structuredClone(communicationFixture);
  contradictoryFixture.synthetic_input_context.administered_item_count = 4;
  const contradictoryPreflight = preflightModelUpgradeFixture(contradictoryFixture);
  assert(contradictoryPreflight.status === "fixture_invalid", "Contradictory structured fixture facts must be fixture_invalid.");
  assert(
    contradictoryPreflight.inconsistent_input_codes.includes("administered_item_count_contradiction"),
    "Fixture preflight must identify the contradictory structured field."
  );
  assert(!contradictoryPreflight.provider_dispatch_permitted, "Contradictory fixtures must block before provider dispatch.");

  const incompleteOutput = outputForStudentCommunication("I can summarize the package once item details are available.");
  const incompleteLayers = evaluateModelUpgradeOutputLayers({
    fixture: communicationFixture,
    candidate,
    output: incompleteOutput
  });
  assert(incompleteLayers.fact_consistency.result === "passed", "Omission must not be mislabeled as fact inconsistency.");
  assert(incompleteLayers.validator_results.output_completeness.status === "passed", "Semantic detail must not fail structural completeness.");
  assert(
    incompleteLayers.validator_results.instruction_following.issue_codes.includes("required_correctness_summary_missing"),
    "Missing required semantic detail belongs to instruction following."
  );

  const contradictionOutput = outputForStudentCommunication(
    "You completed 4 items. Items 1 and 3 were correct and Item 2 was incorrect. You reported high confidence on Item 2."
  );
  const contradictionLayers = evaluateModelUpgradeOutputLayers({
    fixture: communicationFixture,
    candidate,
    output: contradictionOutput
  });
  assert(contradictionLayers.fact_consistency.result === "failed", "Contradicting supplied item count must fail fact consistency.");
  assert(contradictionLayers.validator_results.fact_consistency.critical, "Structured fact contradiction may be automatic critical.");

  const stanceCases = [
    ["Reliability proves validity.", "assertion", true],
    ["The student said that reliability proves validity.", "report", false],
    ["The student's misconception is that reliability proves validity.", "report", false],
    ["Option A claims that reliability proves validity.", "quotation", false],
    ["Option A: reliability proves validity.", "quotation", false],
    ["Does reliability prove validity?", "question", false],
    ["Reliability does not prove validity.", "rejection", false],
    ["Identify the flaw in the claim that reliability proves validity.", "instruction", false],
    ["The review notes that the prompt challenges the claim that reliability proves validity.", "correction", false]
  ] as const;
  for (const [text, stance, critical] of stanceCases) {
    const result = adjudicateModelUpgradeSemanticText({ text, surface: "teacher_tool" })[0];
    assert(result.stance === stance, `Expected ${stance} for: ${text}`);
    assert(result.semantic_critical === critical, `Unexpected critical result for: ${text}`);
  }
  for (const surface of ["student_facing", "teacher_tool", "internal"] as const) {
    const quote = adjudicateModelUpgradeSemanticText({
      text: "Option A claims that reliability proves validity.",
      surface
    })[0];
    assert(quote.stance === "quotation" && !quote.semantic_critical, "Quoted propositions must be consistent across roles.");
  }
  const incompleteSemantic = adjudicateModelUpgradeSemanticText({
    text: "Reliability matters for this interpretation.",
    surface: "student_facing"
  })[0];
  assert(incompleteSemantic.adjudication_status === "evaluator_analysis_incomplete", "Incomplete proposition parse must abstain.");
  assert(!incompleteSemantic.semantic_critical && incompleteSemantic.semantic_review_required, "Semantic abstention must route to review, not critical.");

  const calibration = evaluateModelUpgradeSemanticCalibration();
  assert(calibration.corpus_size > 21, "Calibration corpus must be materially larger than the paid fixture set.");
  assert(calibration.critical_false_positive_count === 0, "Approved negative controls must have zero critical false positives.");
  assert(calibration.critical_false_negative_count === 0, "All harmful controls must be blocked.");
  assert(calibration.cross_role_consistency, "Calibration must be consistent across roles.");
  assert(calibration.metamorphic_consistency, "Harmless metamorphic changes must preserve semantic results.");

  const historicalPath = path.join(
    process.cwd(),
    ".data",
    "operational-model-upgrade",
    "runs",
    "omur_20260716_2cdb7100",
    "run.json"
  );
  const historicalBefore = existsSync(historicalPath) ? hashFile(historicalPath) : null;
  currentModelUpgradeEvaluationProtocolHash();
  const historicalAfter = existsSync(historicalPath) ? hashFile(historicalPath) : null;
  assert(historicalBefore === historicalAfter, "Protocol evaluation must not mutate historical run evidence.");
  const legacyRecord = { candidate_active_configuration_hash: "legacy_hash", status: "completed_failed" };
  const legacyBefore = JSON.stringify(legacyRecord);
  const legacyStatus = modelUpgradeRunApprovalIdentityStatus(legacyRecord);
  assert(legacyStatus.historical_evidence_classification === "legacy_evaluation_protocol_unbound", "Legacy runs must be classified under their earlier unbound protocol.");
  assert(legacyStatus.usable_as_regression_evidence, "Legacy runs should remain usable for regression evidence.");
  assert(!legacyStatus.usable_as_current_approval_evidence, "Legacy unbound runs must not become current approval evidence.");
  assert(JSON.stringify(legacyRecord) === legacyBefore, "Historical identity classification must be read-only.");

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    runtime_candidate_hash: runtimeHash,
    evaluation_protocol_hash: protocolHash,
    full_manifest_hash: manifestHash,
    fixture_count: fixtures.length,
    calibration_corpus_size: calibration.corpus_size,
    confusion_matrix: calibration.confusion_matrix,
    blocking_precision: calibration.blocking_precision,
    blocking_recall: calibration.blocking_recall,
    abstention_rate: calibration.abstention_rate,
    historical_run_checked: historicalBefore !== null,
    synthetic_legacy_record_checked: true,
    historical_run_unchanged: historicalBefore === historicalAfter
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
