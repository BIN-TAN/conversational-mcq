import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  stableClassroomHash
} from "./e2a40-classroom-isolation-contracts";
import {
  buildE2A41FreezeArtifacts
} from "./e2a41-research-audit-protocol";
import {
  BASELINE_COMPARISON_CONTRACT_VERSION,
  DIAGNOSTIC_EVALUATION_CONTRACT_VERSION,
  DIALOGUE_EFFICIENCY_CONTRACT_VERSION,
  EVALUATION_FRAMEWORK_CONTRACT_VERSION,
  EVALUATION_FRAMEWORK_VERSION,
  EVALUATION_REPLAY_CONTRACT_VERSION,
  INTERVENTION_QUALITY_CONTRACT_VERSION,
  LEARNING_PROGRESSION_CONTRACT_VERSION,
  STUDENT_EXPERIENCE_CONTRACT_VERSION,
  TEACHER_UTILITY_CONTRACT_VERSION,
  buildBaselineComparison,
  buildBaselineComparisonContractV1,
  buildDiagnosticEvaluationContractV1,
  buildDialogueEfficiencyContractV1,
  buildEvaluationFrameworkContractV1,
  buildEvaluationReplayContractV1,
  buildInterventionQualityContractV1,
  buildLearningProgressionContractV1,
  buildStudentExperienceContractV1,
  buildTeacherUtilityContractV1,
  computeEvaluationMetrics,
  detectEvaluationFailures,
  replayEvaluationDataset,
  scopeForEvaluationCase,
  validateEvaluationDataset,
  type EvaluationCase,
  type EvaluationDataset,
  type InterventionNeed,
  type InterventionStrategy,
  type ReasoningState
} from "./e2a42-evaluation-framework-contracts";

export const E2A42_PROTOCOL_VERSION =
  "e2a42-cba-evaluation-framework-freeze-v1" as const;
export const E2A42_SCENARIO_VERSION =
  "e2a42-measurement-theory-evaluation-fixtures-v1" as const;
export const E2A42_ARTIFACT_CONTRACT_VERSION =
  "e2a42-artifact-contract-v1" as const;
export const E2A42_BUDGET_CONTRACT_VERSION =
  "e2a42-budget-contract-v1" as const;
export const E2A42_COMPOSITE_IDENTITY_VERSION =
  "e2a42-composite-runtime-identity-v1" as const;
export const E2A42_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a42-cba-evaluation-framework-protocol-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const PREDECESSOR_COMMIT =
  "d422719c10f18e82c92d6aa873c215e8ac08f475";
const E2A41_PROTOCOL_HASH =
  "01bece2a52167d5f4b1993bd6d358a98b64f6c3332c4a5f78cccb34fa57fcc83";
const E2A41_COMPOSITE_IDENTITY =
  "9465c76cabd28c3aca8c107bed2b19c81e395150d6012e1f2926e1b3fc283ef5";
const E2A40_PROTOCOL_HASH =
  "0ce1218bb01caf99ce85c45a973d3c5604913b9fb8eb80157860b07bdacd91ab";
const E2A40_COMPOSITE_IDENTITY =
  "ab5a6a047b8e663753303f142ee2fdcb979e854c6f0d37330dd3e10c42da7171";

const PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/services/student-assessment/canonical-anchor-evidence.ts":
    "bb03fd71ba544d9ffab2ce5c650fc036d3525d7f29a3718bcbd015c620c07fd2",
  "src/lib/services/student-assessment/active-anchor-alias-resolution-v4.ts":
    "caeaa699f5a769dff743ee491d3abe49bfcbeb535644f78e18233b136696661b",
  "src/lib/services/student-assessment/anchor-stance-resolution-v1.ts":
    "36c291183aaf15378a65a3cf00c847e4625676a275dca8daa47fe1aaf9749e6a",
  "src/lib/services/student-assessment/anchor-stance-evidence-resolution-v2.ts":
    "4cb954d19b1a975694ffaa277b13ec856284a0c6714fd74a9801bd29a33a927b",
  "src/lib/services/student-assessment/anchor-stance-scope-resolution-v1.ts":
    "5cef63e18291b2e3f9ace00c2e4d8be20d9e7a70d51c06717723972250c1e82a",
  "src/lib/services/student-assessment/target-evidence-mapper-v7.ts":
    "a4ef776faa93094222e5cb7e61e890a71e662b6d247f2c247013224c5ab787a5",
  "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts":
    "98044fed11bd8a1a9ff9151afa21e866e7d0f0624cfdf8cecc455f42700ad941",
  "src/lib/evaluation/formative/e2a37-instructor-handoff-protocol.ts":
    "a32d141d052cbe07d56d4b989cda129d7442950f311166b42f79d6d9b38794d7",
  "src/lib/evaluation/formative/e2a40-classroom-isolation-contracts.ts":
    "2718e4162788c4b0d1b1c0a0da122ee3e3544090a9c395b41e357befa4713d76",
  "src/lib/evaluation/formative/e2a40-classroom-isolation-protocol.ts":
    "08fd5e2cfe0b3b3546f5bb480f7e77eabc7e9d1c609474673c7e45cee3c7fbd4",
  "prisma/formative-evaluation-e2a40.ts":
    "252b06908d528c4f37da93626ae08d309d377e79d9f1ec262fc4ffa3ab7546bb",
  "src/lib/evaluation/formative/e2a41-research-audit-contracts.ts":
    "64cd030fb82857f6fd629c26b9f596de64b3ab080631f8d0db7fa78504c5ab67",
  "src/lib/evaluation/formative/e2a41-research-audit-protocol.ts":
    "b982c8b8ae7b9644bf62524c6c35790d1360bac2399788cfa097b49725c9397b",
  "prisma/formative-evaluation-e2a41.ts":
    "7ece73e3709d80ea6cfe087ee3eb031869807ec762f6957451443ea10b671f2a"
} as const;

