import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
  E2A36_LONGITUDINAL_METRICS_VERSION,
  E2A36_STUDENT_FACING_COMMUNICATION_VERSION,
  buildAdaptiveStoppingPolicyContractV1,
  buildE2A36LongitudinalMetricsContract,
  buildEngagementProfileEvolutionContractV1,
  buildInstructorEscalationPolicyContractV1,
  buildLearningProfileEvolutionContractV1,
  buildLongitudinalInterventionMemoryContractV1,
  buildStudentFacingCommunicationContractV1,
  runAllE2A36DeterministicSuites
} from "./e2a36-longitudinal-contracts";
import {
  SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
  buildSelfCorrectionEvidenceContractV1
} from "./self-correction-evidence-v1";
import {
  TRAJECTORY_ENVELOPE_VERSION,
  TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
  TrajectoryEnvelopeContractSchema,
  buildDefaultTrajectoryProgressionConsequences,
  type TrajectoryEnvelopeContract
} from "./trajectory-envelope-v1";

export const E2A36_PREPARATION_VERSION =
  "e2a36-measurement-longitudinal-protocol-freeze-preparation-v1" as const;
export const E2A36_PROTOCOL_VERSION =
  "e2a36-measurement-reasoning-longitudinal-canary-v1" as const;
export const E2A36_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a36-measurement-reasoning-longitudinal-protocol-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const CANDIDATE_FILE_SHA256 =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2";
const ITEM_ID = "measurement_reliability_validity_longitudinal_item_1";
const CONCEPT_ID = "measurement_reasoning_longitudinal";
const OPTION_LABEL = "D";
const CANONICAL_ANCHOR_ID = `${ITEM_ID}:option:${OPTION_LABEL}`;
const SCENARIO_PROMPT =
  "A test produces highly consistent scores across repeated administrations. A researcher concludes that the test must be valid for deciding who understands measurement theory. Do you agree? Explain.";
const DISTRACTOR_CLAIM =
  "The test is valid because consistent scores prove that it measures the intended construct accurately.";

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
  "src/lib/services/student-assessment/anchor-conclusion-consistency.ts":
    "d7c5c368b3e93f2f5b6f2932184491693d98f502cccec2ad5778f331b2caaf83",
  "src/lib/evaluation/formative/trajectory-envelope-v1.ts":
    "95319bb52d087601680e53ce2db9e357764a2b5f5574e125f3b88804c49d4e70",
  "src/lib/evaluation/formative/self-correction-evidence-v1.ts":
    "99719a8d8d4a77848acd4cfd8d64c8e4ea02337fa3aa467eab6cc7cb1a9c6bff",
  "src/lib/services/student-assessment/autonomous-formative-dialogue.ts":
    "93d1793496ff1ed989b581586b3f639f554a8b79a65f337907a89593a4dda766",
  "src/lib/services/student-assessment/pre-tutor-profile-finalization-v4.ts":
    "4a97f5a1d20fb7a664c3f26e3d1aef17fc17c0517e33b7811df8582fd3554751"
} as const;

export const E2A36_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "held-out-domain.json",
  "target-evidence-contract.json",
  "canonical-anchor-contract.json",
  "anchor-stance-contract.json",
  "self-correction-evidence-integration-contract.json",
  "compiled-evaluator-v5-request.json",
  "trajectory-envelope-contract.json",
  "intervention-memory-contract.json",
  "learning-profile-evolution-contract.json",
  "engagement-profile-evolution-contract.json",
  "adaptive-stopping-policy-contract.json",
  "instructor-escalation-policy-contract.json",
  "student-facing-communication-contract.json",
  "longitudinal-metrics-contract.json",
  "deterministic-regressions.json",
  "learning-profile-regressions.json",
  "engagement-profile-regressions.json",
  "stopping-policy-regressions.json",
  "instructor-escalation-regressions.json",
  "student-facing-communication-regressions.json",
  "intervention-memory-regressions.json",
  "trajectory-envelope-regressions.json",
  "self-correction-regressions.json",
  "personalization-regressions.json",
  "budget.json",
  "artifact-contract.json",
  "candidate-integrity.json",
  "protected-source-integrity.json",
  "composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json",
  "artifact-validation.json"
] as const;

