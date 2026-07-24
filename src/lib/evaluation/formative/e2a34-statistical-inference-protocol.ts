import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
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
  canonicalStructuredAgentRequestHash,
  PROVIDER_TRANSPORT_RETRY_POLICY_VERSION
} from "@/lib/llm/provider-transport-retry";
import type {
  StructuredAgentRequest
} from "@/lib/llm/providers/types";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
  ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  ACTIVITY_RESPONSE_EVALUATOR_INPUT_SCHEMA_VERSION
} from "@/lib/services/student-assessment/activity-misconception-evidence-live";
import {
  ActiveAnchorAliasContractSchema,
  buildActiveAnchorAliasContract,
  type ActiveAnchorAliasContract
} from "@/lib/services/student-assessment/active-anchor-alias-resolution";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
  resolveActiveAnchorAliasV4
} from "@/lib/services/student-assessment/active-anchor-alias-resolution-v4";
import {
  ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION
} from "@/lib/services/student-assessment/anchor-stance-evidence-resolution-v2";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
  assertBlockingAnchorConflictPropagatedV2,
  propagateAnchorContradictionV2
} from "@/lib/services/student-assessment/anchor-contradiction-propagation-v2";
import {
  SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
  evaluateAnchorConsistentSoundGate,
  type AnchorInterpretation
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import {
  CANONICAL_ANCHOR_EVIDENCE_VERSION
} from "@/lib/services/student-assessment/canonical-anchor-evidence";
import {
  FORMATIVE_ACTIVITY_SCHEMA_VERSION
} from "@/lib/services/student-assessment/formative-activity-design";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_INSTRUCTIONS_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  ProductionTurnEvidenceEvaluatorInputV5Schema,
  ProductionTurnEvidenceEvaluatorOutputV5Schema,
  buildProductionTurnEvidenceEvaluatorInputV5
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  TARGET_EVIDENCE_CONTRACT_VERSION_V5,
  TargetEvidenceContractV5Schema,
  type TargetEvidenceContractV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import {
  PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v4";
import {
  TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7
} from "@/lib/services/student-assessment/target-evidence-mapper-v7";
import {
  E2A24_CANDIDATE_PATH,
  evaluateE2A24Candidate
} from "./e2a24-autonomous-dialogue-candidate";
import {
  TRAJECTORY_ENVELOPE_VERSION,
  TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
  TrajectoryEnvelopeContractSchema,
  TrajectoryProgressionConsequenceSchema,
  TrajectoryProhibitedStateSchema,
  TrajectoryReasoningQualitySchema,
  TrajectoryRoleSchema,
  buildDefaultTrajectoryProgressionConsequences,
  evaluateTrajectoryEnvelope,
  type TrajectoryEnvelopeContract,
  type TrajectoryEnvelopeTurn,
  type TrajectoryReasoningQuality
} from "./trajectory-envelope-v1";

export const E2A34_PREPARATION_VERSION =
  "e2a34-statistical-inference-held-out-protocol-freeze-v1" as const;
export const E2A34_PROTOCOL_VERSION =
  "e2a34-statistical-inference-trajectory-envelope-canary-v1" as const;
export const E2A34_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a34-statistical-inference-protocol-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const CANDIDATE_FILE_SHA256 =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2";
const APPROVED_BASELINE_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";

const ITEM_ID = "research_methods_p_value_interpretation_item_1";
const CONCEPT_ID = "p_value_null_conditional_interpretation_boundary";
const OPTION_LABEL = "D";
const DISTRACTOR_CLAIM =
  "The probability of the research hypothesis being true can be directly calculated from the p-value.";
const CANONICAL_ANCHOR_ID = `${ITEM_ID}:option:${OPTION_LABEL}`;
const INITIAL_ACTIVITY =
  "A researcher conducts a hypothesis test and obtains p = .03. The researcher concludes: \"Because p = .03, there is a 97% chance that the research hypothesis is true.\" Do you agree? Explain.";

const EXPECTED_PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    CANDIDATE_FILE_SHA256,
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/services/student-assessment/target-evidence-contract-v5.ts":
    "775dd493ce68a11223ec5407bd3fb4a146315e13dfbd566ab5b5159b9e8e2a6a",
  "src/lib/services/student-assessment/canonical-anchor-evidence.ts":
    "bb03fd71ba544d9ffab2ce5c650fc036d3525d7f29a3718bcbd015c620c07fd2",
  "src/lib/services/student-assessment/active-anchor-alias-resolution.ts":
    "44e4dcab3423bdcfd46211125435effb22b83f2ff00a0399dab5ab860eb74b43",
  "src/lib/services/student-assessment/anchor-conclusion-consistency.ts":
    "d7c5c368b3e93f2f5b6f2932184491693d98f502cccec2ad5778f331b2caaf83",
  "src/lib/services/student-assessment/active-anchor-alias-resolution-v3.ts":
    "29f4c7da1d380c8dc70ade8fd2516010a601d143fd605ab1eba931d8242f0635",
  "src/lib/services/student-assessment/active-anchor-alias-resolution-v4.ts":
    "caeaa699f5a769dff743ee491d3abe49bfcbeb535644f78e18233b136696661b",
  "src/lib/services/student-assessment/anchor-stance-resolution-v1.ts":
    "36c291183aaf15378a65a3cf00c847e4625676a275dca8daa47fe1aaf9749e6a",
  "src/lib/services/student-assessment/anchor-stance-evidence-resolution-v2.ts":
    "4cb954d19b1a975694ffaa277b13ec856284a0c6714fd74a9801bd29a33a927b",
  "src/lib/services/student-assessment/anchor-contradiction-propagation-v2.ts":
    "58b4b37133ac49f85d544023b7443563c6c042984a0fa31d78b850fe46830163",
  "src/lib/services/student-assessment/target-evidence-mapper-v7.ts":
    "a4ef776faa93094222e5cb7e61e890a71e662b6d247f2c247013224c5ab787a5",
  "src/lib/services/student-assessment/pre-tutor-profile-finalization-v4.ts":
    "4a97f5a1d20fb7a664c3f26e3d1aef17fc17c0517e33b7811df8582fd3554751",
  "src/lib/evaluation/formative/trajectory-envelope-v1.ts":
    "95319bb52d087601680e53ce2db9e357764a2b5f5574e125f3b88804c49d4e70"
} as const;

const HISTORICAL_INPUTS = [
  {
    stage: "E2A.24",
    path:
      ".data/e2a24-autonomous-formative-dialogue-architecture/e2a24_20260720220102_1324ebaf/cross-domain-target-contracts.json",
    semantic_tags: [
      "reliability_validity",
      "correlation_causation",
      "screening_predictive_value",
      "voltage_current_resistance"
    ],
    structural_tags: ["construct_boundary", "causal_boundary"]
  },
  {
    stage: "E2A.25",
    path:
      ".data/e2a25-autonomous-dialogue-live-canary/e2a25_20260721000435_bf179fb6/session-designs.json",
    semantic_tags: ["phoneme_allophone", "sunk_cost", "binary_search"],
    structural_tags: ["classification_boundary", "decision_boundary"]
  },
  {
    stage: "E2A.26",
    path:
      ".data/e2a26-semantic-oracle-calibration/e2a26_20260721222943_37b534d9/calibration-corpus.jsonl",
    semantic_tags: ["semantic_oracle", "assessment_reasoning"],
    structural_tags: ["evidence_quality_calibration"]
  },
  {
    stage: "E2A.27",
    path:
      ".data/e2a27-geometrical-optics-anchor-consistency-canary/e2a27_20260722061521_9bd4a441/session-designs.json",
    semantic_tags: ["geometrical_optics", "converging_lens"],
    structural_tags: ["optical_boundary"]
  },
  {
    stage: "E2A.28",
    path:
      ".data/e2a28-antimicrobial-resistance-contradiction-canary/e2a28_20260722083935_6ecb39bb/session-designs.json",
    semantic_tags: ["antimicrobial_resistance", "selection_variation"],
    structural_tags: ["selection_not_intentional_adaptation"]
  },
  {
    stage: "E2A.29",
    path:
      ".data/e2a29-electrical-circuits-anchor-contradiction-canary/e2a29_20260722120813_3fd136e6/session-designs.json",
    semantic_tags: ["electrical_circuits", "series_current"],
    structural_tags: ["conserved_quantity"]
  },
  {
    stage: "E2A.30",
    path:
      ".data/e2a30-thermal-physics-transport-autonomous-canary/e2a30_20260722212059_c1f72790/session-designs.json",
    semantic_tags: ["thermal_physics", "temperature_heat_transfer"],
    structural_tags: ["state_vs_transfer_rate"]
  },
  {
    stage: "E2A.31",
    path:
      ".data/e2a31b-ecology-anchor-stance-resolution-canary/e2a31b_20260723111043_c82c52ae/session-designs.json",
    semantic_tags: ["ecology", "trophic_cascade", "predator_removal"],
    structural_tags: ["direct_plus_indirect_pathway"]
  },
  {
    stage: "E2A.32",
    path:
      ".data/e2a32-chemical-equilibrium-protocol-freeze/e2a32_20260723T171215134_14feb916/held-out-domain.json",
    semantic_tags: [
      "chemistry",
      "dynamic_equilibrium",
      "equal_rates_not_equal_concentrations",
      "equilibrium_constant"
    ],
    structural_tags: [
      "equal_process_rates_vs_unequal_state_values",
      "trajectory_envelope_v1"
    ]
  },
  {
    stage: "E2A.33",
    path:
      ".data/e2a33-causal-inference-protocol-freeze/e2a33_20260723T231529905_eddc5657/held-out-domain.json",
    semantic_tags: [
      "introductory_statistics",
      "causal_inference",
      "correlation_causation",
      "confounding",
      "educational_app_exam_scores"
    ],
    structural_tags: [
      "causal_boundary",
      "common_cause_joint_pattern",
      "trajectory_envelope_v1"
    ]
  },
  {
    stage: "E2A.33b",
    path:
      ".data/e2a33b-anchor-stance-resolution-protocol/e2a33b_20260724T020933630_a1270ef0/stance-evidence-contract.json",
    semantic_tags: [
      "causal_inference",
      "anchor_stance_resolution"
    ],
    structural_tags: [
      "anchor_reference_then_stance",
      "discourse_context_resolution"
    ]
  },
  {
    stage: "E2A.33c",
    path:
      ".data/e2a33c-causal-inference-false-sound-adjudication/e2a33c_20260724142532_cd0ca553/root-cause-adjudication.json",
    semantic_tags: [
      "causal_inference",
      "false_sound_adjudication"
    ],
    structural_tags: [
      "evaluator_mapper_sound_gate_trace"
    ]
  },
  {
    stage: "E2A.33d",
    path:
      ".data/e2a33d-evidence-preserving-mapper-correction/e2a33d_20260724145806_004e9fee/evidence-preservation-contract.json",
    semantic_tags: [
      "evidence_preservation",
      "essential_missing_links"
    ],
    structural_tags: [
      "mapper_preservation_invariant",
      "sound_requires_zero_missing_links"
    ]
  }
] as const;

export const E2A34_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "trajectory-envelope-contract.json",
  "runtime-trajectory-envelope-projection.json",
  "future-canary-protocol-template.json",
  "held-out-domain.json",
  "target-evidence-contract.json",
  "canonical-anchor-contract.json",
  "alias-contract.json",
  "anchor-stance-contract.json",
  "alias-resolution-validation.json",
  "required-contradiction-validation.json",
  "mapper-preservation-prerequisite.json",
  "compiled-evaluator-v5-request.json",
  "deterministic-trajectory-regressions.json",
  "overlap-analysis.json",
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

export const E2A34_TRAJECTORY_ROLE_VOCABULARY_VERSION =
  "e2a34-statistical-inference-trajectory-role-v1" as const;

export const E2A34TrajectoryRoleSchema = z.enum([
  "misconception",
  "copied_wording",
  "partial_improvement",
  "contradiction",
  "clarification",
  "sound"
]);
export type E2A34TrajectoryRole = z.infer<
  typeof E2A34TrajectoryRoleSchema
>;

export const E2A34TrajectoryEnvelopeTurnSchema = z.object({
  turn_index: z.number().int().positive(),
  expected_trajectory_role: E2A34TrajectoryRoleSchema,
  runtime_trajectory_role: TrajectoryRoleSchema,
  allowed_reasoning_quality_set: z.array(
    TrajectoryReasoningQualitySchema
  ).min(1).max(4).refine(
    (values) => new Set(values).size === values.length,
    "allowed_reasoning_quality_set must not contain duplicates"
  ),
  sound_gate_override_rule: z.literal(
    TRAJECTORY_SOUND_GATE_OVERRIDE_RULE
  ),
  progression_consequence: TrajectoryProgressionConsequenceSchema,
  prohibited_states: z.array(TrajectoryProhibitedStateSchema)
    .min(1)
    .refine(
      (values) => new Set(values).size === values.length,
      "prohibited_states must not contain duplicates"
    )
}).strict();
export type E2A34TrajectoryEnvelopeTurn = z.infer<
  typeof E2A34TrajectoryEnvelopeTurnSchema
>;

export const E2A34TrajectoryEnvelopeContractSchema = z.object({
  trajectory_envelope_version: z.literal(TRAJECTORY_ENVELOPE_VERSION),
  trajectory_role_vocabulary_version: z.literal(
    E2A34_TRAJECTORY_ROLE_VOCABULARY_VERSION
  ),
  authority_boundary: z.object({
    simulator_intended_trajectory_is_non_authoritative: z.literal(true),
    evaluator_follows_observable_evidence: z.literal(true),
    production_sound_gate_is_authoritative_for_progression: z.literal(true),
    exact_turn_by_turn_reasoning_labels_prohibited: z.literal(true)
  }).strict(),
  separation: z.object({
    simulator_intended_trajectory: z.string().min(1).max(1200),
    acceptable_reasoning_quality_envelope: z.string().min(1).max(1200),
    progression_consequences: z.string().min(1).max(1200)
  }).strict(),
  required_scenario_states: z.object({
    initial_misconception: z.object({
      student_response: z.string().min(1).max(1200),
      allowed_reasoning_quality_set: z.tuple([
        z.literal("misconception")
      ]),
      progression: z.literal("remain_in_dialogue")
    }).strict(),
    partial_improvement: z.object({
      student_response: z.string().min(1).max(1200),
      allowed_reasoning_quality_set: z.tuple([
        z.literal("partial"),
        z.literal("misconception")
      ]),
      progression: z.literal("remain_in_dialogue")
    }).strict(),
    contradiction: z.object({
      student_response: z.string().min(1).max(1200),
      anchor_application: z.literal("explicit"),
      anchor_stance: z.literal("endorses_distractor"),
      anchor_consistency: z.literal(
        "contradictory_to_conceptual_reasoning"
      ),
      structured_contradiction: z.literal(
        "anchor_conclusion_conceptual_explanation_conflict"
      ),
      revision_ready: z.literal(false)
    }).strict(),
    sound: z.object({
      student_response: z.string().min(1).max(1200),
      sound: z.literal(true),
      revision_ready: z.literal(true),
      progression: z.literal("immediate_revision"),
      minimum_turns: z.literal(0)
    }).strict()
  }).strict(),
  turns: z.array(E2A34TrajectoryEnvelopeTurnSchema)
    .length(6)
    .refine(
      (turns) => turns.every(
        (turn, index) => turn.turn_index === index + 1
      ),
      "turn_index values must be contiguous and one-based"
    )
    .refine(
      (turns) =>
        new Set(turns.map((turn) => turn.expected_trajectory_role))
          .size === 6,
      "all six E2A.34 trajectory roles must appear exactly once"
    )
}).strict();
export type E2A34TrajectoryEnvelopeContract = z.infer<
  typeof E2A34TrajectoryEnvelopeContractSchema
>;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha256(relativePath: string) {
  return sha256(readFileSync(path.join(process.cwd(), relativePath)));
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function currentGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function normalizedText(value: string) {
  return value
    .toLocaleLowerCase("en-CA")
    .replace(/_/gu, " ")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function textTokens(value: string) {
  return new Set(normalizedText(value).split(" ").filter((token) =>
    token.length > 2
  ));
}

function tokenJaccard(left: string, right: string) {
  const leftTokens = textTokens(left);
  const rightTokens = textTokens(right);
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token)
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function collectStrings(value: unknown, output: Set<string>) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length >= 20 && trimmed.length <= 5_000) output.add(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, output));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as JsonRecord).forEach((entry) =>
      collectStrings(entry, output)
    );
  }
}

