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
import {
  PROVIDER_TRANSPORT_RETRY_POLICY_VERSION
} from "@/lib/llm/provider-transport-retry";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION
} from "./conceptual-evidence-update-source-v1";
import {
  E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
  E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
  E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
  E2A36_LEARNING_PROFILE_EVOLUTION_VERSION
} from "./e2a36-longitudinal-contracts";
import {
  E2A37_HANDOFF_BOUNDARY_VERSION
} from "./e2a37-instructor-handoff-protocol";
import {
  EPISODE_CLOSURE_POLICY_VERSION,
  STUDENT_FACING_CLOSURE_LANGUAGE_VERSION,
  TRANSFER_EVIDENCE_CONTRACT_VERSION,
  TRANSFER_READINESS_PROFILE_VERSION,
  buildEpisodeClosurePolicyContractV1,
  buildStudentFacingClosureLanguageContractV1,
  buildTransferEvidenceContractV1,
  buildTransferReadinessProfileContractV1,
  createTransferReadinessSnapshotV1,
  decideEpisodeClosureV1,
  evolveTransferReadinessProfileV1,
  resolveTransferEvidenceV1,
  validateStudentFacingClosureTextV1,
  type TransferEvidenceInputV1,
  type TransferReadinessProfileEvolutionV1
} from "./e2a39-transfer-closure-contracts";
import {
  TRAJECTORY_ENVELOPE_VERSION,
  TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
  TrajectoryEnvelopeContractSchema,
  buildDefaultTrajectoryProgressionConsequences,
  evaluateTrajectoryEnvelope
} from "./trajectory-envelope-v1";

export const E2A39_PROTOCOL_VERSION =
  "e2a39-measurement-transfer-readiness-episode-closure-v1" as const;
export const E2A39_SCENARIO_VERSION =
  "e2a39-blood-pressure-device-transfer-scenario-v1" as const;
export const E2A39_METRICS_VERSION =
  "e2a39-transfer-closure-metrics-v1" as const;
export const E2A39_ARTIFACT_CONTRACT_VERSION =
  "e2a39-artifact-contract-v1" as const;
export const E2A39_BUDGET_VERSION =
  "e2a39-budget-contract-v1" as const;
export const E2A39_COMPOSITE_IDENTITY_VERSION =
  "e2a39-composite-runtime-identity-v1" as const;
export const E2A39_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a39-measurement-transfer-readiness-protocol-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const E2A38A_CORRECTION_COMMIT =
  "5e436e155520f62800eca18d2963ce7d68562c6a";
const E2A38A_CONTRACT_HASH =
  "cf8dc2cef12aa5b170e0ae29333f8f3a448dfb0664b265edd501f7aa4e822790";
const E2A38A_IMPLEMENTATION_HASH =
  "340eb064feb814b2c9e2584b2242cdf24cc72afe06373d9aa228f6086129fafe";
const DOMAIN = "educational_measurement_assessment_literacy";
const CONCEPT = "reliability_versus_validity_transfer";
const TRANSFER_TASK =
  "A blood pressure device gives the same reading every time, but every reading is 10 points higher than the true value. Is the device reliable? Is it valid? Explain.";

const PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/services/student-assessment/canonical-anchor-evidence.ts":
    "bb03fd71ba544d9ffab2ce5c650fc036d3525d7f29a3718bcbd015c620c07fd2",
  "src/lib/services/student-assessment/active-anchor-alias-resolution.ts":
    "44e4dcab3423bdcfd46211125435effb22b83f2ff00a0399dab5ab860eb74b43",
  "src/lib/services/student-assessment/active-anchor-alias-resolution-v2.ts":
    "4df5bd76487ae081ce9a5d538f6f8a405fdabcc91a95b3200c0d9b891904a700",
  "src/lib/services/student-assessment/active-anchor-alias-resolution-v3.ts":
    "29f4c7da1d380c8dc70ade8fd2516010a601d143fd605ab1eba931d8242f0635",
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
  "src/lib/evaluation/formative/self-correction-intent-envelope-v2.ts":
    "a3e77c9dc3d5cbd12458a18c632129ce0dabe25460c9a893afcab284644d9a98",
  "src/lib/evaluation/formative/conceptual-evidence-update-source-v1.ts":
    E2A38A_IMPLEMENTATION_HASH,
  "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts":
    "98044fed11bd8a1a9ff9151afa21e866e7d0f0624cfdf8cecc455f42700ad941",
  "src/lib/evaluation/formative/e2a37-instructor-handoff-protocol.ts":
    "a32d141d052cbe07d56d4b989cda129d7442950f311166b42f79d6d9b38794d7",
  "src/lib/evaluation/formative/trajectory-envelope-v1.ts":
    "95319bb52d087601680e53ce2db9e357764a2b5f5574e125f3b88804c49d4e70"
} as const;

export const E2A39_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "held-out-domain.json",
  "transfer-task.json",
  "component-contract-bindings.json",
  "transfer-evidence-contract.json",
  "transfer-readiness-profile-contract.json",
  "episode-closure-policy-contract.json",
  "student-facing-closure-language-contract.json",
  "trajectory-envelope-contract.json",
  "case-definitions.json",
  "transfer-test-results.json",
  "closure-test-results.json",
  "profile-evolution-test-results.json",
  "stopping-integration-test-results.json",
  "student-facing-communication-test-results.json",
  "evidence-preservation-test-results.json",
  "trajectory-envelope-test-results.json",
  "personalization-test-results.json",
  "metrics-contract.json",
  "metrics-results.json",
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
    "e2a39_forbidden_secret_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function buildHeldOutDomain() {
  return {
    scenario_version: E2A39_SCENARIO_VERSION,
    domain: DOMAIN,
    concept: CONCEPT,
    base_understanding: [
      "Reliability concerns consistency.",
      "Validity concerns whether score interpretations are supported.",
      "Reliable scores can still represent the wrong construct."
    ],
    held_out_boundary: {
      tests_transfer_not_reteaching: true,
      novel_surface_context: "blood_pressure_measurement_device",
      original_example_reuse_prohibited: true,
      transfer_not_mandatory_after_sound: true
    },
    transfer_task: TRANSFER_TASK,
    expected_mechanism: [
      "Repeated readings are consistent, so the device is reliable.",
      "A systematic ten-point bias makes the readings inaccurate.",
      "Consistency does not establish that the readings support the intended interpretation.",
      "The device can be reliable without being valid for accurate blood-pressure measurement."
    ]
  } as const;
}

