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
import { z } from "zod";
import {
  PROVIDER_TRANSPORT_RETRY_POLICY_VERSION
} from "@/lib/llm/provider-transport-retry";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  ActiveAnchorAliasContractSchema,
  buildActiveAnchorAliasContract,
  type ActiveAnchorAliasContract
} from "@/lib/services/student-assessment/active-anchor-alias-resolution";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4
} from "@/lib/services/student-assessment/active-anchor-alias-resolution-v4";
import {
  SOUND_GATE_ANCHOR_CONSISTENCY_VERSION
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import {
  ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION
} from "@/lib/services/student-assessment/anchor-stance-evidence-resolution-v2";
import {
  ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION
} from "@/lib/services/student-assessment/anchor-stance-scope-resolution-v1";
import {
  PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v4";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  buildProductionTurnEvidenceEvaluatorInputV5
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  TARGET_EVIDENCE_CONTRACT_VERSION_V5,
  TargetEvidenceContractV5Schema,
  type TargetEvidenceContractV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import {
  TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7
} from "@/lib/services/student-assessment/target-evidence-mapper-v7";
import {
  E2A24_CANDIDATE_PATH,
  evaluateE2A24Candidate
} from "./e2a24-autonomous-dialogue-candidate";
import {
  E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
  E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
  E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
  E2A36_INTERVENTION_MEMORY_VERSION,
  E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
  E2A36_STUDENT_FACING_COMMUNICATION_VERSION,
  AdaptiveStoppingDecisionV1Schema,
  buildAdaptiveStoppingPolicyContractV1,
  buildEngagementProfileEvolutionContractV1,
  buildInstructorEscalationPolicyContractV1,
  buildLearningProfileEvolutionContractV1,
  buildLongitudinalInterventionMemoryContractV1,
  buildStudentFacingCommunicationContractV1,
  createEngagementProfileSnapshotV1,
  createLearningProfileSnapshotV1,
  decideAdaptiveStoppingV1,
  evaluateInstructorEscalationV1,
  evolveEngagementProfileV1,
  evolveLearningProfileV1,
  selectLongitudinalInterventionV1,
  translateStoppingDecisionForStudentV1,
  validateStudentFacingCommunicationV1,
  type AdaptiveStoppingDecisionV1,
  type EngagementProfileEvolutionV1,
  type LearningProfileEvolutionV1,
  type LongitudinalInterventionRecordV1
} from "./e2a36-longitudinal-contracts";
import {
  SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
  buildSelfCorrectionEvidenceContractV1
} from "./self-correction-evidence-v1";
import {
  SELF_CORRECTION_INTENT_ENVELOPE_VERSION,
  buildSelfCorrectionIntentEnvelopeContractV2,
  resolveSelfCorrectionIntentEnvelopeV2
} from "./self-correction-intent-envelope-v2";
import {
  TRAJECTORY_ENVELOPE_VERSION,
  TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
  TrajectoryEnvelopeContractSchema,
  buildDefaultTrajectoryProgressionConsequences,
  evaluateTrajectoryEnvelope,
  type TrajectoryEnvelopeContract
} from "./trajectory-envelope-v1";

export const E2A37_PREPARATION_VERSION =
  "e2a37-instructor-handoff-protocol-freeze-preparation-v1" as const;
export const E2A37_PROTOCOL_VERSION =
  "e2a37-instructor-handoff-human-in-loop-boundary-canary-v1" as const;
export const E2A37_HANDOFF_BOUNDARY_VERSION =
  "e2a37-instructor-handoff-boundary-v1" as const;
export const E2A37_STUDENT_COMMUNICATION_BOUNDARY_VERSION =
  "e2a37-student-facing-handoff-communication-v1" as const;
export const E2A37_METRICS_VERSION =
  "e2a37-instructor-handoff-metrics-v1" as const;
export const E2A37_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a37-instructor-handoff-protocol-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const CANDIDATE_FILE_SHA256 =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2";
const ITEM_ID = "measurement_reliability_validity_handoff_item_1";
const CONCEPT_ID = "reliability_validity_instructor_handoff";
const OPTION_LABEL = "D";
const CANONICAL_ANCHOR_ID = `${ITEM_ID}:option:${OPTION_LABEL}`;
const SCENARIO_PROMPT =
  "A classroom assessment produces nearly identical scores when it is given twice. An instructor concludes that the scores must support the intended interpretation because they are consistent. Do you agree? Explain.";
const DISTRACTOR_CLAIM =
  "The assessment is valid for the intended interpretation because stable scores prove it measures the intended construct.";

const PROTECTED_SOURCE_HASHES = {
  [E2A24_CANDIDATE_PATH]: CANDIDATE_FILE_SHA256,
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
  "src/lib/evaluation/formative/trajectory-envelope-v1.ts":
    "95319bb52d087601680e53ce2db9e357764a2b5f5574e125f3b88804c49d4e70",
  "src/lib/evaluation/formative/self-correction-intent-envelope-v2.ts":
    "a3e77c9dc3d5cbd12458a18c632129ce0dabe25460c9a893afcab284644d9a98",
  "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts":
    "98044fed11bd8a1a9ff9151afa21e866e7d0f0624cfdf8cecc455f42700ad941"
} as const;

export const E2A37_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "held-out-domain.json",
  "held-out-trajectories.json",
  "target-evidence-contract.json",
  "canonical-anchor-contract.json",
  "anchor-stance-contract.json",
  "self-correction-integration-contract.json",
  "compiled-evaluator-v5-request.json",
  "learning-profile-evolution-contract.json",
  "engagement-profile-evolution-contract.json",
  "intervention-memory-contract.json",
  "adaptive-stopping-policy-contract.json",
  "instructor-escalation-policy-contract.json",
  "instructor-handoff-boundary-contract.json",
  "student-facing-communication-contract.json",
  "trajectory-envelope-contract.json",
  "deterministic-regressions.json",
  "profile-evolution-regressions.json",
  "stopping-policy-regressions.json",
  "instructor-escalation-regressions.json",
  "student-facing-communication-regressions.json",
  "intervention-memory-regressions.json",
  "trajectory-envelope-regressions.json",
  "self-correction-regressions.json",
  "personalization-regressions.json",
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

const E2A37CanonicalAnchorContractSchema = z.object({
  contract_version: z.literal(
    "e2a37-measurement-canonical-anchor-v1"
  ),
  canonical_anchor_id: z.literal(CANONICAL_ANCHOR_ID),
  item_id: z.literal(ITEM_ID),
  option_label: z.literal(OPTION_LABEL),
  distractor_text: z.literal(DISTRACTOR_CLAIM),
  required_anchor_application: z.literal("explicit"),
  required_anchor_stance: z.literal("rejects_distractor"),
  mechanism_criteria: z.array(z.string().min(1)).min(3),
  sound_criteria: z.array(z.string().min(1)).min(5),
  contradiction_criteria: z.array(z.string().min(1)).min(2),
  active_anchor_alias_contract: ActiveAnchorAliasContractSchema
}).strict();

const E2A37AnchorStanceContractSchema = z.object({
  contract_version: z.literal(
    "e2a37-measurement-anchor-stance-v1"
  ),
  canonical_anchor_id: z.literal(CANONICAL_ANCHOR_ID),
  reference_resolver_version:
    z.literal(ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4),
  stance_evidence_resolver_version:
    z.literal(ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION),
  scope_resolver_version:
    z.literal(ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION),
  reference_resolution_separate_from_stance: z.literal(true),
  polarity_must_attach_to_active_anchor: z.literal(true),
  endorsement_examples: z.array(z.string().min(1)).min(3),
  rejection_examples: z.array(z.string().min(1)).min(3),
  uncertainty_examples: z.array(z.string().min(1)).min(2)
}).strict();

const E2A37SelfCorrectionIntegrationContractSchema = z.object({
  contract_version: z.literal(
    "e2a37-self-correction-integration-v1"
  ),
  intent_envelope_version:
    z.literal(SELF_CORRECTION_INTENT_ENVELOPE_VERSION),
  intent_envelope_hash: z.string().length(64),
  conceptual_evidence_contract_version:
    z.literal(SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION),
  conceptual_evidence_contract_hash: z.string().length(64),
  separation: z.object({
    visible_interaction_behavior: z.literal("independent_signal"),
    simulator_metadata: z.literal("non_authoritative_audit_signal"),
    conceptual_evidence_update:
      z.literal("requires_observable_independent_evidence"),
    intent_only_preserves_profile: z.literal(true),
    contradictory_correction_keeps_barrier_open: z.literal(true)
  }).strict()
}).strict();

const E2A37InstructorHandoffBoundaryContractSchema = z.object({
  boundary_version: z.literal(E2A37_HANDOFF_BOUNDARY_VERSION),
  base_escalation_policy_version:
    z.literal(E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION),
  base_stopping_policy_version:
    z.literal(E2A36_ADAPTIVE_STOPPING_POLICY_VERSION),
  authority_boundary: z.object({
    handoff_is_internal_orchestration: z.literal(true),
    provider_does_not_authorize_handoff: z.literal(true),
    fixed_turn_count_alone_is_insufficient: z.literal(true),
    correctness_alone_is_insufficient: z.literal(true),
    student_visible_internal_reasoning_prohibited: z.literal(true)
  }).strict(),
  continue_conditions: z.array(z.enum([
    "new_evidence",
    "knowledge_gap_narrowing",
    "effective_intervention",
    "engagement_supports_learning"
  ])).length(4),
  change_strategy_conditions: z.array(z.enum([
    "prior_strategy_did_not_address_gap",
    "remaining_gap_changed",
    "new_evidence_requires_different_probe"
  ])).length(3),
  handoff_conditions: z.array(z.enum([
    "persistent_unresolved_conceptual_barrier",
    "intervention_value_decreasing",
    "bounded_budget_exhausted",
    "limited_expected_ai_benefit",
    "human_contextual_knowledge_preferable"
  ])).length(5),
  sound_requires_immediate_revision: z.literal(true),
  regression_reopens_support: z.literal(true),
  unsupported_understanding_requires_evidence: z.literal(true)
}).strict();

const E2A37StudentCommunicationBoundaryContractSchema = z.object({
  boundary_version:
    z.literal(E2A37_STUDENT_COMMUNICATION_BOUNDARY_VERSION),
  base_contract_version:
    z.literal(E2A36_STUDENT_FACING_COMMUNICATION_VERSION),
  required_qualities: z.array(z.enum([
    "supportive",
    "actionable",
    "learning_oriented",
    "student_facing",
    "internal_state_free"
  ])).length(5),
  prohibited_internal_categories: z.array(z.enum([
    "internal_profile",
    "misconception_label",
    "engagement_score",
    "stopping_rule",
    "session_budget",
    "ai_limitation",
    "escalation_criteria"
  ])).length(7),
  handoff_message_requires: z.array(z.enum([
    "key_distinction_summary",
    "useful_instructor_next_step",
    "no_failure_language",
    "no_internal_reason"
  ])).length(4)
}).strict();

const E2A37MetricsContractSchema = z.object({
  contract_version: z.literal(E2A37_METRICS_VERSION),
  metrics: z.array(z.object({
    metric_id: z.enum([
      "dialogue_efficiency",
      "unnecessary_turn_detection",
      "missed_progression_detection",
      "intervention_adaptation",
      "stopping_appropriateness",
      "escalation_appropriateness",
      "student_facing_communication_quality",
      "instructor_handoff_quality"
    ]),
    description: z.string().min(1).max(500)
  }).strict()).length(8),
  synthetic_protocol_metric_only: z.literal(true),
  stable_student_trait_claim: z.literal(false)
}).strict();

const E2A37TrajectoryCaseSchema = z.object({
  case_id: z.enum(["A", "B", "C", "D", "E", "F"]),
  title: z.string().min(1),
  initial_condition: z.string().min(1),
  trajectory_intent: z.array(z.string().min(1)).min(1),
  expected_progression: z.array(z.string().min(1)).min(1),
  instructor_handoff_expected: z.boolean(),
  exact_turn_labels_required: z.literal(false),
  sound_evidence_override_required: z.literal(true)
}).strict();

const E2A37HeldOutTrajectoriesSchema = z.object({
  trajectory_contract_version:
    z.literal("e2a37-held-out-trajectories-v1"),
  domain: z.literal("educational_measurement_assessment_literacy"),
  cases: z.array(E2A37TrajectoryCaseSchema).length(6),
  latest_valid_evidence_precedence: z.literal(true),
  fixed_turn_count_stopping_prohibited: z.literal(true)
}).strict();

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha256(relativePath: string) {
  const target = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(process.cwd(), relativePath);
  return sha256(readFileSync(target));
}

function currentGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
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
    "e2a37_forbidden_secret_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildAliasContract(): ActiveAnchorAliasContract {
  return ActiveAnchorAliasContractSchema.parse(buildActiveAnchorAliasContract({
    active_anchor_id: CANONICAL_ANCHOR_ID,
    option_label: OPTION_LABEL,
    option_text: DISTRACTOR_CLAIM,
    accepted_paraphrases: [
      "stable scores prove validity",
      "reliability automatically means validity",
      "consistency proves the intended construct",
      "the stability-proves-validity claim",
      "the reliability-validity claim",
      "that validity claim",
      "that option"
    ]
  }));
}

function buildTargetEvidenceContract(
  aliases: ActiveAnchorAliasContract
): TargetEvidenceContractV5 {
  return TargetEvidenceContractV5Schema.parse({
    contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    concept_id: CONCEPT_ID,
    item_id: ITEM_ID,
    distractor_option: OPTION_LABEL,
    distractor_claim: DISTRACTOR_CLAIM,
    target_conceptual_relationships: [
      "Reliability concerns consistency or precision under specified conditions.",
      "Validity concerns evidence supporting the intended score interpretation or use.",
      "Stable scores can consistently represent the wrong construct."
    ],
    required_mechanisms: [
      "Distinguish score stability from interpretation evidence.",
      "Explain how a measure can be consistent without measuring the intended construct.",
      "Apply the distinction directly to the active distractor."
    ],
    acceptable_equivalent_explanations: [
      "A test can consistently measure the wrong construct.",
      "Reliability is useful but is not sufficient for validity.",
      "Validity needs evidence for the proposed interpretation and use."
    ],
    required_anchor_application:
      `Apply the reliability-validity distinction to ${ITEM_ID} option ${OPTION_LABEL} and reject its claim.`,
    prohibited_contradictions: [
      DISTRACTOR_CLAIM,
      "Reliability proves validity.",
      "The test can measure the wrong construct consistently, but option D is still correct."
    ],
    revision_ready_criteria: [
      "reliability_definition",
      "validity_interpretation_boundary",
      "consistent_wrong_construct_mechanism",
      "active_anchor_application",
      "coherent_conclusion"
    ],
    optional_deepening_criteria: [
      "identify_additional_validity_evidence"
    ],
    evidence_limitations: [
      "This synthetic held-out protocol evaluates one assessment-literacy boundary and does not establish broad mastery.",
      "Engagement evidence informs orchestration only and never determines conceptual correctness."
    ],
    criteria: [
      {
        criterion_id: "reliability_definition",
        criterion_kind: "conceptual_relationship",
        description:
          "The response identifies reliability as score consistency or precision evidence.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "reliability concerns consistency",
          "reliability concerns score precision"
        ]
      },
      {
        criterion_id: "validity_interpretation_boundary",
        criterion_kind: "conceptual_relationship",
        description:
          "The response identifies validity as evidence for an intended interpretation or use.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "validity concerns the intended interpretation",
          "validity requires evidence beyond reliability"
        ]
      },
      {
        criterion_id: "consistent_wrong_construct_mechanism",
        criterion_kind: "required_mechanism",
        description:
          "The response explains that stable scores can consistently represent the wrong construct.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "consistently measure the wrong construct",
          "stable scores do not establish what is measured"
        ]
      },
      {
        criterion_id: "active_anchor_application",
        criterion_kind: "anchor_application",
        description:
          `The response explicitly rejects option ${OPTION_LABEL} or an accepted alias using the mechanism.`,
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          `option ${OPTION_LABEL} is incorrect`,
          "the stability-proves-validity claim is wrong"
        ]
      },
      {
        criterion_id: "coherent_conclusion",
        criterion_kind: "coherent_conclusion",
        description:
          "The response concludes that reliability does not automatically establish validity.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "reliability is not sufficient for validity"
        ]
      },
      {
        criterion_id: "identify_additional_validity_evidence",
        criterion_kind: "optional_deepening",
        description:
          "The response identifies evidence relevant to the intended interpretation.",
        essential_for_revision: false,
        acceptable_evidence_patterns: [
          "collect evidence that scores represent the intended construct"
        ]
      }
    ],
    contradiction_criteria: [
      {
        contradiction_id: "active_distractor_claim_retained",
        description: DISTRACTOR_CLAIM,
        observable_patterns: [
          "option D is correct",
          "stable scores prove validity"
        ]
      },
      {
        contradiction_id:
          "anchor_conclusion_conceptual_explanation_conflict",
        description:
          "The response states the distinction but still endorses the active distractor.",
        observable_patterns: [
          "reliability is consistency, but D is still right"
        ]
      }
    ],
    active_anchor_id: CANONICAL_ANCHOR_ID,
    active_anchor_text:
      `${ITEM_ID} option ${OPTION_LABEL}: ${DISTRACTOR_CLAIM}`,
    active_anchor_type: "distractor_option",
    required_anchor_stance: "rejects_distractor",
    acceptable_anchor_paraphrases: aliases.accepted_paraphrases,
    prohibited_anchor_stances: [
      "not_expressed",
      "ambiguous",
      "endorses_distractor"
    ],
    anchor_resolution_criteria: [
      `Explicitly reject option ${OPTION_LABEL} or an accepted alias using the reliability-validity distinction.`
    ],
    anchor_contradiction_criteria: [
      `Endorsing option ${OPTION_LABEL} conflicts with explaining that consistency is insufficient validity evidence.`,
      `Rejecting option ${OPTION_LABEL} without the mechanism remains incomplete.`
    ],
    ambiguity_resolution_policy:
      "Require observable stance attached to the active anchor; do not infer stance from confidence, self-correction language, or non-anchor polarity.",
    active_anchor_alias_contract: aliases
  });
}