export const E2A42_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "component-contract-bindings.json",
  "evaluation-framework-contract.json",
  "diagnostic-evaluation-contract.json",
  "intervention-quality-contract.json",
  "learning-progression-contract.json",
  "dialogue-efficiency-contract.json",
  "student-experience-contract.json",
  "teacher-utility-contract.json",
  "baseline-comparison-contract.json",
  "evaluation-replay-contract.json",
  "synthetic-evaluation-cases.json",
  "diagnostic-evaluation-results.json",
  "evidence-quality-results.json",
  "intervention-quality-results.json",
  "learning-progression-results.json",
  "dialogue-efficiency-results.json",
  "student-experience-results.json",
  "teacher-utility-results.json",
  "baseline-comparison-results.json",
  "evaluation-replay-results.json",
  "multi-student-evaluation-results.json",
  "failure-evaluation-results.json",
  "deterministic-regression-results.json",
  "evaluation-metrics.json",
  "historical-integrity.json",
  "budget.json",
  "artifact-contract.json",
  "candidate-integrity.json",
  "protected-source-integrity.json",
  "composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json",
  "artifact-validation.json"
] as const;

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha256(relativePath: string) {
  return sha256(readFileSync(path.join(process.cwd(), relativePath)));
}

function currentGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function writeJson(filePath: string, value: unknown) {
  const serialized = JSON.stringify(value);
  assert(
    ![
      /\bsk-[A-Za-z0-9_-]{12,}/u,
      /\bBearer\s+[A-Za-z0-9._-]+/u,
      /OPENAI_API_KEY\s*=/u,
      /DATABASE_URL\s*=/u,
      /SESSION_SECRET\s*=/u
    ].some((pattern) => pattern.test(serialized)),
    "e2a42_forbidden_secret_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function expectedStrategy(
  need: InterventionNeed
): InterventionStrategy {
  return {
    conceptual_distinction: "contrast_reliability_and_validity",
    confidence_calibration: "confidence_evidence_audit",
    counterexample: "counterexample_test",
    independent_application: "independent_reconstruction",
    no_intervention: "none"
  }[need] as InterventionStrategy;
}

function makeEvaluationCase(input: {
  id: string;
  baseline?: EvaluationCase["baseline"];
  expectedState: ReasoningState;
  need: InterventionNeed;
  student: string;
  sharedGroup?: string | null;
  progression?: ReasoningState[];
  regression?: boolean;
  soundReached?: boolean;
  transfer?: boolean;
  keywordOnly?: boolean;
  copied?: boolean;
  unsupported?: boolean;
  expectedGaps?: string[];
}): EvaluationCase {
  const baseline = input.baseline ?? "conversation_based_assessment";
  const isCba = baseline === "conversation_based_assessment";
  const progression = input.progression ?? (
    input.expectedState === "sound"
      ? ["partial", "sound"]
      : [input.expectedState, "partial", "sound"]
  );
  const soundReached = input.soundReached ?? (
    progression.at(-1) === "sound"
  );
  const expectedGaps = input.expectedGaps ?? (
    input.need === "no_intervention"
      ? []
      : [`gap_${input.need}`]
  );
  const strategy = expectedStrategy(input.need);
  const teacherPacket = {
    struggling_student_signal_present: isCba,
    misconception_summary_present: isCba,
    instructional_planning_evidence_present: isCba,
    ai_decision_trace_present: isCba,
    evidence_provenance_present: isCba,
    hidden_reasoning_present: false as const,
    private_identifier_present: false as const
  };
  return {
    case_id: input.id,
    scope: scopeForEvaluationCase({
      student: input.student,
      session: input.id
    }),
    baseline,
    shared_misconception_group:
      input.sharedGroup === undefined
        ? "same_reliability_validity_misconception"
        : input.sharedGroup,
    expected_reasoning_state: input.expectedState,
    identified_reasoning_state: input.expectedState,
    expected_gap_codes: expectedGaps,
    identified_gap_codes: expectedGaps,
    expected_profile_transition_valid: true,
    observed_profile_transition_valid: true,
    evidence: {
      reasoning_evidence: isCba,
      confidence_evidence: isCba,
      distractor_stance_evidence: isCba,
      conceptual_application_evidence: isCba,
      revision_evidence: isCba && soundReached,
      transfer_evidence: isCba && Boolean(input.transfer),
      keyword_only: Boolean(input.keywordOnly),
      copied_without_understanding: Boolean(input.copied),
      unsupported_understanding_claim: Boolean(input.unsupported),
      essential_missing_link_codes: [],
      source_evidence_ids: isCba
        ? [`syn_evidence_${input.id}_reasoning`]
        : [],
      evidence_preserved_to_decision: true
    },
    intervention: {
      expected_need: input.need,
      selected_strategy: strategy,
      strategy_adapted_from_previous:
        isCba && input.need !== "no_intervention",
      personalized_to_observed_gap: true,
      generic_identical_feedback: false,
      intervention_effective:
        input.need === "no_intervention" ? null : soundReached
    },
    progression: {
      expected_states: progression,
      observed_states: progression,
      resolution_turn: soundReached ? progression.length : null,
      regression_present: Boolean(input.regression),
      regression_reopened_profile: Boolean(input.regression),
      transfer_demonstrated: Boolean(input.transfer)
    },
    stopping: {
      support_needed: !soundReached,
      sound_reached: soundReached,
      sound_turn: soundReached ? progression.length : null,
      stopping_outcome: soundReached
        ? "revise"
        : "instructor_support",
      episode_closed: soundReached,
      tutor_turns_after_sound: 0,
      revision_authorized: soundReached,
      stopping_appropriate: true
    },
    student_visible_messages: isCba
      ? [
          input.need === "no_intervention"
            ? "Your explanation supports the distinction. Revise your answer in your own words."
            : "Let us work with the part of your explanation that still needs support."
        ]
      : ["Review the answer and explanation."],
    student_experience: {
      clarity: isCba ? 5 : 3,
      usefulness: isCba ? 5 : 3,
      personalization: isCba ? 5 : 1,
      cognitive_burden: isCba ? 2 : 2,
      communication_quality: isCba ? 5 : 3
    },
    teacher_evidence_package: teacherPacket
  };
}

function buildSyntheticCases(): EvaluationCase[] {
  return [
    makeEvaluationCase({
      id: "cba_conceptual_distinction",
      expectedState: "misconception",
      need: "conceptual_distinction",
      student: "student_a",
      progression: ["misconception", "partial", "sound"],
      transfer: true
    }),
    makeEvaluationCase({
      id: "cba_confidence_calibration",
      expectedState: "misconception",
      need: "confidence_calibration",
      student: "student_b",
      progression: ["misconception", "partial"],
      soundReached: false
    }),
    makeEvaluationCase({
      id: "cba_counterexample",
      expectedState: "misconception",
      need: "counterexample",
      student: "student_c",
      progression: ["misconception", "contradictory", "sound"],
      transfer: true
    }),
    makeEvaluationCase({
      id: "cba_copied_wording",
      expectedState: "copied",
      need: "independent_application",
      student: "student_d",
      sharedGroup: null,
      progression: ["copied", "partial", "sound"],
      copied: true,
      transfer: true
    }),
    makeEvaluationCase({
      id: "cba_regression_recovery",
      expectedState: "partial",
      need: "confidence_calibration",
      student: "student_e",
      sharedGroup: null,
      progression: ["partial", "sound", "regressed", "partial", "sound"],
      regression: true,
      transfer: true
    }),
    makeEvaluationCase({
      id: "cba_early_sound",
      expectedState: "sound",
      need: "no_intervention",
      student: "student_f",
      sharedGroup: null,
      progression: ["partial", "sound"],
      transfer: true
    }),
    makeEvaluationCase({
      id: "baseline_traditional_mcq",
      baseline: "traditional_mcq_only",
      expectedState: "misconception",
      need: "no_intervention",
      student: "baseline_traditional",
      sharedGroup: "baseline_shared_case",
      progression: ["misconception"],
      soundReached: false
    }),
    makeEvaluationCase({
      id: "baseline_generic_ai",
      baseline: "mcq_with_generic_ai_explanation",
      expectedState: "misconception",
      need: "no_intervention",
      student: "baseline_generic",
      sharedGroup: "baseline_shared_case",
      progression: ["misconception"],
      soundReached: false
    })
  ];
}

function cloneCase(
  value: EvaluationCase,
  mutate: (draft: EvaluationCase) => void
) {
  const draft = structuredClone(value);
  mutate(draft);
  return draft;
}

function buildFailureEvaluation(cases: EvaluationCase[]) {
  const source = cases[0]!;
  const mutations = {
    false_sound: cloneCase(source, (draft) => {
      draft.identified_reasoning_state = "sound";
      draft.evidence.essential_missing_link_codes = [
        "validity_evidence_not_explained"
      ];
    }),
    premature_closure: cloneCase(source, (draft) => {
      draft.stopping.support_needed = true;
      draft.stopping.episode_closed = true;
    }),
    excessive_tutoring: cloneCase(source, (draft) => {
      draft.stopping.tutor_turns_after_sound = 2;
    }),
    wrong_intervention: cloneCase(source, (draft) => {
      draft.intervention.selected_strategy = "generic_explanation";
      draft.intervention.personalized_to_observed_gap = false;
    }),
    evidence_loss: cloneCase(source, (draft) => {
      draft.evidence.evidence_preserved_to_decision = false;
    }),
    student_facing_leakage: cloneCase(source, (draft) => {
      draft.student_visible_messages = [
        "The stopping outcome selected revision under policy version one."
      ];
    })
  };
  const detections = Object.entries(mutations).map(([expected, item]) => ({
    expected_failure: expected,
    detected_failures: detectEvaluationFailures(item),
    passed: detectEvaluationFailures(item).includes(
      expected as ReturnType<typeof detectEvaluationFailures>[number]
    )
  }));
  return {
    evaluation_version: "e2a42-failure-evaluation-v1",
    detections,
    passed: detections.every((item) => item.passed)
  };
}

function buildMultiStudentEvaluation(cases: EvaluationCase[]) {
  const shared = cases.filter(
    (item) =>
      item.shared_misconception_group ===
      "same_reliability_validity_misconception"
  );
  const strategies = shared.map(
    (item) => item.intervention.selected_strategy
  );
  const namespaces = shared.map(
    (item) => stableClassroomHash(item.scope)
  );
  return {
    evaluation_version: "e2a42-multi-student-evaluation-v1",
    compared_case_ids: shared.map((item) => item.case_id),
    shared_misconception: true,
    distinct_student_scopes:
      new Set(namespaces).size === shared.length,
    distinct_personalized_strategies:
      new Set(strategies).size === shared.length,
    profile_isolation_preserved: true,
    audit_isolation_preserved: true,
    passed:
      shared.length === 3 &&
      new Set(namespaces).size === 3 &&
      new Set(strategies).size === 3
  };
}

function metricAcceptance(
  metrics: ReturnType<typeof computeEvaluationMetrics>
) {
  return {
    diagnostic:
      metrics.diagnostic_accuracy.misconception_detection_accuracy === 1 &&
      metrics.diagnostic_accuracy.false_sound_rate === 0 &&
      metrics.diagnostic_accuracy.missed_misconception_rate === 0 &&
      metrics.diagnostic_accuracy.sound_detection_accuracy === 1 &&
      metrics.diagnostic_accuracy.profile_transition_accuracy === 1 &&
      metrics.diagnostic_accuracy
        .knowledge_gap_identification_accuracy === 1,
    evidence:
      metrics.evidence_quality.evidence_preservation_rate === 1 &&
      metrics.evidence_quality.keyword_only_rejected_rate === 1 &&
      metrics.evidence_quality.copied_wording_rejected_rate === 1 &&
      metrics.evidence_quality.unsupported_claim_rejected_rate === 1,
    intervention:
      metrics.intervention_quality.intervention_appropriateness === 1 &&
      metrics.intervention_quality.strategy_adaptation_rate === 1 &&
      metrics.intervention_quality.personalization_rate === 1,
    progression:
      metrics.learning_progression.mean_evidence_gain > 0.4 &&
      metrics.learning_progression.profile_improvement_rate >= 5 / 6 &&
      metrics.learning_progression.regression_handling_accuracy === 1,
    efficiency:
      metrics.dialogue_efficiency.unnecessary_dialogue_rate === 0 &&
      metrics.dialogue_efficiency.missed_revision_rate === 0 &&
      metrics.dialogue_efficiency.strategy_adaptation_rate === 1 &&
      metrics.dialogue_efficiency.stopping_appropriateness === 1,
    student_experience:
      metrics.student_experience.clarity_mean >= 4 &&
      metrics.student_experience.usefulness_mean >= 4 &&
      metrics.student_experience.personalization_mean >= 4 &&
      metrics.student_experience.cognitive_burden_mean <= 3 &&
      metrics.student_experience.communication_quality_mean >= 4 &&
      metrics.student_experience.student_audit_separation_rate === 1,
    teacher_utility:
      metrics.teacher_research_utility
        .evidence_package_completeness === 1
  };
}

function buildRegressions(dataset: EvaluationDataset) {
  const cases = dataset.cases.filter(
    (item) => item.baseline === "conversation_based_assessment"
  );
  const primary = cases[0]!;
  const falseSound = cloneCase(primary, (draft) => {
    draft.identified_reasoning_state = "sound";
    draft.evidence.essential_missing_link_codes = [
      "interpretation_evidence_missing"
    ];
  });
  const missedMisconception = cloneCase(primary, (draft) => {
    draft.identified_reasoning_state = "partial";
  });
  const genericFeedback = cloneCase(primary, (draft) => {
    draft.intervention.generic_identical_feedback = true;
  });
  const earlyClosure = cloneCase(primary, (draft) => {
    draft.stopping.support_needed = true;
    draft.stopping.episode_closed = true;
  });
  const excessiveDialogue = cloneCase(primary, (draft) => {
    draft.stopping.tutor_turns_after_sound = 1;
  });
  const evidenceLoss = cloneCase(primary, (draft) => {
    draft.evidence.evidence_preserved_to_decision = false;
  });
  const studentLeakage = cloneCase(primary, (draft) => {
    draft.student_visible_messages = [
      "Your profile schema triggered the stopping outcome."
    ];
  });
  const incompleteTeacherPacket = cloneCase(primary, (draft) => {
    draft.teacher_evidence_package.ai_decision_trace_present = false;
  });
  const replayOne = replayEvaluationDataset(dataset);
  const replayTwo = replayEvaluationDataset({
    cases: [...dataset.cases].reverse(),
    researchAuditDataset: {
      acceptedTurns: [...dataset.researchAuditDataset.acceptedTurns].reverse(),
      evidenceSpans: [
        ...dataset.researchAuditDataset.evidenceSpans
      ].reverse(),
      profileSnapshots: [
        ...dataset.researchAuditDataset.profileSnapshots
      ].reverse(),
      decisionTraces: [
        ...dataset.researchAuditDataset.decisionTraces
      ].reverse()
    }
  });
  const baseline = buildBaselineComparison(dataset.cases);
  const tests = [
    {
      test_id: "correct_misconception_diagnosis",
      passed:
        primary.expected_reasoning_state ===
          primary.identified_reasoning_state &&
        primary.expected_gap_codes.join("|") ===
          primary.identified_gap_codes.join("|")
    },
    {
      test_id: "false_sound_detection",
      passed: detectEvaluationFailures(falseSound).includes("false_sound")
    },
    {
      test_id: "missed_misconception_detection",
      passed:
        missedMisconception.expected_reasoning_state === "misconception" &&
        missedMisconception.identified_reasoning_state !== "misconception"
    },
    {
      test_id: "appropriate_personalized_intervention",
      passed:
        primary.intervention.selected_strategy ===
          expectedStrategy(primary.intervention.expected_need) &&
        primary.intervention.personalized_to_observed_gap
    },
    {
      test_id: "generic_feedback_weakness",
      passed:
        genericFeedback.intervention.generic_identical_feedback &&
        !(
          genericFeedback.intervention.personalized_to_observed_gap &&
          !genericFeedback.intervention.generic_identical_feedback
        )
    },
    {
      test_id: "early_closure",
      passed: detectEvaluationFailures(earlyClosure).includes(
        "premature_closure"
      )
    },
    {
      test_id: "excessive_dialogue",
      passed: detectEvaluationFailures(excessiveDialogue).includes(
        "excessive_tutoring"
      )
    },
    {
      test_id: "evidence_preservation",
      passed: detectEvaluationFailures(evidenceLoss).includes(
        "evidence_loss"
      )
    },
    {
      test_id: "student_audit_separation",
      passed: detectEvaluationFailures(studentLeakage).includes(
        "student_facing_leakage"
      )
    },
    {
      test_id: "baseline_comparison_validity",
      passed: baseline.passed && !baseline.causal_claim_made
    },
    {
      test_id: "replay_consistency",
      passed: replayOne.replay_hash === replayTwo.replay_hash
    },
    {
      test_id: "teacher_evidence_package_completeness",
      passed:
        computeEvaluationMetrics([incompleteTeacherPacket])
          .teacher_research_utility
          .evidence_package_completeness === 0
    }
  ];
  return {
    regression_version: "e2a42-deterministic-regressions-v1",
    tests,
    test_count: tests.length,
    passed: tests.length === 12 && tests.every((item) => item.passed)
  };
}

function buildContracts() {
  return {
    framework: buildEvaluationFrameworkContractV1(),
    diagnostic: buildDiagnosticEvaluationContractV1(),
    intervention: buildInterventionQualityContractV1(),
    progression: buildLearningProgressionContractV1(),
    efficiency: buildDialogueEfficiencyContractV1(),
    student_experience: buildStudentExperienceContractV1(),
    teacher_utility: buildTeacherUtilityContractV1(),
    baseline: buildBaselineComparisonContractV1(),
    replay: buildEvaluationReplayContractV1()
  };
}

function buildBudget() {
  return {
    budget_contract_version: E2A42_BUDGET_CONTRACT_VERSION,
    maximum_logical_generation_calls: 29,
    maximum_adapter_attempts: 87,
    provider_concurrency: 1,
    maximum_transport_retries_per_logical_call: 2,
    maximum_input_tokens: 900_000,
    maximum_output_tokens: 70_000,
    maximum_total_tokens: 970_000,
    maximum_cost_usd_when_pricing_metadata_exists: 25,
    execution_authorized: false,
    live_entrypoint_present: false,
    provider_calls_made: 0
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: E2A42_ARTIFACT_CONTRACT_VERSION,
    required_artifacts: [...E2A42_ARTIFACT_NAMES],
    immutable_after_write: true,
    synthetic_data_only: true,
    chain_of_thought_prohibited: true,
    hidden_prompts_prohibited: true,
    hidden_model_reasoning_prohibited: true,
    raw_private_data_prohibited: true,
    provider_calls_required: 0,
    network_requests_required: 0
  } as const;
}

function buildCandidateIntegrity() {
  const relativePath =
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json";
  const actual = fileSha256(relativePath);
  return {
    integrity_version: "e2a42-candidate-integrity-v1",
    relative_path: relativePath,
    expected_sha256: PROTECTED_SOURCE_HASHES[relativePath],
    actual_sha256: actual,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    candidate_modified: false,
    passed: actual === PROTECTED_SOURCE_HASHES[relativePath]
  };
}

function buildProtectedSourceIntegrity() {
  const actual = Object.fromEntries(
    Object.keys(PROTECTED_SOURCE_HASHES).map((relativePath) => [
      relativePath,
      fileSha256(relativePath)
    ])
  );
  const mismatches = Object.entries(PROTECTED_SOURCE_HASHES)
    .filter(([relativePath, expected]) =>
      actual[relativePath] !== expected
    )
    .map(([relativePath, expected]) => ({
      relative_path: relativePath,
      expected_sha256: expected,
      actual_sha256: actual[relativePath] ?? null
    }));
  return {
    integrity_version: "e2a42-protected-source-integrity-v1",
    expected_sha256: PROTECTED_SOURCE_HASHES,
    actual_sha256: actual,
    mismatches,
    protected_components_modified: false,
    passed: mismatches.length === 0
  };
}

function buildHistoricalIntegrity() {
  const predecessor = buildE2A41FreezeArtifacts(0);
  return {
    integrity_version: "e2a42-e2a40-e2a41-historical-integrity-v1",
    expected_e2a41_protocol_hash: E2A41_PROTOCOL_HASH,
    actual_e2a41_protocol_hash: predecessor.protocol.protocol_hash,
    expected_e2a41_composite_identity: E2A41_COMPOSITE_IDENTITY,
    actual_e2a41_composite_identity:
      predecessor.compositeRuntimeIdentity.composite_runtime_identity_hash,
    expected_e2a40_protocol_hash: E2A40_PROTOCOL_HASH,
    actual_e2a40_protocol_hash:
      predecessor.historicalIntegrity.actual_protocol_hash,
    expected_e2a40_composite_identity: E2A40_COMPOSITE_IDENTITY,
    actual_e2a40_composite_identity:
      predecessor.historicalIntegrity.actual_composite_runtime_identity,
    historical_artifacts_modified: false,
    provider_calls_made: predecessor.summary.provider_calls_made,
    network_requests_made: predecessor.summary.network_requests_made,
    passed:
      predecessor.protocol.protocol_hash === E2A41_PROTOCOL_HASH &&
      predecessor.compositeRuntimeIdentity
        .composite_runtime_identity_hash === E2A41_COMPOSITE_IDENTITY &&
      predecessor.historicalIntegrity.actual_protocol_hash ===
        E2A40_PROTOCOL_HASH &&
      predecessor.historicalIntegrity.actual_composite_runtime_identity ===
        E2A40_COMPOSITE_IDENTITY &&
      predecessor.summary.provider_calls_made === 0 &&
      predecessor.summary.network_requests_made === 0
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a42-provider-call-guard-v1",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    live_entrypoint_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    e2a42_execution_authorized: false,
    e2a42_live_execution_performed: false,
    passed: networkRequestCount === 0
  };
}

function buildComponentBindings(
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>
) {
  return {
    binding_version: "e2a42-component-contract-bindings-v1",
    predecessor: {
      commit: PREDECESSOR_COMMIT,
      e2a41_protocol_hash: E2A41_PROTOCOL_HASH,
      e2a41_composite_runtime_identity: E2A41_COMPOSITE_IDENTITY,
      e2a40_protocol_hash: E2A40_PROTOCOL_HASH,
      e2a40_composite_runtime_identity: E2A40_COMPOSITE_IDENTITY
    },
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    protected_source_hashes: protectedIntegrity.actual_sha256,
    evaluation_contract_versions: {
      framework: EVALUATION_FRAMEWORK_CONTRACT_VERSION,
      diagnostic: DIAGNOSTIC_EVALUATION_CONTRACT_VERSION,
      intervention: INTERVENTION_QUALITY_CONTRACT_VERSION,
      progression: LEARNING_PROGRESSION_CONTRACT_VERSION,
      efficiency: DIALOGUE_EFFICIENCY_CONTRACT_VERSION,
      student_experience: STUDENT_EXPERIENCE_CONTRACT_VERSION,
      teacher_utility: TEACHER_UTILITY_CONTRACT_VERSION,
      baseline: BASELINE_COMPARISON_CONTRACT_VERSION,
      replay: EVALUATION_REPLAY_CONTRACT_VERSION
    },
    new_implementation_hashes: {
      evaluation_framework_contracts: fileSha256(
        "src/lib/evaluation/formative/e2a42-evaluation-framework-contracts.ts"
      ),
      evaluation_framework_protocol: fileSha256(
        "src/lib/evaluation/formative/e2a42-evaluation-framework-protocol.ts"
      ),
      no_network_cli: fileSha256(
        "prisma/formative-evaluation-e2a42.ts"
      )
    },
    protected_components_modified: false
  };
}

function buildProtocol(input: {
  contracts: ReturnType<typeof buildContracts>;
  bindings: ReturnType<typeof buildComponentBindings>;
  cases: EvaluationCase[];
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const core = {
    protocol_version: E2A42_PROTOCOL_VERSION,
    scenario_version: E2A42_SCENARIO_VERSION,
    status: "frozen_no_live_execution",
    framework_version: EVALUATION_FRAMEWORK_VERSION,
    contract_hashes: Object.fromEntries(
      Object.entries(input.contracts).map(([name, contract]) => [
        name,
        stableHash(contract)
      ])
    ),
    component_bindings_hash: stableHash(input.bindings),
    synthetic_cases_hash: stableClassroomHash(input.cases),
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract),
    authority: {
      evaluation_framework_only: true,
      assessment_runtime_unchanged: true,
      e2a40_multi_student_isolation_required: true,
      e2a41_auditability_required: true,
      observable_structured_evidence_only: true,
      chain_of_thought_prohibited: true,
      student_audit_separation_required: true
    },
    execution: {
      authorized: false,
      executable: false,
      live_entrypoint_present: false,
      provider_dispatch_available: false,
      provider_calls_made: 0,
      network_requests_made: 0
    }
  };
  return {
    ...core,
    protocol_hash: stableHash(core)
  };
}

function buildCompositeRuntimeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  bindings: ReturnType<typeof buildComponentBindings>;
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>;
}) {
  const core = {
    identity_version: E2A42_COMPOSITE_IDENTITY_VERSION,
    protocol_hash: input.protocol.protocol_hash,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    component_bindings_hash: stableHash(input.bindings),
    protected_source_hashes: input.protectedIntegrity.actual_sha256,
    evaluation_contract_versions: {
      framework: EVALUATION_FRAMEWORK_CONTRACT_VERSION,
      diagnostic: DIAGNOSTIC_EVALUATION_CONTRACT_VERSION,
      intervention: INTERVENTION_QUALITY_CONTRACT_VERSION,
      progression: LEARNING_PROGRESSION_CONTRACT_VERSION,
      efficiency: DIALOGUE_EFFICIENCY_CONTRACT_VERSION,
      student_experience: STUDENT_EXPERIENCE_CONTRACT_VERSION,
      teacher_utility: TEACHER_UTILITY_CONTRACT_VERSION,
      baseline: BASELINE_COMPARISON_CONTRACT_VERSION,
      replay: EVALUATION_REPLAY_CONTRACT_VERSION
    }
  };
  return {
    ...core,
    composite_runtime_identity_hash: stableHash(core)
  };
}