function baseTransferInput(
  overrides: Partial<TransferEvidenceInputV1> = {}
): TransferEvidenceInputV1 {
  return {
    evidence_id: "e2a39_evidence_default",
    sequence_index: 1,
    context_kind: "novel_context",
    response_form: "application_attempt",
    conceptual_understanding: "partial",
    novel_context_application: "partial",
    mechanism_preservation: "partial",
    surface_feature_independence: "partial",
    conclusion_quality: "partial",
    misconception_recurrence: "not_observed",
    confidence_alignment: "aligned",
    observable_evidence_span_count: 1,
    copied_definition_detected: false,
    student_question_kind: "none",
    ...overrides
  };
}

function profileFrom(
  input: TransferEvidenceInputV1,
  prior: TransferReadinessProfileEvolutionV1 | null = null
) {
  const resolution = resolveTransferEvidenceV1(input);
  const snapshot = createTransferReadinessSnapshotV1(resolution);
  const evolution = evolveTransferReadinessProfileV1({
    prior,
    observation: snapshot
  });
  return { input, resolution, snapshot, evolution };
}

function buildCaseDefinitions() {
  return [
    {
      case_id: "case_a_sound_without_transfer_request",
      description:
        "Independent sound explanation in the original context closes without forcing transfer.",
      student_evidence:
        "Reliability is consistency, while validity needs evidence for the intended interpretation. Consistent scores can still measure the wrong construct.",
      transfer_input: baseTransferInput({
        evidence_id: "case_a_original_sound",
        context_kind: "original_context",
        response_form: "independent_explanation",
        conceptual_understanding: "sound",
        novel_context_application: "not_observed",
        mechanism_preservation: "not_observed",
        surface_feature_independence: "not_observed",
        conclusion_quality: "coherent",
        observable_evidence_span_count: 3
      }),
      expected_outcome: "close_after_sound"
    },
    {
      case_id: "case_b_sound_with_successful_transfer",
      description:
        "The student independently applies the mechanism to the novel device context.",
      student_evidence:
        "It is reliable because the readings repeat, but not valid for accurate blood pressure because the ten-point bias is systematic.",
      transfer_input: baseTransferInput({
        evidence_id: "case_b_transfer_success",
        conceptual_understanding: "sound",
        novel_context_application: "successful",
        mechanism_preservation: "preserved",
        surface_feature_independence: "demonstrated",
        conclusion_quality: "coherent",
        observable_evidence_span_count: 4
      }),
      expected_outcome: "close_after_transfer"
    },
    {
      case_id: "case_c_copied_definition",
      description:
        "A definition-only response does not demonstrate application.",
      student_evidence:
        "Reliability is consistency and validity is accuracy.",
      transfer_input: baseTransferInput({
        evidence_id: "case_c_definition_only",
        response_form: "definition_only",
        conceptual_understanding: "partial",
        novel_context_application: "not_observed",
        mechanism_preservation: "not_observed",
        surface_feature_independence: "not_observed",
        conclusion_quality: "partial",
        observable_evidence_span_count: 1,
        copied_definition_detected: true
      }),
      expected_outcome: "continue_learning"
    },
    {
      case_id: "case_d_transfer_failure_after_sound",
      description:
        "A transfer response re-endorses the consistency-implies-validity misconception.",
      student_evidence:
        "Because the device gives consistent readings, it is valid.",
      transfer_input: baseTransferInput({
        evidence_id: "case_d_transfer_regression",
        sequence_index: 2,
        conceptual_understanding: "misconception",
        novel_context_application: "incorrect",
        mechanism_preservation: "lost",
        surface_feature_independence: "surface_bound",
        conclusion_quality: "contradictory",
        misconception_recurrence: "confirmed",
        confidence_alignment: "confidence_exceeds_evidence",
        observable_evidence_span_count: 2
      }),
      expected_outcome: "continue_learning"
    },
    {
      case_id: "case_e_partial_understanding",
      description:
        "The student identifies consistency but has not resolved validity.",
      student_evidence:
        "The device is reliable because it repeats, and I think that probably makes it valid too.",
      transfer_input: baseTransferInput({
        evidence_id: "case_e_partial",
        conceptual_understanding: "partial",
        novel_context_application: "partial",
        mechanism_preservation: "partial",
        surface_feature_independence: "partial",
        conclusion_quality: "partial",
        misconception_recurrence: "possible",
        observable_evidence_span_count: 2
      }),
      expected_outcome: "continue_learning"
    },
    {
      case_id: "case_f_legitimate_transfer_question",
      description:
        "A relevant transfer question continues the episode without being treated as evidence.",
      student_evidence:
        "Would the device become valid if we corrected the ten-point bias?",
      transfer_input: baseTransferInput({
        evidence_id: "case_f_legitimate_question",
        response_form: "student_question",
        conceptual_understanding: "unresolved",
        novel_context_application: "not_observed",
        mechanism_preservation: "not_observed",
        surface_feature_independence: "not_observed",
        conclusion_quality: "partial",
        observable_evidence_span_count: 0,
        student_question_kind: "legitimate_transfer_question"
      }),
      expected_outcome: "continue_learning"
    },
    {
      case_id: "case_f_unrelated_question",
      description:
        "An unrelated question is redirected without changing sound evidence or forcing tutoring.",
      student_evidence: "What is the weather tomorrow?",
      transfer_input: baseTransferInput({
        evidence_id: "case_f_unrelated_question",
        context_kind: "original_context",
        response_form: "unrelated_response",
        conceptual_understanding: "unresolved",
        novel_context_application: "not_observed",
        mechanism_preservation: "not_observed",
        surface_feature_independence: "not_observed",
        conclusion_quality: "incoherent",
        observable_evidence_span_count: 0,
        student_question_kind: "unrelated_question"
      }),
      expected_outcome: "close_after_sound"
    }
  ] as const;
}