const E2A36CanonicalAnchorContractSchema = z.object({
  contract_version: z.literal(
    "e2a36-measurement-canonical-anchor-v1"
  ),
  canonical_anchor_id: z.literal(CANONICAL_ANCHOR_ID),
  item_id: z.literal(ITEM_ID),
  option_label: z.literal(OPTION_LABEL),
  distractor_text: z.literal(DISTRACTOR_CLAIM),
  required_anchor_application: z.literal("explicit"),
  required_anchor_stance: z.literal("rejects_distractor"),
  mechanism_criteria: z.array(z.string().min(1)).min(2),
  sound_criteria: z.array(z.string().min(1)).min(5),
  contradiction_criteria: z.array(z.string().min(1)).min(2),
  active_anchor_alias_contract: ActiveAnchorAliasContractSchema
}).strict();

const E2A36AnchorStanceContractSchema = z.object({
  contract_version: z.literal(
    "e2a36-measurement-anchor-stance-v1"
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
  uncertainty_examples: z.array(z.string().min(1)).min(2),
  self_correction_examples: z.array(z.string().min(1)).min(2)
}).strict();

const E2A36SelfCorrectionIntegrationContractSchema = z.object({
  contract_version: z.literal(
    "e2a36-self-correction-evidence-integration-v1"
  ),
  evidence_contract_version:
    z.literal(SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION),
  evidence_contract_hash: z.string().length(64),
  separation: z.object({
    self_correction_intent: z.literal("independent_signal"),
    conceptual_evidence_update:
      z.literal("requires_observable_independent_evidence"),
    profile_update_eligibility:
      z.literal("derived_from_conceptual_evidence"),
    correction_language_alone_is_not_understanding: z.literal(true)
  }).strict(),
  examples: z.object({
    intent_only: z.string().min(1),
    evidence_bearing: z.string().min(1),
    misconception_preserved: z.string().min(1)
  }).strict()
}).strict();

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
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildAliasContract(): ActiveAnchorAliasContract {
  return ActiveAnchorAliasContractSchema.parse(buildActiveAnchorAliasContract({
    active_anchor_id: CANONICAL_ANCHOR_ID,
    option_label: OPTION_LABEL,
    option_text: DISTRACTOR_CLAIM,
    accepted_paraphrases: [
      "consistent scores prove validity",
      "reliability automatically means validity",
      "a reliable test must measure the intended construct",
      "the consistency-proves-validity claim",
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
      "Reliability concerns score consistency or precision under specified conditions.",
      "Validity concerns the evidence and argument supporting an intended score interpretation or use.",
      "Consistent scores can still reflect the wrong construct or support an inappropriate interpretation."
    ],
    required_mechanisms: [
      "Distinguish consistency evidence from interpretation evidence.",
      "Explain how a consistently measured wrong construct can be reliable without supporting the intended interpretation.",
      "Apply that boundary directly to the active distractor."
    ],
    acceptable_equivalent_explanations: [
      "A test can consistently measure something other than the intended construct.",
      "High reliability is useful but is not sufficient evidence for validity.",
      "Validity requires evidence for the proposed interpretation and use, not consistency alone."
    ],
    required_anchor_application:
      `Apply the reliability-validity distinction directly to ${ITEM_ID} option ${OPTION_LABEL} and reject its claim.`,
    prohibited_contradictions: [
      DISTRACTOR_CLAIM,
      "Reliability proves validity.",
      "The test may measure the wrong construct consistently, but option D is still correct."
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
      "This synthetic protocol tests longitudinal measurement reasoning and does not establish broad measurement-theory mastery.",
      "Process and engagement evidence qualify orchestration decisions but do not determine conceptual correctness."
    ],
    criteria: [
      {
        criterion_id: "reliability_definition",
        criterion_kind: "conceptual_relationship",
        description:
          "The response identifies reliability as consistency or precision evidence under specified conditions.",
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
          "The response distinguishes validity as evidence for an intended interpretation or use.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "validity concerns the intended interpretation",
          "validity requires more than reliability evidence"
        ]
      },
      {
        criterion_id: "consistent_wrong_construct_mechanism",
        criterion_kind: "required_mechanism",
        description:
          "The response explains that consistent scores can still measure the wrong construct.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "consistently measure the wrong construct",
          "stable scores do not establish what is being measured"
        ]
      },
      {
        criterion_id: "active_anchor_application",
        criterion_kind: "anchor_application",
        description:
          `The response explicitly rejects option ${OPTION_LABEL} or an accepted alias using the target mechanism.`,
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          `option ${OPTION_LABEL} is incorrect`,
          "the consistency-proves-validity claim is wrong"
        ]
      },
      {
        criterion_id: "coherent_conclusion",
        criterion_kind: "coherent_conclusion",
        description:
          "The response concludes that reliability is useful but not sufficient validity evidence.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "reliability does not automatically establish validity"
        ]
      },
      {
        criterion_id: "identify_additional_validity_evidence",
        criterion_kind: "optional_deepening",
        description:
          "The response identifies content, construct, criterion, or consequences evidence relevant to the intended interpretation.",
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
          "reliability proves validity"
        ]
      },
      {
        contradiction_id:
          "anchor_conclusion_conceptual_explanation_conflict",
        description:
          "The response distinguishes reliability from validity but still endorses the active distractor.",
        observable_patterns: [
          "reliability is only consistency, but D is still right"
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
      `Explicitly apply the reliability-validity distinction to option ${OPTION_LABEL} or an accepted alias and reject the claim.`
    ],
    anchor_contradiction_criteria: [
      `Endorsing option ${OPTION_LABEL} conflicts with explaining that consistency is not sufficient validity evidence.`,
      `Rejecting option ${OPTION_LABEL} without the reliability-validity mechanism remains incomplete.`
    ],
    ambiguity_resolution_policy:
      "Do not infer the anchor stance from confidence, self-correction language, or non-anchor polarity. Require observable stance attached to the active anchor.",
    active_anchor_alias_contract: aliases
  });
}

