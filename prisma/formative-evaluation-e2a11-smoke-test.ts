import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import {
  identifyTopicDialogueInstructionalStrategySignals,
  resolveTopicDialogueRegenerationPolicy,
  validateTopicDialogueRuntimeAcceptance
} from "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v2";
import {
  buildE2A11BorderlineValidCorpus,
  buildE2A11HardNegativeCorpus,
  e2a11ProtectedArtifactSnapshot,
  evaluateE2A11CalibrationInMemory,
  executeE2A11Calibration,
  loadE2A11Calibration
} from "@/lib/evaluation/formative/e2a11-validator-calibration";
import {
  E2A11_CANDIDATE_FILE_SHA256,
  E2A11_CANDIDATE_HASH,
  evaluateE2A11Candidate
} from "@/lib/evaluation/formative/e2a11-v8-validator-candidate";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const baseContext = {
  selected_mode: "remain_in_dialogue" as const,
  selected_operation: "clarify_concept_with_new_strategy" as const,
  latest_student_message:
    "Why does a high reliability coefficient not prove validity?",
  distractor_anchor: "Item 2 option A",
  misconception_target:
    "Reliability evidence is being treated as proof of validity."
};

function operationOutput(message: string) {
  return {
    schema_version:
      TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS
        .clarify_concept_with_new_strategy,
    student_facing_message: message
  };
}

function runArchitectureAssertions() {
  const soft = validateTopicDialogueRuntimeAcceptance({
    context: baseContext,
    output: operationOutput(
      "Think about it: explain how reliability and validity differ for option A."
    )
  });
  assert(soft.runtime_acceptance === "accepted_with_review_flags",
    "soft review result should remain accepted");
  assert(!soft.regeneration_required,
    "soft review flag must not trigger regeneration");
  assert(!soft.deterministic_fallback_required,
    "soft review flag must not trigger fallback");
  assert(soft.safe_for_student_display,
    "soft review result should remain displayable");

  const hard = validateTopicDialogueRuntimeAcceptance({
    context: baseContext,
    output: operationOutput("The correct answer is C.")
  });
  assert(hard.runtime_acceptance === "hard_rejected",
    "answer-key disclosure should hard reject");
  assert(hard.regeneration_required,
    "hard rejection should trigger one regeneration");
  assert(hard.hard_rejection_reasons.every((reason) =>
    reason.evidence_spans.length > 0 || reason.structured_evidence.length > 0
  ), "every hard rejection should contain auditable evidence");

  const malformed = validateTopicDialogueRuntimeAcceptance({
    context: baseContext,
    output: null
  });
  assert(malformed.hard_rejection_reasons.some((reason) =>
    reason.evidence_spans.length === 0 &&
    reason.structured_evidence.length > 0
  ), "structured contract failure should reject without a text span");

  const initialPolicy = resolveTopicDialogueRegenerationPolicy({
    initial: hard
  });
  assert(initialPolicy.regeneration_required &&
    !initialPolicy.deterministic_fallback_required,
  "first hard rejection should request regeneration only");
  const secondPolicy = resolveTopicDialogueRegenerationPolicy({
    initial: hard,
    regenerated: hard
  });
  assert(!secondPolicy.regeneration_required &&
    secondPolicy.deterministic_fallback_required,
  "second hard rejection should trigger fallback");
  const repairedPolicy = resolveTopicDialogueRegenerationPolicy({
    initial: hard,
    regenerated: soft
  });
  assert(repairedPolicy.display_source === "regenerated_provider_output" &&
    !repairedPolicy.deterministic_fallback_required,
  "accepted regeneration should be displayed without fallback");

  const strategies = [
    ["Change one thing while keeping score consistency fixed.", "counterfactual_test"],
    ["Trace the inference chain and identify the unsupported arrow.", "inference_chain"],
    ["Separate evidence strength from evidence type.", "evidence_type_decomposition"]
  ] as const;
  for (const [message, expected] of strategies) {
    assert(identifyTopicDialogueInstructionalStrategySignals(message)
      .includes(expected), `${expected} should count as strategy change`);
  }

  const imperative = validateTopicDialogueRuntimeAcceptance({
    context: { ...baseContext, selected_operation: "clarify_task" },
    output: {
      schema_version:
        TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS.clarify_task,
      student_facing_message:
        "Give two parts: identify the flaw, then rewrite the reliability claim narrowly."
    }
  });
  assert(imperative.runtime_acceptance !== "hard_rejected",
    "imperative task clarification should not hard reject");

  const semanticAnchor = validateTopicDialogueRuntimeAcceptance({
    context: baseContext,
    output: operationOutput(
      "Stable scores can support consistency without establishing intended meaning. What validity evidence is needed?"
    )
  });
  assert(semanticAnchor.runtime_acceptance !== "hard_rejected",
    "semantic anchor should not require literal option label");
}