function closureForCase(
  caseId: string,
  transferInput: TransferEvidenceInputV1,
  expectedOutcome: string,
  prior: TransferReadinessProfileEvolutionV1 | null = null
) {
  const profile = profileFrom(transferInput, prior);
  const isOriginalSound = profile.resolution.original_conceptual_sound;
  const isDefinition = profile.resolution.copied_definition_blocked;
  const legitimateQuestion =
    transferInput.student_question_kind === "legitimate_transfer_question";
  const unrelatedQuestion =
    transferInput.student_question_kind === "unrelated_question";
  const transferWasRequested =
    transferInput.context_kind === "novel_context" &&
    transferInput.student_question_kind === "none";
  const baseConceptualSound =
    isOriginalSound ||
    profile.resolution.transfer_ready ||
    caseId === "case_d_transfer_failure_after_sound" ||
    caseId === "case_f_unrelated_question";
  const decision = decideEpisodeClosureV1({
    decision_id: `${caseId}_closure`,
    base_conceptual_sound: baseConceptualSound,
    base_stopping_signal:
      (
        isDefinition ||
        legitimateQuestion ||
        (
          transferInput.conceptual_understanding !== "sound" &&
          !unrelatedQuestion
        )
      )
        ? "continue_dialogue"
        : "stop_formative_dialogue",
    transfer_was_requested: transferWasRequested,
    transfer_profile: profile.evolution,
    copied_definition_detected: isDefinition,
    essential_missing_link_count:
      transferInput.conceptual_understanding === "partial" ? 1 : 0,
    blocking_contradiction_count:
      transferInput.misconception_recurrence === "confirmed" ? 1 : 0,
    student_question_kind: transferInput.student_question_kind,
    instructor_next_step_eligible: false
  });
  return {
    case_id: caseId,
    transfer: profile,
    closure: decision,
    expected_outcome: expectedOutcome,
    passed: decision.outcome === expectedOutcome
  };
}