function buildCanonicalAnchorContract(
  aliases: ActiveAnchorAliasContract
) {
  return E2A36CanonicalAnchorContractSchema.parse({
    contract_version: "e2a36-measurement-canonical-anchor-v1",
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    item_id: ITEM_ID,
    option_label: OPTION_LABEL,
    distractor_text: DISTRACTOR_CLAIM,
    required_anchor_application: "explicit",
    required_anchor_stance: "rejects_distractor",
    mechanism_criteria: [
      "distinguish consistency from interpretation evidence",
      "explain consistent measurement of the wrong construct",
      "apply the boundary to the active distractor"
    ],
    sound_criteria: [
      "define reliability as consistency or precision evidence",
      "define validity as interpretation or use evidence",
      "explain why reliability is not sufficient for validity",
      "reject the active distractor",
      "give a coherent conclusion with no essential missing links"
    ],
    contradiction_criteria: [
      "retain the claim that reliability proves validity",
      "explain the conceptual distinction but still endorse option D"
    ],
    active_anchor_alias_contract: aliases
  });
}

function buildAnchorStanceContract() {
  return E2A36AnchorStanceContractSchema.parse({
    contract_version: "e2a36-measurement-anchor-stance-v1",
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    reference_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    stance_evidence_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    scope_resolver_version: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    reference_resolution_separate_from_stance: true,
    polarity_must_attach_to_active_anchor: true,
    endorsement_examples: [
      "I agree with D because consistent scores prove validity.",
      "Option D is still correct.",
      "The reliability-validity claim makes sense."
    ],
    rejection_examples: [
      "Option D is wrong because consistency alone does not establish validity.",
      "I reject the consistency-proves-validity claim.",
      "That option is tempting but incorrect."
    ],
    uncertainty_examples: [
      "I am unsure whether D is right.",
      "Maybe reliability is enough for validity."
    ],
    self_correction_examples: [
      "I was wrong because reliability concerns consistency, not the intended interpretation.",
      "I changed my answer, but D is still correct."
    ]
  });
}