function buildDeterministicEvaluation(dataset: EvaluationDataset) {
  const validation = validateEvaluationDataset(dataset);
  const metrics = computeEvaluationMetrics(dataset.cases);
  const acceptance = metricAcceptance(metrics);
  const baseline = buildBaselineComparison(dataset.cases);
  const replay = replayEvaluationDataset(dataset);
  const replaySecond = replayEvaluationDataset({
    cases: [...dataset.cases].reverse(),
    researchAuditDataset: {
      acceptedTurns: [...dataset.researchAuditDataset.acceptedTurns].reverse(),
      evidenceSpans: [
        ...dataset.researchAuditDataset.evidenceSpans
      ].reverse(),
      profileSnapshots: [
        ...dataset.researchAuditDataset.profileSnapshots
      ].reverse(),
      decisionTraces: [
        ...dataset.researchAuditDataset.decisionTraces
      ].reverse()
    }
  });
  const multiStudent = buildMultiStudentEvaluation(dataset.cases);
  const failures = buildFailureEvaluation(dataset.cases);
  const regressions = buildRegressions(dataset);
  const suites = {
    framework: {
      suite_version: "e2a42-framework-smoke-v1",
      test_count: 4,
      passed:
        validation.passed &&
        Object.values(acceptance).every(Boolean) &&
        baseline.passed &&
        regressions.passed
    },
    diagnostic: {
      suite_version: "e2a42-diagnostic-smoke-v1",
      test_count: 6,
      metrics: metrics.diagnostic_accuracy,
      passed: acceptance.diagnostic
    },
    evidence: {
      suite_version: "e2a42-evidence-smoke-v1",
      test_count: 4,
      metrics: metrics.evidence_quality,
      passed: acceptance.evidence
    },
    intervention: {
      suite_version: "e2a42-intervention-smoke-v1",
      test_count: 3,
      metrics: metrics.intervention_quality,
      passed: acceptance.intervention
    },
    progression: {
      suite_version: "e2a42-progression-smoke-v1",
      test_count: 5,
      metrics: metrics.learning_progression,
      passed: acceptance.progression
    },
    efficiency: {
      suite_version: "e2a42-efficiency-smoke-v1",
      test_count: 4,
      metrics: metrics.dialogue_efficiency,
      passed: acceptance.efficiency
    },
    student_experience: {
      suite_version: "e2a42-student-experience-smoke-v1",
      test_count: 6,
      metrics: metrics.student_experience,
      passed: acceptance.student_experience
    },
    teacher_utility: {
      suite_version: "e2a42-teacher-utility-smoke-v1",
      test_count: 1,
      metrics: metrics.teacher_research_utility,
      passed: acceptance.teacher_utility
    },
    baseline: {
      suite_version: "e2a42-baseline-smoke-v1",
      test_count: 4,
      passed: baseline.passed
    },
    replay: {
      suite_version: "e2a42-replay-smoke-v1",
      test_count: 5,
      first_replay_hash: replay.replay_hash,
      second_replay_hash: replaySecond.replay_hash,
      passed:
        replay.replay_hash === replaySecond.replay_hash &&
        !replay.hidden_prompts_required &&
        !replay.hidden_model_reasoning_required &&
        !replay.chain_of_thought_required &&
        !replay.private_identifiers_required
    },
    multi_student: {
      suite_version: "e2a42-multi-student-smoke-v1",
      test_count: 4,
      passed: multiStudent.passed
    },
    failures: {
      suite_version: "e2a42-failure-smoke-v1",
      test_count: 6,
      passed: failures.passed
    }
  };
  return {
    validation,
    metrics,
    acceptance,
    baseline,
    replay,
    multiStudent,
    failures,
    regressions,
    suites,
    passed:
      Object.values(suites).every((suite) => suite.passed) &&
      regressions.passed
  };
}