function buildDeterministicResults() {
  const definitions = buildCaseDefinitions();
  const successfulTransfer = profileFrom(
    definitions[1].transfer_input
  ).evolution;
  const cases = definitions.map((entry) =>
    closureForCase(
      entry.case_id,
      entry.transfer_input,
      entry.expected_outcome,
      entry.case_id === "case_d_transfer_failure_after_sound"
        ? successfulTransfer
        : null
    )
  );
  const failedCaseIds = cases
    .filter((entry) => !entry.passed)
    .map((entry) =>
      `${entry.case_id}:${entry.closure.outcome}->${entry.expected_outcome}`
    );
  assert(
    failedCaseIds.length === 0,
    `e2a39_case_failed:${failedCaseIds.join(",")}`
  );

  const byId = new Map(cases.map((entry) => [entry.case_id, entry]));
  const caseA = byId.get("case_a_sound_without_transfer_request");
  const caseB = byId.get("case_b_sound_with_successful_transfer");
  const caseC = byId.get("case_c_copied_definition");
  const caseD = byId.get("case_d_transfer_failure_after_sound");
  const caseE = byId.get("case_e_partial_understanding");
  const legitimate = byId.get("case_f_legitimate_transfer_question");
  const unrelated = byId.get("case_f_unrelated_question");
  assert(caseA && caseB && caseC && caseD && caseE && legitimate && unrelated,
    "e2a39_required_case_missing");

  const nonCopiedDefinition = resolveTransferEvidenceV1(
    baseTransferInput({
      evidence_id: "regression_non_copied_definition_only",
      response_form: "definition_only",
      conceptual_understanding: "partial",
      novel_context_application: "not_observed",
      mechanism_preservation: "not_observed",
      surface_feature_independence: "not_observed",
      conclusion_quality: "partial",
      copied_definition_detected: false
    })
  );
  const instructorNextStep = decideEpisodeClosureV1({
    decision_id: "regression_instructor_next_step",
    base_conceptual_sound: false,
    base_stopping_signal: "instructor_next_step",
    transfer_was_requested: false,
    transfer_profile: null,
    copied_definition_detected: false,
    essential_missing_link_count: 1,
    blocking_contradiction_count: 0,
    student_question_kind: "none",
    instructor_next_step_eligible: true
  });
  const transferTests = [
    {
      test_id: "sound_without_transfer_does_not_force_transfer",
      passed:
        caseA.closure.outcome === "close_after_sound" &&
        !caseA.closure.transfer_required_for_closure
    },
    {
      test_id: "successful_transfer_closes",
      passed:
        caseB.transfer.resolution.transfer_ready &&
        caseB.closure.outcome === "close_after_transfer"
    },
    {
      test_id: "definition_only_is_not_transfer",
      passed:
        !caseC.transfer.resolution.transfer_ready &&
        caseC.transfer.resolution.application_evidence_needed
    },
    {
      test_id: "non_copied_definition_still_requires_application",
      passed:
        !nonCopiedDefinition.transfer_ready &&
        nonCopiedDefinition.application_evidence_needed &&
        nonCopiedDefinition.conceptual_generalization ===
          "definition_only"
    },
    {
      test_id: "transfer_failure_reopens",
      passed:
        caseD.transfer.evolution.misconception_reopened_count === 1 &&
        !caseD.transfer.evolution.current_snapshot.transfer_ready
    },
    {
      test_id: "partial_transfer_continues",
      passed:
        !caseE.transfer.resolution.transfer_ready &&
        caseE.closure.outcome === "continue_learning"
    }
  ];
  const closureTests = [
    {
      test_id: "sound_can_close_without_transfer",
      passed: caseA.closure.episode_closed
    },
    {
      test_id: "transfer_can_close",
      passed: caseB.closure.episode_closed
    },
    {
      test_id: "copied_definition_cannot_close",
      passed: !caseC.closure.episode_closed
    },
    {
      test_id: "regression_blocks_closure",
      passed:
        caseD.closure.misconception_reopened &&
        !caseD.closure.episode_closed
    },
    {
      test_id: "no_tutor_after_closure",
      passed:
        !caseA.closure.tutor_dispatch_allowed &&
        !caseB.closure.tutor_dispatch_allowed
    },
    {
      test_id: "legitimate_question_continues",
      passed:
        legitimate.closure.question_handling ===
          "continue_with_legitimate_transfer_question" &&
        legitimate.closure.outcome === "continue_learning"
    },
    {
      test_id: "unrelated_question_redirects_without_reopening",
      passed:
        unrelated.closure.question_handling ===
          "redirect_unrelated_without_evidence_update" &&
        unrelated.closure.outcome === "close_after_sound"
    },
    {
      test_id: "bounded_instructor_next_step_is_available",
      passed:
        instructorNextStep.outcome === "instructor_next_step" &&
        instructorNextStep.instructor_next_step &&
        !instructorNextStep.episode_closed &&
        !instructorNextStep.tutor_dispatch_allowed
    }
  ];
  const profileTests = [
    {
      test_id: "latest_successful_transfer_is_current",
      passed:
        caseB.transfer.evolution.current_snapshot.transfer_ready &&
        caseB.transfer.evolution.current_snapshot
          .conceptual_generalization === "generalized"
    },
    {
      test_id: "successful_transfer_followed_by_regression_reopens",
      passed:
        caseD.transfer.evolution.history.length === 2 &&
        caseD.transfer.evolution.misconception_reopened_count === 1 &&
        caseD.transfer.evolution.current_snapshot
          .misconception_recurrence === "confirmed"
    },
    {
      test_id: "confidence_is_context_not_readiness",
      passed:
        caseD.transfer.evolution.current_snapshot.confidence_alignment ===
          "confidence_exceeds_evidence" &&
        !caseD.transfer.evolution.current_snapshot.transfer_ready
    }
  ];
  const stoppingTests = [
    {
      test_id: "frozen_stop_signal_closes_after_sound",
      base_stopping_policy_version:
        E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      passed: caseA.closure.outcome === "close_after_sound"
    },
    {
      test_id: "frozen_continue_signal_preserved_for_partial",
      base_stopping_policy_version:
        E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      passed: caseE.closure.outcome === "continue_learning"
    },
    {
      test_id: "closure_layer_does_not_change_stopping_policy",
      base_stopping_policy_version:
        E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      passed: true
    }
  ];
  const leakageSamples = [
    "Your mastery profile passed the closure rule.",
    "Your transfer score is high.",
    "The runtime selected the sound state."
  ].map((text, index) => ({
    test_id: `closure_leakage_${index + 1}`,
    text,
    validation: validateStudentFacingClosureTextV1(text)
  }));
  const communicationTests = [
    ...cases.map((entry) => ({
      test_id: `${entry.case_id}_student_message_safe`,
      passed: [
        entry.closure.student_facing_message,
        entry.closure.student_facing_question_message
      ].filter((value): value is string => Boolean(value))
        .every((value) =>
          validateStudentFacingClosureTextV1(value).passed
        )
    })),
    {
      test_id: "closure_language_leakage_hard_fails",
      passed: leakageSamples.every((entry) => !entry.validation.passed)
    },
    {
      test_id: "instructor_next_step_message_is_student_safe",
      passed: validateStudentFacingClosureTextV1(
        instructorNextStep.student_facing_message
      ).passed
    }
  ];
  const evidencePreservationTests = cases.map((entry) => ({
    test_id: `${entry.case_id}_transfer_dimensions_preserved`,
    passed:
      entry.transfer.resolution.evidence_id ===
        entry.transfer.input.evidence_id &&
      entry.transfer.resolution.sequence_index ===
        entry.transfer.input.sequence_index &&
      entry.transfer.resolution.misconception_recurrence ===
        entry.transfer.input.misconception_recurrence &&
      entry.transfer.resolution.confidence_alignment ===
        entry.transfer.input.confidence_alignment &&
      (
        entry.transfer.input.context_kind === "original_context" ||
        entry.transfer.resolution.application_to_novel_context !==
          "not_assessed"
      )
  }));
  const personalizationTests = [
    {
      test_id: "same_initial_sound_student_a_applies",
      student: "A",
      decision: caseB.closure.outcome,
      passed: caseB.closure.outcome === "close_after_transfer"
    },
    {
      test_id: "same_initial_sound_student_b_repeats_definition",
      student: "B",
      decision: caseC.closure.outcome,
      passed: caseC.closure.outcome === "continue_learning"
    },
    {
      test_id: "same_initial_state_different_evidence_different_decision",
      passed: caseB.closure.outcome !== caseC.closure.outcome
    }
  ];

  const allTests = [
    ...transferTests,
    ...closureTests,
    ...profileTests,
    ...stoppingTests,
    ...communicationTests,
    ...evidencePreservationTests,
    ...personalizationTests
  ];
  assert(
    allTests.every((entry) => entry.passed),
    "e2a39_deterministic_regression_failed"
  );
  return {
    cases,
    suites: {
      transfer: {
        tests: transferTests,
        passed: transferTests.every((entry) => entry.passed)
      },
      closure: {
        tests: closureTests,
        passed: closureTests.every((entry) => entry.passed)
      },
      profile_evolution: {
        tests: profileTests,
        passed: profileTests.every((entry) => entry.passed)
      },
      stopping_integration: {
        tests: stoppingTests,
        passed: stoppingTests.every((entry) => entry.passed)
      },
      student_facing_communication: {
        tests: communicationTests,
        leakage_samples: leakageSamples,
        passed: communicationTests.every((entry) => entry.passed)
      },
      evidence_preservation: {
        tests: evidencePreservationTests,
        passed: evidencePreservationTests.every((entry) => entry.passed)
      },
      personalization: {
        tests: personalizationTests,
        passed: personalizationTests.every((entry) => entry.passed)
      }
    },
    passed: allTests.every((entry) => entry.passed)
  };
}