function stringsFromArtifact(relativePath: string) {
  const filePath = path.join(process.cwd(), relativePath);
  if (!existsSync(filePath)) {
    throw new Error(`e2a34_overlap_source_missing:${relativePath}`);
  }
  const strings = new Set<string>();
  const source = readFileSync(filePath, "utf8");
  if (relativePath.endsWith(".jsonl")) {
    source.split(/\r?\n/gu).filter(Boolean).forEach((line) =>
      collectStrings(JSON.parse(line), strings)
    );
  } else {
    collectStrings(JSON.parse(source), strings);
  }
  return strings;
}

function buildAliasContract(): ActiveAnchorAliasContract {
  return ActiveAnchorAliasContractSchema.parse(buildActiveAnchorAliasContract({
    active_anchor_id: CANONICAL_ANCHOR_ID,
    option_label: OPTION_LABEL,
    option_text: DISTRACTOR_CLAIM,
    accepted_paraphrases: [
      "p=.03 means 97% chance",
      "the hypothesis has a 97% probability",
      "the result proves my hypothesis is probably true",
      "the 97 percent interpretation",
      "the hypothesis-probability claim",
      "the p-value directly gives the hypothesis probability",
      "the result proves the research hypothesis is probably true",
      "that probability interpretation",
      "that interpretation"
    ]
  }));
}

function buildTargetEvidenceContract(
  aliasContract: ActiveAnchorAliasContract
): TargetEvidenceContractV5 {
  return TargetEvidenceContractV5Schema.parse({
    contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    concept_id: CONCEPT_ID,
    item_id: ITEM_ID,
    distractor_option: OPTION_LABEL,
    distractor_claim: DISTRACTOR_CLAIM,
    target_conceptual_relationships: [
      "A frequentist p-value is calculated under the assumption that the null hypothesis is true.",
      "The p-value describes how unusual the observed data, or data at least as extreme, would be under the null hypothesis.",
      "The conditional probability of the data under the null is not the conditional probability that the research hypothesis is true given the data.",
      "A p-value does not directly provide P(Hypothesis | Data), so subtracting p from one does not produce a hypothesis probability."
    ],
    required_mechanisms: [
      "State the null-hypothesis assumption used to define the p-value.",
      "Explain that p = .03 concerns the unusualness of the observed result under the null rather than the truth probability of a hypothesis.",
      "Distinguish P(Data | Null) from P(Hypothesis | Data) and reject the inverse-probability interpretation.",
      "Explain that stronger claims require appropriate statistical reasoning and a study design that supports the intended inference."
    ],
    acceptable_equivalent_explanations: [
      "If the null were true, results this extreme or more extreme would occur about three percent of the time under the specified test conditions; that is not a posterior probability for the research hypothesis.",
      "The p-value conditions on the null hypothesis, while the researcher's 97 percent claim reverses the conditional probability.",
      "A small p-value can count against the null within the testing framework, but it does not assign a direct probability to either hypothesis."
    ],
    required_anchor_application:
      `Apply the p-value interpretation boundary directly to ${ITEM_ID} option ${OPTION_LABEL} and reject its direct hypothesis-probability claim.`,
    prohibited_contradictions: [
      DISTRACTOR_CLAIM,
      "Because p = .03, the research hypothesis has a 97 percent probability of being true.",
      "The p-value is calculated assuming the null is true, but option D is still correct that the alternative is 97 percent likely."
    ],
    revision_ready_criteria: [
      "null_reference_condition",
      "data_extremeness_interpretation",
      "conditional_probability_direction",
      "stronger_inference_boundary",
      "active_anchor_application",
      "coherent_conclusion"
    ],
    optional_deepening_criteria: ["optional_posterior_context"],
    evidence_limitations: [
      "This isolated synthetic scenario tests one p-value interpretation boundary and does not support a broad research-methods mastery or learner-trait claim.",
      "The protocol distinguishes p-value interpretation from the prior correlation-versus-causation scenario; it does not evaluate every inferential framework or every condition of hypothesis testing."
    ],
    criteria: [
      {
        criterion_id: "null_reference_condition",
        criterion_kind: "conceptual_relationship",
        description:
          "The response states that the p-value is defined under the assumption that the null hypothesis is true.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "the p-value assumes the null hypothesis",
          "under the null hypothesis"
        ]
      },
      {
        criterion_id: "data_extremeness_interpretation",
        criterion_kind: "required_mechanism",
        description:
          "The response explains that p = .03 describes how unusual the observed data, or more extreme data, would be under the null.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "results this extreme would be unusual under the null",
          "about three percent under the null test conditions"
        ]
      },
      {
        criterion_id: "conditional_probability_direction",
        criterion_kind: "required_mechanism",
        description:
          "The response distinguishes the probability of data under the null from the probability of a hypothesis given the data.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "P data given null is not P hypothesis given data",
          "the conclusion reverses the conditional probability"
        ]
      },
      {
        criterion_id: "stronger_inference_boundary",
        criterion_kind: "required_mechanism",
        description:
          "The response notes that a stronger hypothesis-probability claim requires an appropriate inferential framework and supporting design assumptions.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "the study design and statistical model must support the intended inference",
          "a p-value alone is not enough for a direct hypothesis probability"
        ]
      },
      {
        criterion_id: "active_anchor_application",
        criterion_kind: "anchor_application",
        description:
          `The response applies the distinction to option ${OPTION_LABEL} or an accepted p-value alias and rejects the direct hypothesis-probability claim.`,
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          `reject option ${OPTION_LABEL}`,
          "reject the 97 percent interpretation"
        ]
      },
      {
        criterion_id: "coherent_conclusion",
        criterion_kind: "coherent_conclusion",
        description:
          "The response concludes coherently that p = .03 does not mean the research hypothesis has a 97 percent probability of being true.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "the result may be unusual under the null but the 97 percent hypothesis claim does not follow"
        ]
      },
      {
        criterion_id: "optional_posterior_context",
        criterion_kind: "optional_deepening",
        description:
          "The response notes that a posterior hypothesis probability would require additional assumptions, such as a prior and a specified model.",
        essential_for_revision: false,
        acceptable_evidence_patterns: [
          "a posterior probability requires more than the p-value"
        ]
      }
    ],
    contradiction_criteria: [
      {
        contradiction_id: "active_distractor_claim_retained",
        description: DISTRACTOR_CLAIM,
        observable_patterns: [
          `option ${OPTION_LABEL} is correct`,
          "p equals .03 so the hypothesis is 97 percent likely"
        ]
      },
      {
        contradiction_id: "one_minus_p_treated_as_hypothesis_probability",
        description:
          "The response treats one minus the p-value as the probability that the research hypothesis is true.",
        observable_patterns: [
          "one minus .03 gives a 97 percent chance for my hypothesis"
        ]
      },
      {
        contradiction_id:
          "anchor_conclusion_conceptual_explanation_conflict",
        description:
          `The response explains the null-conditional definition of a p-value but still endorses option ${OPTION_LABEL}.`,
        observable_patterns: [
          "the p-value assumes the null, but option D is still correct that the alternative is 97 percent likely"
        ]
      }
    ],
    active_anchor_id: CANONICAL_ANCHOR_ID,
    active_anchor_text:
      `${ITEM_ID} option ${OPTION_LABEL}: ${DISTRACTOR_CLAIM}`,
    active_anchor_type: "distractor_option",
    required_anchor_stance: "rejects_distractor",
    acceptable_anchor_paraphrases:
      aliasContract.accepted_paraphrases,
    prohibited_anchor_stances: [
      "not_expressed",
      "ambiguous",
      "endorses_distractor"
    ],
    anchor_resolution_criteria: [
      `Explicitly apply the p-value reasoning to option ${OPTION_LABEL} or an accepted alias and reject the unsupported hypothesis-probability claim.`
    ],
    anchor_contradiction_criteria: [
      `Endorsing option ${OPTION_LABEL} conflicts with explaining that a p-value is conditional on the null hypothesis.`,
      `Rejecting option ${OPTION_LABEL} without explaining the null condition and the direction of the conditional probability is not sufficient for a sound result.`
    ],
    ambiguity_resolution_policy:
      "Do not infer a final stance from statistical terminology alone. Mixed, implicit, uncertain, or contradictory conclusions require clarification.",
    active_anchor_alias_contract: aliasContract
  });
}

function buildCanonicalAnchorContract(
  aliasContract: ActiveAnchorAliasContract
) {
  return {
    canonical_anchor_contract_version:
      "e2a34-p-value-canonical-anchor-v1",
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    item_id: ITEM_ID,
    option_label: OPTION_LABEL,
    distractor_text: DISTRACTOR_CLAIM,
    required_anchor_application: "explicit",
    required_anchor_stance: "rejects_distractor",
    accepted_aliases: aliasContract.accepted_paraphrases,
    rejection_aliases: [
      `reject option ${OPTION_LABEL}`,
      "the 97 percent interpretation is incorrect",
      "significance does not tell the probability of the hypothesis"
    ],
    mechanism_criteria: [
      "state that the p-value is calculated assuming the null hypothesis",
      "explain observed-data unusualness under the null",
      "distinguish P(Data | Null) from P(Hypothesis | Data)",
      "state why stronger statistical reasoning and design support are required"
    ],
    sound_criteria: [
      "state the null-hypothesis reference condition",
      "explain the unusual-data interpretation",
      "reject the direct hypothesis-probability interpretation",
      "state that stronger claims need appropriate statistical reasoning and design support",
      "apply the distinction to the active distractor and provide a coherent conclusion"
    ],
    contradiction_criteria: [
      "endorse the 97 percent hypothesis claim after stating the null assumption",
      "treat one minus p as a direct hypothesis probability",
      "reject the p-value misconception in explanation but retain it in the conclusion"
    ],
    anchor_reference_and_stance_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    anchor_stance_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION
  };
}