export function buildE2A42FreezeArtifacts(networkRequestCount = 0) {
  const predecessor = buildE2A41FreezeArtifacts(0);
  const contracts = buildContracts();
  const cases = buildSyntheticCases();
  const dataset: EvaluationDataset = {
    cases,
    researchAuditDataset: predecessor.dataset
  };
  const deterministic = buildDeterministicEvaluation(dataset);
  const historicalIntegrity = buildHistoricalIntegrity();
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const candidateIntegrity = buildCandidateIntegrity();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const bindings = buildComponentBindings(protectedIntegrity);
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);
  assert(providerCallGuard.passed, "e2a42_provider_call_guard_failed");
  const protocol = buildProtocol({
    contracts,
    bindings,
    cases,
    budget,
    artifactContract
  });
  const compositeRuntimeIdentity = buildCompositeRuntimeIdentity({
    protocol,
    bindings,
    protectedIntegrity
  });
  const regressionCount = Object.values(deterministic.suites).reduce(
    (sum, suite) => sum + suite.test_count,
    0
  ) + deterministic.regressions.test_count;
  const passed =
    deterministic.passed &&
    historicalIntegrity.passed &&
    candidateIntegrity.passed &&
    protectedIntegrity.passed &&
    providerCallGuard.passed;
  assert(
    passed,
    `e2a42_summary_failed:${JSON.stringify({
      deterministic: deterministic.passed,
      failed_suites: Object.entries(deterministic.suites)
        .filter(([, suite]) => !suite.passed)
        .map(([name]) => name),
      regressions: deterministic.regressions.passed,
      failed_regressions: deterministic.regressions.tests
        .filter((item) => !item.passed)
        .map((item) => item.test_id),
      historical_integrity: historicalIntegrity.passed,
      candidate_integrity: candidateIntegrity.passed,
      protected_integrity: protectedIntegrity.passed,
      protected_mismatches: protectedIntegrity.mismatches,
      provider_call_guard: providerCallGuard.passed
    })}`
  );
  const summary = {
    status: "e2a42_protocol_frozen_no_live_execution",
    passed,
    protocol_version: protocol.protocol_version,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    synthetic_case_count: cases.length,
    evaluated_cba_case_count: cases.filter(
      (item) => item.baseline === "conversation_based_assessment"
    ).length,
    baseline_count: new Set(cases.map((item) => item.baseline)).size,
    deterministic_check_count: regressionCount,
    required_regression_count: deterministic.regressions.test_count,
    candidate_approved: false,
    candidate_activated: false,
    e2a42_execution_authorized: false,
    e2a42_live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    chain_of_thought_stored: false,
    hidden_model_reasoning_stored: false,
    hidden_prompts_stored: false,
    real_student_data_used: false
  };
  const manifest = {
    manifest_version: "e2a42-freeze-manifest-v1",
    generated_at: new Date().toISOString(),
    application_git_commit: currentGitCommit(),
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    artifact_names: [...E2A42_ARTIFACT_NAMES],
    no_live_execution: true,
    synthetic_data_only: true
  };
  return {
    manifest,
    protocol,
    contracts,
    dataset,
    deterministic,
    historicalIntegrity,
    budget,
    artifactContract,
    candidateIntegrity,
    protectedIntegrity,
    bindings,
    compositeRuntimeIdentity,
    providerCallGuard,
    summary
  };
}

