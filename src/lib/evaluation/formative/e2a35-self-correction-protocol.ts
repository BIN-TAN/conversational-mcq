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
  resolveActiveAnchorAlias,
  type ActiveAnchorAliasContract
} from "@/lib/services/student-assessment/active-anchor-alias-resolution";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2
} from "@/lib/services/student-assessment/anchor-contradiction-propagation-v2";
import {
  SOUND_GATE_ANCHOR_CONSISTENCY_VERSION
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import {
  ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
  resolveAnchorStanceScopeV1
} from "@/lib/services/student-assessment/anchor-stance-scope-resolution-v1";
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
  type TurnEvidenceObservationV5,
  TargetEvidenceContractV5Schema,
  type TargetEvidenceContractV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import {
  classifyTopicDialogueInteractionIntent,
  createTopicDialogueTurnEvidenceProfile,
  selectEvidenceFirstTopicDialogueRoute,
  type TopicDialogueCumulativeEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  applyConceptualApplicabilityToTurnProfile,
  assertProfileUpdateDispositionCoherent,
  classifyConceptualEvidenceApplicability,
  createLearningProfileUpdateDispositionRecordV1,
  createTurnEvidenceObservationRecordV1,
  determineProfileUpdateDisposition,
  integrateTopicDialogueEvidenceProfileWithDisposition
} from "@/lib/services/student-assessment/turn-evidence-profile-update";
import {
  E2A24_CANDIDATE_PATH,
  evaluateE2A24Candidate
} from "./e2a24-autonomous-dialogue-candidate";
import {
  SELF_CORRECTION_INTENT_VERSION,
  SelfCorrectionIntentContractV1Schema,
  buildSelfCorrectionIntentContractV1,
  resolveSelfCorrectionIntentV1,
  type SelfCorrectionIntentContractV1
} from "./self-correction-intent-v1";
import {
  TRAJECTORY_ENVELOPE_VERSION,
  TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
  TrajectoryEnvelopeContractSchema,
  buildDefaultTrajectoryProgressionConsequences,
  evaluateTrajectoryEnvelope,
  type TrajectoryEnvelopeContract,
  type TrajectoryReasoningQuality
} from "./trajectory-envelope-v1";

export const E2A35_PREPARATION_VERSION =
  "e2a35-self-correction-protocol-freeze-preparation-v1" as const;
export const E2A35_PROTOCOL_VERSION =
  "e2a35-sampling-bias-self-correction-canary-v1" as const;
export const E2A35_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a35-sampling-bias-self-correction-protocol-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const CANDIDATE_FILE_SHA256 =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2";
const ITEM_ID = "sampling_bias_volunteer_sample_item_1";
const CONCEPT_ID = "voluntary_response_self_selection_bias";
const OPTION_LABEL = "D";
const CANONICAL_ANCHOR_ID = `${ITEM_ID}:option:${OPTION_LABEL}`;
const SCENARIO_PROMPT =
  "A researcher surveys only students who volunteer for an online-learning study and concludes that all university students prefer online learning. Do you agree? Explain.";
const DISTRACTOR_CLAIM =
  "Volunteer students represent the whole university population because anyone could choose to participate.";

const EXPECTED_PROTECTED_SOURCE_HASHES = {
  [E2A24_CANDIDATE_PATH]: CANDIDATE_FILE_SHA256,
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/services/student-assessment/target-evidence-contract-v5.ts":
    "775dd493ce68a11223ec5407bd3fb4a146315e13dfbd566ab5b5159b9e8e2a6a",
  "src/lib/services/student-assessment/anchor-stance-scope-resolution-v1.ts":
    "5cef63e18291b2e3f9ace00c2e4d8be20d9e7a70d51c06717723972250c1e82a",
  "src/lib/services/student-assessment/target-evidence-scoped-adjudication-v1.ts":
    "40b43bc48eff6f8e1d92b22341a34dcf2a16294182c42e885f4406feb895731f",
  "src/lib/services/student-assessment/turn-evidence-profile-update.ts":
    "b06e6ad8ea654047d8cdf3afaa37a61773b4b0a5709081b0f95c590e3ad7ea3e",
  "src/lib/evaluation/formative/trajectory-envelope-v1.ts":
    "95319bb52d087601680e53ce2db9e357764a2b5f5574e125f3b88804c49d4e70"
} as const;

const PRIOR_SCENARIO_SOURCES = [
  {
    stage: "E2A.24",
    path:
      ".data/e2a24-autonomous-formative-dialogue-architecture/e2a24_20260720220102_1324ebaf/cross-domain-target-contracts.json",
    semantic_tags: [
      "reliability_validity",
      "correlation_causation",
      "screening_predictive_value",
      "voltage_current_resistance"
    ]
  },
  {
    stage: "E2A.25",
    path:
      ".data/e2a25-autonomous-dialogue-live-canary/e2a25_20260721000435_bf179fb6/session-designs.json",
    semantic_tags: ["phoneme_allophone", "sunk_cost", "binary_search"]
  },
  {
    stage: "E2A.27",
    path:
      ".data/e2a27-geometrical-optics-anchor-consistency-canary/e2a27_20260722061521_9bd4a441/session-designs.json",
    semantic_tags: ["geometrical_optics", "converging_lens"]
  },
  {
    stage: "E2A.28",
    path:
      ".data/e2a28-antimicrobial-resistance-contradiction-canary/e2a28_20260722083935_6ecb39bb/session-designs.json",
    semantic_tags: ["antimicrobial_resistance", "selection_variation"]
  },
  {
    stage: "E2A.29",
    path:
      ".data/e2a29-electrical-circuits-anchor-contradiction-canary/e2a29_20260722120813_3fd136e6/session-designs.json",
    semantic_tags: ["electrical_circuits", "series_current"]
  },
  {
    stage: "E2A.30",
    path:
      ".data/e2a30-thermal-physics-transport-autonomous-canary/e2a30_20260722212059_c1f72790/session-designs.json",
    semantic_tags: ["thermal_physics", "temperature_heat_transfer"]
  },
  {
    stage: "E2A.31b",
    path:
      ".data/e2a31b-ecology-anchor-stance-resolution-canary/e2a31b_20260723111043_c82c52ae/session-designs.json",
    semantic_tags: ["ecology", "trophic_cascade", "predator_removal"]
  },
  {
    stage: "E2A.32",
    path:
      ".data/e2a32-chemical-equilibrium-protocol-freeze/e2a32_20260723T171215134_14feb916/frozen-protocol.json",
    semantic_tags: ["chemistry", "dynamic_equilibrium"]
  },
  {
    stage: "E2A.33b",
    path:
      ".data/e2a33b-causal-inference-held-out-canary/e2a33b_20260724101300_f5ae71c0/session-designs.json",
    semantic_tags: ["causal_inference", "correlation_causation"]
  },
  {
    stage: "E2A.34",
    path:
      ".data/e2a34-statistical-inference-held-out-canary/e2a34_20260724162010_49f33990/session-designs.json",
    semantic_tags: ["statistical_inference", "p_value_interpretation"]
  }
] as const;

export const E2A35_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "held-out-domain.json",
  "target-evidence-contract.json",
  "canonical-anchor-contract.json",
  "anchor-stance-contract.json",
  "self-correction-intent-contract.json",
  "compiled-evaluator-v5-request.json",
  "trajectory-envelope-contract.json",
  "self-correction-calibration.json",
  "deterministic-self-correction-regressions.json",
  "profile-update-regressions.json",
  "regression-reopening-regressions.json",
  "trajectory-envelope-regressions.json",
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

const E2A35CanonicalAnchorContractSchema = z.object({
  contract_version: z.literal(
    "e2a35-sampling-bias-canonical-anchor-v1"
  ),
  canonical_anchor_id: z.literal(CANONICAL_ANCHOR_ID),
  item_id: z.literal(ITEM_ID),
  option_label: z.literal(OPTION_LABEL),
  distractor_text: z.literal(DISTRACTOR_CLAIM),
  required_anchor_application: z.literal("explicit"),
  required_anchor_stance: z.literal("rejects_distractor"),
  mechanism_criteria: z.array(z.string().min(1)).min(2),
  sound_criteria: z.array(z.string().min(1)).min(4),
  contradiction_criteria: z.array(z.string().min(1)).min(2),
  active_anchor_alias_contract: ActiveAnchorAliasContractSchema
}).strict();

const E2A35AnchorStanceContractSchema = z.object({
  contract_version: z.literal(
    "e2a35-sampling-bias-anchor-stance-v1"
  ),
  canonical_anchor_id: z.literal(CANONICAL_ANCHOR_ID),
  resolver_version: z.literal(ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION),
  reference_resolution_separate_from_stance: z.literal(true),
  polarity_must_attach_to_active_anchor: z.literal(true),
  endorsement_examples: z.array(z.string().min(1)).min(3),
  rejection_examples: z.array(z.string().min(1)).min(3),
  uncertainty_examples: z.array(z.string().min(1)).min(2),
  self_correction_examples: z.array(z.string().min(1)).min(2)
}).strict();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha256(relativePath: string) {
  const filePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(process.cwd(), relativePath);
  return sha256(readFileSync(filePath));
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
    .normalize("NFKC")
    .replace(/_/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
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
  assert(existsSync(filePath), `e2a35_overlap_source_missing:${relativePath}`);
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
      "the volunteer sample represents everyone",
      "anyone could volunteer so the sample is representative",
      "volunteers represent the university population",
      "the anyone-could-participate claim",
      "the volunteer-representation claim",
      "that representation claim",
      "that option"
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
      "Volunteer participation can create a sample that differs systematically from the broader target population.",
      "The fact that anyone could choose to volunteer does not make the people who actually volunteer representative.",
      "Self-selection bias limits generalization from the volunteer sample to all university students."
    ],
    required_mechanisms: [
      "Identify a plausible systematic difference between volunteers and non-volunteers, such as stronger interest in online learning.",
      "Explain how that difference can affect the observed preference in the sample.",
      "Connect self-selection bias to the limit on the researcher's population-level conclusion."
    ],
    acceptable_equivalent_explanations: [
      "Students who choose the study may already be more interested in online learning, so their preferences may not match non-volunteers.",
      "Open eligibility does not remove voluntary-response bias because participation is still related to student characteristics.",
      "The survey describes the volunteers but cannot justify a claim about every university student without a more representative sampling design."
    ],
    required_anchor_application:
      `Apply the self-selection mechanism directly to ${ITEM_ID} option ${OPTION_LABEL} and reject its representation claim.`,
    prohibited_contradictions: [
      DISTRACTOR_CLAIM,
      "Anyone could participate, so the volunteers necessarily represent all university students.",
      "Volunteers may differ from non-volunteers, but option D is still correct that they represent everyone."
    ],
    revision_ready_criteria: [
      "volunteer_population_difference",
      "selection_mechanism",
      "generalization_boundary",
      "active_anchor_application",
      "coherent_conclusion"
    ],
    optional_deepening_criteria: ["optional_sampling_design_improvement"],
    evidence_limitations: [
      "This isolated synthetic scenario tests one voluntary-response sampling-bias boundary and does not establish broad research-methods mastery.",
      "Self-correction language is not conceptual evidence unless the revised response supplies assessable reasoning."
    ],
    criteria: [
      {
        criterion_id: "volunteer_population_difference",
        criterion_kind: "conceptual_relationship",
        description:
          "The response states that volunteers may differ systematically from the broader university population.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "volunteers may be more interested in online learning",
          "non-volunteers may have different preferences"
        ]
      },
      {
        criterion_id: "selection_mechanism",
        criterion_kind: "required_mechanism",
        description:
          "The response explains that self-selection into participation can produce the observed sample difference.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "students choose whether to participate",
          "interest can affect both volunteering and reported preference"
        ]
      },
      {
        criterion_id: "generalization_boundary",
        criterion_kind: "required_mechanism",
        description:
          "The response explains why the volunteer result cannot be generalized to all university students.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "the sample does not support a population-wide conclusion",
          "a representative sampling design is needed for generalization"
        ]
      },
      {
        criterion_id: "active_anchor_application",
        criterion_kind: "anchor_application",
        description:
          `The response explicitly rejects option ${OPTION_LABEL} or an accepted alias using the self-selection mechanism.`,
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          `option ${OPTION_LABEL} is wrong`,
          "the anyone-could-participate claim does not make the sample representative"
        ]
      },
      {
        criterion_id: "coherent_conclusion",
        criterion_kind: "coherent_conclusion",
        description:
          "The response concludes coherently that the researcher cannot infer all university students' preferences from volunteers alone.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "the conclusion applies only to the observed volunteers"
        ]
      },
      {
        criterion_id: "optional_sampling_design_improvement",
        criterion_kind: "optional_deepening",
        description:
          "The response proposes probability sampling or another defensible design improvement.",
        essential_for_revision: false,
        acceptable_evidence_patterns: [
          "use a random sample from the university population"
        ]
      }
    ],
    contradiction_criteria: [
      {
        contradiction_id: "active_distractor_claim_retained",
        description: DISTRACTOR_CLAIM,
        observable_patterns: [
          `option ${OPTION_LABEL} is correct`,
          "anyone could volunteer so the sample represents everyone"
        ]
      },
      {
        contradiction_id: "self_selection_acknowledged_but_ignored",
        description:
          "The response identifies systematic volunteer differences but still generalizes to the whole population.",
        observable_patterns: [
          "volunteers may differ, but the conclusion still applies to everyone"
        ]
      },
      {
        contradiction_id:
          "anchor_conclusion_conceptual_explanation_conflict",
        description:
          `The response explains self-selection bias but still endorses option ${OPTION_LABEL}.`,
        observable_patterns: [
          "volunteers may differ, but option D is still right"
        ]
      }
    ],
    active_anchor_id: CANONICAL_ANCHOR_ID,
    active_anchor_text:
      `${ITEM_ID} option ${OPTION_LABEL}: ${DISTRACTOR_CLAIM}`,
    active_anchor_type: "distractor_option",
    required_anchor_stance: "rejects_distractor",
    acceptable_anchor_paraphrases: aliasContract.accepted_paraphrases,
    prohibited_anchor_stances: [
      "not_expressed",
      "ambiguous",
      "endorses_distractor"
    ],
    anchor_resolution_criteria: [
      `Explicitly apply self-selection bias to option ${OPTION_LABEL} or an accepted alias and reject the representation claim.`
    ],
    anchor_contradiction_criteria: [
      `Endorsing option ${OPTION_LABEL} conflicts with explaining that volunteers differ systematically from non-volunteers.`,
      `Rejecting option ${OPTION_LABEL} without explaining the selection mechanism and generalization limit is not sufficient for a sound result.`
    ],
    ambiguity_resolution_policy:
      "Do not infer a revised stance from self-correction language alone. Evaluate the latest assessable evidence and require clarification for an ambiguous or unsupported correction.",
    active_anchor_alias_contract: aliasContract
  });
}