function buildAnchorStanceContract(
  aliasContract: ActiveAnchorAliasContract
) {
  return {
    stance_contract_version: "e2a34-p-value-anchor-stance-v1",
    anchor_reference_resolution_is_separate: true,
    anchor_stance_resolution_is_separate: true,
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    resolver_version: ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    alias_contract_hash: stableHash(aliasContract),
    endorsement_examples: [
      "p=.03 means 97% chance",
      "the hypothesis has a 97% probability",
      "the result proves my hypothesis is probably true",
      "I agree with D",
      "that claim is right"
    ],
    rejection_examples: [
      "p-value does not mean hypothesis probability",
      "that interpretation is incorrect",
      "significance does not tell the probability of the hypothesis",
      "I disagree with D",
      "D sounds plausible, but it is wrong"
    ],
    uncertainty_examples: [
      "I am unsure what p=.03 means",
      "maybe it means the hypothesis is likely",
      "D might be possible"
    ],
    discourse_cases_required: [
      "negation",
      "contrast",
      "pronoun_reference",
      "paraphrase",
      "prior_student_reasoning"
    ],
    decisive_endorsement_maps_to: "endorses_distractor",
    decisive_rejection_maps_to: "rejects_distractor",
    uncertainty_maps_to: "ambiguous",
    domain_specific_logic_prohibited: true
  } as const;
}

const ALIAS_CASES = [
  {
    case_id: "identifier_endorsement",
    category: "explicit_endorsement",
    message:
      "I choose option D because p=.03 means there is a 97% chance the research hypothesis is true.",
    prior: [] as string[],
    expected: "endorses_distractor"
  },
  {
    case_id: "identifier_rejection",
    category: "explicit_rejection",
    message:
      "Option D is wrong because a p-value does not directly state the probability that a hypothesis is true.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "claim_rejection",
    category: "paraphrase_rejection",
    message:
      "The 97 percent interpretation is incorrect because p=.03 is calculated under the null hypothesis.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "pronoun_rejection",
    category: "pronoun_rejection",
    message:
      "That claim is wrong because the p-value describes data under the null, not the probability of the hypothesis.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "paraphrase_endorsement",
    category: "paraphrase_endorsement",
    message:
      "I endorse the hypothesis-probability claim because the result proves my hypothesis is probably true.",
    prior: [] as string[],
    expected: "endorses_distractor"
  },
  {
    case_id: "uncertainty",
    category: "uncertainty",
    message: "Maybe option D, but I am unsure what p=.03 means.",
    prior: [] as string[],
    expected: "ambiguous"
  },
  {
    case_id: "negated_endorsement",
    category: "negation",
    message:
      "Option D is not correct; p=.03 is not a 97% probability for the research hypothesis.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "contrastive_rejection",
    category: "contrast",
    message:
      "The 97 percent interpretation sounds intuitive, but it is incorrect because the p-value assumes the null.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "pronoun_endorsement",
    category: "pronoun_endorsement",
    message:
      "That claim is right: the hypothesis has a 97% probability.",
    prior: [] as string[],
    expected: "endorses_distractor"
  },
  {
    case_id: "paraphrase_uncertainty",
    category: "paraphrase_uncertainty",
    message:
      "The hypothesis-probability claim might be possible, but I am not sure.",
    prior: [] as string[],
    expected: "ambiguous"
  },
  {
    case_id: "p_equals_endorsement",
    category: "required_endorsement_alias",
    message: "p=.03 means 97% chance",
    prior: [] as string[],
    expected: "endorses_distractor"
  },
  {
    case_id: "agreement_endorsement",
    category: "direct_agreement",
    message:
      "I agree with option D because the hypothesis has a 97% probability.",
    prior: [] as string[],
    expected: "endorses_distractor"
  },
  {
    case_id: "hypothesis_probability_endorsement",
    category: "required_endorsement_alias",
    message: "The hypothesis has a 97% probability.",
    prior: [] as string[],
    expected: "endorses_distractor"
  },
  {
    case_id: "proof_endorsement",
    category: "required_endorsement_alias",
    message: "The result proves my hypothesis is probably true.",
    prior: [] as string[],
    expected: "endorses_distractor"
  },
  {
    case_id: "p_value_rejection_alias",
    category: "required_rejection_alias",
    message:
      "Option D is wrong: p-value does not mean hypothesis probability.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "disagreement_rejection",
    category: "direct_disagreement",
    message:
      "I disagree with option D because p-value does not mean hypothesis probability.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "interpretation_rejection_alias",
    category: "required_rejection_alias",
    message: "That interpretation is incorrect.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "significance_rejection_alias",
    category: "required_rejection_alias",
    message:
      "I reject option D because significance does not tell the probability of the hypothesis.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "p_value_uncertainty_alias",
    category: "required_uncertainty_alias",
    message:
      "I am unsure about option D and what p=.03 means.",
    prior: [] as string[],
    expected: "ambiguous"
  },
  {
    case_id: "likely_uncertainty_alias",
    category: "required_uncertainty_alias",
    message:
      "Maybe option D; maybe it means the hypothesis is likely.",
    prior: [] as string[],
    expected: "ambiguous"
  }
] as const;

function validateAliasResolution(aliasContract: ActiveAnchorAliasContract) {
  const results = ALIAS_CASES.map((testCase, index) => {
    const resolution = resolveActiveAnchorAliasV4({
      message: testCase.message,
      contract: aliasContract,
      source_turn_id: `synthetic_e2a34_alias_${testCase.case_id}`,
      source_sequence_index: index + 1,
      prior_visible_message:
        `We are evaluating option ${OPTION_LABEL}: ${DISTRACTOR_CLAIM}`,
      prior_student_reasoning: [...testCase.prior]
    });
    return {
      ...testCase,
      observed_reference: resolution.observed_anchor_reference,
      observed_stance: resolution.observed_anchor_stance,
      resolver_version: resolution.resolver_version,
      stance_resolver_version:
        resolution.independent_stance_evidence_resolution
          .resolver_version,
      passed:
        resolution.observed_anchor_reference === "explicit" &&
        resolution.observed_anchor_stance === testCase.expected
    };
  });
  return {
    validation_version: "e2a34-statistical-inference-alias-validation-v1",
    case_count: results.length,
    required_categories: [
      "explicit_endorsement",
      "explicit_rejection",
      "paraphrase_rejection",
      "pronoun_rejection",
      "paraphrase_endorsement",
      "uncertainty",
      "negation",
      "contrast",
      "pronoun_endorsement",
      "paraphrase_uncertainty",
      "direct_agreement",
      "direct_disagreement",
      "required_endorsement_alias",
      "required_rejection_alias",
      "required_uncertainty_alias"
    ],
    results,
    passed: results.every((result) => result.passed),
    provider_calls_made: 0
  };
}

function allProhibitedStates(): TrajectoryEnvelopeTurn["prohibited_states"] {
  return [
    "trajectory_expectation_overrides_evaluator",
    "revision_delayed_after_sound",
    "copied_wording_without_evidence",
    "blocking_contradiction",
    "unsupported_sound_promotion"
  ];
}