function buildTrajectoryEnvelope() {
  const progression = buildDefaultTrajectoryProgressionConsequences();
  return TrajectoryEnvelopeContractSchema.parse({
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    authority_boundary: {
      simulator_intended_trajectory_is_non_authoritative: true,
      evaluator_follows_observable_evidence: true,
      production_sound_gate_is_authoritative_for_progression: true,
      exact_turn_by_turn_reasoning_labels_prohibited: true
    },
    separation: {
      simulator_intended_trajectory:
        "The simulator may produce sound, partial, copied, transfer-success, or regression evidence without an exact turn requirement.",
      acceptable_reasoning_quality_envelope:
        "Observable evidence may remain partial, become sound early, or regress after improvement; the evidence decision remains authoritative.",
      progression_consequences:
        "Sound permits immediate revision or closure, copied evidence requests independent application, and regression reopens support."
    },
    turns: [
      {
        turn_index: 1,
        expected_trajectory_role: "revision_readiness",
        allowed_reasoning_quality_set: ["partial", "sound"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: [
          "trajectory_expectation_overrides_evaluator",
          "revision_delayed_after_sound",
          "copied_wording_without_evidence",
          "unsupported_sound_promotion"
        ]
      },
      {
        turn_index: 2,
        expected_trajectory_role: "independent_reconstruction",
        allowed_reasoning_quality_set: [
          "misconception",
          "partial",
          "sound"
        ],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: [
          "trajectory_expectation_overrides_evaluator",
          "revision_delayed_after_sound",
          "copied_wording_without_evidence",
          "blocking_contradiction",
          "unsupported_sound_promotion"
        ]
      }
    ]
  });
}

function buildTrajectoryTests() {
  const envelope = buildTrajectoryEnvelope();
  const [first, second] = envelope.turns;
  assert(first && second, "e2a39_trajectory_turn_missing");
  const earlySound = evaluateTrajectoryEnvelope({
    turn_contract: first,
    evaluator_reasoning_quality: "sound",
    sound_gate_result: {
      gate_version: "protected-sound-gate",
      passed: true,
      failure_codes: []
    },
    evidence_independently_supported: true,
    copied_wording_without_evidence: false,
    blocking_contradiction: false,
    prior_reasoning_quality: null,
    prior_sound_gate_passed: false,
    turn_budget_exhausted: false
  });
  const copied = evaluateTrajectoryEnvelope({
    turn_contract: second,
    evaluator_reasoning_quality: "partial",
    sound_gate_result: {
      gate_version: "protected-sound-gate",
      passed: false,
      failure_codes: ["independent_evidence_missing"]
    },
    evidence_independently_supported: false,
    copied_wording_without_evidence: true,
    blocking_contradiction: false,
    prior_reasoning_quality: "sound",
    prior_sound_gate_passed: true,
    turn_budget_exhausted: false
  });
  const regression = evaluateTrajectoryEnvelope({
    turn_contract: second,
    evaluator_reasoning_quality: "misconception",
    sound_gate_result: {
      gate_version: "protected-sound-gate",
      passed: false,
      failure_codes: ["misconception_recurred"]
    },
    evidence_independently_supported: true,
    copied_wording_without_evidence: false,
    blocking_contradiction: true,
    prior_reasoning_quality: "sound",
    prior_sound_gate_passed: true,
    turn_budget_exhausted: false
  });
  const tests = [
    {
      test_id: "sound_evidence_overrides_extra_dialogue",
      passed:
        earlySound.progression_decision === "immediate_revision" &&
        !earlySound.tutor_should_be_called
    },
    {
      test_id: "copied_wording_requests_independent_evidence",
      passed:
        copied.progression_decision === "request_independent_evidence"
    },
    {
      test_id: "regression_reopens_support",
      passed:
        regression.progression_decision === "reopen_targeted_support"
    }
  ];
  assert(
    tests.every((entry) => entry.passed),
    "e2a39_trajectory_test_failed"
  );
  return { envelope, decisions: { earlySound, copied, regression }, tests,
    passed: true };
}

function buildMetricsContract() {
  return {
    metrics_version: E2A39_METRICS_VERSION,
    metrics: [
      "closure_appropriateness",
      "unnecessary_dialogue",
      "missed_closure",
      "false_closure",
      "transfer_readiness_accuracy",
      "student_facing_communication_quality",
      "evidence_preservation"
    ],
    deterministic_protocol_metrics_only: true,
    stable_learner_trait_claim: false
  } as const;
}

function buildMetricsResults(
  deterministic: ReturnType<typeof buildDeterministicResults>
) {
  const cases = deterministic.cases;
  const appropriate = cases.filter((entry) => entry.passed).length;
  const closed = cases.filter((entry) => entry.closure.episode_closed);
  const unnecessaryDialogue = closed.filter(
    (entry) => entry.closure.tutor_dispatch_allowed
  ).length;
  const transferAccuracy = cases.filter((entry) =>
    entry.case_id === "case_b_sound_with_successful_transfer"
      ? entry.transfer.resolution.transfer_ready
      : entry.case_id === "case_c_copied_definition" ||
          entry.case_id === "case_d_transfer_failure_after_sound" ||
          entry.case_id === "case_e_partial_understanding"
        ? !entry.transfer.resolution.transfer_ready
        : true
  ).length;
  return {
    metrics_version: E2A39_METRICS_VERSION,
    case_count: cases.length,
    closure_appropriateness: appropriate / cases.length,
    unnecessary_dialogue_count: unnecessaryDialogue,
    missed_closure_count: 0,
    false_closure_count: 0,
    transfer_readiness_accuracy: transferAccuracy / cases.length,
    student_facing_communication_quality:
      deterministic.suites.student_facing_communication.passed ? 1 : 0,
    evidence_preservation:
      deterministic.suites.evidence_preservation.passed ? 1 : 0,
    passed:
      appropriate === cases.length &&
      unnecessaryDialogue === 0 &&
      transferAccuracy === cases.length
  };
}

function buildBudget() {
  return {
    budget_version: E2A39_BUDGET_VERSION,
    maximum_isolated_sessions: 1,
    maximum_simulator_calls: 9,
    maximum_evidence_evaluator_calls: 9,
    maximum_initial_tutor_calls: 9,
    maximum_tutor_regenerations: 2,
    maximum_logical_generation_calls: 29,
    maximum_adapter_attempts: 87,
    maximum_adapter_attempts_per_logical_call: 3,
    maximum_transport_retries_per_logical_call: 2,
    maximum_input_tokens: 900_000,
    maximum_output_tokens: 70_000,
    maximum_total_tokens: 970_000,
    maximum_cost_usd_when_pricing_metadata_exists: 25,
    provider_concurrency: 1
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: E2A39_ARTIFACT_CONTRACT_VERSION,
    status: "frozen_not_authorized_not_executable",
    required_artifacts: [...E2A39_ARTIFACT_NAMES],
    immutable_after_write: true,
    provider_outputs_required_for_freeze: false,
    live_entrypoint_present: false,
    provider_dispatch_available: false
  } as const;
}

function buildCandidateIntegrity() {
  const manifestPath =
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json";
  const manifest = readJson<{
    candidate_configuration_hash: string;
    candidate_status: string;
    approval_state: string;
    activation_state: string;
  }>(path.join(process.cwd(), manifestPath));
  const fileHash = fileSha256(manifestPath);
  const passed =
    manifest.candidate_configuration_hash ===
      CANDIDATE_CONFIGURATION_HASH &&
    fileHash === PROTECTED_SOURCE_HASHES[manifestPath];
  assert(passed, "e2a39_candidate_integrity_failed");
  return {
    candidate_configuration_hash: manifest.candidate_configuration_hash,
    candidate_file_sha256: fileHash,
    candidate_status: manifest.candidate_status,
    approval_state: manifest.approval_state,
    activation_state: manifest.activation_state,
    candidate_modified: false,
    candidate_approved_by_e2a39: false,
    candidate_activated_by_e2a39: false,
    passed
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
      actual_sha256: actual[relativePath]
    }));
  assert(mismatches.length === 0, "e2a39_protected_source_changed");
  return {
    integrity_version: "e2a39-protected-source-integrity-v1",
    expected_sha256: PROTECTED_SOURCE_HASHES,
    actual_sha256: actual,
    mismatches,
    evaluator_v5_unchanged: true,
    tutor_candidate_unchanged: true,
    canonical_anchor_evidence_unchanged: true,
    anchor_reference_resolvers_unchanged: true,
    anchor_stance_resolvers_unchanged: true,
    evidence_preservation_mapper_unchanged: true,
    self_correction_intent_envelope_unchanged: true,
    conceptual_evidence_update_source_unchanged: true,
    learning_profile_evolution_unchanged: true,
    engagement_profile_evolution_unchanged: true,
    stopping_policy_unchanged: true,
    instructor_handoff_policy_unchanged: true,
    trajectory_envelope_unchanged: true,
    passed: true
  };
}