function buildCanonicalAnchorContract(
  aliasContract: ActiveAnchorAliasContract
) {
  return E2A35CanonicalAnchorContractSchema.parse({
    contract_version: "e2a35-sampling-bias-canonical-anchor-v1",
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    item_id: ITEM_ID,
    option_label: OPTION_LABEL,
    distractor_text: DISTRACTOR_CLAIM,
    required_anchor_application: "explicit",
    required_anchor_stance: "rejects_distractor",
    mechanism_criteria: [
      "identify a systematic volunteer versus non-volunteer difference",
      "explain how self-selection produces the difference",
      "connect the difference to limited population generalization"
    ],
    sound_criteria: [
      "explain volunteer samples can differ systematically",
      "identify self-selection or voluntary-response bias",
      "explain why open eligibility does not guarantee representativeness",
      "reject the active distractor",
      "give a coherent conclusion that does not generalize to all students"
    ],
    contradiction_criteria: [
      "endorse the representation claim after explaining self-selection",
      "acknowledge volunteer differences but still conclude the sample represents everyone"
    ],
    active_anchor_alias_contract: aliasContract
  });
}

function buildAnchorStanceContract() {
  return E2A35AnchorStanceContractSchema.parse({
    contract_version: "e2a35-sampling-bias-anchor-stance-v1",
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    resolver_version: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    reference_resolution_separate_from_stance: true,
    polarity_must_attach_to_active_anchor: true,
    endorsement_examples: [
      "I choose D because anyone could volunteer.",
      "Option D is still right.",
      "The volunteer-representation claim makes sense."
    ],
    rejection_examples: [
      "Option D is wrong because volunteers may differ.",
      "I reject the anyone-could-participate claim.",
      "That representation claim is tempting but incorrect."
    ],
    uncertainty_examples: [
      "I am unsure whether D is right.",
      "Maybe the volunteer sample represents everyone."
    ],
    self_correction_examples: [
      "I think my previous answer was wrong because option D ignores self-selection.",
      "On second thought, I choose D because anyone could volunteer."
    ]
  });
}

function buildSelfCorrectionContract(
  aliasContract: ActiveAnchorAliasContract
) {
  return SelfCorrectionIntentContractV1Schema.parse(
    buildSelfCorrectionIntentContractV1({
      active_topic_terms: [
        "volunteer sample",
        "volunteer students",
        "university population",
        "self-selection bias",
        "self selection bias",
        "voluntary response bias",
        "non-volunteers",
        "online learning",
        "representative sample",
        "generalize",
        "participation"
      ],
      active_anchor_aliases: [
        ...aliasContract.accepted_identifiers,
        aliasContract.option_text,
        ...aliasContract.accepted_aliases,
        ...aliasContract.accepted_paraphrases
      ],
      unrelated_topic_terms: [
        "hockey",
        "weather",
        "movie",
        "pizza",
        "vacation",
        "concert"
      ]
    })
  );
}