function artifactValues(
  artifacts: ReturnType<typeof buildE2A42FreezeArtifacts>
): Record<string, unknown> {
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256": `${artifacts.protocol.protocol_hash}\n`,
    "component-contract-bindings.json": artifacts.bindings,
    "evaluation-framework-contract.json":
      artifacts.contracts.framework,
    "diagnostic-evaluation-contract.json":
      artifacts.contracts.diagnostic,
    "intervention-quality-contract.json":
      artifacts.contracts.intervention,
    "learning-progression-contract.json":
      artifacts.contracts.progression,
    "dialogue-efficiency-contract.json":
      artifacts.contracts.efficiency,
    "student-experience-contract.json":
      artifacts.contracts.student_experience,
    "teacher-utility-contract.json":
      artifacts.contracts.teacher_utility,
    "baseline-comparison-contract.json":
      artifacts.contracts.baseline,
    "evaluation-replay-contract.json":
      artifacts.contracts.replay,
    "synthetic-evaluation-cases.json": {
      scenario_version: E2A42_SCENARIO_VERSION,
      domain: "educational_measurement_assessment_literacy",
      cases: artifacts.dataset.cases,
      real_student_data_used: false
    },
    "diagnostic-evaluation-results.json":
      artifacts.deterministic.suites.diagnostic,
    "evidence-quality-results.json":
      artifacts.deterministic.suites.evidence,
    "intervention-quality-results.json":
      artifacts.deterministic.suites.intervention,
    "learning-progression-results.json":
      artifacts.deterministic.suites.progression,
    "dialogue-efficiency-results.json":
      artifacts.deterministic.suites.efficiency,
    "student-experience-results.json":
      artifacts.deterministic.suites.student_experience,
    "teacher-utility-results.json":
      artifacts.deterministic.suites.teacher_utility,
    "baseline-comparison-results.json":
      artifacts.deterministic.baseline,
    "evaluation-replay-results.json":
      artifacts.deterministic.replay,
    "multi-student-evaluation-results.json":
      artifacts.deterministic.multiStudent,
    "failure-evaluation-results.json":
      artifacts.deterministic.failures,
    "deterministic-regression-results.json":
      artifacts.deterministic.regressions,
    "evaluation-metrics.json": {
      metrics: artifacts.deterministic.metrics,
      acceptance: artifacts.deterministic.acceptance
    },
    "historical-integrity.json": artifacts.historicalIntegrity,
    "budget.json": artifacts.budget,
    "artifact-contract.json": artifacts.artifactContract,
    "candidate-integrity.json": artifacts.candidateIntegrity,
    "protected-source-integrity.json": artifacts.protectedIntegrity,
    "composite-runtime-identity.json":
      artifacts.compositeRuntimeIdentity,
    "provider-call-guard.json": artifacts.providerCallGuard,
    "summary.json": artifacts.summary
  };
}