function buildSelfCorrectionIntegrationContract() {
  const evidenceContract = buildSelfCorrectionEvidenceContractV1();
  return E2A36SelfCorrectionIntegrationContractSchema.parse({
    contract_version:
      "e2a36-self-correction-evidence-integration-v1",
    evidence_contract_version:
      SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
    evidence_contract_hash: stableHash(evidenceContract),
    separation: {
      self_correction_intent: "independent_signal",
      conceptual_evidence_update:
        "requires_observable_independent_evidence",
      profile_update_eligibility:
        "derived_from_conceptual_evidence",
      correction_language_alone_is_not_understanding: true
    },
    examples: {
      intent_only: "I was wrong. I choose another option.",
      evidence_bearing:
        "I was wrong because reliability only addresses consistency, not whether the interpretation is appropriate.",
      misconception_preserved:
        "I was wrong, but D is still correct because the scores are consistent."
    }
  });
}

function buildTrajectoryEnvelope(): TrajectoryEnvelopeContract {
  const progression = buildDefaultTrajectoryProgressionConsequences();
  const prohibited = [
    "trajectory_expectation_overrides_evaluator",
    "revision_delayed_after_sound",
    "copied_wording_without_evidence",
    "blocking_contradiction",
    "unsupported_sound_promotion"
  ] as const;
  const roles = [
    "initial_anchor_position",
    "mechanism_exploration",
    "anchor_reconciliation",
    "independent_reconstruction",
    "mechanism_exploration",
    "anchor_reconciliation",
    "independent_reconstruction",
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
        "Synthetic turns may exercise misconception, partial understanding, contradiction, self-correction, sound understanding, and regression without prescribing an exact evaluator label for any turn.",
      acceptable_reasoning_quality_envelope:
        "Every checkpoint accepts any evidence-supported reasoning quality. Sound may occur early, partial reasoning may persist, and regression may reopen support.",
      progression_consequences:
        "Observable evidence and the sound gate control progression. Sound triggers immediate revision, regression reopens support, and copied or intent-only language requests independent evidence."
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
      progression_consequence: progression,
      prohibited_states: [...prohibited]
    }))
  });
}

function buildCompiledEvaluatorRequest(
  targetContract: TargetEvidenceContractV5
) {
  return buildProductionTurnEvidenceEvaluatorInputV5({
    legacy_evaluator_input: {
      evaluation_mode: "e2a36_no_live_request_compilation",
      scenario_prompt: SCENARIO_PROMPT,
      latest_student_message:
        "I reject option D. Reliability tells us the scores are consistent, but a test can consistently measure the wrong construct, so more evidence is needed for the intended interpretation.",
      visible_prior_student_position:
        "I agreed with D because the repeated scores were consistent.",
      target_evidence_contract: targetContract,
      longitudinal_profile_context: {
        learning_profile_evolution_version:
          E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
        engagement_profile_evolution_version:
          E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
        stopping_policy_version:
          E2A36_ADAPTIVE_STOPPING_POLICY_VERSION
      }
    },
    source_student_turn: {
      source_student_turn_id: "e2a36_compile_student_turn_4",
      source_sequence_index: 4
    },
    active_anchor_alias_contract:
      targetContract.active_anchor_alias_contract
  });
}