function buildCompiledEvaluatorRequest(
  targetContract: TargetEvidenceContractV5,
  selfCorrectionContract: SelfCorrectionIntentContractV1
) {
  const latestMessage =
    "I think my previous answer was wrong because option D ignores that volunteers may be more interested in online learning than non-volunteers, so the result cannot represent all university students.";
  const intent = resolveSelfCorrectionIntentV1({
    message: latestMessage,
    contract: selfCorrectionContract
  });
  assert(intent.downstream_disposition === "evaluate_revised_evidence",
    "e2a35_compiled_request_self_correction_not_evaluable");
  return buildProductionTurnEvidenceEvaluatorInputV5({
    legacy_evaluator_input: {
      evaluation_mode: "e2a35_no_live_request_compilation",
      scenario_prompt: SCENARIO_PROMPT,
      latest_student_message: latestMessage,
      visible_prior_student_position:
        "I chose option D because anyone could volunteer.",
      target_evidence_contract: targetContract,
      self_correction_intent_resolution: intent,
      evidence_precedence_policy:
        "evaluate_latest_valid_evidence_and_preserve_prior_evidence_as_historical"
    },
    source_student_turn: {
      source_student_turn_id: "e2a35_compile_student_turn_2",
      source_sequence_index: 2
    },
    active_anchor_alias_contract:
      targetContract.active_anchor_alias_contract
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
        "Synthetic generation should exercise initial misconception, natural correction, regression, and final independent repair without prescribing the evaluator's reasoning label for any exact turn.",
      acceptable_reasoning_quality_envelope:
        "Each conversational checkpoint allows multiple evidence-grounded qualities; a valid correction may become sound immediately, remain partial, or retain the misconception.",
      progression_consequences:
        "Latest valid evidence is authoritative. Sound evidence triggers immediate revision, renewed misconception evidence reopens support, and correction language without evidence requests independent evidence."
    },
    turns: [
      {
        turn_index: 1,
        expected_trajectory_role: "initial_anchor_position",
        allowed_reasoning_quality_set: ["misconception", "partial"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: [...prohibited]
      },
      {
        turn_index: 2,
        expected_trajectory_role: "mechanism_exploration",
        allowed_reasoning_quality_set: [
          "insufficient",
          "misconception",
          "partial",
          "sound"
        ],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: [...prohibited]
      },
      {
        turn_index: 3,
        expected_trajectory_role: "anchor_reconciliation",
        allowed_reasoning_quality_set: [
          "misconception",
          "partial",
          "sound"
        ],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: [...prohibited]
      },
      {
        turn_index: 4,
        expected_trajectory_role: "mechanism_exploration",
        allowed_reasoning_quality_set: [
          "misconception",
          "partial",
          "sound"
        ],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: [...prohibited]
      },
      {
        turn_index: 5,
        expected_trajectory_role: "independent_reconstruction",
        allowed_reasoning_quality_set: ["partial", "sound"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: [...prohibited]
      },
      {
        turn_index: 6,
        expected_trajectory_role: "revision_readiness",
        allowed_reasoning_quality_set: ["partial", "sound"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: [...prohibited]
      }
    ]
  });
}

const CALIBRATION_CONTEXTS = [
  ["sample", "option A", "weather"],
  ["estimate", "option B", "hockey"],
  ["claim", "option C", "movie"],
  ["conclusion", "option D", "pizza"],
  ["comparison", "option E", "vacation"],
  ["mechanism", "option F", "concert"],
  ["relationship", "choice A", "weather"],
  ["interpretation", "choice B", "hockey"],
  ["explanation", "choice C", "movie"],
  ["generalization", "choice D", "pizza"],
  ["assumption", "choice E", "vacation"],
  ["pattern", "choice F", "concert"],
  ["population result", "that option", "weather"],
  ["selection effect", "that choice", "hockey"],
  ["study inference", "the active distractor", "movie"],
  ["response pattern", "the anchor claim", "pizza"]
] as const;

type CalibrationArchetype = {
  archetype_id: string;
  expected_intent:
    | "self_correction_intent"
    | "no_self_correction_intent";
  expected_disposition:
    | "evaluate_revised_evidence"
    | "request_revision_evidence"
    | "retain_prior_and_redirect_topic"
    | "continue_normal_evaluation";
  message: (context: typeof CALIBRATION_CONTEXTS[number]) => string;
};

const CALIBRATION_ARCHETYPES: CalibrationArchetype[] = [
  {
    archetype_id: "valid_previous_answer_correction",
    expected_intent: "self_correction_intent",
    expected_disposition: "evaluate_revised_evidence",
    message: ([topic]) =>
      `I think my previous answer was wrong because the ${topic} changes the interpretation and conclusion.`
  },
  {
    archetype_id: "valid_explicit_anchor_revision",
    expected_intent: "self_correction_intent",
    expected_disposition: "evaluate_revised_evidence",
    message: ([topic, anchor]) =>
      `I need to revise my earlier reasoning: ${anchor} is wrong because the ${topic} does not support it.`
  },
  {
    archetype_id: "valid_on_second_thought",
    expected_intent: "self_correction_intent",
    expected_disposition: "evaluate_revised_evidence",
    message: ([topic, anchor]) =>
      `On second thought, my answer was mistaken because the ${topic} contradicts ${anchor}.`
  },
  {
    archetype_id: "valid_restate",
    expected_intent: "self_correction_intent",
    expected_disposition: "evaluate_revised_evidence",
    message: ([topic]) =>
      `Let me correct my previous explanation: the ${topic} needs a different conclusion.`
  },
  {
    archetype_id: "false_correction_no_evidence",
    expected_intent: "self_correction_intent",
    expected_disposition: "request_revision_evidence",
    message: () => "I think my previous answer was wrong."
  },
  {
    archetype_id: "copied_correction_stem",
    expected_intent: "self_correction_intent",
    expected_disposition: "request_revision_evidence",
    message: () => "I think my previous answer was wrong because..."
  },
  {
    archetype_id: "topic_changed_correction",
    expected_intent: "self_correction_intent",
    expected_disposition: "retain_prior_and_redirect_topic",
    message: ([, , unrelated]) =>
      `I think my previous answer was wrong because the ${unrelated} was exciting.`
  },
  {
    archetype_id: "topic_changed_revision",
    expected_intent: "self_correction_intent",
    expected_disposition: "retain_prior_and_redirect_topic",
    message: ([, , unrelated]) =>
      `I need to revise my answer because I want to discuss ${unrelated}.`
  },
  {
    archetype_id: "ordinary_conceptual_response",
    expected_intent: "no_self_correction_intent",
    expected_disposition: "continue_normal_evaluation",
    message: ([topic]) => `The ${topic} supports a narrower conclusion.`
  },
  {
    archetype_id: "ordinary_question",
    expected_intent: "no_self_correction_intent",
    expected_disposition: "continue_normal_evaluation",
    message: ([topic]) => `How should I interpret the ${topic}?`
  }
];

export function runE2A35SelfCorrectionCalibration() {
  const results = CALIBRATION_CONTEXTS.flatMap((context, contextIndex) => {
    const [activeTopic, anchorAlias, unrelated] = context;
    const contract = buildSelfCorrectionIntentContractV1({
      active_topic_terms: [activeTopic],
      active_anchor_aliases: [anchorAlias],
      unrelated_topic_terms: [unrelated]
    });
    return CALIBRATION_ARCHETYPES.map((archetype) => {
      const message = archetype.message(context);
      const resolution = resolveSelfCorrectionIntentV1({
        message,
        contract
      });
      return {
        case_id: `context_${contextIndex + 1}:${archetype.archetype_id}`,
        archetype_id: archetype.archetype_id,
        message,
        expected_intent: archetype.expected_intent,
        observed_intent: resolution.intent,
        expected_disposition: archetype.expected_disposition,
        observed_disposition: resolution.downstream_disposition,
        latest_valid_evidence_eligible:
          resolution.latest_valid_evidence_eligible,
        passed:
          resolution.intent === archetype.expected_intent &&
          resolution.downstream_disposition ===
            archetype.expected_disposition &&
          (archetype.expected_disposition !== "evaluate_revised_evidence" ||
            resolution.prohibited_route_classifications.join("|") ===
              "off_topic|unrelated|new_question")
      };
    });
  });
  return {
    calibration_version: "e2a35-self-correction-intent-calibration-v1",
    resolver_version: SELF_CORRECTION_INTENT_VERSION,
    case_count: results.length,
    minimum_case_count: 150,
    passed_case_count: results.filter((entry) => entry.passed).length,
    required_categories: [
      "valid_self_correction",
      "correction_without_evidence",
      "copied_correction_language",
      "topic_changed_correction",
      "no_self_correction_intent"
    ],
    correction_language_alone_is_not_evidence: true,
    results,
    passed: results.length >= 150 && results.every((entry) => entry.passed)
  };
}

type ObservationInput = {
  reasoning_quality: TrajectoryReasoningQuality;
  misconception_status:
    | "persists"
    | "uncertain"
    | "resolved_for_current_anchor";
  anchor_stance:
    | "not_expressed"
    | "ambiguous"
    | "endorses_distractor"
    | "rejects_distractor";
  anchor_resolution_status:
    | "unresolved"
    | "resolved_against_distractor"
    | "regressed"
    | "contradictory";
  interaction_intent?:
    | "ordinary_conceptual_response"
    | "off_topic_response";
  essential_missing_links?: string[];
  contradictions?: string[];
  evidence_present?: boolean;
};

function observation(input: ObservationInput): TurnEvidenceObservationV5 {
  const evidencePresent = input.evidence_present ?? true;
  const decisiveStance = input.anchor_stance === "endorses_distractor" ||
    input.anchor_stance === "rejects_distractor";
  return {
    interaction_intent:
      input.interaction_intent ?? "ordinary_conceptual_response",
    reasoning_quality: input.reasoning_quality,
    anchor_application: decisiveStance && evidencePresent
      ? "explicit"
      : "absent",
    misconception_status: input.misconception_status,
    essential_missing_links: input.essential_missing_links ?? [],
    contradictions: input.contradictions ?? [],
    structured_contradictions: [],
    observable_evidence_spans: evidencePresent ? [{
      label: "synthetic_e2a35_latest_valid_evidence",
      span: "Synthetic bounded evidence span for deterministic state testing."
    }] : [],
    confidence_evidence: "medium",
    evidence_limitations: evidencePresent ? [] : [
      "self_correction_language_without_observable_conceptual_evidence"
    ],
    anchor_stance: input.anchor_stance,
    anchor_consistency: !decisiveStance
      ? "not_assessable"
      : "consistent_with_conceptual_reasoning",
    anchor_resolution_status: input.anchor_resolution_status,
    anchor_conclusion_consistency_version:
      "anchor-conclusion-consistency-v1",
    sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2
  };
}

function applyObservation(input: {
  prior: TopicDialogueCumulativeEvidenceProfile | null;
  current: TurnEvidenceObservationV5;
  sequence_index: number;
}) {
  const applicability = classifyConceptualEvidenceApplicability({
    observation: input.current,
    unsupported_understanding_claim: false
  });
  const disposition = determineProfileUpdateDisposition({
    prior: input.prior,
    observation: input.current,
    conceptual_evidence_applicability: applicability
  });
  const createdAt =
    `2026-07-25T00:00:${String(input.sequence_index).padStart(2, "0")}.000Z`;
  const baseProfile = createTopicDialogueTurnEvidenceProfile({
    source_student_turn_id: `e2a35_state_turn_${input.sequence_index}`,
    source_sequence_index: input.sequence_index,
    concept_id: CONCEPT_ID,
    distractor_anchor: CANONICAL_ANCHOR_ID,
    observation: input.current,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    created_at: createdAt
  });
  const currentProfile = applyConceptualApplicabilityToTurnProfile({
    profile: baseProfile,
    observation: input.current,
    conceptual_evidence_applicability: applicability
  });
  const cumulative = integrateTopicDialogueEvidenceProfileWithDisposition({
    prior: input.prior,
    current: currentProfile,
    disposition
  });
  const observationRecord = createTurnEvidenceObservationRecordV1({
    source_student_turn_id: currentProfile.source_student_turn_id,
    source_sequence_index: currentProfile.source_sequence_index,
    observation: input.current,
    conceptual_evidence_applicability: applicability,
    profile_update_disposition: disposition,
    unsupported_understanding_claim: false,
    created_at: createdAt
  });
  const updateRecord = createLearningProfileUpdateDispositionRecordV1({
    prior: input.prior,
    current_profile: currentProfile,
    resulting_profile: cumulative,
    observation_record: observationRecord,
    disposition,
    created_at: createdAt
  });
  const consistency = assertProfileUpdateDispositionCoherent({
    prior: input.prior,
    current_profile: currentProfile,
    resulting_profile: cumulative,
    observation_record: observationRecord,
    update_record: updateRecord
  });
  const route = selectEvidenceFirstTopicDialogueRoute({
    profile: currentProfile,
    cumulative
  });
  return {
    applicability,
    disposition,
    current_profile: currentProfile,
    cumulative,
    observation_record: observationRecord,
    update_record: updateRecord,
    consistency,
    route
  };
}

function buildBaseProfileSequence() {
  const initial = applyObservation({
    prior: null,
    current: observation({
      reasoning_quality: "misconception",
      misconception_status: "persists",
      anchor_stance: "endorses_distractor",
      anchor_resolution_status: "unresolved",
      essential_missing_links: [
        "systematic_volunteer_difference",
        "generalization_boundary"
      ],
      contradictions: ["active_distractor_claim_retained"]
    }),
    sequence_index: 1
  });
  const corrected = applyObservation({
    prior: initial.cumulative,
    current: observation({
      reasoning_quality: "sound",
      misconception_status: "resolved_for_current_anchor",
      anchor_stance: "rejects_distractor",
      anchor_resolution_status: "resolved_against_distractor"
    }),
    sequence_index: 2
  });
  const regressed = applyObservation({
    prior: corrected.cumulative,
    current: observation({
      reasoning_quality: "misconception",
      misconception_status: "persists",
      anchor_stance: "endorses_distractor",
      anchor_resolution_status: "regressed",
      essential_missing_links: ["generalization_boundary"],
      contradictions: ["active_distractor_claim_retained"]
    }),
    sequence_index: 3
  });
  const finalSound = applyObservation({
    prior: regressed.cumulative,
    current: observation({
      reasoning_quality: "sound",
      misconception_status: "resolved_for_current_anchor",
      anchor_stance: "rejects_distractor",
      anchor_resolution_status: "resolved_against_distractor"
    }),
    sequence_index: 4
  });
  return { initial, corrected, regressed, finalSound };
}

export function runE2A35SelfCorrectionRegressions() {
  const aliasContract = buildAliasContract();
  const intentContract = buildSelfCorrectionContract(aliasContract);
  const cases = [
    {
      case_id: "valid_self_correction",
      message:
        "I think my previous answer was wrong because option D is wrong: it ignores self-selection bias, volunteers may prefer online learning more than non-volunteers, and the result cannot represent all students.",
      expected_disposition: "evaluate_revised_evidence",
      expected_stance: "rejects_distractor",
      require_ordinary_conceptual_route: true
    },
    {
      case_id: "false_self_correction_without_evidence",
      message: "I think my previous answer was wrong.",
      expected_disposition: "request_revision_evidence",
      expected_stance: "not_expressed",
      require_ordinary_conceptual_route: false
    },
    {
      case_id: "copied_correction_language",
      message: "I think my previous answer was wrong because...",
      expected_disposition: "request_revision_evidence",
      expected_stance: "not_expressed",
      require_ordinary_conceptual_route: false
    },
    {
      case_id: "correction_that_changes_topic",
      message:
        "I think my previous answer was wrong because the hockey game was exciting.",
      expected_disposition: "retain_prior_and_redirect_topic",
      expected_stance: "not_expressed",
      require_ordinary_conceptual_route: false
    },
    {
      case_id: "correction_after_sound",
      message:
        "Let me correct my previous explanation: option D is wrong because volunteer students may systematically differ from non-volunteers, which limits generalization.",
      expected_disposition: "evaluate_revised_evidence",
      expected_stance: "rejects_distractor",
      require_ordinary_conceptual_route: true
    },
    {
      case_id: "regression_after_correction",
      message:
        "I need to change my previous answer: I choose option D because anyone could volunteer, so the sample represents everyone.",
      expected_disposition: "evaluate_revised_evidence",
      expected_stance: "endorses_distractor",
      require_ordinary_conceptual_route: true
    },
    {
      case_id: "correction_with_explicit_distractor_rejection",
      message:
        "I need to correct my earlier answer: option D is wrong because open eligibility does not stop self-selection bias among volunteer students.",
      expected_disposition: "evaluate_revised_evidence",
      expected_stance: "rejects_distractor",
      require_ordinary_conceptual_route: true
    },
    {
      case_id: "correction_with_continued_distractor_endorsement",
      message:
        "I think my previous answer was wrong because I explained it poorly, but option D is still right since anyone could volunteer.",
      expected_disposition: "evaluate_revised_evidence",
      expected_stance: "endorses_distractor",
      require_ordinary_conceptual_route: true
    }
  ] as const;

  const results = cases.map((testCase) => {
    const intent = resolveSelfCorrectionIntentV1({
      message: testCase.message,
      contract: intentContract
    });
    const reference = resolveActiveAnchorAlias({
      message: testCase.message,
      contract: aliasContract,
      prior_visible_message:
        "We are evaluating whether option D represents the whole university population."
    });
    const stance = resolveAnchorStanceScopeV1({
      message: testCase.message,
      contract: aliasContract,
      reference_resolution: reference
    });
    const ordinaryIntent = classifyTopicDialogueInteractionIntent(
      testCase.message
    );
    const observedStance =
      stance.stance_classification.observed_anchor_stance;
    const passed =
      intent.intent === "self_correction_intent" &&
      intent.downstream_disposition === testCase.expected_disposition &&
      observedStance === testCase.expected_stance &&
      (!testCase.require_ordinary_conceptual_route ||
        ordinaryIntent === "ordinary_conceptual_response") &&
      (testCase.expected_disposition !== "evaluate_revised_evidence" ||
        intent.latest_valid_evidence_eligible);
    return {
      case_id: testCase.case_id,
      message: testCase.message,
      self_correction_intent: intent.intent,
      evidence_status: intent.evidence_status,
      downstream_disposition: intent.downstream_disposition,
      ordinary_topic_dialogue_intent: ordinaryIntent,
      observed_anchor_reference: reference.observed_anchor_reference,
      observed_anchor_stance: observedStance,
      expected_anchor_stance: testCase.expected_stance,
      latest_valid_evidence_eligible:
        intent.latest_valid_evidence_eligible,
      passed
    };
  });
  return {
    suite_version: "e2a35-self-correction-regressions-v1",
    required_case_ids: cases.map((entry) => entry.case_id),
    case_count: results.length,
    passed_case_count: results.filter((entry) => entry.passed).length,
    valid_correction_not_off_topic:
      results.filter((entry) =>
        entry.latest_valid_evidence_eligible
      ).every((entry) =>
        entry.ordinary_topic_dialogue_intent ===
          "ordinary_conceptual_response"
      ),
    copied_or_empty_correction_not_evidence:
      results.filter((entry) => [
        "false_self_correction_without_evidence",
        "copied_correction_language"
      ].includes(entry.case_id)).every((entry) =>
        !entry.latest_valid_evidence_eligible
      ),
    revised_evidence_evaluated:
      results.filter((entry) => [
        "valid_self_correction",
        "correction_after_sound",
        "regression_after_correction",
        "correction_with_explicit_distractor_rejection",
        "correction_with_continued_distractor_endorsement"
      ].includes(entry.case_id)).every((entry) =>
        entry.latest_valid_evidence_eligible
      ),
    results,
    passed: results.every((entry) => entry.passed)
  };
}

export function runE2A35ProfileUpdateRegressions() {
  const sequence = buildBaseProfileSequence();
  const noEvidence = observation({
    reasoning_quality: "insufficient",
    misconception_status: "uncertain",
    anchor_stance: "not_expressed",
    anchor_resolution_status: "unresolved",
    essential_missing_links: ["observable_revised_evidence"],
    evidence_present: false
  });
  const falseCorrection = applyObservation({
    prior: sequence.initial.cumulative,
    current: noEvidence,
    sequence_index: 5
  });
  const copiedCorrection = applyObservation({
    prior: sequence.initial.cumulative,
    current: noEvidence,
    sequence_index: 6
  });
  const topicChangedCorrection = applyObservation({
    prior: sequence.initial.cumulative,
    current: observation({
      reasoning_quality: "insufficient",
      misconception_status: "uncertain",
      anchor_stance: "not_expressed",
      anchor_resolution_status: "unresolved",
      interaction_intent: "off_topic_response",
      essential_missing_links: ["active_topic_evidence"],
      evidence_present: false
    }),
    sequence_index: 7
  });
  const soundAfterSound = applyObservation({
    prior: sequence.corrected.cumulative,
    current: observation({
      reasoning_quality: "sound",
      misconception_status: "resolved_for_current_anchor",
      anchor_stance: "rejects_distractor",
      anchor_resolution_status: "resolved_against_distractor"
    }),
    sequence_index: 8
  });

  const cases = [
    {
      case_id: "initial_misconception_recorded",
      passed:
        sequence.initial.disposition === "update_from_latest_evidence" &&
        sequence.initial.cumulative.current_misconception_status ===
          "persists" &&
        sequence.initial.cumulative.historical_misconception_snapshot_ids
          .includes(sequence.initial.current_profile.profile_snapshot_id)
    },
    {
      case_id: "valid_correction_becomes_authoritative",
      passed:
        sequence.corrected.disposition === "update_from_latest_evidence" &&
        sequence.corrected.cumulative.current_reasoning_quality ===
          "sound" &&
        sequence.corrected.cumulative.current_revision_readiness &&
        sequence.corrected.cumulative.current_conceptual_profile_snapshot_id ===
          sequence.corrected.current_profile.profile_snapshot_id
    },
    {
      case_id: "false_correction_preserves_prior_profile",
      passed:
        falseCorrection.disposition === "preserve_prior_profile" &&
        falseCorrection.cumulative.current_conceptual_profile_snapshot_id ===
          sequence.initial.cumulative.current_conceptual_profile_snapshot_id
    },
    {
      case_id: "copied_correction_preserves_prior_profile",
      passed:
        copiedCorrection.disposition === "preserve_prior_profile" &&
        copiedCorrection.cumulative.current_misconception_status ===
          "persists"
    },
    {
      case_id: "topic_changed_correction_preserves_prior_profile",
      passed:
        topicChangedCorrection.disposition === "preserve_prior_profile" &&
        topicChangedCorrection.route.selected_operation ===
          "redirect_off_topic"
    },
    {
      case_id: "correction_after_sound_uses_latest_valid_evidence",
      passed:
        soundAfterSound.disposition === "update_from_latest_evidence" &&
        soundAfterSound.cumulative.current_reasoning_quality === "sound" &&
        soundAfterSound.cumulative.misconception_reopened_count === 0
    },
    {
      case_id: "earlier_misconception_remains_historical",
      passed:
        sequence.finalSound.cumulative.historical_misconception_snapshot_ids
          .includes(sequence.initial.current_profile.profile_snapshot_id) &&
        sequence.finalSound.cumulative.current_revision_readiness
    }
  ];
  return {
    suite_version: "e2a35-profile-update-regressions-v1",
    production_update_contract_used: true,
    latest_valid_evidence_precedence:
      sequence.finalSound.cumulative.latest_evidence_precedence,
    case_count: cases.length,
    passed_case_count: cases.filter((entry) => entry.passed).length,
    cases,
    passed: cases.every((entry) => entry.passed)
  };
}

export function runE2A35RegressionReopeningRegressions() {
  const sequence = buildBaseProfileSequence();
  const cases = [
    {
      case_id: "resolved_profile_reopens_on_regression",
      passed:
        sequence.regressed.disposition ===
          "reopen_from_latest_contradiction" &&
        sequence.regressed.cumulative.current_misconception_status ===
          "persists" &&
        !sequence.regressed.cumulative.current_revision_readiness
    },
    {
      case_id: "reopening_count_increments",
      passed:
        sequence.regressed.cumulative.misconception_reopened_count === 1
    },
    {
      case_id: "regression_routes_to_targeted_repair",
      passed:
        sequence.regressed.route.selected_mode === "remain_in_dialogue" &&
        sequence.regressed.route.selected_operation === "repair_recurrence"
    },
    {
      case_id: "final_sound_closes_reopened_profile",
      passed:
        sequence.finalSound.disposition ===
          "update_from_latest_evidence" &&
        sequence.finalSound.cumulative.current_misconception_status ===
          "resolved_for_current_anchor" &&
        sequence.finalSound.cumulative.current_revision_readiness
    },
    {
      case_id: "final_sound_authorizes_immediate_revision",
      passed:
        sequence.finalSound.route.selected_mode === "request_revision" &&
        sequence.finalSound.route.minimum_turn_requirement_applied === false
    },
    {
      case_id: "historical_misconception_does_not_block_progression",
      passed:
        sequence.finalSound.cumulative.historical_misconception_snapshot_ids
          .length >= 2 &&
        sequence.finalSound.route.selected_mode === "request_revision"
    }
  ];
  return {
    suite_version: "e2a35-regression-reopening-regressions-v1",
    case_count: cases.length,
    passed_case_count: cases.filter((entry) => entry.passed).length,
    misconception_reopened_count:
      sequence.finalSound.cumulative.misconception_reopened_count,
    cases,
    passed: cases.every((entry) => entry.passed)
  };
}

export function runE2A35TrajectoryEnvelopeRegressions(
  envelope: TrajectoryEnvelopeContract
) {
  const testCases = [
    {
      case_id: "early_sound_overrides_trajectory",
      turn: envelope.turns[0]!,
      evaluator_reasoning_quality: "sound" as const,
      sound_passed: true,
      evidence_independently_supported: true,
      copied: false,
      contradiction: false,
      prior_quality: null,
      prior_sound: false,
      expected_progression: "immediate_revision",
      expected_adherence: "sound_earlier_than_intended"
    },
    {
      case_id: "prolonged_partial_after_correction",
      turn: envelope.turns[5]!,
      evaluator_reasoning_quality: "partial" as const,
      sound_passed: false,
      evidence_independently_supported: true,
      copied: false,
      contradiction: false,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_progression: "continue_evidence_targeted_tutor",
      expected_adherence: "partial_longer_than_intended"
    },
    {
      case_id: "regression_after_valid_correction",
      turn: envelope.turns[3]!,
      evaluator_reasoning_quality: "misconception" as const,
      sound_passed: false,
      evidence_independently_supported: true,
      copied: false,
      contradiction: true,
      prior_quality: "sound" as const,
      prior_sound: true,
      expected_progression: "reopen_targeted_support",
      expected_adherence: "contradiction_after_sound"
    },
    {
      case_id: "copied_correction_language_without_evidence",
      turn: envelope.turns[1]!,
      evaluator_reasoning_quality: "insufficient" as const,
      sound_passed: false,
      evidence_independently_supported: false,
      copied: true,
      contradiction: false,
      prior_quality: "misconception" as const,
      prior_sound: false,
      expected_progression: "request_independent_evidence",
      expected_adherence: "copied_wording_without_evidence"
    },
    {
      case_id: "final_sound_immediate_revision",
      turn: envelope.turns[4]!,
      evaluator_reasoning_quality: "sound" as const,
      sound_passed: true,
      evidence_independently_supported: true,
      copied: false,
      contradiction: false,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_progression: "immediate_revision",
      expected_adherence: "inside_allowed_envelope"
    }
  ];
  const results = testCases.map((testCase) => {
    const decision = evaluateTrajectoryEnvelope({
      turn_contract: testCase.turn,
      evaluator_reasoning_quality:
        testCase.evaluator_reasoning_quality,
      sound_gate_result: {
        gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
        passed: testCase.sound_passed,
        failure_codes: testCase.sound_passed ? [] : ["not_sound"]
      },
      evidence_independently_supported:
        testCase.evidence_independently_supported,
      copied_wording_without_evidence: testCase.copied,
      blocking_contradiction: testCase.contradiction,
      prior_reasoning_quality: testCase.prior_quality,
      prior_sound_gate_passed: testCase.prior_sound,
      turn_budget_exhausted: false
    });
    return {
      case_id: testCase.case_id,
      progression_decision: decision.progression_decision,
      trajectory_adherence: decision.trajectory_adherence,
      revision_required_immediately:
        decision.revision_required_immediately,
      evaluator_reasoning_quality_preserved:
        decision.evaluator_reasoning_quality_preserved,
      passed:
        decision.progression_decision ===
          testCase.expected_progression &&
        decision.trajectory_adherence === testCase.expected_adherence &&
        decision.trajectory_expectation_changed_evaluator_output === false
    };
  });
  return {
    suite_version: "e2a35-trajectory-envelope-regressions-v1",
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    sound_evidence_overrides_scripted_trajectory: results.find((entry) =>
      entry.case_id === "early_sound_overrides_trajectory"
    )?.passed === true,
    exact_turn_reasoning_labels_enforced: false,
    case_count: results.length,
    passed_case_count: results.filter((entry) => entry.passed).length,
    results,
    passed: results.every((entry) => entry.passed)
  };
}

function runOverlapAnalysis(targetContract: TargetEvidenceContractV5) {
  const candidateStrings = [
    SCENARIO_PROMPT,
    DISTRACTOR_CLAIM,
    ...targetContract.target_conceptual_relationships,
    ...targetContract.required_mechanisms
  ];
  const normalizedCandidates = new Set(
    candidateStrings.map(normalizedText)
  );
  const results = PRIOR_SCENARIO_SOURCES.map((source) => {
    const priorStrings = stringsFromArtifact(source.path);
    const normalizedPrior = new Set(
      [...priorStrings].map(normalizedText)
    );
    const exactMatches = candidateStrings.filter((candidate) =>
      priorStrings.has(candidate)
    );
    const normalizedMatches = [...normalizedCandidates].filter((candidate) =>
      normalizedPrior.has(candidate)
    );
    let maximumTokenOverlap = 0;
    for (const candidate of candidateStrings) {
      for (const prior of priorStrings) {
        maximumTokenOverlap = Math.max(
          maximumTokenOverlap,
          tokenJaccard(candidate, prior)
        );
      }
    }
    return {
      stage: source.stage,
      source_path: source.path,
      source_sha256: fileSha256(source.path),
      exact_match_count: exactMatches.length,
      normalized_match_count: normalizedMatches.length,
      maximum_token_jaccard: Number(maximumTokenOverlap.toFixed(6)),
      semantic_tags: source.semantic_tags,
      sampling_bias_tag_collision: source.semantic_tags.some((tag) =>
        [
          "sampling_bias",
          "voluntary_response_bias",
          "self_selection_bias",
          "conversation_state_self_correction"
        ].includes(tag)
      ),
      passed:
        exactMatches.length === 0 &&
        normalizedMatches.length === 0 &&
        maximumTokenOverlap < 0.72 &&
        !source.semantic_tags.some((tag) =>
          [
            "sampling_bias",
            "voluntary_response_bias",
            "self_selection_bias",
            "conversation_state_self_correction"
          ].includes(tag)
        )
    };
  });
  return {
    overlap_analysis_version: "e2a35-held-out-overlap-analysis-v1",
    candidate_semantic_tags: [
      "research_methods",
      "sampling_bias",
      "voluntary_response_bias",
      "self_selection_bias",
      "external_validity",
      "conversation_state_self_correction"
    ],
    declared_framework_reuse: [
      "target_evidence_contract_v5",
      "canonical_anchor_evidence",
      "anchor_stance_scope_resolution_v1",
      "trajectory_envelope_v1",
      "evidence_first_profile_update"
    ],
    scenario_or_domain_reuse_permitted: false,
    exact_overlap_passed: results.every((entry) =>
      entry.exact_match_count === 0
    ),
    normalized_overlap_passed: results.every((entry) =>
      entry.normalized_match_count === 0
    ),
    token_overlap_passed: results.every((entry) =>
      entry.maximum_token_jaccard < 0.72
    ),
    semantic_tag_audit_passed: results.every((entry) =>
      !entry.sampling_bias_tag_collision
    ),
    results,
    passed: results.every((entry) => entry.passed)
  };
}

function buildBudget() {
  return {
    budget_version: "e2a35-bounded-live-budget-v1",
    live_execution_authorized: false,
    isolated_session_count: 1,
    maximum_logical_generation_calls: 29,
    maximum_adapter_attempts: 87,
    maximum_transport_retries_per_logical_call: 2,
    maximum_input_tokens: 900_000,
    maximum_output_tokens: 70_000,
    maximum_total_tokens: 970_000,
    maximum_usd_when_pricing_metadata_available: 25,
    provider_concurrency: 1,
    provider_transport_retry_policy_version:
      PROVIDER_TRANSPORT_RETRY_POLICY_VERSION
  };
}

function candidateIntegrity() {
  const candidate = evaluateE2A24Candidate();
  const passed =
    candidate.candidate_configuration_hash ===
      CANDIDATE_CONFIGURATION_HASH &&
    candidate.candidate_file_sha256 === CANDIDATE_FILE_SHA256 &&
    candidate.changed_unrelated_roles.length === 0 &&
    !candidate.candidate_approved &&
    !candidate.candidate_activated;
  return {
    integrity_version: "e2a35-candidate-integrity-v1",
    candidate_path: E2A24_CANDIDATE_PATH,
    candidate_configuration_hash:
      candidate.candidate_configuration_hash,
    candidate_file_sha256: candidate.candidate_file_sha256,
    expected_candidate_configuration_hash:
      CANDIDATE_CONFIGURATION_HASH,
    expected_candidate_file_sha256: CANDIDATE_FILE_SHA256,
    evaluator_v5_role_configuration:
      candidate.full_candidate.roles
        .formative_activity_response_evaluator_agent,
    tutor_role_configuration:
      candidate.full_candidate.roles.formative_activity_dialogue_agent,
    candidate_approved: false,
    candidate_activated: false,
    passed
  };
}

function protectedSourceIntegrity() {
  const results = Object.entries(EXPECTED_PROTECTED_SOURCE_HASHES).map(
    ([relativePath, expected]) => {
      const actual = fileSha256(relativePath);
      return {
        path: relativePath,
        expected_sha256: expected,
        actual_sha256: actual,
        unchanged: actual === expected
      };
    }
  );
  return {
    integrity_version: "e2a35-protected-source-integrity-v1",
    evaluator_v5_unchanged: results.find((entry) =>
      entry.path.endsWith("production-turn-evidence-evaluator-v5.ts")
    )?.unchanged === true,
    tutor_candidate_unchanged: results.find((entry) =>
      entry.path.endsWith("e2a24-autonomous-dialogue-candidate.ts")
    )?.unchanged === true,
    trajectory_envelope_unchanged: results.find((entry) =>
      entry.path.endsWith("trajectory-envelope-v1.ts")
    )?.unchanged === true,
    profile_update_contract_unchanged: results.find((entry) =>
      entry.path.endsWith("turn-evidence-profile-update.ts")
    )?.unchanged === true,
    results,
    passed: results.every((entry) => entry.unchanged)
  };
}

function buildArtifactContract() {
  return {
    artifact_contract_version: "e2a35-artifact-contract-v1",
    preparation_artifacts: [...E2A35_ARTIFACT_NAMES],
    future_live_artifacts_required_after_separate_implementation: [
      "dispatch-checkpoint.json",
      "simulator-provider-outputs.jsonl",
      "evaluator-provider-outputs.jsonl",
      "autonomous-tutor-provider-outputs.jsonl",
      "provider-attempt-results.jsonl",
      "self-correction-intent-results.jsonl",
      "anchor-stance-scope-results.jsonl",
      "turn-evidence-observations.jsonl",
      "profile-update-dispositions.jsonl",
      "cumulative-profile-updates.jsonl",
      "trajectory-envelope-results.jsonl",
      "progression-results.jsonl",
      "complete-visible-conversations.jsonl",
      "human-review-packet.json",
      "usage-and-cost.json",
      "canary-summary.json"
    ],
    provider_outputs_must_be_preserved: true,
    self_correction_resolution_must_be_preserved: true,
    latest_evidence_precedence_trace_required: true,
    profile_reopening_trace_required: true,
    human_review_required: true,
    artifacts_must_be_read_only_after_finalization: true,
    secrets_and_credentials_prohibited: true,
    live_execution_in_this_phase: false
  };
}

function buildProtocol(input: {
  targetContract: TargetEvidenceContractV5;
  canonicalAnchor: ReturnType<typeof buildCanonicalAnchorContract>;
  stanceContract: ReturnType<typeof buildAnchorStanceContract>;
  selfCorrectionContract: SelfCorrectionIntentContractV1;
  compiledEvaluatorRequest: ReturnType<
    typeof buildProductionTurnEvidenceEvaluatorInputV5
  >;
  trajectoryEnvelope: TrajectoryEnvelopeContract;
  calibration: ReturnType<typeof runE2A35SelfCorrectionCalibration>;
  selfCorrectionRegressions:
    ReturnType<typeof runE2A35SelfCorrectionRegressions>;
  profileRegressions:
    ReturnType<typeof runE2A35ProfileUpdateRegressions>;
  reopeningRegressions:
    ReturnType<typeof runE2A35RegressionReopeningRegressions>;
  trajectoryRegressions:
    ReturnType<typeof runE2A35TrajectoryEnvelopeRegressions>;
  overlap: ReturnType<typeof runOverlapAnalysis>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
  candidate: ReturnType<typeof candidateIntegrity>;
  protectedSources: ReturnType<typeof protectedSourceIntegrity>;
}) {
  const protocol = {
    preparation_version: E2A35_PREPARATION_VERSION,
    protocol_version: E2A35_PROTOCOL_VERSION,
    status: "e2a35_protocol_frozen_not_authorized_not_executed",
    source_parent_git_commit: currentGitCommit(),
    held_out_domain: "research_methods",
    held_out_topic: "sampling_bias_and_self_selection",
    generalization_focus: "self_correction_and_conversational_state",
    scenario: {
      prompt: SCENARIO_PROMPT,
      active_distractor_option: OPTION_LABEL,
      active_distractor: DISTRACTOR_CLAIM,
      correct_mechanism: [
        "volunteer samples may differ systematically from the broader population",
        "self-selection into participation can affect the observed preference",
        "self-selection bias limits population generalization"
      ]
    },
    contract_versions: {
      target_evidence: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
      evaluator: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
      evaluator_input:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
      evaluator_output:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
      anchor_stance_scope: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
      self_correction_intent: SELF_CORRECTION_INTENT_VERSION,
      trajectory_envelope: TRAJECTORY_ENVELOPE_VERSION
    },
    contract_hashes: {
      target_evidence: stableHash(input.targetContract),
      canonical_anchor: stableHash(input.canonicalAnchor),
      anchor_stance: stableHash(input.stanceContract),
      self_correction_intent: stableHash(input.selfCorrectionContract),
      compiled_evaluator_v5_request:
        stableHash(input.compiledEvaluatorRequest),
      trajectory_envelope: stableHash(input.trajectoryEnvelope),
      artifact_contract: stableHash(input.artifactContract),
      budget: stableHash(input.budget)
    },
    evaluator_identity: {
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
      prompt_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
      prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
      repair_prompt_hash:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5
    },
    conversational_state_policy: {
      self_correction_intent_is_distinct: true,
      valid_self_correction_not_off_topic: true,
      valid_self_correction_not_unrelated: true,
      valid_self_correction_not_new_question: true,
      revised_evidence_evaluated_by_unchanged_evaluator_v5: true,
      correction_language_alone_not_evidence: true,
      latest_valid_evidence_precedence: true,
      earlier_misconception_retained_as_historical: true,
      regression_reopens_profile: true,
      sound_evidence_authorizes_revision_immediately: true,
      exact_turn_labels_enforced: false
    },
    deterministic_gate_results: {
      calibration_passed: input.calibration.passed,
      self_correction_regressions_passed:
        input.selfCorrectionRegressions.passed,
      profile_update_regressions_passed:
        input.profileRegressions.passed,
      regression_reopening_passed: input.reopeningRegressions.passed,
      trajectory_envelope_passed: input.trajectoryRegressions.passed,
      held_out_overlap_passed: input.overlap.passed,
      candidate_integrity_passed: input.candidate.passed,
      protected_source_integrity_passed: input.protectedSources.passed,
      evaluator_v5_request_compiled: true,
      provider_call_guard_required: true
    },
    execution_boundary: {
      live_harness_present: false,
      live_command_present: false,
      execution_authorized: false,
      live_execution_performed: false,
      provider_calls_made: 0,
      network_requests_made: 0,
      approval_performed: false,
      activation_performed: false
    },
    budget: input.budget
  };
  return {
    ...protocol,
    protocol_hash: stableHash(protocol)
  };
}

function buildCompositeRuntimeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  targetContract: TargetEvidenceContractV5;
  canonicalAnchor: ReturnType<typeof buildCanonicalAnchorContract>;
  stanceContract: ReturnType<typeof buildAnchorStanceContract>;
  selfCorrectionContract: SelfCorrectionIntentContractV1;
  trajectoryEnvelope: TrajectoryEnvelopeContract;
  candidate: ReturnType<typeof candidateIntegrity>;
}) {
  const identity = {
    identity_version: "e2a35-composite-runtime-identity-v1",
    protocol_version: E2A35_PROTOCOL_VERSION,
    protocol_hash: input.protocol.protocol_hash,
    candidate_configuration_hash:
      input.candidate.candidate_configuration_hash,
    candidate_file_sha256: input.candidate.candidate_file_sha256,
    evaluator_v5: {
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
      prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
      repair_prompt_hash:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
      source_sha256:
        EXPECTED_PROTECTED_SOURCE_HASHES[
          "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
        ]
    },
    tutor_candidate_source_sha256:
      EXPECTED_PROTECTED_SOURCE_HASHES[
        "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
      ],
    target_evidence_contract_hash: stableHash(input.targetContract),
    canonical_anchor_contract_hash: stableHash(input.canonicalAnchor),
    anchor_stance_contract_hash: stableHash(input.stanceContract),
    self_correction_intent_contract_hash:
      stableHash(input.selfCorrectionContract),
    trajectory_envelope_hash: stableHash(input.trajectoryEnvelope),
    source_hashes: {
      self_correction_intent:
        fileSha256(
          "src/lib/evaluation/formative/self-correction-intent-v1.ts"
        ),
      protocol_builder:
        fileSha256(
          "src/lib/evaluation/formative/e2a35-self-correction-protocol.ts"
        ),
      anchor_stance_scope:
        EXPECTED_PROTECTED_SOURCE_HASHES[
          "src/lib/services/student-assessment/anchor-stance-scope-resolution-v1.ts"
        ],
      profile_update:
        EXPECTED_PROTECTED_SOURCE_HASHES[
          "src/lib/services/student-assessment/turn-evidence-profile-update.ts"
        ],
      trajectory_envelope:
        EXPECTED_PROTECTED_SOURCE_HASHES[
          "src/lib/evaluation/formative/trajectory-envelope-v1.ts"
        ]
    },
    execution_authorized: false,
    live_execution_performed: false
  };
  return {
    ...identity,
    composite_runtime_identity_hash: stableHash(identity)
  };
}