function runReplayAssertions() {
  const result = evaluateE2A11CalibrationInMemory();
  assert(result.summary.v7_output_count === 14,
    "all 14 V7 outputs must replay");
  assert(result.summary.v8_safe_for_student_display_count === 14,
    "all V7 outputs should remain displayable under V8");
  assert(result.summary.v8_hard_rejected_count === 0,
    "V7 replay should have zero hard rejections");
  assert(result.summary.v8_regeneration_required_count === 0,
    "V7 replay should require zero regenerations");
  assert(result.summary.v8_fallback_required_count === 0,
    "V7 replay should require zero fallbacks");
}

function runNegativeAssertions() {
  const result = evaluateE2A11CalibrationInMemory();
  assert(buildE2A11HardNegativeCorpus().length >= 24,
    "hard-negative corpus must contain at least 24 cases");
  assert(result.summary.hard_negative_pass_count ===
    result.summary.hard_negative_count,
  "every hard negative must reject with the expected rule and evidence");
  assert(result.hard_negative_results.every((entry) =>
    entry.runtime_acceptance === "hard_rejected"
  ), "hard negatives must not be downgraded to soft-only results");
}

function runBorderlineAssertions() {
  const result = evaluateE2A11CalibrationInMemory();
  assert(buildE2A11BorderlineValidCorpus().length >= 24,
    "borderline corpus must contain at least 24 cases");
  assert(result.summary.borderline_false_hard_rejection_count === 0,
    "borderline corpus must have zero false hard rejections");
  assert(result.summary.borderline_expectation_pass_count ===
    result.summary.borderline_count,
  "borderline expectations should match row-level results");
  assert(result.borderline_results.filter((entry) =>
    entry.runtime_acceptance === "accepted_with_review_flags"
  ).every((entry) =>
    !entry.regeneration_required && !entry.fallback_required
  ), "soft-only cases must not regenerate or fall back");
}

function runMutationAssertions() {
  const result = evaluateE2A11CalibrationInMemory();
  assert(result.summary.mutation_count === 8,
    "eight controlled mutations should be present");
  assert(result.summary.mutation_pass_count === result.summary.mutation_count,
    "each mutation should flip acceptance and restore cleanly");
}

function runCandidateAssertions() {
  const candidate = evaluateE2A11Candidate();
  assert(candidate.candidate_configuration_hash === E2A11_CANDIDATE_HASH,
    "V8 configuration hash should be reproducible");
  assert(candidate.candidate_file_sha256 === E2A11_CANDIDATE_FILE_SHA256,
    "V8 file SHA should be reproducible");
  assert(candidate.exact_delta_paths_from_v7.length === 6,
    "V8 should contain only six validation-policy metadata deltas");
  assert(candidate.v7_prompt_metadata_unchanged,
    "V7 prompts must remain unchanged");
  assert(candidate.v7_schema_metadata_unchanged,
    "V7 schemas must remain unchanged");
  assert(!candidate.unrelated_role_configuration_changed,
    "unrelated roles must remain unchanged");
  assert(!candidate.candidate_approved && !candidate.candidate_activated,
    "V8 must remain unapproved and inactive");
}

async function runArtifactAssertions() {
  const root = mkdtempSync(path.join(os.tmpdir(), "e2a11-smoke-"));
  try {
    const result = await executeE2A11Calibration({
      artifact_root: root,
      run_id: "e2a11_smoke"
    });
    const loaded = loadE2A11Calibration(result.runDir);
    assert(loaded.replay.length === 14,
      "artifact replay should contain 14 rows");
    assert(loaded.hardNegative.length === 24,
      "artifact hard-negative corpus should contain 24 rows");
    assert(loaded.borderline.length === 24,
      "artifact borderline corpus should contain 24 rows");
    assert(loaded.mutations.length === 8,
      "artifact mutation results should contain eight rows");
    assert(result.summary.status ===
      "e2a11_passed_v8_unapproved_pending_fresh_canary",
    "artifact summary should pass without approving V8");
    assert(result.summary.network_request_count === 0,
      "artifact generation must make no network request");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const suiteIndex = process.argv.indexOf("--suite");
  const suite = suiteIndex >= 0 ? process.argv[suiteIndex + 1] : "all";
  const protectedBefore = e2a11ProtectedArtifactSnapshot();
  if (["all", "architecture", "regeneration"].includes(suite)) {
    runArchitectureAssertions();
  }
  if (["all", "replay"].includes(suite)) runReplayAssertions();
  if (["all", "negative"].includes(suite)) runNegativeAssertions();
  if (["all", "borderline"].includes(suite)) runBorderlineAssertions();
  if (["all", "mutation"].includes(suite)) runMutationAssertions();
  if (["all", "candidate"].includes(suite)) runCandidateAssertions();
  if (suite === "all") await runArtifactAssertions();
  const protectedAfter = e2a11ProtectedArtifactSnapshot();
  assert(protectedBefore.aggregate_sha256 === protectedAfter.aggregate_sha256,
    "protected artifacts changed during E2A.11 smoke");
  console.log(JSON.stringify({
    status: "passed",
    suite,
    candidate_hash: E2A11_CANDIDATE_HASH,
    provider_calls: 0,
    protected_artifacts_unchanged: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "e2a11_smoke_failed");
  process.exitCode = 1;
});