function buildCanonicalAnchorContract(
  aliases: ActiveAnchorAliasContract
) {
  return E2A37CanonicalAnchorContractSchema.parse({
    contract_version: "e2a37-measurement-canonical-anchor-v1",
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    item_id: ITEM_ID,
    option_label: OPTION_LABEL,
    distractor_text: DISTRACTOR_CLAIM,
    required_anchor_application: "explicit",
    required_anchor_stance: "rejects_distractor",
    mechanism_criteria: [
      "distinguish score stability from interpretation evidence",
      "explain consistent measurement of the wrong construct",
      "apply the distinction to the active distractor"
    ],
    sound_criteria: [
      "identify reliability as consistency or precision evidence",
      "identify validity as interpretation or use evidence",
      "explain why reliability is insufficient for validity",
      "reject the active distractor",
      "give a coherent conclusion with no essential missing links"
    ],
    contradiction_criteria: [
      "retain the claim that stable scores prove validity",
      "state the distinction but still endorse option D"
    ],
    active_anchor_alias_contract: aliases
  });
}

function buildAnchorStanceContract() {
  return E2A37AnchorStanceContractSchema.parse({
    contract_version: "e2a37-measurement-anchor-stance-v1",
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    reference_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    stance_evidence_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    scope_resolver_version: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    reference_resolution_separate_from_stance: true,
    polarity_must_attach_to_active_anchor: true,
    endorsement_examples: [
      "I agree with D because stable scores prove validity.",
      "Option D is still correct.",
      "That reliability-validity claim makes sense."
    ],
    rejection_examples: [
      "Option D is wrong because stability alone does not establish validity.",
      "I reject the stability-proves-validity claim.",
      "That option is tempting but incorrect."
    ],
    uncertainty_examples: [
      "I am unsure whether D is right.",
      "Maybe stable scores are enough for validity."
    ]
  });
}