function validateArtifactDirectory(runDirectory: string) {
  const expectedWithoutValidation = E2A35_ARTIFACT_NAMES.filter((name) =>
    name !== "artifact-validation.json"
  ).sort();
  const expectedNameSet = new Set<string>(expectedWithoutValidation);
  const actual = readdirSync(runDirectory).sort();
  const missing = expectedWithoutValidation.filter((name) =>
    !actual.includes(name)
  );
  const unexpected = actual.filter((name) =>
    !expectedNameSet.has(name)
  );
  const unsafePatterns = [
    /\bsk-[A-Za-z0-9_-]{12,}\b/u,
    /Bearer\s+[A-Za-z0-9._-]+/iu,
    /OPENAI_API_KEY\s*=/u,
    /DATABASE_URL\s*=/u,
    /SESSION_SECRET\s*=/u,
    /Authorization\s*:/iu
  ];
  const unsafeFiles = actual.filter((name) => {
    const filePath = path.join(runDirectory, name);
    return statSync(filePath).isFile() &&
      unsafePatterns.some((pattern) =>
        pattern.test(readFileSync(filePath, "utf8"))
      );
  });
  return {
    validation_version: "e2a35-artifact-validation-v1",
    expected_artifact_count_before_validation:
      expectedWithoutValidation.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    unsafe_artifacts: unsafeFiles,
    passed:
      missing.length === 0 &&
      unexpected.length === 0 &&
      unsafeFiles.length === 0
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a35-provider-call-guard-v1",
    preparation_mode: "deterministic_no_live",
    provider_client_constructed: false,
    provider_dispatch_enabled: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    e2a35_live_execution_performed: false,
    passed: networkRequestCount === 0
  };
}