function buildTrajectoryEnvelope(): E2A34TrajectoryEnvelopeContract {
  const progression = buildDefaultTrajectoryProgressionConsequences();
  return E2A34TrajectoryEnvelopeContractSchema.parse({
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    trajectory_role_vocabulary_version:
      E2A34_TRAJECTORY_ROLE_VOCABULARY_VERSION,
    authority_boundary: {
      simulator_intended_trajectory_is_non_authoritative: true,
      evaluator_follows_observable_evidence: true,
      production_sound_gate_is_authoritative_for_progression: true,
      exact_turn_by_turn_reasoning_labels_prohibited: true
    },
    separation: {
      simulator_intended_trajectory:
        "The six statistical-inference trajectory roles guide synthetic student generation only. They do not prescribe the evaluator result at a turn.",
      acceptable_reasoning_quality_envelope:
        "Each role permits a set of observable reasoning qualities. An outcome outside that set is a trajectory-adherence observation, not permission to rewrite evidence.",
      progression_consequences:
        "The existing production sound gate authorizes immediate revision whenever the null-reference, data-unusualness, conditional-direction, anchor-rejection, and coherent-conclusion requirements pass with no essential missing links. No minimum turn count applies."
    },
    required_scenario_states: {
      initial_misconception: {
        student_response:
          "p=.03 means there is a 97% chance the hypothesis is correct.",
        allowed_reasoning_quality_set: ["misconception"],
        progression: "remain_in_dialogue"
      },
      partial_improvement: {
        student_response:
          "I know the p-value assumes the null hypothesis, so the alternative hypothesis is probably 97% true.",
        allowed_reasoning_quality_set: ["partial", "misconception"],
        progression: "remain_in_dialogue"
      },
      contradiction: {
        student_response:
          "I understand that p-values are calculated assuming the null is true, but a very small p-value still means there is a 97% chance my hypothesis is correct.",
        anchor_application: "explicit",
        anchor_stance: "endorses_distractor",
        anchor_consistency:
          "contradictory_to_conceptual_reasoning",
        structured_contradiction:
          "anchor_conclusion_conceptual_explanation_conflict",
        revision_ready: false
      },
      sound: {
        student_response:
          "A p-value of .03 means the observed data would be unlikely if the null hypothesis were true. It does not mean there is a 97% probability that my hypothesis is true.",
        sound: true,
        revision_ready: true,
        progression: "immediate_revision",
        minimum_turns: 0
      }
    },
    turns: [
      {
        turn_index: 1,
        expected_trajectory_role: "misconception",
        runtime_trajectory_role: "initial_anchor_position",
        allowed_reasoning_quality_set: ["misconception", "partial"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: allProhibitedStates()
      },
      {
        turn_index: 2,
        expected_trajectory_role: "copied_wording",
        runtime_trajectory_role: "mechanism_exploration",
        allowed_reasoning_quality_set: [
          "insufficient",
          "misconception",
          "partial"
        ],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: allProhibitedStates()
      },
      {
        turn_index: 3,
        expected_trajectory_role: "partial_improvement",
        runtime_trajectory_role: "mechanism_exploration",
        allowed_reasoning_quality_set: [
          "misconception",
          "partial",
          "sound"
        ],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: allProhibitedStates()
      },
      {
        turn_index: 4,
        expected_trajectory_role: "contradiction",
        runtime_trajectory_role: "anchor_reconciliation",
        allowed_reasoning_quality_set: ["misconception", "partial"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: allProhibitedStates()
      },
      {
        turn_index: 5,
        expected_trajectory_role: "clarification",
        runtime_trajectory_role: "independent_reconstruction",
        allowed_reasoning_quality_set: [
          "insufficient",
          "partial",
          "sound"
        ],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: allProhibitedStates()
      },
      {
        turn_index: 6,
        expected_trajectory_role: "sound",
        runtime_trajectory_role: "revision_readiness",
        allowed_reasoning_quality_set: ["partial", "sound"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: allProhibitedStates()
      }
    ]
  });
}

function projectRuntimeTrajectoryEnvelope(
  envelope: E2A34TrajectoryEnvelopeContract
): TrajectoryEnvelopeContract {
  return TrajectoryEnvelopeContractSchema.parse({
    trajectory_envelope_version: envelope.trajectory_envelope_version,
    authority_boundary: envelope.authority_boundary,
    separation: envelope.separation,
    turns: envelope.turns.map((turn) => ({
      turn_index: turn.turn_index,
      expected_trajectory_role: turn.runtime_trajectory_role,
      allowed_reasoning_quality_set:
        turn.allowed_reasoning_quality_set,
      sound_gate_override_rule: turn.sound_gate_override_rule,
      progression_consequence: turn.progression_consequence,
      prohibited_states: turn.prohibited_states
    }))
  });
}

function buildFutureCanaryProtocolTemplate(
  trajectoryEnvelope: E2A34TrajectoryEnvelopeContract
) {
  return {
    template_version: "e2a34-future-canary-protocol-template-v1",
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    trajectory_role_vocabulary_version:
      E2A34_TRAJECTORY_ROLE_VOCABULARY_VERSION,
    required_turn_fields: [
      "expected_trajectory_role",
      "allowed_reasoning_quality_set",
      "sound_gate_override_rule",
      "progression_consequence",
      "prohibited_states"
    ],
    prohibited_turn_fields: [
      "expected_exact_reasoning_quality",
      "required_exact_reasoning_label",
      "human_adjudicated_earliest_sound_turn"
    ],
    authority_boundary: trajectoryEnvelope.authority_boundary,
    sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
    evaluator_output_must_not_be_rewritten_by_trajectory: true,
    revision_must_begin_immediately_when_sound_gate_passes: true,
    minimum_turns_before_revision: 0,
    required_scenario_states:
      trajectoryEnvelope.required_scenario_states,
    template_turns: trajectoryEnvelope.turns
  };
}

function soundInterpretation(): AnchorInterpretation {
  return {
    interpretation_version: "anchor-conclusion-consistency-v1",
    anchor_application: "explicit",
    anchor_stance: "rejects_distractor",
    anchor_consistency: "consistent_with_conceptual_reasoning",
    anchor_resolution_status: "resolved_against_distractor",
    anchor_reference_spans: ["option D"],
    anchor_stance_spans: ["option D is wrong"],
    blocking_limitations: [],
    contradictions: [],
    clarification_required: false
  };
}

function partialInterpretation(): AnchorInterpretation {
  return {
    interpretation_version: "anchor-conclusion-consistency-v1",
    anchor_application: "explicit",
    anchor_stance: "ambiguous",
    anchor_consistency: "unresolved",
    anchor_resolution_status: "unresolved",
    anchor_reference_spans: ["option D"],
    anchor_stance_spans: [],
    blocking_limitations: [],
    contradictions: [],
    clarification_required: true
  };
}

function contradictionInterpretation(): AnchorInterpretation {
  return {
    interpretation_version: "anchor-conclusion-consistency-v1",
    anchor_application: "explicit",
    anchor_stance: "endorses_distractor",
    anchor_consistency: "contradictory_to_conceptual_reasoning",
    anchor_resolution_status: "contradictory",
    anchor_reference_spans: ["option D"],
    anchor_stance_spans: ["option D is still correct"],
    blocking_limitations: [],
    contradictions: [
      "anchor_conclusion_conceptual_explanation_conflict"
    ],
    clarification_required: true
  };
}

function runSoundGateFixture(
  fixture: "sound" | "partial" | "contradiction" | "copied"
) {
  if (fixture === "sound") {
    return evaluateAnchorConsistentSoundGate({
      all_essential_conceptual_relationships_satisfied: true,
      required_mechanism_demonstrated: true,
      coherent_conclusion: true,
      essential_missing_links: [],
      contradictions: [],
      interpretation: soundInterpretation()
    });
  }
  if (fixture === "contradiction") {
    return evaluateAnchorConsistentSoundGate({
      all_essential_conceptual_relationships_satisfied: true,
      required_mechanism_demonstrated: true,
      coherent_conclusion: false,
      essential_missing_links: ["coherent_conclusion"],
      contradictions: [
        "anchor_conclusion_conceptual_explanation_conflict"
      ],
      interpretation: contradictionInterpretation()
    });
  }
  if (fixture === "copied") {
    return evaluateAnchorConsistentSoundGate({
      all_essential_conceptual_relationships_satisfied: false,
      required_mechanism_demonstrated: false,
      coherent_conclusion: false,
      essential_missing_links: [
        "target_conceptual_relationship",
        "required_mechanism",
        "coherent_conclusion"
      ],
      contradictions: [],
      interpretation: soundInterpretation()
    });
  }
  return evaluateAnchorConsistentSoundGate({
    all_essential_conceptual_relationships_satisfied: false,
    required_mechanism_demonstrated: true,
    coherent_conclusion: false,
    essential_missing_links: [
      "target_conceptual_relationship",
      "coherent_conclusion"
    ],
    contradictions: [],
    interpretation: partialInterpretation()
  });
}

function qualityPreserved(
  expected: TrajectoryReasoningQuality,
  observed: TrajectoryReasoningQuality
) {
  return expected === observed;
}

function validateRequiredContradiction(
  aliasContract: ActiveAnchorAliasContract,
  targetContract: TargetEvidenceContractV5
) {
  const studentResponse =
    "I understand that p-values are calculated assuming the null is true, but a very small p-value still means there is a 97% chance my hypothesis is correct, so I endorse option D.";
  const sourceTurnId =
    "synthetic_e2a34_required_contradiction";
  const resolution = resolveActiveAnchorAliasV4({
    message: studentResponse,
    contract: aliasContract,
    source_turn_id: sourceTurnId,
    source_sequence_index: 4,
    prior_visible_message:
      `Evaluate option ${OPTION_LABEL}: ${DISTRACTOR_CLAIM}`,
    prior_student_reasoning: [
      "The p-value is calculated under the null hypothesis."
    ],
    evaluator_canonical_evidence: {
      canonicalization_version: CANONICAL_ANCHOR_EVIDENCE_VERSION,
      anchor_id: CANONICAL_ANCHOR_ID,
      anchor_label: OPTION_LABEL,
      anchor_text: DISTRACTOR_CLAIM,
      matched_alias: `option ${OPTION_LABEL}`,
      match_type: "exact_identifier",
      application: "explicit",
      stance: "endorses_distractor",
      evidence_spans: [
        {
          label: "anchor_reference",
          span: `option ${OPTION_LABEL}`,
          start_index: studentResponse.indexOf(`option ${OPTION_LABEL}`)
        },
        {
          label: "anchor_stance",
          span: `I endorse option ${OPTION_LABEL}`,
          start_index: studentResponse.indexOf(
            `I endorse option ${OPTION_LABEL}`
          )
        }
      ],
      source_turn_id: sourceTurnId,
      source_sequence_index: 4,
      confidence: null
    }
  });
  const propagation = assertBlockingAnchorConflictPropagatedV2(
    propagateAnchorContradictionV2({
      contract: targetContract,
      structured_evidence: {
        evaluator_version:
          PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
        source_student_turn_id:
          "synthetic_e2a34_required_contradiction",
        source_sequence_index: 4,
        active_anchor_id: CANONICAL_ANCHOR_ID,
        observed_anchor_reference: "explicit",
        observed_anchor_identifier: `option ${OPTION_LABEL}`,
        observed_anchor_text: DISTRACTOR_CLAIM,
        observed_anchor_conclusion: "endorses_distractor",
        observed_anchor_stance: "endorses_distractor",
        conceptual_mechanism:
          "A p-value is calculated under the assumption that the null hypothesis is true.",
        conceptual_conclusion: "rejects_distractor",
        anchor_concept_alignment: "contradictory",
        anchor_conflict_type:
          "anchor_conclusion_conceptual_explanation_conflict",
        blocking_conflict: true,
        exact_anchor_evidence_spans: [
          {
            label: "anchor_reference",
            span: "option D"
          },
          {
            label: "anchor_stance",
            span: "I endorse option D"
          }
        ],
        exact_conceptual_evidence_spans: [
          {
            label: "conceptual_mechanism",
            span:
              "p-values are calculated assuming the null is true"
          },
          {
            label: "conceptual_conclusion",
            span:
              "a p-value is not itself the probability that a hypothesis is true"
          }
        ],
        essential_missing_links: [
          "active_anchor_application",
          "coherent_conclusion"
        ],
        confidence_evidence: null,
        engagement_evidence: [],
        evidence_limitations: [
          "The conceptual explanation conflicts with the final anchor stance."
        ]
      },
      anchor_application: resolution.observed_anchor_reference,
      anchor_stance: resolution.observed_anchor_stance,
      exact_anchor_spans: [
        {
          label: "anchor_reference",
          span: "option D"
        },
        {
          label: "anchor_stance",
          span: "I endorse option D"
        }
      ],
      mapper_version: "e2a34-statistical-inference-contradiction-fixture-v1"
    })
  );
  const soundGate = evaluateAnchorConsistentSoundGate({
    all_essential_conceptual_relationships_satisfied: true,
    required_mechanism_demonstrated: true,
    coherent_conclusion: false,
    essential_missing_links: [
      "active_anchor_application",
      "coherent_conclusion"
    ],
    contradictions: [
      "anchor_conclusion_conceptual_explanation_conflict"
    ],
    interpretation: propagation.anchor_interpretation
  });
  const observed = {
    anchor_application: propagation.anchor_application,
    anchor_stance: propagation.anchor_stance,
    anchor_consistency: propagation.anchor_consistency,
    revision_ready: propagation.revision_ready && soundGate.passed
  };
  const expected = {
    anchor_application: "explicit",
    anchor_stance: "endorses_distractor",
    anchor_consistency: "contradictory_to_conceptual_reasoning",
    revision_ready: false
  } as const;
  return {
    validation_version:
      "e2a34-required-p-value-contradiction-validation-v1",
    student_response: studentResponse,
    expected,
    observed,
    resolver_version: resolution.resolver_version,
    stance_resolver_version:
      resolution.independent_stance_evidence_resolution
        .resolver_version,
    contradiction_propagation_version:
      propagation.propagation_version,
    contradiction_propagation: propagation,
    sound_gate_result: soundGate,
    passed:
      observed.anchor_application === expected.anchor_application &&
      observed.anchor_stance === expected.anchor_stance &&
      observed.anchor_consistency === expected.anchor_consistency &&
      observed.revision_ready === expected.revision_ready,
    provider_calls_made: 0
  };
}

export function runE2A34TrajectoryRegressions(
  envelope = buildTrajectoryEnvelope()
) {
  const runtimeEnvelope = projectRuntimeTrajectoryEnvelope(envelope);
  const exactLabelFieldSchemaRejectionPassed =
    !E2A34TrajectoryEnvelopeTurnSchema.safeParse({
      ...envelope.turns[0],
      expected_exact_reasoning_quality: "misconception"
    }).success;
  const exactTurnReasoningLabelsAbsent = envelope.turns.every((turn) =>
    !Object.keys(turn).some((key) => [
      "expected_exact_reasoning_quality",
      "required_exact_reasoning_label",
      "human_adjudicated_earliest_sound_turn"
    ].includes(key))
  );
  const requiredRoles: E2A34TrajectoryRole[] = [
    "misconception",
    "copied_wording",
    "partial_improvement",
    "contradiction",
    "clarification",
    "sound"
  ];
  const rolesComplete = requiredRoles.every((role) =>
    envelope.turns.some((turn) =>
      turn.expected_trajectory_role === role
    )
  );
  const runtimeTurn = (index: number) => runtimeEnvelope.turns[index]!;
  const cases = [
    {
      case_id: "early_sound_overrides_trajectory",
      scenario_role: envelope.turns[0]!.expected_trajectory_role,
      turn: runtimeTurn(0),
      evaluator_reasoning_quality: "sound" as const,
      gate: runSoundGateFixture("sound"),
      independent: true,
      copied: false,
      contradiction: false,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_adherence: "sound_earlier_than_intended",
      expected_progression: "immediate_revision",
      contextual_signals: {}
    },
    {
      case_id: "prolonged_partial",
      scenario_role: envelope.turns[5]!.expected_trajectory_role,
      turn: runtimeTurn(5),
      evaluator_reasoning_quality: "partial" as const,
      gate: runSoundGateFixture("partial"),
      independent: true,
      copied: false,
      contradiction: false,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_adherence: "partial_longer_than_intended",
      expected_progression: "continue_evidence_targeted_tutor",
      contextual_signals: {}
    },
    {
      case_id: "contradiction_after_improvement",
      scenario_role: envelope.turns[3]!.expected_trajectory_role,
      turn: runtimeTurn(3),
      evaluator_reasoning_quality: "partial" as const,
      gate: runSoundGateFixture("contradiction"),
      independent: true,
      copied: false,
      contradiction: true,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_adherence: "inside_allowed_envelope",
      expected_progression: "reopen_targeted_support",
      contextual_signals: {
        conceptual_improvement_present: true,
        distractor_still_endorsed: true
      }
    },
    {
      case_id: "copied_wording_without_understanding",
      scenario_role: envelope.turns[1]!.expected_trajectory_role,
      turn: runtimeTurn(1),
      evaluator_reasoning_quality: "insufficient" as const,
      gate: runSoundGateFixture("copied"),
      independent: false,
      copied: true,
      contradiction: false,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_adherence: "copied_wording_without_evidence",
      expected_progression: "request_independent_evidence",
      contextual_signals: {
        repeated_phrase: "a p-value assumes the null hypothesis",
        mechanism_evidence_present: false
      }
    },
    {
      case_id: "confidence_correctness_mismatch",
      scenario_role: envelope.turns[4]!.expected_trajectory_role,
      turn: runtimeTurn(4),
      evaluator_reasoning_quality: "partial" as const,
      gate: runSoundGateFixture("partial"),
      independent: true,
      copied: false,
      contradiction: false,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_adherence: "inside_allowed_envelope",
      expected_progression: "continue_evidence_targeted_tutor",
      contextual_signals: {
        selected_answer_correct: true,
        confidence: "high",
        conceptual_evidence_complete: false
      }
    },
    {
      case_id: "explicit_distractor_endorsement",
      scenario_role: envelope.turns[0]!.expected_trajectory_role,
      turn: runtimeTurn(0),
      evaluator_reasoning_quality: "misconception" as const,
      gate: runSoundGateFixture("contradiction"),
      independent: true,
      copied: false,
      contradiction: true,
      prior_quality: null,
      prior_sound: false,
      expected_adherence: "inside_allowed_envelope",
      expected_progression: "reopen_targeted_support",
      contextual_signals: {
        anchor_stance: "endorses_distractor"
      }
    },
    {
      case_id: "explicit_distractor_rejection",
      scenario_role: envelope.turns[4]!.expected_trajectory_role,
      turn: runtimeTurn(4),
      evaluator_reasoning_quality: "partial" as const,
      gate: runSoundGateFixture("partial"),
      independent: true,
      copied: false,
      contradiction: false,
      prior_quality: "misconception" as const,
      prior_sound: false,
      expected_adherence: "inside_allowed_envelope",
      expected_progression: "continue_evidence_targeted_tutor",
      contextual_signals: {
        anchor_stance: "rejects_distractor",
        null_reference_condition_present: true,
        conditional_probability_direction_complete: false
      }
    },
    {
      case_id: "missing_statistical_reasoning",
      scenario_role: envelope.turns[4]!.expected_trajectory_role,
      turn: runtimeTurn(4),
      evaluator_reasoning_quality: "insufficient" as const,
      gate: runSoundGateFixture("copied"),
      independent: true,
      copied: false,
      contradiction: false,
      prior_quality: null,
      prior_sound: false,
      expected_adherence: "inside_allowed_envelope",
      expected_progression: "continue_evidence_targeted_tutor",
      contextual_signals: {
        response: "I disagree with D.",
        null_reference_condition_present: false,
        data_extremeness_interpretation_present: false
      }
    },
    {
      case_id: "sound_rejection_of_p_value_misconception",
      scenario_role: envelope.turns[5]!.expected_trajectory_role,
      turn: runtimeTurn(5),
      evaluator_reasoning_quality: "sound" as const,
      gate: runSoundGateFixture("sound"),
      independent: true,
      copied: false,
      contradiction: false,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_adherence: "inside_allowed_envelope",
      expected_progression: "immediate_revision",
      contextual_signals: {
        transfer_scenario:
          "A second study reports p=.02; the student explains the null-conditional data probability and rejects a 98 percent hypothesis-probability interpretation.",
        p_value_boundary_applied_independently: true
      }
    }
  ].map((testCase) => {
    const decision = evaluateTrajectoryEnvelope({
      turn_contract: testCase.turn,
      evaluator_reasoning_quality:
        testCase.evaluator_reasoning_quality,
      sound_gate_result: testCase.gate,
      evidence_independently_supported: testCase.independent,
      copied_wording_without_evidence: testCase.copied,
      blocking_contradiction: testCase.contradiction,
      prior_reasoning_quality: testCase.prior_quality,
      prior_sound_gate_passed: testCase.prior_sound,
      turn_budget_exhausted: false
    });
    const passed =
      qualityPreserved(
        testCase.evaluator_reasoning_quality,
        decision.evaluator_reasoning_quality
      ) &&
      decision.trajectory_adherence === testCase.expected_adherence &&
      decision.progression_decision === testCase.expected_progression &&
      decision.trajectory_expectation_changed_evaluator_output === false &&
      (
        testCase.case_id !== "early_sound_overrides_trajectory" ||
        (
          decision.sound_gate_override_applied &&
          decision.revision_required_immediately &&
          !decision.tutor_should_be_called
        )
      );
    return {
      case_id: testCase.case_id,
      scenario_trajectory_role: testCase.scenario_role,
      evaluator_reasoning_quality:
        testCase.evaluator_reasoning_quality,
      contextual_signals: testCase.contextual_signals,
      sound_gate_result: testCase.gate,
      runtime_trajectory_role:
        testCase.turn.expected_trajectory_role,
      allowed_reasoning_quality_set:
        testCase.turn.allowed_reasoning_quality_set,
      expected_adherence: testCase.expected_adherence,
      expected_progression: testCase.expected_progression,
      decision,
      passed
    };
  });
  return {
    regression_version:
      "e2a34-statistical-inference-trajectory-regressions-v1",
    sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    trajectory_role_vocabulary_version:
      E2A34_TRAJECTORY_ROLE_VOCABULARY_VERSION,
    case_count: cases.length,
    required_case_ids: [
      "early_sound_overrides_trajectory",
      "prolonged_partial",
      "contradiction_after_improvement",
      "copied_wording_without_understanding",
      "confidence_correctness_mismatch",
      "explicit_distractor_endorsement",
      "explicit_distractor_rejection",
      "missing_statistical_reasoning",
      "sound_rejection_of_p_value_misconception"
    ],
    required_trajectory_roles: requiredRoles,
    required_trajectory_roles_complete: rolesComplete,
    evaluator_follows_evidence: cases.every((testCase) =>
      testCase.decision.evaluator_reasoning_quality_preserved
    ),
    exact_turn_reasoning_labels_absent:
      exactTurnReasoningLabelsAbsent,
    exact_label_field_schema_rejection_passed:
      exactLabelFieldSchemaRejectionPassed,
    sound_gate_overrides_trajectory_expectation:
      cases.find((testCase) =>
        testCase.case_id === "early_sound_overrides_trajectory"
      )?.decision.sound_gate_override_applied === true,
    revision_immediate_when_sound_reached:
      cases.filter((testCase) =>
        testCase.sound_gate_result.passed
      ).every((testCase) =>
        testCase.decision.revision_required_immediately &&
        !testCase.decision.tutor_should_be_called
      ),
    confidence_and_correctness_do_not_promote_incomplete_evidence:
      cases.find((testCase) =>
        testCase.case_id === "confidence_correctness_mismatch"
      )?.decision.progression_decision ===
        "continue_evidence_targeted_tutor",
    sound_p_value_rejection_authorizes_revision:
      cases.find((testCase) =>
        testCase.case_id ===
          "sound_rejection_of_p_value_misconception"
      )?.decision.revision_required_immediately === true,
    cases,
    passed:
      cases.every((testCase) => testCase.passed) &&
      exactTurnReasoningLabelsAbsent &&
      exactLabelFieldSchemaRejectionPassed &&
      rolesComplete,
    provider_calls_made: 0
  };
}

function compileEvaluatorV5Request(contract: TargetEvidenceContractV5) {
  const sourceStudentTurn = {
    source_student_turn_id: "synthetic_e2a34_student_turn_1",
    source_sequence_index: 2
  };
  const studentMessage =
    "Option D is not supported. A p-value of .03 describes how unusual the observed data would be if the null hypothesis were true. That is P(Data | Null), not a 97% value for P(Hypothesis | Data), so stronger claims require appropriate statistical reasoning and design support.";
  const legacyInput = {
    schema_version: ACTIVITY_RESPONSE_EVALUATOR_INPUT_SCHEMA_VERSION,
    case_id: "e2a34_statistical_inference_turn_1",
    session_public_id: "synthetic_e2a34_session_1",
    student_public_id: "synthetic_e2a34_student_1",
    assessment_public_id: "synthetic_e2a34_assessment_1",
    concept_unit_id: CONCEPT_ID,
    activity_attempt_id: "synthetic_e2a34_activity_1",
    required_output_contract: {
      schema_version: ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
      evaluator_agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
      evaluation_source: "live_llm",
      runtime_servable_to_student: false,
      review_only: false
    },
    source_activity_context: {
      source_activity_schema: FORMATIVE_ACTIVITY_SCHEMA_VERSION,
      source_activity_generation_source: "live_llm",
      source_activity_runtime_servable_to_student: true,
      source_activity_family: "reasoning_chain_repair",
      selected_formative_value: "reasoning_refinement",
      source_diagnostic_purpose: "reasoning_boundary_repair",
      profile_condition: "synthetic_frozen_e2a34_trajectory",
      distractor_role: "selected_distractor",
      safe_activity_prompt:
        "Explain whether p = .03 supports the claim that the research hypothesis has a 97% probability of being true."
    },
    student_activity_response: {
      safe_response_summary: studentMessage,
      response_kind_hint: "substantive"
    },
    diagnostic_task: {
      expected_evidence_focus: [
        ...contract.target_conceptual_relationships,
        ...contract.required_mechanisms,
        contract.required_anchor_application
      ].join(" "),
      process_context_is_reliability_context_only: true,
      low_information_response_policy:
        "Repeating that a p-value is not a hypothesis probability is insufficient without stating the null condition, explaining data unusualness, distinguishing the conditional direction, and applying that reasoning to the 97 percent claim."
    },
    target_evidence_contract: contract,
    complete_visible_formative_conversation: {
      dialogue_public_id: "synthetic_e2a34_dialogue_1",
      activity_attempt_public_id: "synthetic_e2a34_activity_1",
      turns: [
        {
          actor: "assistant",
          sequence_index: 1,
          message:
            "Consider option D. Explain what p = .03 is conditional on and what it does and does not say about the probability of the research hypothesis."
        },
        {
          actor: "student",
          sequence_index: 2,
          source_student_turn_id:
            sourceStudentTurn.source_student_turn_id,
          message: studentMessage
        }
      ]
    },
    required_safety_constraints: {
      no_answer_key: true,
      no_correct_option: true,
      no_correctness_label: true,
      no_raw_distractor_metadata: true,
      no_misconception_ids: true,
      no_engagement_or_ai_labels: true,
      no_raw_process_payload: true,
      no_raw_llm_output: true,
      no_secrets_or_headers: true,
      no_misconduct_or_genai_accusation: true
    }
  };
  const providerInput = buildProductionTurnEvidenceEvaluatorInputV5({
    legacy_evaluator_input: legacyInput,
    source_student_turn: sourceStudentTurn,
    active_anchor_alias_contract:
      contract.active_anchor_alias_contract
  });
  ProductionTurnEvidenceEvaluatorInputV5Schema.parse(providerInput);
  const candidate = evaluateE2A24Candidate();
  const modelConfig = candidate.full_candidate.roles[
    "formative_activity_response_evaluator_agent"
  ];
  if (!modelConfig) {
    throw new Error("e2a34_evaluator_model_config_missing");
  }
  const request = {
    agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
    model_config: modelConfig,
    instructions: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_INSTRUCTIONS_V5,
    input: providerInput,
    output_schema: ProductionTurnEvidenceEvaluatorOutputV5Schema,
    schema_name:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    client_request_id: "e2a34_compile_only_evaluator_turn_1",
    timeout_ms: 90_000,
    metadata: {
      evaluation_phase: "e2a34_compile_only_no_live",
      role: "evidence_evaluator",
      session_id: "E2A34-STATISTICAL-INFERENCE",
      turn_number: "1",
      prompt_version:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
      prompt_hash:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
      execution_authorized: "false"
    }
  } satisfies StructuredAgentRequest<typeof providerInput, unknown>;
  const projection = {
    request_compilation_version: "e2a34-evaluator-v5-request-v1",
    compilation_mode: "compile_only_no_provider",
    agent_name: request.agent_name,
    model_config: request.model_config,
    prompt_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
    prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    repair_prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    input_schema_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
    output_schema_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    schema_name: request.schema_name,
    client_request_id: request.client_request_id,
    timeout_ms: request.timeout_ms,
    metadata: request.metadata,
    input: request.input,
    canonical_request_hash:
      canonicalStructuredAgentRequestHash(request),
    output_schema_runtime_validation_present: true,
    provider_dispatch_performed: false
  };
  const oldContracts = JSON.stringify(projection).match(
    /production-turn-evidence-evaluator-(?:prompt-|input-|output-)?v[1-4]\b/gu
  ) ?? [];
  return {
    ...projection,
    old_evaluator_contract_matches: [...new Set(oldContracts)],
    passed:
      oldContracts.length === 0 &&
      projection.evaluator_version ===
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5 &&
      projection.schema_name ===
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    provider_calls_made: 0
  };
}

function heldOutDomain() {
  return {
    domain_contract_version: "e2a34-held-out-domain-v1",
    domain: "research_methods_and_statistical_inference",
    topic: "p_value_interpretation_and_inverse_probability",
    concept_id: CONCEPT_ID,
    item_id: ITEM_ID,
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    distractor_option: OPTION_LABEL,
    distractor_claim: DISTRACTOR_CLAIM,
    scenario: INITIAL_ACTIVITY,
    held_out_scope:
      "p_value_null_conditional_scenario_anchor_aliases_and_trajectory",
    broad_concept_overlap_disclosed: false,
    broad_concept_overlap_stage: null,
    broad_concept_overlap: null,
    prior_causal_inference_scenario_compared: true,
    not_a_renamed_causal_inference_scenario: true,
    distinction_from_e2a33:
      "E2A.33 tests causal identification from an observed association and a confounder mechanism. E2A.34 tests inversion of a null-conditional p-value into a hypothesis probability; it requires no correlation, confounder, or causal-effect conclusion.",
    exact_scenario_previously_used: false,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    tutor_candidate_changed: false,
    execution_authorized: false,
    live_execution_performed: false
  };
}

function runOverlapAnalysis(contract: TargetEvidenceContractV5) {
  const plannedTexts = [
    heldOutDomain().scenario,
    DISTRACTOR_CLAIM,
    ...contract.target_conceptual_relationships,
    ...contract.required_mechanisms,
    ...contract.acceptable_equivalent_explanations
  ];
  const semanticTags = [
    "research_methods",
    "statistical_inference",
    "p_value_interpretation",
    "null_hypothesis_reference_distribution",
    "inverse_probability_fallacy",
    "conditional_probability_direction"
  ];
  const structuralTags = [
    "conditional_direction_reversal",
    "evidence_strength_not_hypothesis_probability",
    "trajectory_envelope_v1"
  ];
  const prohibitedDomainAliases = [
    "ecology",
    "trophic cascade",
    "thermal physics",
    "heat transfer",
    "electrical circuit",
    "series current",
    "antimicrobial resistance",
    "geometrical optics",
    "converging lens",
    "binary search",
    "item response theory",
    "irt theta",
    "educational app",
    "exam score association",
    "correlation proves causation",
    "confounding variable",
    "motivation affects both"
  ];
  const prohibitedAliasMatches = prohibitedDomainAliases.filter((alias) =>
    plannedTexts.some((text) =>
      normalizedText(text).includes(normalizedText(alias))
    )
  );
  const allowedSemanticOverlap: Record<string, string[]> = {};
  const allowedStructuralOverlap: Record<string, string[]> = {
    "E2A.32": ["trajectory_envelope_v1"],
    "E2A.33": ["trajectory_envelope_v1"]
  };
  const stageResults = HISTORICAL_INPUTS.map((historical) => {
    const historicalStrings = stringsFromArtifact(historical.path);
    let exactMatchCount = 0;
    let normalizedMatchCount = 0;
    let maximumTokenOverlap = 0;
    for (const planned of plannedTexts) {
      for (const prior of historicalStrings) {
        if (planned === prior) exactMatchCount += 1;
        if (normalizedText(planned) === normalizedText(prior)) {
          normalizedMatchCount += 1;
        }
        maximumTokenOverlap = Math.max(
          maximumTokenOverlap,
          tokenJaccard(planned, prior)
        );
      }
    }
    const historicalSemanticTags = new Set<string>(
      historical.semantic_tags
    );
    const historicalStructuralTags = new Set<string>(
      historical.structural_tags
    );
    const semanticOverlap = semanticTags.filter((tag) =>
      historicalSemanticTags.has(tag)
    );
    const structuralOverlap = structuralTags.filter((tag) =>
      historicalStructuralTags.has(tag)
    );
    const unexpectedSemanticOverlap = semanticOverlap.filter((tag) =>
      !(allowedSemanticOverlap[historical.stage] ?? []).includes(tag)
    );
    const unexpectedStructuralOverlap = structuralOverlap.filter((tag) =>
      !(allowedStructuralOverlap[historical.stage] ?? []).includes(tag)
    );
    const exactScenarioReuse =
      [...historicalStrings].some((prior) =>
        normalizedText(prior) === normalizedText(INITIAL_ACTIVITY)
      );
    return {
      stage: historical.stage,
      source_path: historical.path,
      source_sha256: fileSha256(historical.path),
      historical_string_count: historicalStrings.size,
      exact_match_count: exactMatchCount,
      normalized_match_count: normalizedMatchCount,
      maximum_token_jaccard:
        Number(maximumTokenOverlap.toFixed(4)),
      semantic_tag_overlap: semanticOverlap,
      structural_tag_overlap: structuralOverlap,
      allowed_semantic_tag_overlap:
        allowedSemanticOverlap[historical.stage] ?? [],
      allowed_structural_tag_overlap:
        allowedStructuralOverlap[historical.stage] ?? [],
      unexpected_semantic_tag_overlap: unexpectedSemanticOverlap,
      unexpected_structural_tag_overlap: unexpectedStructuralOverlap,
      exact_scenario_reuse: exactScenarioReuse,
      broad_concept_or_template_overlap_disclosed:
        semanticOverlap.length > 0 || structuralOverlap.length > 0,
      passed:
        exactMatchCount === 0 &&
        normalizedMatchCount === 0 &&
        maximumTokenOverlap < 0.85 &&
        !exactScenarioReuse &&
        unexpectedSemanticOverlap.length === 0 &&
        unexpectedStructuralOverlap.length === 0
    };
  });
  return {
    analysis_version:
      "e2a34-p-value-overlap-analysis-v1",
    comparison_scope: "E2A.24_through_E2A.33d",
    methods: {
      exact: "byte-equal comparison of bounded content strings",
      normalized:
        "case-folded punctuation-normalized whitespace-collapsed comparison",
      token:
        "deterministic token Jaccard with a pass threshold below 0.85",
      structural:
        "frozen content-structure tag comparison with declared reuse of trajectory-envelope-v1 only",
      semantic:
        "frozen concept-tag comparison without embeddings or provider calls; p-value conditional-direction concepts are distinct from E2A.33 causal-identification concepts"
    },
    held_out_scope: heldOutDomain().held_out_scope,
    novelty_classification:
      "held_out_p_value_interpretation_scenario_and_mechanism",
    concept_level_novelty_claimed: true,
    declared_broad_concept_overlap: null,
    declared_protocol_template_overlap: {
      stages: ["E2A.32", "E2A.33"],
      structural_tag: "trajectory_envelope_v1",
      rationale:
        "Reuse is required to test cross-domain generalization of the frozen trajectory-envelope system."
    },
    causal_inference_rename_check: {
      compared_stage: "E2A.33",
      prohibited_alias_matches: prohibitedAliasMatches,
      mechanism_distinction:
        "Null-conditional data unusualness and inverse conditional probability replace causal association, confounding, and causal-design criteria.",
      passed: prohibitedAliasMatches.length === 0
    },
    candidate_semantic_tags: semanticTags,
    candidate_structural_tags: structuralTags,
    prohibited_domain_aliases: prohibitedDomainAliases,
    prohibited_domain_alias_matches: prohibitedAliasMatches,
    semantic_tag_audit_passed: prohibitedAliasMatches.length === 0,
    planned_text_count: plannedTexts.length,
    stage_results: stageResults,
    no_prior_scenario_reuse: stageResults.every((result) =>
      !result.exact_scenario_reuse &&
      result.exact_match_count === 0 &&
      result.normalized_match_count === 0
    ),
    passed:
      stageResults.every((result) => result.passed) &&
      prohibitedAliasMatches.length === 0,
    provider_calls_made: 0
  };
}

function buildBudget() {
  const maximum = {
    isolated_sessions: 1,
    simulator_calls: 9,
    evidence_evaluator_calls: 9,
    initial_tutor_calls: 9,
    tutor_semantic_regenerations: 2,
    logical_generation_calls: 29,
    adapter_attempts: 87,
    adapter_attempts_per_logical_call: 3,
    transport_retries_per_logical_call: 2,
    input_tokens: 900_000,
    output_tokens: 70_000,
    total_tokens: 970_000,
    cost_usd_when_pricing_available: 25,
    provider_concurrency: 1
  };
  return {
    budget_version: "e2a34-bounded-canary-budget-v1",
    maximum,
    arithmetic_valid:
      maximum.logical_generation_calls ===
        maximum.simulator_calls +
        maximum.evidence_evaluator_calls +
        maximum.initial_tutor_calls +
        maximum.tutor_semantic_regenerations &&
      maximum.adapter_attempts ===
        maximum.logical_generation_calls *
        maximum.adapter_attempts_per_logical_call &&
      maximum.total_tokens ===
        maximum.input_tokens + maximum.output_tokens,
    execution_authorized: false,
    provider_calls_made: 0
  };
}

function candidateIntegrity() {
  const candidate = evaluateE2A24Candidate();
  const candidateFileHash = sha256(readFileSync(E2A24_CANDIDATE_PATH));
  return {
    integrity_version: "e2a34-candidate-integrity-v1",
    expected_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    actual_configuration_hash:
      candidate.candidate_configuration_hash,
    expected_file_sha256: CANDIDATE_FILE_SHA256,
    actual_file_sha256: candidateFileHash,
    approved_baseline_hash: candidate.approved_v2_hash,
    candidate_approved: candidate.candidate_approved,
    candidate_activated: candidate.candidate_activated,
    passed:
      candidate.candidate_configuration_hash ===
        CANDIDATE_CONFIGURATION_HASH &&
      candidateFileHash === CANDIDATE_FILE_SHA256 &&
      candidate.approved_v2_hash === APPROVED_BASELINE_HASH &&
      !candidate.candidate_approved &&
      !candidate.candidate_activated
  };
}

function protectedSourceIntegrity() {
  const actual = Object.fromEntries(
    Object.keys(EXPECTED_PROTECTED_SOURCE_HASHES).map((relativePath) => [
      relativePath,
      fileSha256(relativePath)
    ])
  );
  const mismatches = Object.entries(EXPECTED_PROTECTED_SOURCE_HASHES)
    .filter(([relativePath, expected]) =>
      actual[relativePath] !== expected
    )
    .map(([relativePath, expected]) => ({
      relative_path: relativePath,
      expected_sha256: expected,
      actual_sha256: actual[relativePath]
    }));
  return {
    integrity_version: "e2a34-protected-source-integrity-v1",
    expected_sha256: EXPECTED_PROTECTED_SOURCE_HASHES,
    actual_sha256: actual,
    evaluator_v5_unchanged:
      actual[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ] ===
      EXPECTED_PROTECTED_SOURCE_HASHES[
        "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
      ],
    tutor_candidate_unchanged:
      actual[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ] ===
      EXPECTED_PROTECTED_SOURCE_HASHES[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ],
    canonical_anchor_evidence_unchanged:
      actual[
        "src/lib/services/student-assessment/canonical-anchor-evidence.ts"
      ] ===
      EXPECTED_PROTECTED_SOURCE_HASHES[
        "src/lib/services/student-assessment/canonical-anchor-evidence.ts"
      ],
    reference_and_stance_resolver_unchanged:
      actual[
        "src/lib/services/student-assessment/active-anchor-alias-resolution-v4.ts"
      ] ===
      EXPECTED_PROTECTED_SOURCE_HASHES[
        "src/lib/services/student-assessment/active-anchor-alias-resolution-v4.ts"
      ] &&
      actual[
        "src/lib/services/student-assessment/anchor-stance-evidence-resolution-v2.ts"
      ] ===
      EXPECTED_PROTECTED_SOURCE_HASHES[
        "src/lib/services/student-assessment/anchor-stance-evidence-resolution-v2.ts"
      ],
    mapper_evidence_preservation_unchanged:
      actual[
        "src/lib/services/student-assessment/target-evidence-mapper-v7.ts"
      ] ===
      EXPECTED_PROTECTED_SOURCE_HASHES[
        "src/lib/services/student-assessment/target-evidence-mapper-v7.ts"
      ],
    sound_gate_unchanged:
      actual[
        "src/lib/services/student-assessment/anchor-conclusion-consistency.ts"
      ] ===
      EXPECTED_PROTECTED_SOURCE_HASHES[
        "src/lib/services/student-assessment/anchor-conclusion-consistency.ts"
      ],
    trajectory_envelope_system_unchanged:
      actual[
        "src/lib/evaluation/formative/trajectory-envelope-v1.ts"
      ] ===
      EXPECTED_PROTECTED_SOURCE_HASHES[
        "src/lib/evaluation/formative/trajectory-envelope-v1.ts"
      ],
    passed: mismatches.length === 0,
    mismatches
  };
}

function mapperPreservationPrerequisite() {
  const root = path.join(
    process.cwd(),
    ".data",
    "e2a33d-evidence-preserving-mapper-correction",
    "e2a33d_20260724145806_004e9fee"
  );
  const summary = readJson<JsonRecord>(
    path.join(root, "summary.json")
  );
  const validation = readJson<JsonRecord>(
    path.join(root, "artifact-validation.json")
  );
  return {
    prerequisite_version:
      "e2a34-mapper-preservation-prerequisite-v1",
    source_run_id: summary.run_id,
    source_summary_sha256: sha256(
      readFileSync(path.join(root, "summary.json"))
    ),
    source_evidence_preservation_contract_sha256: sha256(
      readFileSync(
        path.join(root, "evidence-preservation-contract.json")
      )
    ),
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
    preservation_contract_version:
      TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
    finalization_version:
      PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4,
    source_corrected_reasoning_quality:
      summary.corrected_reasoning_quality,
    source_corrected_revision_ready:
      summary.corrected_revision_ready,
    evaluator_missing_link_count:
      summary.evaluator_missing_link_count,
    mapped_missing_link_count:
      summary.mapped_missing_link_count,
    preservation_contract_passed:
      summary.preservation_contract_passed,
    production_wiring_passed: summary.production_wiring_passed,
    source_artifact_validation_passed: validation.passed,
    provider_calls_made: 0,
    passed:
      summary.status ===
        "e2a33d_evidence_preserving_mapper_correction_passed_no_live" &&
      summary.corrected_reasoning_quality === "partial" &&
      summary.corrected_revision_ready === false &&
      summary.evaluator_missing_link_count === 2 &&
      summary.mapped_missing_link_count === 2 &&
      summary.preservation_contract_passed === true &&
      summary.production_wiring_passed === true &&
      validation.passed === true
  };
}

function buildArtifactContract() {
  return {
    artifact_contract_version: "e2a34-artifact-contract-v1",
    required_artifacts: E2A34_ARTIFACT_NAMES,
    required_count: E2A34_ARTIFACT_NAMES.length,
    immutable_provider_outputs_required_after_future_live_execution: true,
    human_review_packet_required_after_future_live_execution: true,
    live_execution_in_this_phase: false,
    provider_calls_made: 0
  };
}

function buildFrozenProtocol(input: {
  trajectoryEnvelope: E2A34TrajectoryEnvelopeContract;
  runtimeTrajectoryEnvelope: TrajectoryEnvelopeContract;
  targetContract: TargetEvidenceContractV5;
  canonicalAnchor: ReturnType<typeof buildCanonicalAnchorContract>;
  anchorStanceContract: ReturnType<typeof buildAnchorStanceContract>;
  aliasValidation: ReturnType<typeof validateAliasResolution>;
  requiredContradiction: ReturnType<
    typeof validateRequiredContradiction
  >;
  evaluatorRequest: ReturnType<typeof compileEvaluatorV5Request>;
  regressions: ReturnType<typeof runE2A34TrajectoryRegressions>;
  overlap: ReturnType<typeof runOverlapAnalysis>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
  mapperPrerequisite: ReturnType<typeof mapperPreservationPrerequisite>;
  candidate: ReturnType<typeof candidateIntegrity>;
  protectedSources: ReturnType<typeof protectedSourceIntegrity>;
}) {
  const protocol = {
    protocol_version: E2A34_PROTOCOL_VERSION,
    preparation_version: E2A34_PREPARATION_VERSION,
    protocol_state: "frozen_preparation_only",
    execution_authorized: false,
    live_execution_performed: false,
    domain: heldOutDomain(),
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    trajectory_role_vocabulary_version:
      E2A34_TRAJECTORY_ROLE_VOCABULARY_VERSION,
    trajectory_envelope_hash: stableHash(input.trajectoryEnvelope),
    runtime_trajectory_envelope_projection_hash:
      stableHash(input.runtimeTrajectoryEnvelope),
    future_canary_template_hash: stableHash(
      buildFutureCanaryProtocolTemplate(input.trajectoryEnvelope)
    ),
    target_evidence_contract_version:
      TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    target_evidence_contract_hash: stableHash(input.targetContract),
    canonical_anchor_contract_hash: stableHash(input.canonicalAnchor),
    anchor_stance_contract_hash:
      stableHash(input.anchorStanceContract),
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_prompt_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
    evaluator_prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    evaluator_request_hash:
      input.evaluatorRequest.canonical_request_hash,
    reference_and_stance_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    stance_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
    target_evidence_mapper_version:
      TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
    evidence_preservation_contract_version:
      TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
    pre_tutor_finalization_version:
      PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4,
    sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
    transport_retry_policy_version:
      PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract),
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    candidate_approved: false,
    candidate_activated: false,
    gates: {
      trajectory_envelope_valid: true,
      exact_turn_reasoning_labels_absent:
        input.regressions.exact_turn_reasoning_labels_absent &&
        input.regressions.exact_label_field_schema_rejection_passed,
      evaluator_follows_evidence:
        input.regressions.evaluator_follows_evidence,
      sound_gate_override_passed:
        input.regressions
          .sound_gate_overrides_trajectory_expectation,
      immediate_revision_passed:
        input.regressions.revision_immediate_when_sound_reached,
      deterministic_regressions_passed: input.regressions.passed,
      required_trajectory_roles_complete:
        input.regressions.required_trajectory_roles_complete,
      alias_resolution_passed: input.aliasValidation.passed,
      anchor_stance_contract_valid:
        input.anchorStanceContract.anchor_reference_resolution_is_separate &&
        input.anchorStanceContract.anchor_stance_resolution_is_separate &&
        input.anchorStanceContract.domain_specific_logic_prohibited,
      required_contradiction_passed:
        input.requiredContradiction.passed,
      evaluator_v5_request_compiled: input.evaluatorRequest.passed,
      overlap_analysis_passed: input.overlap.passed,
      no_prior_scenario_reuse:
        input.overlap.no_prior_scenario_reuse,
      budget_validated: input.budget.arithmetic_valid,
      artifact_contract_valid:
        input.artifactContract.required_count ===
        E2A34_ARTIFACT_NAMES.length,
      candidate_integrity_passed: input.candidate.passed,
      evaluator_v5_unchanged:
        input.protectedSources.evaluator_v5_unchanged,
      tutor_candidate_unchanged:
        input.protectedSources.tutor_candidate_unchanged,
      canonical_anchor_evidence_unchanged:
        input.protectedSources.canonical_anchor_evidence_unchanged,
      reference_and_stance_resolver_unchanged:
        input.protectedSources.reference_and_stance_resolver_unchanged,
      mapper_evidence_preservation_unchanged:
        input.protectedSources.mapper_evidence_preservation_unchanged,
      mapper_evidence_preservation_prerequisite_passed:
        input.mapperPrerequisite.passed,
      sound_gate_unchanged:
        input.protectedSources.sound_gate_unchanged,
      trajectory_envelope_system_unchanged:
        input.protectedSources.trajectory_envelope_system_unchanged,
      provider_call_guard_required: true
    }
  };
  return {
    ...protocol,
    protocol_hash: stableHash(protocol),
    passed: Object.values(protocol.gates).every(Boolean)
  };
}

function buildAll(networkRequestCount: number) {
  const protectedBefore = protectedSourceIntegrity();
  if (!protectedBefore.passed) {
    throw new Error("e2a34_protected_source_integrity_failed");
  }
  const candidate = candidateIntegrity();
  if (!candidate.passed) throw new Error("e2a34_candidate_integrity_failed");
  const aliasContract = buildAliasContract();
  const targetContract = buildTargetEvidenceContract(aliasContract);
  const canonicalAnchor = buildCanonicalAnchorContract(aliasContract);
  const anchorStanceContract = buildAnchorStanceContract(aliasContract);
  const aliasValidation = validateAliasResolution(aliasContract);
  if (!aliasValidation.passed) {
    const failures = aliasValidation.results
      .filter((result) => !result.passed)
      .map((result) =>
        `${result.case_id}:${result.observed_reference}:${result.observed_stance}`
      )
      .join(",");
    throw new Error(
      `e2a34_alias_resolution_validation_failed:${failures}`
    );
  }
  const requiredContradiction =
    validateRequiredContradiction(aliasContract, targetContract);
  if (!requiredContradiction.passed) {
    throw new Error("e2a34_required_contradiction_validation_failed");
  }
  const trajectoryEnvelope = buildTrajectoryEnvelope();
  const runtimeTrajectoryEnvelope =
    projectRuntimeTrajectoryEnvelope(trajectoryEnvelope);
  const futureTemplate =
    buildFutureCanaryProtocolTemplate(trajectoryEnvelope);
  const regressions =
    runE2A34TrajectoryRegressions(trajectoryEnvelope);
  if (!regressions.passed) {
    throw new Error("e2a34_trajectory_regressions_failed");
  }
  const evaluatorRequest = compileEvaluatorV5Request(targetContract);
  if (!evaluatorRequest.passed) {
    throw new Error("e2a34_evaluator_v5_request_failed");
  }
  const overlap = runOverlapAnalysis(targetContract);
  if (!overlap.passed) throw new Error("e2a34_overlap_analysis_failed");
  const budget = buildBudget();
  if (!budget.arithmetic_valid) throw new Error("e2a34_budget_invalid");
  const artifactContract = buildArtifactContract();
  const mapperPrerequisite = mapperPreservationPrerequisite();
  if (!mapperPrerequisite.passed) {
    throw new Error("e2a34_mapper_preservation_prerequisite_failed");
  }
  const protocol = buildFrozenProtocol({
    trajectoryEnvelope,
    runtimeTrajectoryEnvelope,
    targetContract,
    canonicalAnchor,
    anchorStanceContract,
    aliasValidation,
    requiredContradiction,
    evaluatorRequest,
    regressions,
    overlap,
    budget,
    artifactContract,
    mapperPrerequisite,
    candidate,
    protectedSources: protectedBefore
  });
  if (!protocol.passed) throw new Error("e2a34_protocol_gate_failed");
  const protectedAfter = protectedSourceIntegrity();
  if (
    !protectedAfter.passed ||
    stableHash(protectedBefore.actual_sha256) !==
      stableHash(protectedAfter.actual_sha256)
  ) {
    throw new Error("e2a34_protected_source_changed");
  }
  if (networkRequestCount !== 0) {
    throw new Error("e2a34_network_request_detected");
  }
  const identityBody = {
    identity_version: "e2a34-composite-runtime-identity-v1",
    application_git_commit: currentGitCommit(),
    protocol_hash: protocol.protocol_hash,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA256,
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    trajectory_envelope_hash: stableHash(trajectoryEnvelope),
    runtime_trajectory_envelope_projection_hash:
      stableHash(runtimeTrajectoryEnvelope),
    trajectory_envelope_source_sha256: fileSha256(
      "src/lib/evaluation/formative/trajectory-envelope-v1.ts"
    ),
    e2a34_protocol_source_sha256: fileSha256(
      "src/lib/evaluation/formative/e2a34-statistical-inference-protocol.ts"
    ),
    target_evidence_contract_hash: stableHash(targetContract),
    canonical_anchor_contract_hash: stableHash(canonicalAnchor),
    anchor_stance_contract_hash: stableHash(anchorStanceContract),
    e2a33d_predecessor_evidence_preservation_sha256: fileSha256(
      ".data/e2a33d-evidence-preserving-mapper-correction/e2a33d_20260724145806_004e9fee/evidence-preservation-contract.json"
    ),
    mapper_evidence_preservation_source_sha256: fileSha256(
      "src/lib/services/student-assessment/target-evidence-mapper-v7.ts"
    ),
    pre_tutor_finalization_source_sha256: fileSha256(
      "src/lib/services/student-assessment/pre-tutor-profile-finalization-v4.ts"
    ),
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    stance_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
    target_evidence_mapper_version:
      TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
    evidence_preservation_contract_version:
      TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
    pre_tutor_finalization_version:
      PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V4,
    sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
    protected_source_hashes: protectedAfter.actual_sha256,
    execution_authorized: false
  };
  const identity = {
    ...identityBody,
    composite_runtime_identity_hash: stableHash(identityBody)
  };
  return {
    protectedSources: protectedAfter,
    candidate,
    aliasContract,
    aliasValidation,
    canonicalAnchor,
    anchorStanceContract,
    requiredContradiction,
    targetContract,
    trajectoryEnvelope,
    runtimeTrajectoryEnvelope,
    futureTemplate,
    regressions,
    evaluatorRequest,
    overlap,
    budget,
    artifactContract,
    mapperPrerequisite,
    protocol,
    identity,
    networkRequestCount
  };
}

function artifactPayloads(
  all: ReturnType<typeof buildAll>,
  runId: string
) {
  const providerGuard = {
    guard_version: "e2a34-provider-call-guard-v1",
    execution_authorized: false,
    provider_executor_constructed: false,
    provider_calls_made: 0,
    network_requests_made: all.networkRequestCount,
    fetch_guard_required: true,
    passed: all.networkRequestCount === 0
  };
  const summary = {
    summary_version: E2A34_PREPARATION_VERSION,
    status: "e2a34_protocol_frozen_not_authorized_not_executed",
    run_id: runId,
    passed: true,
    protocol_hash: all.protocol.protocol_hash,
    composite_runtime_identity_hash:
      all.identity.composite_runtime_identity_hash,
    held_out_domain: heldOutDomain().domain,
    held_out_topic: heldOutDomain().topic,
    held_out_scope: heldOutDomain().held_out_scope,
    broad_concept_overlap_disclosed: false,
    not_a_renamed_causal_inference_scenario:
      heldOutDomain().not_a_renamed_causal_inference_scenario,
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    deterministic_case_count: all.regressions.case_count,
    deterministic_regressions_passed: all.regressions.passed,
    early_sound_immediate_revision:
      all.regressions.revision_immediate_when_sound_reached,
    evaluator_follows_evidence:
      all.regressions.evaluator_follows_evidence,
    overlap_analysis_passed: all.overlap.passed,
    no_prior_scenario_reuse: all.overlap.no_prior_scenario_reuse,
    required_contradiction_passed:
      all.requiredContradiction.passed,
    evaluator_v5_unchanged:
      all.protectedSources.evaluator_v5_unchanged,
    tutor_candidate_unchanged:
      all.protectedSources.tutor_candidate_unchanged,
    execution_authorized: false,
    live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: all.networkRequestCount,
    candidate_approved: false,
    candidate_activated: false,
    e2a34_ready_for_separate_authorization: true
  };
  return {
    "freeze-manifest.json": {
      manifest_version: E2A34_PREPARATION_VERSION,
      run_id: runId,
      created_at: new Date().toISOString(),
      execution_mode: "deterministic_protocol_freeze_no_provider",
      application_git_commit: all.identity.application_git_commit,
      protocol_hash: all.protocol.protocol_hash,
      composite_runtime_identity_hash:
        all.identity.composite_runtime_identity_hash,
      execution_authorized: false,
      live_execution_performed: false,
      provider_calls_made: 0,
      network_requests_made: all.networkRequestCount
    },
    "frozen-protocol.json": all.protocol,
    "frozen-protocol.sha256": `${all.protocol.protocol_hash}\n`,
    "trajectory-envelope-contract.json": all.trajectoryEnvelope,
    "runtime-trajectory-envelope-projection.json":
      all.runtimeTrajectoryEnvelope,
    "future-canary-protocol-template.json": all.futureTemplate,
    "held-out-domain.json": heldOutDomain(),
    "target-evidence-contract.json": all.targetContract,
    "canonical-anchor-contract.json": all.canonicalAnchor,
    "alias-contract.json": all.aliasContract,
    "anchor-stance-contract.json": all.anchorStanceContract,
    "alias-resolution-validation.json": all.aliasValidation,
    "required-contradiction-validation.json":
      all.requiredContradiction,
    "mapper-preservation-prerequisite.json":
      all.mapperPrerequisite,
    "compiled-evaluator-v5-request.json": all.evaluatorRequest,
    "deterministic-trajectory-regressions.json": all.regressions,
    "overlap-analysis.json": all.overlap,
    "budget.json": all.budget,
    "artifact-contract.json": all.artifactContract,
    "candidate-integrity.json": all.candidate,
    "protected-source-integrity.json": all.protectedSources,
    "composite-runtime-identity.json": all.identity,
    "provider-call-guard.json": providerGuard,
    "summary.json": summary
  };
}

export function validateE2A34Artifacts(
  runDirectory: string,
  allowValidationArtifactMissing = false
) {
  const missing = E2A34_ARTIFACT_NAMES.filter((name) =>
    !(
      allowValidationArtifactMissing &&
      name === "artifact-validation.json"
    ) &&
    !existsSync(path.join(runDirectory, name))
  );
  const unexpected = readdirSync(runDirectory).filter((name) =>
    !E2A34_ARTIFACT_NAMES.includes(
      name as typeof E2A34_ARTIFACT_NAMES[number]
    )
  );
  const unsafePatterns = [
    /\bsk-[A-Za-z0-9_-]{12,}\b/u,
    /Bearer\s+[A-Za-z0-9._-]+/iu,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /Authorization\s*:/iu
  ];
  const unsafeArtifacts = readdirSync(runDirectory).filter((name) => {
    const filePath = path.join(runDirectory, name);
    return statSync(filePath).isFile() &&
      unsafePatterns.some((pattern) =>
        pattern.test(readFileSync(filePath, "utf8"))
      );
  });
  const semanticIssues: string[] = [];
  try {
    E2A34TrajectoryEnvelopeContractSchema.parse(readJson(
      path.join(runDirectory, "trajectory-envelope-contract.json")
    ));
    TrajectoryEnvelopeContractSchema.parse(readJson(
      path.join(
        runDirectory,
        "runtime-trajectory-envelope-projection.json"
      )
    ));
    TargetEvidenceContractV5Schema.parse(readJson(
      path.join(runDirectory, "target-evidence-contract.json")
    ));
    ActiveAnchorAliasContractSchema.parse(readJson(
      path.join(runDirectory, "alias-contract.json")
    ));
    const anchorStance = readJson<JsonRecord>(
      path.join(runDirectory, "anchor-stance-contract.json")
    );
    if (
      anchorStance.stance_contract_version !==
        "e2a34-p-value-anchor-stance-v1" ||
      anchorStance.anchor_reference_resolution_is_separate !== true ||
      anchorStance.anchor_stance_resolution_is_separate !== true ||
      anchorStance.domain_specific_logic_prohibited !== true
    ) {
      semanticIssues.push("anchor_stance_contract_invalid");
    }
    const canonicalAnchor = readJson<JsonRecord>(
      path.join(runDirectory, "canonical-anchor-contract.json")
    );
    if (
      canonicalAnchor.canonical_anchor_id !== CANONICAL_ANCHOR_ID ||
      canonicalAnchor.required_anchor_stance !==
        "rejects_distractor" ||
      !Array.isArray(canonicalAnchor.sound_criteria) ||
      canonicalAnchor.sound_criteria.length !== 5
    ) {
      semanticIssues.push("canonical_anchor_contract_invalid");
    }
    const contradiction = readJson<JsonRecord>(
      path.join(
        runDirectory,
        "required-contradiction-validation.json"
      )
    );
    const contradictionObserved = contradiction.observed as JsonRecord;
    if (
      contradiction.passed !== true ||
      contradictionObserved.anchor_application !== "explicit" ||
      contradictionObserved.anchor_stance !==
        "endorses_distractor" ||
      contradictionObserved.anchor_consistency !==
        "contradictory_to_conceptual_reasoning" ||
      contradictionObserved.revision_ready !== false
    ) {
      semanticIssues.push("required_contradiction_invalid");
    }
    const mapperPrerequisite = readJson<JsonRecord>(
      path.join(
        runDirectory,
        "mapper-preservation-prerequisite.json"
      )
    );
    if (
      mapperPrerequisite.passed !== true ||
      mapperPrerequisite.source_corrected_reasoning_quality !==
        "partial" ||
      mapperPrerequisite.source_corrected_revision_ready !== false ||
      mapperPrerequisite.evaluator_missing_link_count !== 2 ||
      mapperPrerequisite.mapped_missing_link_count !== 2
    ) {
      semanticIssues.push("mapper_preservation_prerequisite_invalid");
    }
    const protocol = readJson<JsonRecord>(
      path.join(runDirectory, "frozen-protocol.json")
    );
    const recordedProtocolHash = readFileSync(
      path.join(runDirectory, "frozen-protocol.sha256"),
      "utf8"
    ).trim();
    const protocolBody = { ...protocol };
    delete protocolBody.protocol_hash;
    delete protocolBody.passed;
    if (stableHash(protocolBody) !== recordedProtocolHash) {
      semanticIssues.push("protocol_hash_mismatch");
    }
    const compiledRequest = readJson<JsonRecord>(
      path.join(runDirectory, "compiled-evaluator-v5-request.json")
    );
    ProductionTurnEvidenceEvaluatorInputV5Schema.parse(
      compiledRequest.input
    );
    if (
      compiledRequest.passed !== true ||
      (compiledRequest.old_evaluator_contract_matches as unknown[])
        .length !== 0
    ) {
      semanticIssues.push("compiled_evaluator_v5_request_invalid");
    }
    const regressions = readJson<JsonRecord>(
      path.join(
        runDirectory,
        "deterministic-trajectory-regressions.json"
      )
    );
    if (
      regressions.passed !== true ||
      regressions.case_count !== 9 ||
      regressions.required_trajectory_roles_complete !== true ||
      regressions.evaluator_follows_evidence !== true ||
      regressions.sound_gate_overrides_trajectory_expectation !== true ||
      regressions.revision_immediate_when_sound_reached !== true ||
      regressions
        .confidence_and_correctness_do_not_promote_incomplete_evidence !==
        true ||
      regressions.sound_p_value_rejection_authorizes_revision !== true
    ) {
      semanticIssues.push("trajectory_regressions_invalid");
    }
    const overlap = readJson<JsonRecord>(
      path.join(runDirectory, "overlap-analysis.json")
    );
    if (
      overlap.passed !== true ||
      overlap.no_prior_scenario_reuse !== true ||
      overlap.concept_level_novelty_claimed !== true ||
      overlap.semantic_tag_audit_passed !== true ||
      (overlap.causal_inference_rename_check as JsonRecord)
        .passed !== true
    ) {
      semanticIssues.push("overlap_analysis_invalid");
    }
    const budget = readJson<JsonRecord>(
      path.join(runDirectory, "budget.json")
    );
    const maximum = budget.maximum as JsonRecord;
    if (
      budget.arithmetic_valid !== true ||
      maximum.logical_generation_calls !== 29 ||
      maximum.adapter_attempts !== 87 ||
      maximum.transport_retries_per_logical_call !== 2 ||
      maximum.input_tokens !== 900_000 ||
      maximum.output_tokens !== 70_000 ||
      maximum.total_tokens !== 970_000 ||
      maximum.cost_usd_when_pricing_available !== 25 ||
      maximum.provider_concurrency !== 1
    ) {
      semanticIssues.push("budget_invalid");
    }
    const guard = readJson<JsonRecord>(
      path.join(runDirectory, "provider-call-guard.json")
    );
    if (
      guard.passed !== true ||
      guard.provider_calls_made !== 0 ||
      guard.network_requests_made !== 0
    ) {
      semanticIssues.push("provider_call_guard_failed");
    }
    const identity = readJson<JsonRecord>(
      path.join(runDirectory, "composite-runtime-identity.json")
    );
    const identityHash = identity.composite_runtime_identity_hash;
    const identityBody = { ...identity };
    delete identityBody.composite_runtime_identity_hash;
    if (stableHash(identityBody) !== identityHash) {
      semanticIssues.push("composite_runtime_identity_mismatch");
    }
  } catch (error) {
    semanticIssues.push(
      `artifact_parse_failed:${
        error instanceof Error ? error.message : "unknown"
      }`
    );
  }
  return {
    validation_version: "e2a34-artifact-validation-v1",
    required_artifact_count: E2A34_ARTIFACT_NAMES.length,
    actual_artifact_count: readdirSync(runDirectory).length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    unsafe_artifacts: unsafeArtifacts,
    semantic_issues: semanticIssues,
    passed:
      missing.length === 0 &&
      unexpected.length === 0 &&
      unsafeArtifacts.length === 0 &&
      semanticIssues.length === 0,
    provider_calls_made: 0,
    network_requests_made: 0
  };
}

export function writeE2A34PreparationArtifacts(input: {
  runDirectory: string;
  runId: string;
  networkRequestCount: number;
}) {
  mkdirSync(input.runDirectory, { recursive: true });
  const all = buildAll(input.networkRequestCount);
  const payloads = artifactPayloads(all, input.runId);
  for (const [name, payload] of Object.entries(payloads)) {
    if (typeof payload === "string") {
      writeFileSync(path.join(input.runDirectory, name), payload, "utf8");
    } else {
      writeJson(path.join(input.runDirectory, name), payload);
    }
  }
  const beforeSelf = validateE2A34Artifacts(input.runDirectory, true);
  if (!beforeSelf.passed) {
    throw new Error(
      `e2a34_artifact_validation_failed:${beforeSelf.semantic_issues.join("|")}`
    );
  }
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    {
      ...beforeSelf,
      actual_artifact_count: E2A34_ARTIFACT_NAMES.length
    }
  );
  const validation = validateE2A34Artifacts(input.runDirectory);
  if (!validation.passed) {
    throw new Error(
      `e2a34_final_artifact_validation_failed:${validation.semantic_issues.join("|")}`
    );
  }
  return {
    all,
    validation,
    summary: readJson<JsonRecord>(
      path.join(input.runDirectory, "summary.json")
    )
  };
}

export function makeE2A34RunId() {
  const timestamp = new Date().toISOString().replace(/[-:.Z]/gu, "");
  return `e2a34_${timestamp}_${randomBytes(4).toString("hex")}`;
}

export function inspectE2A34Run(runDirectory: string) {
  return {
    run_directory: runDirectory,
    summary: readJson<JsonRecord>(
      path.join(runDirectory, "summary.json")
    ),
    protocol: readJson<JsonRecord>(
      path.join(runDirectory, "frozen-protocol.json")
    ),
    identity: readJson<JsonRecord>(
      path.join(runDirectory, "composite-runtime-identity.json")
    ),
    regressions: readJson<JsonRecord>(
      path.join(
        runDirectory,
        "deterministic-trajectory-regressions.json"
      )
    ),
    validation: validateE2A34Artifacts(runDirectory)
  };
}