function buildSelfCorrectionIntegrationContract() {
  const intent = buildSelfCorrectionIntentEnvelopeContractV2();
  const evidence = buildSelfCorrectionEvidenceContractV1();
  return E2A37SelfCorrectionIntegrationContractSchema.parse({
    contract_version: "e2a37-self-correction-integration-v1",
    intent_envelope_version: SELF_CORRECTION_INTENT_ENVELOPE_VERSION,
    intent_envelope_hash: stableHash(intent),
    conceptual_evidence_contract_version:
      SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
    conceptual_evidence_contract_hash: stableHash(evidence),
    separation: {
      visible_interaction_behavior: "independent_signal",
      simulator_metadata: "non_authoritative_audit_signal",
      conceptual_evidence_update:
        "requires_observable_independent_evidence",
      intent_only_preserves_profile: true,
      contradictory_correction_keeps_barrier_open: true
    }
  });
}

function buildInstructorHandoffBoundaryContract() {
  return E2A37InstructorHandoffBoundaryContractSchema.parse({
    boundary_version: E2A37_HANDOFF_BOUNDARY_VERSION,
    base_escalation_policy_version:
      E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
    base_stopping_policy_version:
      E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
    authority_boundary: {
      handoff_is_internal_orchestration: true,
      provider_does_not_authorize_handoff: true,
      fixed_turn_count_alone_is_insufficient: true,
      correctness_alone_is_insufficient: true,
      student_visible_internal_reasoning_prohibited: true
    },
    continue_conditions: [
      "new_evidence",
      "knowledge_gap_narrowing",
      "effective_intervention",
      "engagement_supports_learning"
    ],
    change_strategy_conditions: [
      "prior_strategy_did_not_address_gap",
      "remaining_gap_changed",
      "new_evidence_requires_different_probe"
    ],
    handoff_conditions: [
      "persistent_unresolved_conceptual_barrier",
      "intervention_value_decreasing",
      "bounded_budget_exhausted",
      "limited_expected_ai_benefit",
      "human_contextual_knowledge_preferable"
    ],
    sound_requires_immediate_revision: true,
    regression_reopens_support: true,
    unsupported_understanding_requires_evidence: true
  });
}

function buildStudentCommunicationContract() {
  return {
    base_contract: buildStudentFacingCommunicationContractV1(),
    held_out_boundary:
      E2A37StudentCommunicationBoundaryContractSchema.parse({
        boundary_version:
          E2A37_STUDENT_COMMUNICATION_BOUNDARY_VERSION,
        base_contract_version:
          E2A36_STUDENT_FACING_COMMUNICATION_VERSION,
        required_qualities: [
          "supportive",
          "actionable",
          "learning_oriented",
          "student_facing",
          "internal_state_free"
        ],
        prohibited_internal_categories: [
          "internal_profile",
          "misconception_label",
          "engagement_score",
          "stopping_rule",
          "session_budget",
          "ai_limitation",
          "escalation_criteria"
        ],
        handoff_message_requires: [
          "key_distinction_summary",
          "useful_instructor_next_step",
          "no_failure_language",
          "no_internal_reason"
        ]
      })
  };
}

function buildMetricsContract() {
  return E2A37MetricsContractSchema.parse({
    contract_version: E2A37_METRICS_VERSION,
    metrics: [
      {
        metric_id: "dialogue_efficiency",
        description:
          "Whether the protocol reaches revision or handoff without avoidable dialogue."
      },
      {
        metric_id: "unnecessary_turn_detection",
        description:
          "Whether tutor dispatch is blocked immediately after sound evidence."
      },
      {
        metric_id: "missed_progression_detection",
        description:
          "Whether sound or regression evidence causes the required progression."
      },
      {
        metric_id: "intervention_adaptation",
        description:
          "Whether an ineffective strategy-gap pair changes before another attempt."
      },
      {
        metric_id: "stopping_appropriateness",
        description:
          "Whether evidence, expected benefit, and bounded support justify the stopping outcome."
      },
      {
        metric_id: "escalation_appropriateness",
        description:
          "Whether instructor support is suggested only at the educationally appropriate boundary."
      },
      {
        metric_id: "student_facing_communication_quality",
        description:
          "Whether visible messages are supportive, actionable, and free of internal orchestration language."
      },
      {
        metric_id: "instructor_handoff_quality",
        description:
          "Whether handoff summarizes the key distinction and gives a useful instructor discussion next step."
      }
    ],
    synthetic_protocol_metric_only: true,
    stable_student_trait_claim: false
  });
}

function buildHeldOutTrajectories() {
  return E2A37HeldOutTrajectoriesSchema.parse({
    trajectory_contract_version: "e2a37-held-out-trajectories-v1",
    domain: "educational_measurement_assessment_literacy",
    cases: [
      {
        case_id: "A",
        title: "Early misconception to partial to sound",
        initial_condition: "Active reliability-validity misconception",
        trajectory_intent: [
          "endorse distractor",
          "distinguish consistency from validity partially",
          "reject distractor with complete mechanism"
        ],
        expected_progression: [
          "continue support",
          "continue targeted support",
          "immediate revision"
        ],
        instructor_handoff_expected: false,
        exact_turn_labels_required: false,
        sound_evidence_override_required: true
      },
      {
        case_id: "B",
        title: "Persistent misconception with high engagement",
        initial_condition:
          "Thoughtful responses continue without resolving the conceptual boundary",
        trajectory_intent: [
          "continue while learning gain remains plausible",
          "change ineffective strategy",
          "supportive handoff only when bounded support is exhausted"
        ],
        expected_progression: [
          "continue or adapt strategy",
          "bounded instructor handoff if expected benefit becomes low"
        ],
        instructor_handoff_expected: true,
        exact_turn_labels_required: false,
        sound_evidence_override_required: true
      },
      {
        case_id: "C",
        title: "Persistent misconception with low responsiveness",
        initial_condition:
          "Minimal responses do not incorporate prior support",
        trajectory_intent: [
          "avoid infinite explanation",
          "use a bounded supportive stop",
          "suggest an instructor discussion"
        ],
        expected_progression: ["bounded instructor handoff"],
        instructor_handoff_expected: true,
        exact_turn_labels_required: false,
        sound_evidence_override_required: true
      },
      {
        case_id: "D",
        title: "Sound evidence reached early",
        initial_condition:
          "Complete mechanism and explicit distractor rejection",
        trajectory_intent: ["stop formative dialogue immediately"],
        expected_progression: ["immediate revision"],
        instructor_handoff_expected: false,
        exact_turn_labels_required: false,
        sound_evidence_override_required: true
      },
      {
        case_id: "E",
        title: "Regression after sound",
        initial_condition:
          "Previously sound response followed by renewed distractor endorsement",
        trajectory_intent: [
          "reopen the learning profile",
          "resume targeted support"
        ],
        expected_progression: ["reopen support"],
        instructor_handoff_expected: false,
        exact_turn_labels_required: false,
        sound_evidence_override_required: true
      },
      {
        case_id: "F",
        title: "Unsupported understanding claim",
        initial_condition:
          "Student claims understanding without observable explanation",
        trajectory_intent: [
          "preserve prior conceptual profile",
          "request observable explanation"
        ],
        expected_progression: ["continue evidence-targeted support"],
        instructor_handoff_expected: false,
        exact_turn_labels_required: false,
        sound_evidence_override_required: true
      }
    ],
    latest_valid_evidence_precedence: true,
    fixed_turn_count_stopping_prohibited: true
  });
}

function buildTrajectoryEnvelope(): TrajectoryEnvelopeContract {
  const consequence = buildDefaultTrajectoryProgressionConsequences();
  const roles = [
    "initial_anchor_position",
    "mechanism_exploration",
    "anchor_reconciliation",
    "independent_reconstruction",
    "mechanism_exploration",
    "anchor_reconciliation",
    "revision_readiness",
    "post_sound_revision"
  ] as const;
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
        "Synthetic cases exercise early sound, prolonged misconception, low responsiveness, regression, and unsupported understanding without prescribing exact evaluator labels.",
      acceptable_reasoning_quality_envelope:
        "Every checkpoint permits any evidence-supported quality. Sound can occur immediately and regression can reopen support.",
      progression_consequences:
        "Evidence and the sound gate control progression; bounded orchestration determines when further AI support has insufficient value."
    },
    turns: roles.map((role, index) => ({
      turn_index: index + 1,
      expected_trajectory_role: role,
      allowed_reasoning_quality_set: [
        "insufficient",
        "misconception",
        "partial",
        "sound"
      ],
      sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
      progression_consequence: consequence,
      prohibited_states: [
        "trajectory_expectation_overrides_evaluator",
        "revision_delayed_after_sound",
        "copied_wording_without_evidence",
        "blocking_contradiction",
        "unsupported_sound_promotion"
      ]
    }))
  });
}