function buildHeldOutDomain() {
  return {
    held_out_domain_version: "e2a35-sampling-bias-domain-v1",
    domain: "research_methods",
    topic: "sampling_bias_and_self_selection",
    scenario_prompt: SCENARIO_PROMPT,
    active_distractor_option: OPTION_LABEL,
    active_distractor_text: DISTRACTOR_CLAIM,
    correct_mechanism: [
      "Volunteer samples may differ systematically from the broader population.",
      "Self-selection into participation can affect the observed preference.",
      "Self-selection bias limits generalization to all university students."
    ],
    conversational_state_generalization: [
      "natural self-correction",
      "unsupported correction claim",
      "topic-changing correction",
      "regression after correction",
      "latest valid evidence precedence",
      "immediate revision after sound evidence"
    ],
    prior_domain_reuse_permitted: false
  };
}

export function buildE2A35PreparationArtifacts(
  networkRequestCount = 0
) {
  const aliasContract = buildAliasContract();
  const targetContract = buildTargetEvidenceContract(aliasContract);
  const canonicalAnchor = buildCanonicalAnchorContract(aliasContract);
  const stanceContract = buildAnchorStanceContract();
  const selfCorrectionContract =
    buildSelfCorrectionContract(aliasContract);
  const compiledEvaluatorRequest = buildCompiledEvaluatorRequest(
    targetContract,
    selfCorrectionContract
  );
  const trajectoryEnvelope = buildTrajectoryEnvelope();
  const calibration = runE2A35SelfCorrectionCalibration();
  const selfCorrectionRegressions =
    runE2A35SelfCorrectionRegressions();
  const profileRegressions = runE2A35ProfileUpdateRegressions();
  const reopeningRegressions =
    runE2A35RegressionReopeningRegressions();
  const trajectoryRegressions =
    runE2A35TrajectoryEnvelopeRegressions(trajectoryEnvelope);
  const overlap = runOverlapAnalysis(targetContract);
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const candidate = candidateIntegrity();
  const protectedSources = protectedSourceIntegrity();
  const protocol = buildProtocol({
    targetContract,
    canonicalAnchor,
    stanceContract,
    selfCorrectionContract,
    compiledEvaluatorRequest,
    trajectoryEnvelope,
    calibration,
    selfCorrectionRegressions,
    profileRegressions,
    reopeningRegressions,
    trajectoryRegressions,
    overlap,
    budget,
    artifactContract,
    candidate,
    protectedSources
  });
  const compositeRuntimeIdentity = buildCompositeRuntimeIdentity({
    protocol,
    targetContract,
    canonicalAnchor,
    stanceContract,
    selfCorrectionContract,
    trajectoryEnvelope,
    candidate
  });
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);
  const passed =
    calibration.passed &&
    selfCorrectionRegressions.passed &&
    profileRegressions.passed &&
    reopeningRegressions.passed &&
    trajectoryRegressions.passed &&
    overlap.passed &&
    candidate.passed &&
    protectedSources.passed &&
    providerCallGuard.passed;
  const summary = {
    preparation_version: E2A35_PREPARATION_VERSION,
    status: passed
      ? "e2a35_protocol_frozen_for_separate_authorization"
      : "e2a35_protocol_freeze_failed",
    protocol_version: E2A35_PROTOCOL_VERSION,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    target_evidence_contract_version:
      TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    anchor_stance_scope_resolution_version:
      ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    self_correction_intent_version: SELF_CORRECTION_INTENT_VERSION,
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    self_correction_calibration_case_count: calibration.case_count,
    self_correction_calibration_passed: calibration.passed,
    deterministic_self_correction_case_count:
      selfCorrectionRegressions.case_count,
    deterministic_self_correction_passed:
      selfCorrectionRegressions.passed,
    profile_update_regressions_passed: profileRegressions.passed,
    regression_reopening_passed: reopeningRegressions.passed,
    trajectory_envelope_passed: trajectoryRegressions.passed,
    held_out_overlap_passed: overlap.passed,
    candidate_integrity_passed: candidate.passed,
    protected_source_integrity_passed: protectedSources.passed,
    evaluator_v5_request_compiled: true,
    latest_valid_evidence_has_precedence: true,
    earlier_misconception_remains_historical: true,
    regression_reopens_profile: true,
    sound_authorizes_revision_immediately: true,
    exact_turn_labels_enforced: false,
    e2a35_live_execution_performed: false,
    e2a35_execution_authorized: false,
    candidate_approved: false,
    candidate_activated: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    passed
  };
  const freezeManifest = {
    freeze_manifest_version: "e2a35-freeze-manifest-v1",
    preparation_version: E2A35_PREPARATION_VERSION,
    protocol_version: E2A35_PROTOCOL_VERSION,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    source_parent_git_commit: protocol.source_parent_git_commit,
    execution_mode: "deterministic_no_live_protocol_freeze",
    live_harness_present: false,
    live_command_present: false,
    execution_authorized: false,
    live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    approval_performed: false,
    activation_performed: false
  };

  return {
    freezeManifest,
    protocol,
    heldOutDomain: buildHeldOutDomain(),
    targetContract,
    canonicalAnchor,
    stanceContract,
    selfCorrectionContract,
    compiledEvaluatorRequest,
    trajectoryEnvelope,
    calibration,
    selfCorrectionRegressions,
    profileRegressions,
    reopeningRegressions,
    trajectoryRegressions,
    overlap,
    budget,
    artifactContract,
    candidate,
    protectedSources,
    compositeRuntimeIdentity,
    providerCallGuard,
    summary
  };
}