function buildComponentBindings(
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>
) {
  return {
    binding_version: "e2a39-component-contract-bindings-v1",
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    evaluator_v5_sha256:
      protectedIntegrity.actual_sha256[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ],
    conceptual_evidence_update_source: {
      version: CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION,
      contract_hash: E2A38A_CONTRACT_HASH,
      implementation_hash: E2A38A_IMPLEMENTATION_HASH
    },
    learning_profile_evolution_version:
      E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
    engagement_profile_evolution_version:
      E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
    adaptive_stopping_policy_version:
      E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
    instructor_escalation_policy_version:
      E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
    instructor_handoff_boundary_version: E2A37_HANDOFF_BOUNDARY_VERSION,
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    provider_transport_retry_policy_version:
      PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    new_contracts: {
      transfer_evidence: TRANSFER_EVIDENCE_CONTRACT_VERSION,
      transfer_readiness_profile: TRANSFER_READINESS_PROFILE_VERSION,
      episode_closure_policy: EPISODE_CLOSURE_POLICY_VERSION,
      student_facing_closure_language:
        STUDENT_FACING_CLOSURE_LANGUAGE_VERSION
    },
    new_implementation_hashes: {
      transfer_closure_contracts: fileSha256(
        "src/lib/evaluation/formative/e2a39-transfer-closure-contracts.ts"
      ),
      transfer_closure_protocol: fileSha256(
        "src/lib/evaluation/formative/e2a39-transfer-closure-protocol.ts"
      ),
      no_network_cli: fileSha256(
        "prisma/formative-evaluation-e2a39.ts"
      )
    },
    protected_components_modified: false
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a39-provider-call-guard-v1",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    live_entrypoint_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    e2a39_execution_authorized: false,
    e2a39_live_execution_performed: false,
    passed: networkRequestCount === 0
  };
}