function buildHeldOutDomain() {
  return {
    domain_contract_version: "e2a36-measurement-longitudinal-domain-v1",
    domain: "educational_measurement_measurement_theory",
    purpose:
      "longitudinal autonomous tutoring quality across evolving evidence, engagement, intervention, stopping, escalation, and student communication",
    primary_scenario: {
      item_id: ITEM_ID,
      prompt: SCENARIO_PROMPT,
      active_distractor_option: OPTION_LABEL,
      active_distractor_claim: DISTRACTOR_CLAIM
    },
    concept_families: [
      {
        concept_family: "reliability_validity",
        misconception:
          "Reliable tests are automatically valid because consistent scores mean accurate measurement.",
        knowledge_gap:
          "Reliability concerns consistency; validity concerns interpretation and use."
      },
      {
        concept_family: "observed_score_error",
        misconception:
          "A score of 80 proves more ability than a score of 75.",
        knowledge_gap:
          "Observed scores include error and score differences require uncertainty-aware interpretation."
      },
      {
        concept_family: "sample_dependent_statistics",
        misconception:
          "Item difficulty is always the same for every group.",
        knowledge_gap:
          "Classical Test Theory item statistics depend on the sample and framework."
      },
      {
        concept_family: "reliability_types",
        misconception:
          "Every reliability coefficient answers the same consistency question.",
        knowledge_gap:
          "Internal consistency, stability, equivalence, and rater agreement address different sources."
      },
      {
        concept_family: "standard_error_of_measurement",
        misconception:
          "An observed score is exact and has no measurement uncertainty.",
        knowledge_gap:
          "SEM describes score precision and supports uncertainty-aware interpretation."
      },
      {
        concept_family: "score_comparability",
        misconception:
          "Any two numerical scores can be compared directly.",
        knowledge_gap:
          "Comparability depends on scale, form, administration, and interpretation context."
      },
      {
        concept_family: "ctt_irt_interpretation",
        misconception:
          "CTT and IRT item statistics have the same invariance interpretation.",
        knowledge_gap:
          "Framework assumptions determine how person and item parameters are interpreted."
      }
    ],
    personalization_cases: [
      {
        student: "A",
        response: "Reliability means the same score every time.",
        target_gap: "concept distinction"
      },
      {
        student: "B",
        response: "Cronbach alpha proves validity.",
        target_gap: "reliability evidence overclaim"
      },
      {
        student: "C",
        response: "Two points difference means one student is better.",
        target_gap: "measurement error and SEM"
      }
    ],
    trajectory_conditions: [
      "misconception",
      "partial_understanding",
      "contradiction",
      "self_correction",
      "sound_understanding",
      "regression"
    ],
    domain_novelty_boundary:
      "Unlike prior single-anchor measurement fixtures, E2A.36 tests multi-concept longitudinal profile evolution and adaptive orchestration."
  } as const;
}

function buildBudget() {
  return {
    budget_version: "e2a36-bounded-live-budget-v1",
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
    artifact_contract_version: "e2a36-artifact-contract-v1",
    expected_artifact_names: [...E2A36_ARTIFACT_NAMES],
    preserve_provider_outputs_if_separately_authorized_later: true,
    preparation_creates_live_artifacts: false,
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
    integrity_version: "e2a36-protected-source-integrity-v1",
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
    all_unchanged: files.every((entry) => entry.unchanged)
  };
}