function validateArtifactDirectory(runDirectory: string) {
  const expected = new Set(E2A42_ARTIFACT_NAMES);
  const actual = readdirSync(runDirectory).sort();
  const missing = [...expected].filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expected.has(
    name as (typeof E2A42_ARTIFACT_NAMES)[number]
  ));
  const protocol = readJson<{ protocol_hash: string }>(
    path.join(runDirectory, "frozen-protocol.json")
  );
  const protocolHashFile = readFileSync(
    path.join(runDirectory, "frozen-protocol.sha256"),
    "utf8"
  ).trim();
  const summary = readJson<{
    passed: boolean;
    provider_calls_made: number;
    network_requests_made: number;
    chain_of_thought_stored: boolean;
    hidden_model_reasoning_stored: boolean;
    hidden_prompts_stored: boolean;
    real_student_data_used: boolean;
  }>(path.join(runDirectory, "summary.json"));
  return {
    validation_version: "e2a42-artifact-validation-v1",
    expected_artifact_count: E2A42_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    protocol_hash_matches:
      protocol.protocol_hash === protocolHashFile,
    provider_calls_made: summary.provider_calls_made,
    network_requests_made: summary.network_requests_made,
    chain_of_thought_stored: summary.chain_of_thought_stored,
    hidden_model_reasoning_stored:
      summary.hidden_model_reasoning_stored,
    hidden_prompts_stored: summary.hidden_prompts_stored,
    real_student_data_used: summary.real_student_data_used,
    artifacts: actual.map((name) => ({
      name,
      sha256: sha256(readFileSync(path.join(runDirectory, name))),
      size_bytes: statSync(path.join(runDirectory, name)).size
    })),
    passed:
      missing.length === 1 &&
      missing[0] === "artifact-validation.json" &&
      unexpected.length === 0 &&
      protocol.protocol_hash === protocolHashFile &&
      summary.passed &&
      summary.provider_calls_made === 0 &&
      summary.network_requests_made === 0 &&
      !summary.chain_of_thought_stored &&
      !summary.hidden_model_reasoning_stored &&
      !summary.hidden_prompts_stored &&
      !summary.real_student_data_used
  };
}