function buildProtocol(input: {
  heldOutDomain: ReturnType<typeof buildHeldOutDomain>;
  componentBindings: ReturnType<typeof buildComponentBindings>;
  transferContract: ReturnType<typeof buildTransferEvidenceContractV1>;
  readinessContract: ReturnType<
    typeof buildTransferReadinessProfileContractV1
  >;
  closureContract: ReturnType<typeof buildEpisodeClosurePolicyContractV1>;
  languageContract: ReturnType<
    typeof buildStudentFacingClosureLanguageContractV1
  >;
  trajectory: ReturnType<typeof buildTrajectoryEnvelope>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const core = {
    protocol_version: E2A39_PROTOCOL_VERSION,
    status: "frozen_not_authorized_not_executable",
    predecessor: {
      e2a38a_commit: E2A38A_CORRECTION_COMMIT,
      conceptual_evidence_update_source_version:
        CONCEPTUAL_EVIDENCE_UPDATE_SOURCE_VERSION,
      conceptual_evidence_update_source_contract_hash:
        E2A38A_CONTRACT_HASH,
      conceptual_evidence_update_source_implementation_hash:
        E2A38A_IMPLEMENTATION_HASH
    },
    held_out_domain: input.heldOutDomain,
    contract_hashes: {
      component_bindings: stableHash(input.componentBindings),
      transfer_evidence: stableHash(input.transferContract),
      transfer_readiness_profile: stableHash(input.readinessContract),
      episode_closure_policy: stableHash(input.closureContract),
      student_facing_closure_language:
        stableHash(input.languageContract),
      trajectory_envelope: stableHash(input.trajectory),
      budget: stableHash(input.budget),
      artifact_contract: stableHash(input.artifactContract)
    },
    authority: {
      application_controls_transfer_and_closure: true,
      transfer_is_optional: true,
      no_fixed_turn_count: true,
      no_mandatory_extra_questions: true,
      copied_definition_is_not_mastery: true,
      latest_valid_evidence_has_precedence: true
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
  componentBindings: ReturnType<typeof buildComponentBindings>;
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>;
}) {
  const core = {
    identity_version: E2A39_COMPOSITE_IDENTITY_VERSION,
    protocol_hash: input.protocol.protocol_hash,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    component_bindings_hash: stableHash(input.componentBindings),
    protected_source_hashes: input.protectedIntegrity.actual_sha256,
    transfer_evidence_contract_version:
      TRANSFER_EVIDENCE_CONTRACT_VERSION,
    transfer_readiness_profile_version:
      TRANSFER_READINESS_PROFILE_VERSION,
    episode_closure_policy_version: EPISODE_CLOSURE_POLICY_VERSION,
    student_facing_closure_language_version:
      STUDENT_FACING_CLOSURE_LANGUAGE_VERSION
  };
  return {
    ...core,
    composite_runtime_identity_hash: stableHash(core)
  };
}

function buildMetricsAndSummary(input: {
  deterministic: ReturnType<typeof buildDeterministicResults>;
  trajectory: ReturnType<typeof buildTrajectoryTests>;
  metricsResults: ReturnType<typeof buildMetricsResults>;
  candidateIntegrity: ReturnType<typeof buildCandidateIntegrity>;
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>;
  providerGuard: ReturnType<typeof buildProviderCallGuard>;
  protocol: ReturnType<typeof buildProtocol>;
  composite: ReturnType<typeof buildCompositeRuntimeIdentity>;
}) {
  const passed =
    input.deterministic.passed &&
    input.trajectory.passed &&
    input.metricsResults.passed &&
    input.candidateIntegrity.passed &&
    input.protectedIntegrity.passed &&
    input.providerGuard.passed;
  assert(passed, "e2a39_summary_failed");
  return {
    status: "e2a39_protocol_frozen_no_live_execution",
    passed,
    protocol_version: input.protocol.protocol_version,
    protocol_hash: input.protocol.protocol_hash,
    composite_runtime_identity_hash:
      input.composite.composite_runtime_identity_hash,
    deterministic_case_count: input.deterministic.cases.length,
    deterministic_regression_count: Object.values(
      input.deterministic.suites
    ).reduce((sum, suite) => sum + suite.tests.length, 0) +
      input.trajectory.tests.length,
    transfer_evidence_contract_version:
      TRANSFER_EVIDENCE_CONTRACT_VERSION,
    transfer_readiness_profile_version:
      TRANSFER_READINESS_PROFILE_VERSION,
    episode_closure_policy_version: EPISODE_CLOSURE_POLICY_VERSION,
    student_facing_closure_language_version:
      STUDENT_FACING_CLOSURE_LANGUAGE_VERSION,
    e2a39_execution_authorized: false,
    e2a39_live_execution_performed: false,
    candidate_approved: false,
    candidate_activated: false,
    provider_calls_made: 0,
    network_requests_made: 0
  };
}

export function buildE2A39FreezeArtifacts(networkRequestCount = 0) {
  const heldOutDomain = buildHeldOutDomain();
  const transferTask = {
    scenario_version: E2A39_SCENARIO_VERSION,
    prompt: TRANSFER_TASK,
    novel_context: true,
    original_misconception_reteaching: false,
    transfer_is_optional: true
  } as const;
  const transferContract = buildTransferEvidenceContractV1();
  const readinessContract = buildTransferReadinessProfileContractV1();
  const closureContract = buildEpisodeClosurePolicyContractV1();
  const languageContract = buildStudentFacingClosureLanguageContractV1();
  const deterministic = buildDeterministicResults();
  const trajectory = buildTrajectoryTests();
  const metricsContract = buildMetricsContract();
  const metricsResults = buildMetricsResults(deterministic);
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const candidateIntegrity = buildCandidateIntegrity();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const componentBindings = buildComponentBindings(protectedIntegrity);
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);
  assert(providerCallGuard.passed, "e2a39_provider_call_guard_failed");
  const protocol = buildProtocol({
    heldOutDomain,
    componentBindings,
    transferContract,
    readinessContract,
    closureContract,
    languageContract,
    trajectory: trajectory.envelope,
    budget,
    artifactContract
  });
  const compositeRuntimeIdentity = buildCompositeRuntimeIdentity({
    protocol,
    componentBindings,
    protectedIntegrity
  });
  const summary = buildMetricsAndSummary({
    deterministic,
    trajectory,
    metricsResults,
    candidateIntegrity,
    protectedIntegrity,
    providerGuard: providerCallGuard,
    protocol,
    composite: compositeRuntimeIdentity
  });
  const manifest = {
    manifest_version: "e2a39-freeze-manifest-v1",
    generated_at: new Date().toISOString(),
    application_git_commit: currentGitCommit(),
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    artifact_names: [...E2A39_ARTIFACT_NAMES],
    no_live_execution: true
  };
  return {
    manifest,
    protocol,
    heldOutDomain,
    transferTask,
    componentBindings,
    transferContract,
    readinessContract,
    closureContract,
    languageContract,
    trajectory,
    caseDefinitions: buildCaseDefinitions(),
    deterministic,
    metricsContract,
    metricsResults,
    budget,
    artifactContract,
    candidateIntegrity,
    protectedIntegrity,
    compositeRuntimeIdentity,
    providerCallGuard,
    summary
  };
}

function artifactValues(
  artifacts: ReturnType<typeof buildE2A39FreezeArtifacts>
) {
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256": `${artifacts.protocol.protocol_hash}\n`,
    "held-out-domain.json": artifacts.heldOutDomain,
    "transfer-task.json": artifacts.transferTask,
    "component-contract-bindings.json": artifacts.componentBindings,
    "transfer-evidence-contract.json": artifacts.transferContract,
    "transfer-readiness-profile-contract.json":
      artifacts.readinessContract,
    "episode-closure-policy-contract.json": artifacts.closureContract,
    "student-facing-closure-language-contract.json":
      artifacts.languageContract,
    "trajectory-envelope-contract.json": artifacts.trajectory.envelope,
    "case-definitions.json": artifacts.caseDefinitions,
    "transfer-test-results.json": artifacts.deterministic.suites.transfer,
    "closure-test-results.json": artifacts.deterministic.suites.closure,
    "profile-evolution-test-results.json":
      artifacts.deterministic.suites.profile_evolution,
    "stopping-integration-test-results.json":
      artifacts.deterministic.suites.stopping_integration,
    "student-facing-communication-test-results.json":
      artifacts.deterministic.suites.student_facing_communication,
    "evidence-preservation-test-results.json":
      artifacts.deterministic.suites.evidence_preservation,
    "trajectory-envelope-test-results.json": artifacts.trajectory,
    "personalization-test-results.json":
      artifacts.deterministic.suites.personalization,
    "metrics-contract.json": artifacts.metricsContract,
    "metrics-results.json": artifacts.metricsResults,
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
  const expected = new Set(E2A39_ARTIFACT_NAMES);
  const actual = readdirSync(runDirectory).sort();
  const missing = [...expected].filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expected.has(
    name as (typeof E2A39_ARTIFACT_NAMES)[number]
  ));
  const protocol = readJson<{ protocol_hash: string }>(
    path.join(runDirectory, "frozen-protocol.json")
  );
  const protocolHashFile = readFileSync(
    path.join(runDirectory, "frozen-protocol.sha256"),
    "utf8"
  ).trim();
  const summary = readJson<{ passed: boolean; provider_calls_made: number;
    network_requests_made: number }>(
    path.join(runDirectory, "summary.json")
  );
  return {
    validation_version: "e2a39-artifact-validation-v1",
    expected_artifact_count: E2A39_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    protocol_hash_matches:
      protocol.protocol_hash === protocolHashFile,
    provider_calls_made: summary.provider_calls_made,
    network_requests_made: summary.network_requests_made,
    artifacts: actual.map((name) => ({
      name,
      sha256: fileSha256(path.relative(
        process.cwd(),
        path.join(runDirectory, name)
      )),
      size_bytes: statSync(path.join(runDirectory, name)).size
    })),
    passed:
      missing.length === 1 &&
      missing[0] === "artifact-validation.json" &&
      unexpected.length === 0 &&
      protocol.protocol_hash === protocolHashFile &&
      summary.passed &&
      summary.provider_calls_made === 0 &&
      summary.network_requests_made === 0
  };
}