function buildProtocol(input: {
  targetContract: TargetEvidenceContractV5;
  canonicalAnchor: ReturnType<typeof buildCanonicalAnchorContract>;
  anchorStance: ReturnType<typeof buildAnchorStanceContract>;
  selfCorrection: ReturnType<typeof buildSelfCorrectionIntegrationContract>;
  trajectory: TrajectoryEnvelopeContract;
  interventionMemory:
    ReturnType<typeof buildLongitudinalInterventionMemoryContractV1>;
  learningProfile:
    ReturnType<typeof buildLearningProfileEvolutionContractV1>;
  engagementProfile:
    ReturnType<typeof buildEngagementProfileEvolutionContractV1>;
  stoppingPolicy: ReturnType<typeof buildAdaptiveStoppingPolicyContractV1>;
  escalationPolicy:
    ReturnType<typeof buildInstructorEscalationPolicyContractV1>;
  communication:
    ReturnType<typeof buildStudentFacingCommunicationContractV1>;
  metrics: ReturnType<typeof buildE2A36LongitudinalMetricsContract>;
  compiledEvaluatorRequest:
    ReturnType<typeof buildCompiledEvaluatorRequest>;
  deterministic:
    ReturnType<typeof runAllE2A36DeterministicSuites>;
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>;
  candidateIntegrity: ReturnType<typeof evaluateE2A24Candidate>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const protocol = {
    protocol_version: E2A36_PROTOCOL_VERSION,
    preparation_version: E2A36_PREPARATION_VERSION,
    protocol_state: "frozen_for_separate_authorization_not_executable",
    domain: "educational_measurement_measurement_theory",
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
      evaluator_v5_unchanged: input.protectedIntegrity.evaluator_v5_unchanged,
      tutor_candidate_unchanged: input.protectedIntegrity.tutor_candidate_unchanged,
      stopping_is_internal_orchestration: true,
      student_messages_are_translated_from_internal_decisions: true,
      engagement_never_determines_correctness: true,
      exact_turn_labels_required: false,
      sound_evidence_overrides_trajectory: true,
      latest_valid_evidence_updates_learning_profile: true,
      learning_history_is_never_erased: true,
      repeated_ineffective_intervention_prohibited: true
    },
    contract_versions: {
      target_evidence: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
      canonical_anchor: input.canonicalAnchor.contract_version,
      anchor_reference: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
      anchor_stance: ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
      anchor_scope: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
      self_correction_evidence:
        SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
      self_correction_integration: input.selfCorrection.contract_version,
      trajectory_envelope: TRAJECTORY_ENVELOPE_VERSION,
      intervention_memory: E2A36_INTERVENTION_MEMORY_VERSION,
      learning_profile_evolution:
        E2A36_LEARNING_PROFILE_EVOLUTION_VERSION,
      engagement_profile_evolution:
        E2A36_ENGAGEMENT_PROFILE_EVOLUTION_VERSION,
      adaptive_stopping_policy: E2A36_ADAPTIVE_STOPPING_POLICY_VERSION,
      instructor_escalation_policy:
        E2A36_INSTRUCTOR_ESCALATION_POLICY_VERSION,
      student_facing_communication:
        E2A36_STUDENT_FACING_COMMUNICATION_VERSION,
      metrics: E2A36_LONGITUDINAL_METRICS_VERSION,
      evidence_preservation_mapper:
        TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
      turn_profile_mapper: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
      sound_gate: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
      pre_tutor_finalization:
        PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4
    },
    contract_hashes: {
      target_evidence: stableHash(input.targetContract),
      canonical_anchor: stableHash(input.canonicalAnchor),
      anchor_stance: stableHash(input.anchorStance),
      self_correction_integration: stableHash(input.selfCorrection),
      trajectory_envelope: stableHash(input.trajectory),
      intervention_memory: stableHash(input.interventionMemory),
      learning_profile: stableHash(input.learningProfile),
      engagement_profile: stableHash(input.engagementProfile),
      stopping_policy: stableHash(input.stoppingPolicy),
      escalation_policy: stableHash(input.escalationPolicy),
      student_communication: stableHash(input.communication),
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
      all_regressions_passed: input.deterministic.passed,
      deterministic_case_count: input.deterministic.total_case_count,
      learning_profile_passed:
        input.deterministic.suites.learning_profile.passed,
      engagement_profile_passed:
        input.deterministic.suites.engagement_profile.passed,
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
      protected_components_unchanged:
        input.protectedIntegrity.all_unchanged,
      provider_calls_zero: true,
      network_requests_zero: true
    },
    budget: input.budget,
    artifact_contract_hash: stableHash(input.artifactContract)
  };
  return {
    ...protocol,
    protocol_hash: stableHash(protocol)
  };
}

function buildCompositeRuntimeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const identity = {
    identity_version: "e2a36-composite-runtime-identity-v1",
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
    longitudinal_contracts_source_sha256: fileSha256(
      "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts"
    ),
    protocol_source_sha256: fileSha256(
      "src/lib/evaluation/formative/e2a36-longitudinal-protocol.ts"
    ),
    preparation_harness_source_sha256: fileSha256(
      "prisma/formative-evaluation-e2a36.ts"
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

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a36-provider-call-guard-v1",
    execution_mode: "deterministic_protocol_freeze_no_live",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed: networkRequestCount === 0
  };
}