function writePreparationArtifactFiles(
  runDirectory: string,
  artifacts: ReturnType<typeof buildE2A35PreparationArtifacts>
) {
  writeJson(
    path.join(runDirectory, "freeze-manifest.json"),
    artifacts.freezeManifest
  );
  writeJson(
    path.join(runDirectory, "frozen-protocol.json"),
    artifacts.protocol
  );
  writeFileSync(
    path.join(runDirectory, "frozen-protocol.sha256"),
    `${artifacts.protocol.protocol_hash}\n`,
    "utf8"
  );
  writeJson(
    path.join(runDirectory, "held-out-domain.json"),
    artifacts.heldOutDomain
  );
  writeJson(
    path.join(runDirectory, "target-evidence-contract.json"),
    artifacts.targetContract
  );
  writeJson(
    path.join(runDirectory, "canonical-anchor-contract.json"),
    artifacts.canonicalAnchor
  );
  writeJson(
    path.join(runDirectory, "anchor-stance-contract.json"),
    artifacts.stanceContract
  );
  writeJson(
    path.join(runDirectory, "self-correction-intent-contract.json"),
    artifacts.selfCorrectionContract
  );
  writeJson(
    path.join(runDirectory, "compiled-evaluator-v5-request.json"),
    artifacts.compiledEvaluatorRequest
  );
  writeJson(
    path.join(runDirectory, "trajectory-envelope-contract.json"),
    artifacts.trajectoryEnvelope
  );
  writeJson(
    path.join(runDirectory, "self-correction-calibration.json"),
    artifacts.calibration
  );
  writeJson(
    path.join(
      runDirectory,
      "deterministic-self-correction-regressions.json"
    ),
    artifacts.selfCorrectionRegressions
  );
  writeJson(
    path.join(runDirectory, "profile-update-regressions.json"),
    artifacts.profileRegressions
  );
  writeJson(
    path.join(runDirectory, "regression-reopening-regressions.json"),
    artifacts.reopeningRegressions
  );
  writeJson(
    path.join(runDirectory, "trajectory-envelope-regressions.json"),
    artifacts.trajectoryRegressions
  );
  writeJson(
    path.join(runDirectory, "overlap-analysis.json"),
    artifacts.overlap
  );
  writeJson(path.join(runDirectory, "budget.json"), artifacts.budget);
  writeJson(
    path.join(runDirectory, "artifact-contract.json"),
    artifacts.artifactContract
  );
  writeJson(
    path.join(runDirectory, "candidate-integrity.json"),
    artifacts.candidate
  );
  writeJson(
    path.join(runDirectory, "protected-source-integrity.json"),
    artifacts.protectedSources
  );
  writeJson(
    path.join(runDirectory, "composite-runtime-identity.json"),
    artifacts.compositeRuntimeIdentity
  );
  writeJson(
    path.join(runDirectory, "provider-call-guard.json"),
    artifacts.providerCallGuard
  );
  writeJson(path.join(runDirectory, "summary.json"), artifacts.summary);
}