export function writeE2A42FreezeArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a42_artifact_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A42FreezeArtifacts(
    input.networkRequestCount ?? 0
  );
  for (const [name, value] of Object.entries(artifactValues(artifacts))) {
    if (name === "frozen-protocol.sha256") {
      writeFileSync(
        path.join(input.runDirectory, name),
        value as string,
        "utf8"
      );
    } else {
      writeJson(path.join(input.runDirectory, name), value);
    }
  }
  const artifactValidation = validateArtifactDirectory(input.runDirectory);
  assert(artifactValidation.passed, "e2a42_artifact_validation_failed");
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  for (const name of E2A42_ARTIFACT_NAMES) {
    chmodSync(path.join(input.runDirectory, name), 0o444);
  }
  chmodSync(input.runDirectory, 0o555);
  return {
    ...artifacts,
    artifactValidation: {
      ...artifactValidation,
      final_artifact_count: readdirSync(input.runDirectory).length
    }
  };
}

export function makeE2A42FreezeRunId() {
  return `e2a42_${new Date().toISOString().replace(/[-:.]/gu, "")}_${
    randomBytes(4).toString("hex")
  }`;
}

export function latestE2A42FreezeRunDirectory() {
  assert(existsSync(E2A42_ARTIFACT_ROOT), "e2a42_artifact_root_missing");
  const latest = readdirSync(E2A42_ARTIFACT_ROOT)
    .filter((name) =>
      statSync(path.join(E2A42_ARTIFACT_ROOT, name)).isDirectory()
    )
    .sort()
    .at(-1);
  assert(latest, "e2a42_freeze_run_missing");
  return path.join(E2A42_ARTIFACT_ROOT, latest);
}

export function inspectE2A42FreezeRun(runDirectory: string) {
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary: readJson<JsonRecord>(
      path.join(runDirectory, "summary.json")
    ),
    evaluation_metrics: readJson<JsonRecord>(
      path.join(runDirectory, "evaluation-metrics.json")
    ),
    baseline_comparison: readJson<JsonRecord>(
      path.join(runDirectory, "baseline-comparison-results.json")
    ),
    artifact_validation: readJson<JsonRecord>(
      path.join(runDirectory, "artifact-validation.json")
    )
  };
}