export function buildE2A36PreparationArtifacts(
  networkRequestCount = 0
) {
  const aliases = buildAliasContract();
  const targetContract = buildTargetEvidenceContract(aliases);
  const canonicalAnchor = buildCanonicalAnchorContract(aliases);
  const anchorStance = buildAnchorStanceContract();
  const selfCorrection = buildSelfCorrectionIntegrationContract();
  const trajectory = buildTrajectoryEnvelope();
  const interventionMemory =
    buildLongitudinalInterventionMemoryContractV1();
  const learningProfile = buildLearningProfileEvolutionContractV1();
  const engagementProfile = buildEngagementProfileEvolutionContractV1();
  const stoppingPolicy = buildAdaptiveStoppingPolicyContractV1();
  const escalationPolicy = buildInstructorEscalationPolicyContractV1();
  const communication = buildStudentFacingCommunicationContractV1();
  const metrics = buildE2A36LongitudinalMetricsContract();
  const compiledEvaluatorRequest =
    buildCompiledEvaluatorRequest(targetContract);
  const deterministic = runAllE2A36DeterministicSuites(trajectory);
  const candidateIntegrity = evaluateE2A24Candidate();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const heldOutDomain = buildHeldOutDomain();
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);
  assert(
    candidateIntegrity.candidate_configuration_hash ===
      CANDIDATE_CONFIGURATION_HASH,
    "e2a36_candidate_configuration_hash_mismatch"
  );
  assert(
    candidateIntegrity.candidate_file_sha256 === CANDIDATE_FILE_SHA256,
    "e2a36_candidate_file_hash_mismatch"
  );
  assert(
    protectedIntegrity.all_unchanged,
    "e2a36_protected_source_integrity_failed"
  );
  assert(deterministic.passed, "e2a36_deterministic_regressions_failed");
  assert(providerCallGuard.passed, "e2a36_provider_call_guard_failed");
  const protocol = buildProtocol({
    targetContract,
    canonicalAnchor,
    anchorStance,
    selfCorrection,
    trajectory,
    interventionMemory,
    learningProfile,
    engagementProfile,
    stoppingPolicy,
    escalationPolicy,
    communication,
    metrics,
    compiledEvaluatorRequest,
    deterministic,
    protectedIntegrity,
    candidateIntegrity,
    budget,
    artifactContract
  });
  const compositeRuntimeIdentity = buildCompositeRuntimeIdentity({
    protocol,
    budget,
    artifactContract
  });
  const summary = {
    summary_version: "e2a36-protocol-freeze-summary-v1",
    status: "e2a36_protocol_frozen_not_executed",
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
    manifest_version: "e2a36-freeze-manifest-v1",
    created_at: new Date().toISOString(),
    artifact_names: [...E2A36_ARTIFACT_NAMES],
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
    targetContract,
    canonicalAnchor,
    anchorStance,
    selfCorrection,
    compiledEvaluatorRequest,
    trajectory,
    interventionMemory,
    learningProfile,
    engagementProfile,
    stoppingPolicy,
    escalationPolicy,
    communication,
    metrics,
    deterministic,
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
  artifacts: ReturnType<typeof buildE2A36PreparationArtifacts>
) {
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256": `${artifacts.protocol.protocol_hash}\n`,
    "held-out-domain.json": artifacts.heldOutDomain,
    "target-evidence-contract.json": artifacts.targetContract,
    "canonical-anchor-contract.json": artifacts.canonicalAnchor,
    "anchor-stance-contract.json": artifacts.anchorStance,
    "self-correction-evidence-integration-contract.json":
      artifacts.selfCorrection,
    "compiled-evaluator-v5-request.json":
      artifacts.compiledEvaluatorRequest,
    "trajectory-envelope-contract.json": artifacts.trajectory,
    "intervention-memory-contract.json": artifacts.interventionMemory,
    "learning-profile-evolution-contract.json":
      artifacts.learningProfile,
    "engagement-profile-evolution-contract.json":
      artifacts.engagementProfile,
    "adaptive-stopping-policy-contract.json": artifacts.stoppingPolicy,
    "instructor-escalation-policy-contract.json":
      artifacts.escalationPolicy,
    "student-facing-communication-contract.json":
      artifacts.communication,
    "longitudinal-metrics-contract.json": artifacts.metrics,
    "deterministic-regressions.json": artifacts.deterministic,
    "learning-profile-regressions.json":
      artifacts.deterministic.suites.learning_profile,
    "engagement-profile-regressions.json":
      artifacts.deterministic.suites.engagement_profile,
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

function validateArtifactDirectory(runDirectory: string) {
  const expectedBeforeValidation = E2A36_ARTIFACT_NAMES.filter(
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
  const protocol = readJson<{
    protocol_hash: string;
    execution_authorized: boolean;
    live_execution_performed: boolean;
  }>(path.join(runDirectory, "frozen-protocol.json"));
  const protocolHash = readFileSync(
    path.join(runDirectory, "frozen-protocol.sha256"),
    "utf8"
  ).trim();
  const summary = readJson<{
    passed: boolean;
    provider_calls_made: number;
    network_requests_made: number;
  }>(path.join(runDirectory, "summary.json"));
  const deterministic = readJson<{
    passed: boolean;
    total_case_count: number;
  }>(path.join(runDirectory, "deterministic-regressions.json"));
  const files = actual.map((name) => ({
    name,
    sha256: fileSha256(path.join(runDirectory, name)),
    bytes: statSync(path.join(runDirectory, name)).size
  }));
  const checks = {
    exact_pre_validation_artifact_set:
      missing.length === 0 &&
      unexpected.length === 0 &&
      actual.length === expectedBeforeValidation.length,
    protocol_hash_matches:
      protocol.protocol_hash === protocolHash &&
      /^[a-f0-9]{64}$/u.test(protocolHash),
    protocol_not_authorized:
      !protocol.execution_authorized &&
      !protocol.live_execution_performed,
    deterministic_regressions_passed:
      deterministic.passed && deterministic.total_case_count >= 30,
    summary_passed: summary.passed,
    no_provider_calls:
      summary.provider_calls_made === 0 &&
      summary.network_requests_made === 0
  };
  return {
    validation_version: "e2a36-artifact-validation-v1",
    expected_artifact_count: E2A36_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    checks,
    artifacts: files,
    passed: Object.values(checks).every(Boolean)
  };
}

export function writeE2A36PreparationArtifacts(input: {
  runDirectory: string;
  networkRequestCount: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a36_preparation_run_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A36PreparationArtifacts(
    input.networkRequestCount
  );
  for (const [name, value] of Object.entries(artifactValues(artifacts))) {
    const output = path.join(input.runDirectory, name);
    if (typeof value === "string") {
      writeFileSync(output, value, "utf8");
    } else {
      writeJson(output, value);
    }
  }
  const artifactValidation = validateArtifactDirectory(input.runDirectory);
  assert(artifactValidation.passed, "e2a36_artifact_validation_failed");
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  const finalNames = readdirSync(input.runDirectory);
  assert(
    finalNames.length === E2A36_ARTIFACT_NAMES.length &&
    E2A36_ARTIFACT_NAMES.every((name) => finalNames.includes(name)),
    "e2a36_final_artifact_set_mismatch"
  );
  for (const name of finalNames) {
    chmodSync(path.join(input.runDirectory, name), 0o444);
  }
  return {
    ...artifacts,
    artifactValidation
  };
}

export function makeE2A36PreparationRunId() {
  const timestamp = new Date().toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "");
  return `e2a36_${timestamp}_${randomBytes(4).toString("hex")}`;
}

export function latestE2A36PreparationRunDirectory() {
  if (!existsSync(E2A36_ARTIFACT_ROOT)) {
    throw new Error("e2a36_no_preparation_artifact_directory");
  }
  const latest = readdirSync(E2A36_ARTIFACT_ROOT)
    .map((name) => path.join(E2A36_ARTIFACT_ROOT, name))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
    .at(-1);
  if (!latest) throw new Error("e2a36_no_preparation_run");
  return latest;
}

export function inspectE2A36PreparationRun(runDirectory: string) {
  const read = (name: string) => readJson(
    path.join(runDirectory, name)
  );
  return {
    run_directory: runDirectory,
    summary: read("summary.json"),
    protocol: read("frozen-protocol.json"),
    composite_runtime_identity:
      read("composite-runtime-identity.json"),
    deterministic_regressions:
      read("deterministic-regressions.json"),
    artifact_validation: read("artifact-validation.json")
  };
}