export function writeE2A35PreparationArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory) ||
      readdirSync(input.runDirectory).length === 0,
    "e2a35_artifact_directory_not_empty"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A35PreparationArtifacts(
    input.networkRequestCount ?? 0
  );
  writePreparationArtifactFiles(input.runDirectory, artifacts);
  const artifactValidation = validateArtifactDirectory(input.runDirectory);
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  const finalFiles = readdirSync(input.runDirectory).sort();
  const finalNameSet = new Set<string>(finalFiles);
  const completeArtifactSet =
    finalFiles.length === E2A35_ARTIFACT_NAMES.length &&
    E2A35_ARTIFACT_NAMES.every((name) => finalNameSet.has(name));
  assert(artifacts.summary.passed, "e2a35_deterministic_gates_failed");
  assert(artifactValidation.passed, "e2a35_artifact_validation_failed");
  assert(completeArtifactSet, "e2a35_artifact_set_incomplete");
  for (const name of finalFiles) {
    chmodSync(path.join(input.runDirectory, name), 0o444);
  }
  return {
    ...artifacts,
    artifactValidation: {
      ...artifactValidation,
      final_artifact_count: finalFiles.length,
      complete_artifact_set: completeArtifactSet,
      read_only_finalization_applied: true
    },
    runDirectory: input.runDirectory
  };
}