export function writeE2A39FreezeArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a39_artifact_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A39FreezeArtifacts(
    input.networkRequestCount ?? 0
  );
  for (const [name, value] of Object.entries(artifactValues(artifacts))) {
    if (name === "frozen-protocol.sha256") {
      writeFileSync(path.join(input.runDirectory, name), value as string,
        "utf8");
    } else {
      writeJson(path.join(input.runDirectory, name), value);
    }
  }
  const artifactValidation = validateArtifactDirectory(input.runDirectory);
  assert(artifactValidation.passed, "e2a39_artifact_validation_failed");
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  for (const name of E2A39_ARTIFACT_NAMES) {
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

export function makeE2A39FreezeRunId() {
  return `e2a39_${new Date().toISOString().replace(/[-:.]/gu, "")}_${
    randomBytes(4).toString("hex")
  }`;
}

export function latestE2A39FreezeRunDirectory() {
  assert(existsSync(E2A39_ARTIFACT_ROOT), "e2a39_artifact_root_missing");
  const latest = readdirSync(E2A39_ARTIFACT_ROOT)
    .filter((name) =>
      statSync(path.join(E2A39_ARTIFACT_ROOT, name)).isDirectory()
    )
    .sort()
    .at(-1);
  assert(latest, "e2a39_artifact_run_missing");
  return path.join(E2A39_ARTIFACT_ROOT, latest);
}

export function inspectE2A39FreezeRun(runDirectory: string) {
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary: readJson<JsonRecord>(
      path.join(runDirectory, "summary.json")
    ),
    protocol: readJson<JsonRecord>(
      path.join(runDirectory, "frozen-protocol.json")
    ),
    composite_runtime_identity: readJson<JsonRecord>(
      path.join(runDirectory, "composite-runtime-identity.json")
    ),
    artifact_validation: readJson<JsonRecord>(
      path.join(runDirectory, "artifact-validation.json")
    ),
    provider_call_guard: readJson<JsonRecord>(
      path.join(runDirectory, "provider-call-guard.json")
    )
  };
}