function buildCompiledEvaluatorRequest(
  targetContract: TargetEvidenceContractV5
) {
  return buildProductionTurnEvidenceEvaluatorInputV5({
    legacy_evaluator_input: {
      evaluation_mode: "e2a37_no_live_request_compilation",
      scenario_prompt: SCENARIO_PROMPT,
      latest_student_message:
        "I reject option D. Stable scores show consistency, but a test can consistently measure the wrong construct, so validity needs evidence for the intended interpretation.",
      visible_prior_student_position:
        "I agreed with D because the scores were nearly identical.",
      target_evidence_contract: targetContract,
      longitudinal_profile_context: {
        learning_profile_evolution_version:
          E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
        engagement_profile_evolution_version:
          E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
        stopping_policy_version:
          E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
        instructor_handoff_boundary_version:
          E2A37_HANDOFF_BOUNDARY_VERSION
      }
    },
    source_student_turn: {
      source_student_turn_id: "e2a37_compile_student_turn_4",
      source_sequence_index: 4
    },
    active_anchor_alias_contract:
      targetContract.active_anchor_alias_contract
  });
}

function learningSnapshot(input: {
  sequence: number;
  state: "misconception" | "partial" | "sound";
  selfCorrectionIntent?: boolean;
  conceptualUpdate?: boolean;
  eligible?: boolean;
}) {
  const update = input.conceptualUpdate ?? true;
  const eligible = input.eligible ?? update;
  const state = input.state;
  return createLearningProfileSnapshotV1({
    sequence_index: input.sequence,
    source_student_turn_id: `e2a37_student_turn_${input.sequence}`,
    concept_family: "reliability_validity",
    conceptual_understanding: state,
    misconception_status: state === "sound"
      ? "resolved_for_current_anchor"
      : state === "partial"
        ? "uncertain"
        : "persists",
    knowledge_gap: state === "sound"
      ? "No essential reliability-validity link remains for this anchor."
      : state === "partial"
        ? "Explain how stable scores can still represent the wrong construct."
        : "Separate consistency evidence from intended-interpretation evidence.",
    reasoning_quality: state,
    anchor_interpretation: state === "sound"
      ? {
          application: "explicit",
          stance: "rejects_distractor",
          consistency: "consistent_with_conceptual_reasoning"
        }
      : state === "partial"
        ? {
            application: "explicit",
            stance: "ambiguous",
            consistency: "unresolved"
          }
        : {
            application: "explicit",
            stance: "endorses_distractor",
            consistency: "consistent_with_conceptual_reasoning"
          },
    unresolved_contradictions: [],
    missing_links: state === "sound"
      ? []
      : state === "partial"
        ? ["consistent_wrong_construct_mechanism"]
        : [
            "validity_interpretation_boundary",
            "consistent_wrong_construct_mechanism"
          ],
    transfer_readiness: state === "sound",
    confidence_alignment: state === "sound"
      ? "aligned"
      : "not_assessable",
    self_correction_intent: input.selfCorrectionIntent ?? false,
    conceptual_evidence_update: update,
    profile_update_eligible: eligible,
    observable_evidence_present: update,
    independent_evidence_present: update,
    created_at: new Date(input.sequence * 1000).toISOString()
  });
}

function engagementProfile(input: {
  sequence: number;
  mode: "high" | "low" | "productive";
  prior?: EngagementProfileEvolutionV1 | null;
}) {
  const high = input.mode === "high" || input.mode === "productive";
  return evolveEngagementProfileV1({
    prior: input.prior ?? null,
    observation: createEngagementProfileSnapshotV1({
      sequence_index: input.sequence,
      source_student_turn_id: `e2a37_student_turn_${input.sequence}`,
      participation: high ? "active" : "minimal",
      response_quality_trend: input.mode === "productive"
        ? "improving"
        : input.mode === "high"
          ? "stable"
          : "declining",
      effort: high
        ? "sustained_observed_effort"
        : "limited_observed_effort",
      persistence: high ? "sustained" : "limited",
      help_seeking: high ? "conceptual" : "none",
      frustration: input.mode === "low" ? "possible" : "not_observed",
      disengagement: input.mode === "low" ? "possible" : "not_observed",
      responsiveness_to_intervention: input.mode === "productive"
        ? "productive_response"
        : input.mode === "high"
          ? "partial_response"
          : "no_observable_change",
      strategy_uptake: input.mode === "productive"
        ? "clear"
        : input.mode === "high"
          ? "partial"
          : "not_observed",
      evidence_basis: [
        input.mode === "low"
          ? "Minimal response after a targeted prompt."
          : "Substantive response to a targeted prompt."
      ],
      created_at: new Date(input.sequence * 1000).toISOString()
    })
  });
}

function completedIntervention(input: {
  prior: LongitudinalInterventionRecordV1[];
  outcome:
    | "misconception_persists"
    | "partial_improvement"
    | "no_new_evidence";
  effective: boolean;
}) {
  const selected = selectLongitudinalInterventionV1({
    concept_family: "reliability_validity",
    targeted_gap: "reliability-validity conceptual boundary",
    evidence_sought: [
      "distinguish stability from interpretation evidence"
    ],
    prior_interventions: input.prior
  });
  return {
    ...selected,
    student_response_evidence_summary: input.effective
      ? "The response narrowed the remaining conceptual gap."
      : "The response did not add evidence for the targeted gap.",
    observed_outcome: input.outcome,
    changed_understanding: input.effective,
    effective_for_target_gap: input.effective
  } satisfies LongitudinalInterventionRecordV1;
}

function stoppingDecision(input: {
  learning: LearningProfileEvolutionV1;
  engagement: EngagementProfileEvolutionV1;
  memory?: LongitudinalInterventionRecordV1[];
  budgetExhausted?: boolean;
  newEvidence?: boolean;
  gapNarrowing?: boolean;
  strategyUptake?: boolean;
  expectedBenefit?: "low" | "uncertain" | "high";
  unresolvedBarrier?: boolean;
}) {
  return decideAdaptiveStoppingV1({
    learning_profile: input.learning,
    engagement_profile: input.engagement,
    intervention_memory: input.memory ?? [],
    session_budget_exhausted: input.budgetExhausted ?? false,
    new_evidence_observed: input.newEvidence ?? false,
    knowledge_gap_narrowing: input.gapNarrowing ?? false,
    strategy_uptake_observed: input.strategyUptake ?? false,
    expected_benefit: input.expectedBenefit ?? "uncertain",
    unresolved_conceptual_barrier: input.unresolvedBarrier ?? true
  });
}