export function makeE2A35PreparationRunId() {
  const timestamp = new Date().toISOString().replace(/[-:.Z]/gu, "");
  return `e2a35_${timestamp}_${randomBytes(4).toString("hex")}`;
}

export function latestE2A35PreparationRunDirectory() {
  assert(existsSync(E2A35_ARTIFACT_ROOT), "e2a35_artifact_root_missing");
  const latest = readdirSync(E2A35_ARTIFACT_ROOT)
    .map((name) => path.join(E2A35_ARTIFACT_ROOT, name))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
    .at(-1);
  assert(latest, "e2a35_artifact_run_missing");
  return latest;
}

export function inspectE2A35PreparationRun(runDirectory: string) {
  const summary = readJson<JsonRecord>(
    path.join(runDirectory, "summary.json")
  );
  const validation = readJson<JsonRecord>(
    path.join(runDirectory, "artifact-validation.json")
  );
  const protocol = readJson<JsonRecord>(
    path.join(runDirectory, "frozen-protocol.json")
  );
  const identity = readJson<JsonRecord>(
    path.join(runDirectory, "composite-runtime-identity.json")
  );
  return {
    ...summary,
    artifact_validation: validation,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      identity.composite_runtime_identity_hash,
    artifact_directory: path.relative(process.cwd(), runDirectory)
  };
}