const EXTRA_STUDENT_FACING_BLOCKED_PATTERNS = [
  /\b(?:internal|learning)\s+profiles?\b/iu,
  /\b(?:persistent\s+)?misconceptions?(?:\s+labels?)?\b/iu,
  /\bengagement\s+(?:scores?|profiles?|states?)\b/iu,
  /\bstopping\s+(?:rules?|polic(?:y|ies)|decisions?|criterion|criteria)\b/iu,
  /\b(?:session|turn|token)\s+budgets?\b/iu,
  /\b(?:ai|system)\s+(?:limitations?|cannot help|can't help)\b/iu,
  /\bescalation\s+(?:rules?|polic(?:y|ies)|criterion|criteria)\b/iu
] as const;

function validateStudentMessage(message: string) {
  const base = validateStudentFacingCommunicationV1(message);
  const extraIssueCodes = EXTRA_STUDENT_FACING_BLOCKED_PATTERNS
    .flatMap((pattern, index) =>
      pattern.test(message) ? [`e2a37_internal_leak_${index + 1}`] : []
    );
  return {
    validator_version:
      E2A37_STUDENT_COMMUNICATION_BOUNDARY_VERSION,
    base_validation: base,
    issue_codes: [...base.issue_codes, ...extraIssueCodes],
    passed: base.passed && extraIssueCodes.length === 0
  };
}

function assertStudentMessage(message: string) {
  const validation = validateStudentMessage(message);
  if (!validation.passed) {
    throw new Error(
      `e2a37_student_facing_communication_rejected:${validation.issue_codes.join("|")}`
    );
  }
  return {
    student_facing_message: message,
    validation,
    internal_decision_exposed: false
  };
}

function handoffMessage() {
  return assertStudentMessage(
    "We have explored this idea from several angles. Reliable scores show consistency, but validity still needs evidence for the intended interpretation. A useful next step is to discuss with your instructor what validity evidence would fit this assessment."
  );
}

function evaluateHandoffAppropriateness(input: {
  decision: AdaptiveStoppingDecisionV1;
  meaningfulSupportOccurred: boolean;
  learningGainStillPlausible: boolean;
  fixedTurnCountOnly: boolean;
  handoffRequested: boolean;
}) {
  const decision = AdaptiveStoppingDecisionV1Schema.parse(input.decision);
  const policyEligible =
    decision.internal_decision ===
      "bounded_stop_instructor_support" &&
    decision.instructor_support_recommended &&
    input.meaningfulSupportOccurred &&
    !input.learningGainStillPlausible &&
    !input.fixedTurnCountOnly;
  const premature = input.handoffRequested && !policyEligible;
  return {
    boundary_version: E2A37_HANDOFF_BOUNDARY_VERSION,
    policy_eligible: policyEligible,
    handoff_requested: input.handoffRequested,
    premature_handoff: premature,
    hard_failure_required: premature,
    passed:
      input.handoffRequested ? policyEligible : !policyEligible
  };
}

function assertHandoffAllowed(input: Parameters<
  typeof evaluateHandoffAppropriateness
>[0]) {
  const result = evaluateHandoffAppropriateness(input);
  if (!result.passed) {
    throw new Error("e2a37_premature_instructor_handoff");
  }
  return result;
}

function suite(name: string, cases: Array<{
  case_id: string;
  passed: boolean;
  [key: string]: unknown;
}>) {
  return {
    suite_version: `e2a37-${name}-regressions-v1`,
    case_count: cases.length,
    cases,
    passed: cases.every((entry) => entry.passed)
  };
}

function runDeterministicRegressions(
  trajectory: TrajectoryEnvelopeContract
) {
  const misconception = evolveLearningProfileV1({
    prior: null,
    observation: learningSnapshot({
      sequence: 1,
      state: "misconception"
    })
  });
  const partial = evolveLearningProfileV1({
    prior: misconception,
    observation: learningSnapshot({
      sequence: 2,
      state: "partial"
    })
  });
  const sound = evolveLearningProfileV1({
    prior: partial,
    observation: learningSnapshot({
      sequence: 3,
      state: "sound"
    })
  });
  const highEngagement = engagementProfile({
    sequence: 1,
    mode: "high"
  });
  const productiveEngagement = engagementProfile({
    sequence: 2,
    mode: "productive",
    prior: highEngagement
  });
  const lowEngagement = engagementProfile({
    sequence: 1,
    mode: "low"
  });
  const firstIneffective = completedIntervention({
    prior: [],
    outcome: "misconception_persists",
    effective: false
  });
  const secondIneffective = completedIntervention({
    prior: [firstIneffective],
    outcome: "misconception_persists",
    effective: false
  });

  const caseAInitial = stoppingDecision({
    learning: misconception,
    engagement: highEngagement,
    expectedBenefit: "high"
  });
  const caseAPartial = stoppingDecision({
    learning: partial,
    engagement: productiveEngagement,
    memory: [firstIneffective],
    newEvidence: true,
    gapNarrowing: true,
    strategyUptake: true,
    expectedBenefit: "high"
  });
  const caseASound = stoppingDecision({
    learning: sound,
    engagement: productiveEngagement,
    memory: [firstIneffective]
  });
  const caseBContinue = stoppingDecision({
    learning: misconception,
    engagement: highEngagement,
    memory: [firstIneffective, secondIneffective],
    newEvidence: true,
    strategyUptake: true,
    expectedBenefit: "high"
  });
  const caseBBounded = stoppingDecision({
    learning: misconception,
    engagement: highEngagement,
    memory: [firstIneffective, secondIneffective],
    budgetExhausted: true,
    expectedBenefit: "low"
  });
  const caseCBounded = stoppingDecision({
    learning: misconception,
    engagement: lowEngagement,
    memory: [firstIneffective],
    budgetExhausted: true,
    expectedBenefit: "low"
  });
  const earlySound = evolveLearningProfileV1({
    prior: null,
    observation: learningSnapshot({ sequence: 1, state: "sound" })
  });
  const caseDEarlySound = stoppingDecision({
    learning: earlySound,
    engagement: highEngagement
  });
  const regressed = evolveLearningProfileV1({
    prior: sound,
    observation: learningSnapshot({
      sequence: 4,
      state: "misconception"
    })
  });
  const caseERegression = stoppingDecision({
    learning: regressed,
    engagement: productiveEngagement,
    expectedBenefit: "high"
  });

  const intentEnvelope = resolveSelfCorrectionIntentEnvelopeV2({
    contract: buildSelfCorrectionIntentEnvelopeContractV2(),
    observation: {
      visible_message: "I think I understand now.",
      simulator_metadata: {
        rendered_intent: "unsupported_understanding_claim",
        expressed_evidence_level: "none",
        claims_understanding: true
      },
      conceptual_evidence: {
        status: "no_conceptual_update",
        source: "deterministic_fixture",
        observable_evidence_present: false,
        independent_application_present: false,
        contradiction_present: false
      }
    }
  });
  const unsupportedObservation = learningSnapshot({
    sequence: 2,
    state: "partial",
    conceptualUpdate: false,
    eligible: false
  });
  const unsupportedEvolution = evolveLearningProfileV1({
    prior: misconception,
    observation: unsupportedObservation
  });
  const caseFDecision = stoppingDecision({
    learning: unsupportedEvolution,
    engagement: highEngagement,
    expectedBenefit: "high"
  });
  const evidenceRequest = assertStudentMessage(
    "Explain what reliable scores show and what other evidence would be needed before calling the interpretation valid."
  );

  const profileCases = suite("profile-evolution", [
    {
      case_id: "A_profile_reaches_sound",
      passed:
        sound.current_profile.conceptual_understanding === "sound" &&
        sound.current_profile.transfer_readiness
    },
    {
      case_id: "E_regression_reopens_stale_sound",
      passed:
        regressed.current_profile.conceptual_understanding ===
          "misconception" &&
        regressed.misconception_reopened_count === 1
    },
    {
      case_id: "F_unsupported_claim_preserves_profile",
      passed:
        unsupportedEvolution.current_profile_snapshot_id ===
          misconception.current_profile_snapshot_id &&
        !intentEnvelope.conceptual_evidence_update
    }
  ]);

  const stoppingCases = suite("stopping-policy", [
    {
      case_id: "early_misconception_continues",
      decision: caseAInitial,
      passed: caseAInitial.internal_decision === "continue_dialogue"
    },
    {
      case_id: "productive_partial_continues",
      decision: caseAPartial,
      passed: caseAPartial.internal_decision === "continue_dialogue"
    },
    {
      case_id: "sound_stops_immediately",
      decision: caseASound,
      passed:
        caseASound.internal_decision === "stop_formative_dialogue" &&
        caseASound.revision_ready &&
        !caseASound.tutor_dispatch_allowed
    },
    {
      case_id: "high_engagement_persistent_barrier_continues",
      decision: caseBContinue,
      passed: caseBContinue.internal_decision === "continue_dialogue"
    },
    {
      case_id: "bounded_high_engagement_handoff",
      decision: caseBBounded,
      passed:
        caseBBounded.internal_decision ===
          "bounded_stop_instructor_support"
    },
    {
      case_id: "bounded_low_responsiveness_handoff",
      decision: caseCBounded,
      passed:
        caseCBounded.internal_decision ===
          "bounded_stop_instructor_support"
    },
    {
      case_id: "early_sound_has_no_unnecessary_turn",
      decision: caseDEarlySound,
      passed:
        caseDEarlySound.revision_ready &&
        !caseDEarlySound.tutor_dispatch_allowed
    },
    {
      case_id: "regression_reopens_dialogue",
      decision: caseERegression,
      passed:
        caseERegression.internal_decision === "continue_dialogue" &&
        !caseERegression.revision_ready
    },
    {
      case_id: "unsupported_understanding_requests_evidence",
      decision: caseFDecision,
      student_message: evidenceRequest,
      passed:
        !intentEnvelope.accepted_by_intent_envelope &&
        caseFDecision.internal_decision === "continue_dialogue" &&
        evidenceRequest.validation.passed
    }
  ]);

  const strategyChanged =
    firstIneffective.strategy !== secondIneffective.strategy;
  const interventionCases = suite("intervention-memory", [
    {
      case_id: "ineffective_strategy_is_not_repeated",
      first_strategy: firstIneffective.strategy,
      second_strategy: secondIneffective.strategy,
      passed: strategyChanged
    },
    {
      case_id: "intervention_history_preserves_outcomes",
      passed:
        firstIneffective.observed_outcome ===
          "misconception_persists" &&
        secondIneffective.sequence_index === 2
    }
  ]);

  const escalationB = assertHandoffAllowed({
    decision: caseBBounded,
    meaningfulSupportOccurred: true,
    learningGainStillPlausible: false,
    fixedTurnCountOnly: false,
    handoffRequested: true
  });
  const escalationC = assertHandoffAllowed({
    decision: caseCBounded,
    meaningfulSupportOccurred: true,
    learningGainStillPlausible: false,
    fixedTurnCountOnly: false,
    handoffRequested: true
  });
  let prematureHardFailure = false;
  try {
    assertHandoffAllowed({
      decision: caseBContinue,
      meaningfulSupportOccurred: true,
      learningGainStillPlausible: true,
      fixedTurnCountOnly: false,
      handoffRequested: true
    });
  } catch (error) {
    prematureHardFailure =
      error instanceof Error &&
      error.message === "e2a37_premature_instructor_handoff";
  }
  const escalationCases = suite("instructor-escalation", [
    {
      case_id: "high_engagement_handoff_after_bounded_support",
      escalation: escalationB,
      passed:
        escalationB.passed &&
        evaluateInstructorEscalationV1(caseBBounded)
          .recommend_instructor_support
    },
    {
      case_id: "low_responsiveness_handoff_after_bounded_support",
      escalation: escalationC,
      passed: escalationC.passed
    },
    {
      case_id: "premature_handoff_hard_fails",
      passed: prematureHardFailure
    },
    {
      case_id: "fixed_turn_count_alone_cannot_handoff",
      result: evaluateHandoffAppropriateness({
        decision: caseBBounded,
        meaningfulSupportOccurred: true,
        learningGainStillPlausible: false,
        fixedTurnCountOnly: true,
        handoffRequested: true
      }),
      passed: !evaluateHandoffAppropriateness({
        decision: caseBBounded,
        meaningfulSupportOccurred: true,
        learningGainStillPlausible: false,
        fixedTurnCountOnly: true,
        handoffRequested: true
      }).passed
    }
  ]);

  const validMessages = [
    translateStoppingDecisionForStudentV1(caseASound)
      .student_facing_message,
    "Let’s approach this differently. Could a test consistently measure something other than the intended construct?",
    handoffMessage().student_facing_message,
    evidenceRequest.student_facing_message
  ];
  const invalidMessages = [
    "You have a persistent misconception.",
    "Your engagement score is low.",
    "The stopping rule ended the session budget.",
    "The AI cannot help because the escalation criteria were met."
  ];
  const invalidResults = invalidMessages.map((message) =>
    validateStudentMessage(message)
  );
  let leakageHardFailure = false;
  try {
    assertStudentMessage(invalidMessages[3]);
  } catch (error) {
    leakageHardFailure =
      error instanceof Error &&
      error.message.startsWith(
        "e2a37_student_facing_communication_rejected:"
      );
  }
  const communicationCases = suite("student-facing-communication", [
    {
      case_id: "valid_student_messages_pass",
      messages: validMessages,
      passed: validMessages.every((message) =>
        validateStudentMessage(message).passed
      )
    },
    {
      case_id: "all_internal_categories_are_blocked",
      invalid_messages: invalidMessages,
      validations: invalidResults,
      passed: invalidResults.every((result) => !result.passed)
    },
    {
      case_id: "internal_escalation_leakage_hard_fails",
      passed: leakageHardFailure
    },
    {
      case_id: "handoff_is_supportive_and_actionable",
      message: handoffMessage(),
      passed:
        handoffMessage().validation.passed &&
        /\binstructor\b/iu.test(
          handoffMessage().student_facing_message
        ) &&
        /\breliable scores show consistency\b/iu.test(
          handoffMessage().student_facing_message
        )
    }
  ]);

  const selfCorrectionWithEvidence =
    resolveSelfCorrectionIntentEnvelopeV2({
      contract: buildSelfCorrectionIntentEnvelopeContractV2(),
      observation: {
        visible_message:
          "I was wrong because reliability does not prove validity.",
        simulator_metadata: {
          rendered_intent: "unsupported_understanding_claim",
          expressed_evidence_level: "partial",
          claims_understanding: false
        },
        conceptual_evidence: {
          status: "conceptual_update",
          source: "deterministic_fixture",
          observable_evidence_present: true,
          independent_application_present: true,
          contradiction_present: false
        }
      }
    });
  const selfCorrectionContradictory =
    resolveSelfCorrectionIntentEnvelopeV2({
      contract: buildSelfCorrectionIntentEnvelopeContractV2(),
      observation: {
        visible_message:
          "I was wrong, but D is still correct because the scores are stable.",
        simulator_metadata: {
          rendered_intent: "revision_evidence",
          expressed_evidence_level: "partial",
          claims_understanding: false
        },
        conceptual_evidence: {
          status: "contradictory_conceptual_update",
          source: "deterministic_fixture",
          observable_evidence_present: true,
          independent_application_present: true,
          contradiction_present: true
        }
      }
    });
  const selfCorrectedProfile = evolveLearningProfileV1({
    prior: misconception,
    observation: learningSnapshot({
      sequence: 5,
      state: "partial",
      selfCorrectionIntent: true,
      conceptualUpdate: true,
      eligible: true
    })
  });
  const selfCorrectionCases = suite("self-correction", [
    {
      case_id: "effective_self_correction_updates_evidence",
      resolution: selfCorrectionWithEvidence,
      updated_profile_snapshot_id:
        selfCorrectedProfile.current_profile_snapshot_id,
      passed:
        selfCorrectionWithEvidence.self_correction_intent &&
        selfCorrectionWithEvidence.conceptual_evidence_update &&
        selfCorrectionWithEvidence.profile_update_eligible &&
        selfCorrectedProfile.current_profile_snapshot_id !==
          misconception.current_profile_snapshot_id &&
        selfCorrectedProfile.current_profile.self_correction_intent
    },
    {
      case_id: "unsupported_understanding_does_not_update",
      resolution: intentEnvelope,
      passed:
        !intentEnvelope.conceptual_evidence_update &&
        !intentEnvelope.profile_update_eligible
    },
    {
      case_id: "contradictory_correction_keeps_barrier_open",
      resolution: selfCorrectionContradictory,
      passed:
        selfCorrectionContradictory.self_correction_intent &&
        selfCorrectionContradictory.misconception_remains
    }
  ]);

  const earlySoundTrajectory = evaluateTrajectoryEnvelope({
    turn_contract: trajectory.turns[0],
    evaluator_reasoning_quality: "sound",
    sound_gate_result: {
      gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
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
  const regressionTrajectory = evaluateTrajectoryEnvelope({
    turn_contract: trajectory.turns[4],
    evaluator_reasoning_quality: "misconception",
    sound_gate_result: {
      gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
      passed: false,
      failure_codes: ["active_anchor_endorsed"]
    },
    evidence_independently_supported: true,
    copied_wording_without_evidence: false,
    blocking_contradiction: true,
    prior_reasoning_quality: "sound",
    prior_sound_gate_passed: true,
    turn_budget_exhausted: false
  });
  const unsupportedTrajectory = evaluateTrajectoryEnvelope({
    turn_contract: trajectory.turns[2],
    evaluator_reasoning_quality: "insufficient",
    sound_gate_result: {
      gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
      passed: false,
      failure_codes: ["independent_evidence_missing"]
    },
    evidence_independently_supported: false,
    copied_wording_without_evidence: false,
    blocking_contradiction: false,
    prior_reasoning_quality: "misconception",
    prior_sound_gate_passed: false,
    turn_budget_exhausted: false
  });
  const trajectoryCases = suite("trajectory-envelope", [
    {
      case_id: "early_sound_overrides_trajectory",
      decision: earlySoundTrajectory,
      passed:
        earlySoundTrajectory.progression_decision ===
          "immediate_revision" &&
        earlySoundTrajectory.revision_required_immediately &&
        !earlySoundTrajectory.tutor_should_be_called
    },
    {
      case_id: "regression_after_sound_reopens_support",
      decision: regressionTrajectory,
      passed:
        regressionTrajectory.progression_decision ===
          "reopen_targeted_support" &&
        regressionTrajectory.tutor_should_be_called
    },
    {
      case_id: "unsupported_claim_requests_independent_evidence",
      decision: unsupportedTrajectory,
      passed:
        unsupportedTrajectory.progression_decision ===
          "request_independent_evidence"
    }
  ]);

  const personalizedPlans = [
    {
      student_case: "partial_productive",
      reasoning_quality: "partial",
      engagement: "productive_response",
      previous_interventions: [firstIneffective.strategy],
      remaining_gap: "consistent_wrong_construct_mechanism",
      message:
        "You have separated consistency from interpretation. Now explain how a test could measure the wrong construct consistently."
    },
    {
      student_case: "persistent_high_engagement",
      reasoning_quality: "misconception",
      engagement: "partial_response",
      previous_interventions: [
        firstIneffective.strategy,
        secondIneffective.strategy
      ],
      remaining_gap: "validity_interpretation_boundary",
      message:
        "Let’s use a different angle: imagine a test that gives stable scores but measures reading speed instead of measurement knowledge."
    },
    {
      student_case: "persistent_low_responsiveness",
      reasoning_quality: "misconception",
      engagement: "no_observable_change",
      previous_interventions: [firstIneffective.strategy],
      remaining_gap: "reliability_validity_conceptual_boundary",
      message: handoffMessage().student_facing_message
    }
  ];
  const personalizationCases = suite("personalization", [
    {
      case_id: "same_misconception_gets_evidence_specific_support",
      plans: personalizedPlans,
      passed:
        new Set(personalizedPlans.map((entry) => entry.message)).size ===
          personalizedPlans.length &&
        personalizedPlans.every((entry) =>
          entry.previous_interventions.length > 0 &&
          entry.remaining_gap.length > 0 &&
          validateStudentMessage(entry.message).passed
        ) &&
        new Set(personalizedPlans.map((entry) =>
          `${entry.reasoning_quality}:${entry.engagement}:${entry.remaining_gap}`
        )).size === personalizedPlans.length
    }
  ]);

  const metricsResults = {
    results_version: "e2a37-metrics-results-v1",
    metrics: [
      {
        metric_id: "dialogue_efficiency",
        passed:
          caseDEarlySound.revision_ready &&
          !caseDEarlySound.tutor_dispatch_allowed
      },
      {
        metric_id: "unnecessary_turn_detection",
        passed: !caseASound.tutor_dispatch_allowed
      },
      {
        metric_id: "missed_progression_detection",
        passed:
          caseASound.revision_ready &&
          regressed.misconception_reopened_count === 1
      },
      {
        metric_id: "intervention_adaptation",
        passed: strategyChanged
      },
      {
        metric_id: "stopping_appropriateness",
        passed: stoppingCases.passed
      },
      {
        metric_id: "escalation_appropriateness",
        passed: escalationCases.passed
      },
      {
        metric_id: "student_facing_communication_quality",
        passed: communicationCases.passed
      },
      {
        metric_id: "instructor_handoff_quality",
        passed: handoffMessage().validation.passed
      }
    ]
  };
  const allSuites = {
    profile_evolution: profileCases,
    stopping_policy: stoppingCases,
    instructor_escalation: escalationCases,
    student_facing_communication: communicationCases,
    intervention_memory: interventionCases,
    trajectory_envelope: trajectoryCases,
    self_correction: selfCorrectionCases,
    personalization: personalizationCases
  };
  const caseCount = Object.values(allSuites)
    .reduce((total, entry) => total + entry.case_count, 0);
  return {
    regression_version: "e2a37-deterministic-regressions-v1",
    suites: allSuites,
    total_case_count: caseCount,
    metrics_results: metricsResults,
    passed:
      Object.values(allSuites).every((entry) => entry.passed) &&
      metricsResults.metrics.every((entry) => entry.passed)
  };
}

function buildHeldOutDomain() {
  return {
    domain_contract_version: "e2a37-held-out-domain-v1",
    domain: "educational_measurement_assessment_literacy",
    scenario: {
      item_id: ITEM_ID,
      prompt: SCENARIO_PROMPT,
      active_distractor_option: OPTION_LABEL,
      active_distractor_claim: DISTRACTOR_CLAIM
    },
    goal:
      "Test continue, strategy-change, evidence-driven stop, and educationally appropriate instructor-handoff boundaries without creating an infinite tutoring loop.",
    profile_cases: ["A", "B", "C", "D", "E", "F"],
    student_facing_boundary:
      "Visible messages discuss the learning task and next step, never internal profile, engagement, budget, stopping, or escalation state."
  } as const;
}

function buildBudget() {
  return {
    budget_version: "e2a37-bounded-live-budget-v1",
    exactly_one_isolated_session: true,
    maximum_logical_generation_calls: 29,
    maximum_adapter_attempts: 87,
    maximum_adapter_attempts_per_logical_call: 3,
    maximum_transport_retries_per_logical_call: 2,
    maximum_input_tokens: 900_000,
    maximum_output_tokens: 70_000,
    maximum_total_tokens: 970_000,
    maximum_cost_usd_when_pricing_metadata_available: 25,
    provider_concurrency: 1,
    transport_retry_policy_version:
      PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    execution_authorized: false,
    live_execution_performed: false
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: "e2a37-artifact-contract-v1",
    expected_artifact_names: [...E2A37_ARTIFACT_NAMES],
    preparation_creates_live_artifacts: false,
    provider_outputs_created: false,
    artifacts_must_be_read_only: true,
    required_no_live_fields: {
      execution_authorized: false,
      live_execution_performed: false,
      provider_calls_made: 0,
      network_requests_made: 0
    }
  } as const;
}

function buildProtectedSourceIntegrity() {
  const files = Object.entries(PROTECTED_SOURCE_HASHES).map(
    ([relativePath, expectedSha]) => {
      const actualSha = fileSha256(relativePath);
      return {
        relative_path: relativePath,
        expected_sha256: expectedSha,
        actual_sha256: actualSha,
        unchanged: actualSha === expectedSha
      };
    }
  );
  return {
    integrity_version: "e2a37-protected-source-integrity-v1",
    files,
    evaluator_v5_unchanged: files.find((entry) =>
      entry.relative_path.endsWith(
        "production-turn-evidence-evaluator-v5.ts"
      )
    )?.unchanged === true,
    tutor_candidate_unchanged: files.find((entry) =>
      entry.relative_path.endsWith(
        "e2a24-autonomous-dialogue-candidate.ts"
      )
    )?.unchanged === true,
    self_correction_intent_envelope_unchanged: files.find((entry) =>
      entry.relative_path.endsWith(
        "self-correction-intent-envelope-v2.ts"
      )
    )?.unchanged === true,
    all_unchanged: files.every((entry) => entry.unchanged)
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a37-provider-call-guard-v1",
    execution_mode: "deterministic_protocol_freeze_no_live",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    provider_outputs_created: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed: networkRequestCount === 0
  };
}

function buildProtocol(input: {
  targetContract: TargetEvidenceContractV5;
  canonicalAnchor: ReturnType<typeof buildCanonicalAnchorContract>;
  anchorStance: ReturnType<typeof buildAnchorStanceContract>;
  selfCorrection:
    ReturnType<typeof buildSelfCorrectionIntegrationContract>;
  learningProfile:
    ReturnType<typeof buildLearningProfileEvolutionContractV1>;
  engagementProfile:
    ReturnType<typeof buildEngagementProfileEvolutionContractV1>;
  interventionMemory:
    ReturnType<typeof buildLongitudinalInterventionMemoryContractV1>;
  stoppingPolicy: ReturnType<typeof buildAdaptiveStoppingPolicyContractV1>;
  escalationPolicy:
    ReturnType<typeof buildInstructorEscalationPolicyContractV1>;
  handoffBoundary:
    ReturnType<typeof buildInstructorHandoffBoundaryContract>;
  communication: ReturnType<typeof buildStudentCommunicationContract>;
  trajectory: TrajectoryEnvelopeContract;
  trajectories: ReturnType<typeof buildHeldOutTrajectories>;
  metrics: ReturnType<typeof buildMetricsContract>;
  compiledEvaluatorRequest:
    ReturnType<typeof buildCompiledEvaluatorRequest>;
  deterministic: ReturnType<typeof runDeterministicRegressions>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
  candidateIntegrity: ReturnType<typeof evaluateE2A24Candidate>;
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>;
}) {
  const core = {
    protocol_version: E2A37_PROTOCOL_VERSION,
    preparation_version: E2A37_PREPARATION_VERSION,
    protocol_state: "frozen_for_separate_authorization_not_executable",
    domain: "educational_measurement_assessment_literacy",
    execution_authorized: false,
    live_execution_performed: false,
    provider_dispatch_path_present: false,
    candidate_configuration_hash:
      input.candidateIntegrity.candidate_configuration_hash,
    scenario: {
      item_id: ITEM_ID,
      concept_id: CONCEPT_ID,
      prompt: SCENARIO_PROMPT,
      active_anchor_id: CANONICAL_ANCHOR_ID,
      active_distractor_option: OPTION_LABEL,
      active_distractor_claim: DISTRACTOR_CLAIM
    },
    architecture: {
      application_controls_progression: true,
      stopping_and_handoff_are_internal_orchestration: true,
      provider_does_not_control_stopping_or_handoff: true,
      exact_turn_labels_required: false,
      sound_evidence_overrides_trajectory: true,
      latest_valid_evidence_updates_profile: true,
      regression_reopens_support: true,
      fixed_turn_count_alone_cannot_escalate: true,
      repeated_ineffective_intervention_prohibited: true,
      internal_state_student_visible: false
    },
    contract_versions: {
      target_evidence: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
      canonical_anchor: input.canonicalAnchor.contract_version,
      anchor_reference: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
      anchor_stance: ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
      anchor_scope: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
      evidence_preservation_mapper:
        TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
      turn_profile_mapper: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
      sound_gate: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
      pre_tutor_finalization:
        PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4,
      self_correction_intent:
        SELF_CORRECTION_INTENT_ENVELOPE_VERSION,
      self_correction_evidence:
        SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
      learning_profile: E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
      engagement_profile: E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
      intervention_memory: E2A36_INTERVENTION_MEMORY_VERSION,
      adaptive_stopping: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      instructor_escalation:
        E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
      instructor_handoff_boundary:
        E2A37_HANDOFF_BOUNDARY_VERSION,
      student_communication:
        E2A37_STUDENT_COMMUNICATION_BOUNDARY_VERSION,
      trajectory_envelope: TRAJECTORY_ENVELOPE_VERSION,
      metrics: E2A37_METRICS_VERSION
    },
    contract_hashes: {
      target_evidence: stableHash(input.targetContract),
      canonical_anchor: stableHash(input.canonicalAnchor),
      anchor_stance: stableHash(input.anchorStance),
      self_correction: stableHash(input.selfCorrection),
      learning_profile: stableHash(input.learningProfile),
      engagement_profile: stableHash(input.engagementProfile),
      intervention_memory: stableHash(input.interventionMemory),
      adaptive_stopping: stableHash(input.stoppingPolicy),
      instructor_escalation: stableHash(input.escalationPolicy),
      instructor_handoff_boundary: stableHash(input.handoffBoundary),
      student_communication: stableHash(input.communication),
      trajectory_envelope: stableHash(input.trajectory),
      held_out_trajectories: stableHash(input.trajectories),
      metrics: stableHash(input.metrics),
      compiled_evaluator_request: stableHash(
        input.compiledEvaluatorRequest
      )
    },
    evaluator_v5: {
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
      prompt_version:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
      prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
      repair_prompt_hash:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
      input_schema_version:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
      output_schema_version:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
      request_compiled: true
    },
    deterministic_gate_results: {
      deterministic_case_count: input.deterministic.total_case_count,
      all_regressions_passed: input.deterministic.passed,
      profile_evolution_passed:
        input.deterministic.suites.profile_evolution.passed,
      stopping_policy_passed:
        input.deterministic.suites.stopping_policy.passed,
      instructor_escalation_passed:
        input.deterministic.suites.instructor_escalation.passed,
      student_communication_passed:
        input.deterministic.suites.student_facing_communication.passed,
      intervention_memory_passed:
        input.deterministic.suites.intervention_memory.passed,
      trajectory_envelope_passed:
        input.deterministic.suites.trajectory_envelope.passed,
      self_correction_passed:
        input.deterministic.suites.self_correction.passed,
      personalization_passed:
        input.deterministic.suites.personalization.passed,
      protected_sources_unchanged:
        input.protectedIntegrity.all_unchanged,
      provider_calls_zero: true,
      network_requests_zero: true
    },
    budget: input.budget,
    artifact_contract_hash: stableHash(input.artifactContract)
  };
  return {
    ...core,
    protocol_hash: stableHash(core)
  };
}

function buildCompositeRuntimeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const identity = {
    identity_version: "e2a37-composite-runtime-identity-v1",
    preparation_parent_git_commit: currentGitCommit(),
    protocol_version: input.protocol.protocol_version,
    protocol_hash: input.protocol.protocol_hash,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA256,
    evaluator_v5_source_sha256:
      PROTECTED_SOURCE_HASHES[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ],
    tutor_candidate_source_sha256:
      PROTECTED_SOURCE_HASHES[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ],
    self_correction_intent_envelope_source_sha256:
      PROTECTED_SOURCE_HASHES[
        "src/lib/evaluation/formative/self-correction-intent-envelope-v2.ts"
      ],
    longitudinal_contracts_source_sha256:
      PROTECTED_SOURCE_HASHES[
        "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts"
      ],
    protocol_source_sha256: fileSha256(
      "src/lib/evaluation/formative/e2a37-instructor-handoff-protocol.ts"
    ),
    preparation_harness_source_sha256: fileSha256(
      "prisma/formative-evaluation-e2a37.ts"
    ),
    protected_source_set_hash: stableHash(PROTECTED_SOURCE_HASHES),
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract)
  };
  return {
    ...identity,
    composite_runtime_identity_hash: stableHash(identity)
  };
}

function validateArtifactDirectory(runDirectory: string) {
  const expectedBeforeValidation = E2A37_ARTIFACT_NAMES.filter(
    (name) => name !== "artifact-validation.json"
  );
  const actual = readdirSync(runDirectory).sort();
  const missing = expectedBeforeValidation.filter(
    (name) => !actual.includes(name)
  );
  const unexpected = actual.filter(
    (name) => !expectedBeforeValidation.includes(
      name as typeof expectedBeforeValidation[number]
    )
  );
  return {
    validation_version: "e2a37-artifact-validation-v1",
    expected_artifact_count: E2A37_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    artifacts: actual.map((name) => ({
      name,
      sha256: fileSha256(path.join(runDirectory, name)),
      bytes: statSync(path.join(runDirectory, name)).size
    })),
    passed:
      missing.length === 0 &&
      unexpected.length === 0 &&
      actual.length === E2A37_ARTIFACT_NAMES.length - 1
  };
}

export function buildE2A37PreparationArtifacts(
  networkRequestCount = 0
) {
  const aliases = buildAliasContract();
  const targetContract = buildTargetEvidenceContract(aliases);
  const canonicalAnchor = buildCanonicalAnchorContract(aliases);
  const anchorStance = buildAnchorStanceContract();
  const selfCorrection = buildSelfCorrectionIntegrationContract();
  const learningProfile = buildLearningProfileEvolutionContractV1();
  const engagementProfile = buildEngagementProfileEvolutionContractV1();
  const interventionMemory =
    buildLongitudinalInterventionMemoryContractV1();
  const stoppingPolicy = buildAdaptiveStoppingPolicyContractV1();
  const escalationPolicy = buildInstructorEscalationPolicyContractV1();
  const handoffBoundary = buildInstructorHandoffBoundaryContract();
  const communication = buildStudentCommunicationContract();
  const trajectory = buildTrajectoryEnvelope();
  const trajectories = buildHeldOutTrajectories();
  const compiledEvaluatorRequest =
    buildCompiledEvaluatorRequest(targetContract);
  const metrics = buildMetricsContract();
  const deterministic = runDeterministicRegressions(trajectory);
  const heldOutDomain = buildHeldOutDomain();
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const candidateIntegrity = evaluateE2A24Candidate();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);

  assert(
    candidateIntegrity.candidate_configuration_hash ===
      CANDIDATE_CONFIGURATION_HASH,
    "e2a37_candidate_configuration_hash_mismatch"
  );
  assert(
    candidateIntegrity.candidate_file_sha256 === CANDIDATE_FILE_SHA256,
    "e2a37_candidate_file_hash_mismatch"
  );
  assert(
    protectedIntegrity.all_unchanged,
    "e2a37_protected_source_integrity_failed"
  );
  assert(
    deterministic.passed,
    "e2a37_deterministic_regressions_failed"
  );
  assert(
    providerCallGuard.passed,
    "e2a37_provider_call_guard_failed"
  );

  const protocol = buildProtocol({
    targetContract,
    canonicalAnchor,
    anchorStance,
    selfCorrection,
    learningProfile,
    engagementProfile,
    interventionMemory,
    stoppingPolicy,
    escalationPolicy,
    handoffBoundary,
    communication,
    trajectory,
    trajectories,
    metrics,
    compiledEvaluatorRequest,
    deterministic,
    budget,
    artifactContract,
    candidateIntegrity,
    protectedIntegrity
  });
  const compositeRuntimeIdentity = buildCompositeRuntimeIdentity({
    protocol,
    budget,
    artifactContract
  });
  const summary = {
    summary_version: "e2a37-protocol-freeze-summary-v1",
    status: "e2a37_protocol_frozen_not_executed",
    protocol_version: protocol.protocol_version,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    candidate_configuration_hash:
      candidateIntegrity.candidate_configuration_hash,
    deterministic_case_count: deterministic.total_case_count,
    deterministic_regressions_passed: deterministic.passed,
    protected_components_unchanged: protectedIntegrity.all_unchanged,
    execution_authorized: false,
    live_execution_performed: false,
    candidate_approved: false,
    candidate_activated: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed:
      deterministic.passed &&
      protectedIntegrity.all_unchanged &&
      providerCallGuard.passed
  };
  const manifest = {
    manifest_version: "e2a37-freeze-manifest-v1",
    created_at: new Date().toISOString(),
    artifact_names: [...E2A37_ARTIFACT_NAMES],
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    execution_authorized: false,
    live_execution_performed: false
  };
  return {
    manifest,
    protocol,
    heldOutDomain,
    trajectories,
    targetContract,
    canonicalAnchor,
    anchorStance,
    selfCorrection,
    compiledEvaluatorRequest,
    learningProfile,
    engagementProfile,
    interventionMemory,
    stoppingPolicy,
    escalationPolicy,
    handoffBoundary,
    communication,
    trajectory,
    deterministic,
    metrics,
    metricsResults: deterministic.metrics_results,
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
  artifacts: ReturnType<typeof buildE2A37PreparationArtifacts>
) {
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256": `${artifacts.protocol.protocol_hash}\n`,
    "held-out-domain.json": artifacts.heldOutDomain,
    "held-out-trajectories.json": artifacts.trajectories,
    "target-evidence-contract.json": artifacts.targetContract,
    "canonical-anchor-contract.json": artifacts.canonicalAnchor,
    "anchor-stance-contract.json": artifacts.anchorStance,
    "self-correction-integration-contract.json":
      artifacts.selfCorrection,
    "compiled-evaluator-v5-request.json":
      artifacts.compiledEvaluatorRequest,
    "learning-profile-evolution-contract.json":
      artifacts.learningProfile,
    "engagement-profile-evolution-contract.json":
      artifacts.engagementProfile,
    "intervention-memory-contract.json": artifacts.interventionMemory,
    "adaptive-stopping-policy-contract.json": artifacts.stoppingPolicy,
    "instructor-escalation-policy-contract.json":
      artifacts.escalationPolicy,
    "instructor-handoff-boundary-contract.json":
      artifacts.handoffBoundary,
    "student-facing-communication-contract.json":
      artifacts.communication,
    "trajectory-envelope-contract.json": artifacts.trajectory,
    "deterministic-regressions.json": artifacts.deterministic,
    "profile-evolution-regressions.json":
      artifacts.deterministic.suites.profile_evolution,
    "stopping-policy-regressions.json":
      artifacts.deterministic.suites.stopping_policy,
    "instructor-escalation-regressions.json":
      artifacts.deterministic.suites.instructor_escalation,
    "student-facing-communication-regressions.json":
      artifacts.deterministic.suites.student_facing_communication,
    "intervention-memory-regressions.json":
      artifacts.deterministic.suites.intervention_memory,
    "trajectory-envelope-regressions.json":
      artifacts.deterministic.suites.trajectory_envelope,
    "self-correction-regressions.json":
      artifacts.deterministic.suites.self_correction,
    "personalization-regressions.json":
      artifacts.deterministic.suites.personalization,
    "metrics-contract.json": artifacts.metrics,
    "metrics-results.json": artifacts.metricsResults,
    "budget.json": artifacts.budget,
    "artifact-contract.json": artifacts.artifactContract,
    "candidate-integrity.json": {
      candidate_configuration_hash:
        artifacts.candidateIntegrity.candidate_configuration_hash,
      candidate_file_sha256:
        artifacts.candidateIntegrity.candidate_file_sha256,
      changed_unrelated_roles:
        artifacts.candidateIntegrity.changed_unrelated_roles,
      candidate_approved: false,
      candidate_activated: false
    },
    "protected-source-integrity.json": artifacts.protectedIntegrity,
    "composite-runtime-identity.json":
      artifacts.compositeRuntimeIdentity,
    "provider-call-guard.json": artifacts.providerCallGuard,
    "summary.json": artifacts.summary
  } as const;
}

export function writeE2A37PreparationArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a37_artifact_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A37PreparationArtifacts(
    input.networkRequestCount ?? 0
  );
  for (const [name, value] of Object.entries(artifactValues(artifacts))) {
    const output = path.join(input.runDirectory, name);
    if (typeof value === "string") {
      writeFileSync(output, value, "utf8");
    } else {
      writeJson(output, value);
    }
  }
  const artifactValidation = validateArtifactDirectory(
    input.runDirectory
  );
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  const finalFiles = readdirSync(input.runDirectory).sort();
  const complete =
    finalFiles.length === E2A37_ARTIFACT_NAMES.length &&
    E2A37_ARTIFACT_NAMES.every((name) => finalFiles.includes(name));
  assert(artifacts.summary.passed, "e2a37_summary_failed");
  assert(
    artifactValidation.passed && complete,
    "e2a37_artifact_validation_failed"
  );
  for (const name of finalFiles) {
    chmodSync(path.join(input.runDirectory, name), 0o444);
  }
  chmodSync(input.runDirectory, 0o555);
  return {
    ...artifacts,
    artifactValidation: {
      ...artifactValidation,
      final_artifact_count: finalFiles.length,
      complete
    }
  };
}

export function makeE2A37PreparationRunId() {
  const timestamp = new Date().toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/u, "Z");
  return `e2a37_${timestamp}_${randomBytes(4).toString("hex")}`;
}

export function latestE2A37PreparationRunDirectory() {
  assert(
    existsSync(E2A37_ARTIFACT_ROOT),
    "e2a37_artifact_root_missing"
  );
  const latest = readdirSync(E2A37_ARTIFACT_ROOT)
    .map((name) => path.join(E2A37_ARTIFACT_ROOT, name))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
    .at(-1);
  assert(latest, "e2a37_artifact_run_missing");
  return latest;
}

export function inspectE2A37PreparationRun(runDirectory: string) {
  return {
    run_directory: runDirectory,
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
