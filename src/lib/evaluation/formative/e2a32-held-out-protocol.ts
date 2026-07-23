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
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V3,
  resolveActiveAnchorAliasV3
} from "@/lib/services/student-assessment/active-anchor-alias-resolution-v3";
import {
  ANCHOR_STANCE_RESOLUTION_VERSION
} from "@/lib/services/student-assessment/anchor-stance-resolution-v1";
import {
  SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
  evaluateAnchorConsistentSoundGate,
  type AnchorInterpretation
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
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
  E2A24_CANDIDATE_PATH,
  evaluateE2A24Candidate
} from "./e2a24-autonomous-dialogue-candidate";
import {
  TRAJECTORY_ENVELOPE_VERSION,
  TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
  TrajectoryEnvelopeContractSchema,
  TrajectoryEnvelopeTurnSchema,
  buildDefaultTrajectoryProgressionConsequences,
  evaluateTrajectoryEnvelope,
  type TrajectoryEnvelopeContract,
  type TrajectoryEnvelopeTurn,
  type TrajectoryReasoningQuality
} from "./trajectory-envelope-v1";

export const E2A32_PREPARATION_VERSION =
  "e2a32-held-out-protocol-freeze-preparation-v1" as const;
export const E2A32_PROTOCOL_VERSION =
  "e2a32-chemical-equilibrium-trajectory-envelope-canary-v1" as const;
export const E2A32_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a32-chemical-equilibrium-protocol-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const CANDIDATE_FILE_SHA256 =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2";
const APPROVED_BASELINE_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";

const ITEM_ID = "chemical_equilibrium_rates_item_1";
const CONCEPT_ID = "chemical_equilibrium_rate_concentration_boundary";
const OPTION_LABEL = "C";
const DISTRACTOR_CLAIM =
  "At chemical equilibrium, reactant and product concentrations must be equal because the forward and reverse reaction rates are equal.";
const CANONICAL_ANCHOR_ID = `${ITEM_ID}:option:${OPTION_LABEL}`;

const EXPECTED_PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    CANDIDATE_FILE_SHA256,
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/services/student-assessment/target-evidence-contract-v5.ts":
    "775dd493ce68a11223ec5407bd3fb4a146315e13dfbd566ab5b5159b9e8e2a6a",
  "src/lib/services/student-assessment/anchor-conclusion-consistency.ts":
    "d7c5c368b3e93f2f5b6f2932184491693d98f502cccec2ad5778f331b2caaf83",
  "src/lib/services/student-assessment/active-anchor-alias-resolution-v3.ts":
    "29f4c7da1d380c8dc70ade8fd2516010a601d143fd605ab1eba931d8242f0635",
  "src/lib/services/student-assessment/anchor-stance-resolution-v1.ts":
    "36c291183aaf15378a65a3cf00c847e4625676a275dca8daa47fe1aaf9749e6a"
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
  }
] as const;

export const E2A32_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "trajectory-envelope-contract.json",
  "future-canary-protocol-template.json",
  "held-out-domain.json",
  "target-evidence-contract.json",
  "alias-contract.json",
  "alias-resolution-validation.json",
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
    throw new Error(`e2a32_overlap_source_missing:${relativePath}`);
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
      "the equal-concentration claim",
      "equal rates mean equal concentrations",
      "equilibrium means equal amounts",
      "the concentrations must match at equilibrium"
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
      "Chemical equilibrium requires equal forward and reverse reaction rates, not equal reactant and product concentrations.",
      "At equilibrium, concentrations are constant over time while their ratio or relationship depends on the equilibrium constant and reaction conditions."
    ],
    required_mechanisms: [
      "Explain that equal rates prevent net concentration change without requiring equal concentration values.",
      "Connect the equilibrium constant or reaction conditions to why equilibrium concentrations can differ."
    ],
    acceptable_equivalent_explanations: [
      "Equal forward and reverse rates mean each species is formed and consumed at matching rates, so concentrations stay constant but need not match.",
      "The equilibrium composition is set by the equilibrium constant at a given temperature rather than by a rule requiring equal amounts.",
      "Dynamic equilibrium has ongoing reactions in both directions with no net change, not identical concentrations."
    ],
    required_anchor_application:
      `Apply the rate-versus-concentration distinction directly to ${ITEM_ID} option ${OPTION_LABEL} and reject its equal-concentration conclusion.`,
    prohibited_contradictions: [
      DISTRACTOR_CLAIM,
      "Equal forward and reverse reaction rates require equal reactant and product concentrations."
    ],
    revision_ready_criteria: [
      "target_conceptual_relationship",
      "required_mechanism",
      "active_anchor_application",
      "coherent_conclusion"
    ],
    optional_deepening_criteria: ["optional_equilibrium_constant_detail"],
    evidence_limitations: [
      "This isolated synthetic contract tests one equilibrium misconception and does not support broad chemistry-mastery claims."
    ],
    criteria: [
      {
        criterion_id: "target_conceptual_relationship",
        criterion_kind: "conceptual_relationship",
        description:
          "The response distinguishes equal opposing reaction rates from equal species concentrations.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "equal rates produce no net concentration change",
          "constant concentrations do not have to be equal"
        ]
      },
      {
        criterion_id: "required_mechanism",
        criterion_kind: "required_mechanism",
        description:
          "The response explains how equal formation and consumption rates maintain constant, potentially unequal concentrations.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "each species is produced and consumed at matching rates",
          "the equilibrium constant sets the composition relationship"
        ]
      },
      {
        criterion_id: "active_anchor_application",
        criterion_kind: "anchor_application",
        description:
          `The response applies the distinction to option ${OPTION_LABEL} or an accepted chemistry-specific alias.`,
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          `reject option ${OPTION_LABEL}`,
          "reject the equal-concentration claim"
        ]
      },
      {
        criterion_id: "coherent_conclusion",
        criterion_kind: "coherent_conclusion",
        description:
          "The response coherently rejects the claim that equal rates require equal concentrations.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "the concentrations remain constant but may differ"
        ]
      },
      {
        criterion_id: "optional_equilibrium_constant_detail",
        criterion_kind: "optional_deepening",
        description:
          "The response relates the equilibrium composition to the equilibrium constant at fixed temperature.",
        essential_for_revision: false,
        acceptable_evidence_patterns: [
          "the equilibrium constant constrains concentration ratios"
        ]
      }
    ],
    contradiction_criteria: [
      {
        contradiction_id: "active_distractor_claim_retained",
        description: DISTRACTOR_CLAIM,
        observable_patterns: [
          `option ${OPTION_LABEL} is correct`,
          "equal rates mean equal concentrations"
        ]
      },
      {
        contradiction_id: "rate_concentration_equivalence_retained",
        description:
          "The response continues to treat equal opposing rates as proof of equal concentration values.",
        observable_patterns: [
          "the concentrations must match because the rates match"
        ]
      },
      {
        contradiction_id:
          "anchor_conclusion_conceptual_explanation_conflict",
        description:
          `The response explains that equilibrium concentrations can differ but still endorses option ${OPTION_LABEL}.`,
        observable_patterns: [
          "concentrations can differ, but option C is still correct"
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
      `Explicitly apply the rate-versus-concentration reasoning to option ${OPTION_LABEL} or an accepted alias and reject the equal-concentration claim.`
    ],
    anchor_contradiction_criteria: [
      `Endorsing option ${OPTION_LABEL} conflicts with explaining that equal rates do not require equal concentrations.`,
      `Rejecting option ${OPTION_LABEL} without the rate-versus-concentration mechanism is not sufficient for a sound result.`
    ],
    ambiguity_resolution_policy:
      "Do not infer a final stance from chemistry vocabulary alone. Mixed, implicit, uncertain, or contradictory conclusions require clarification.",
    active_anchor_alias_contract: aliasContract
  });
}

const ALIAS_CASES = [
  {
    case_id: "identifier_endorsement",
    message: "I keep option C because equilibrium should make both amounts equal.",
    prior: [] as string[],
    expected: "endorses_distractor"
  },
  {
    case_id: "identifier_rejection",
    message:
      "Option C is wrong because equal rates only mean there is no net concentration change.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "claim_rejection",
    message:
      "The equal-concentration claim is unsupported because equilibrium concentrations can remain different.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "pronoun_rejection",
    message:
      "That claim is wrong because equal forward and reverse rates do not require equal amounts.",
    prior: [] as string[],
    expected: "rejects_distractor"
  },
  {
    case_id: "uncertainty",
    message: "Maybe option C, but I am not sure.",
    prior: [] as string[],
    expected: "ambiguous"
  }
] as const;

function validateAliasResolution(aliasContract: ActiveAnchorAliasContract) {
  const results = ALIAS_CASES.map((testCase, index) => {
    const resolution = resolveActiveAnchorAliasV3({
      message: testCase.message,
      contract: aliasContract,
      source_turn_id: `synthetic_e2a32_alias_${testCase.case_id}`,
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
        resolution.independent_stance_resolution.resolver_version,
      passed:
        resolution.observed_anchor_reference === "explicit" &&
        resolution.observed_anchor_stance === testCase.expected
    };
  });
  return {
    validation_version: "e2a32-chemical-equilibrium-alias-validation-v1",
    case_count: results.length,
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

function buildTrajectoryEnvelope(): TrajectoryEnvelopeContract {
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
        "Expected trajectory roles guide synthetic student generation and are audited separately from evaluator accuracy.",
      acceptable_reasoning_quality_envelope:
        "Each turn permits a bounded set of observable reasoning qualities; an out-of-envelope result is a simulator-adherence signal, not an evaluator override.",
      progression_consequences:
        "The existing production sound gate controls immediate revision. Non-sound evidence receives bounded support, while regressions and prohibited states fail closed."
    },
    turns: [
      {
        turn_index: 1,
        expected_trajectory_role: "initial_anchor_position",
        allowed_reasoning_quality_set: ["misconception", "partial"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: allProhibitedStates()
      },
      {
        turn_index: 2,
        expected_trajectory_role: "mechanism_exploration",
        allowed_reasoning_quality_set: ["misconception", "partial"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: allProhibitedStates()
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
        prohibited_states: allProhibitedStates()
      },
      {
        turn_index: 4,
        expected_trajectory_role: "independent_reconstruction",
        allowed_reasoning_quality_set: ["partial", "sound"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: allProhibitedStates()
      },
      {
        turn_index: 5,
        expected_trajectory_role: "revision_readiness",
        allowed_reasoning_quality_set: ["partial", "sound"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: allProhibitedStates()
      },
      {
        turn_index: 6,
        expected_trajectory_role: "post_sound_revision",
        allowed_reasoning_quality_set: ["partial", "sound"],
        sound_gate_override_rule: TRAJECTORY_SOUND_GATE_OVERRIDE_RULE,
        progression_consequence: progression,
        prohibited_states: allProhibitedStates()
      }
    ]
  });
}

function buildFutureCanaryProtocolTemplate(
  trajectoryEnvelope: TrajectoryEnvelopeContract
) {
  return {
    template_version: "future-canary-protocol-template-v1",
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
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
    anchor_reference_spans: ["option C"],
    anchor_stance_spans: ["option C is wrong"],
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
    anchor_reference_spans: ["option C"],
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
    anchor_reference_spans: ["option C"],
    anchor_stance_spans: ["option C is still correct"],
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

export function runE2A32TrajectoryRegressions(
  envelope = buildTrajectoryEnvelope()
) {
  const exactLabelFieldSchemaRejectionPassed =
    !TrajectoryEnvelopeTurnSchema.safeParse({
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
  const cases = [
    {
      case_id: "sound_earlier_than_scripted",
      turn: envelope.turns[1]!,
      evaluator_reasoning_quality: "sound" as const,
      gate: runSoundGateFixture("sound"),
      independent: true,
      copied: false,
      contradiction: false,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_adherence: "sound_earlier_than_intended",
      expected_progression: "immediate_revision"
    },
    {
      case_id: "partial_longer_than_scripted",
      turn: envelope.turns[4]!,
      evaluator_reasoning_quality: "partial" as const,
      gate: runSoundGateFixture("partial"),
      independent: true,
      copied: false,
      contradiction: false,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_adherence: "partial_longer_than_intended",
      expected_progression: "continue_evidence_targeted_tutor"
    },
    {
      case_id: "regression_after_improvement",
      turn: envelope.turns[2]!,
      evaluator_reasoning_quality: "misconception" as const,
      gate: runSoundGateFixture("contradiction"),
      independent: true,
      copied: false,
      contradiction: false,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_adherence: "regression_after_improvement",
      expected_progression: "reopen_targeted_support"
    },
    {
      case_id: "contradiction_after_sound",
      turn: envelope.turns[5]!,
      evaluator_reasoning_quality: "partial" as const,
      gate: runSoundGateFixture("contradiction"),
      independent: true,
      copied: false,
      contradiction: true,
      prior_quality: "sound" as const,
      prior_sound: true,
      expected_adherence: "contradiction_after_sound",
      expected_progression: "reopen_targeted_support"
    },
    {
      case_id: "copied_wording_without_evidence",
      turn: envelope.turns[3]!,
      evaluator_reasoning_quality: "insufficient" as const,
      gate: runSoundGateFixture("copied"),
      independent: false,
      copied: true,
      contradiction: false,
      prior_quality: "partial" as const,
      prior_sound: false,
      expected_adherence: "copied_wording_without_evidence",
      expected_progression: "request_independent_evidence"
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
        testCase.case_id !== "sound_earlier_than_scripted" ||
        (
          decision.sound_gate_override_applied &&
          decision.revision_required_immediately &&
          !decision.tutor_should_be_called
        )
      );
    return {
      case_id: testCase.case_id,
      evaluator_reasoning_quality:
        testCase.evaluator_reasoning_quality,
      sound_gate_result: testCase.gate,
      expected_trajectory_role:
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
    regression_version: "e2a32-trajectory-envelope-regressions-v1",
    sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    case_count: cases.length,
    required_case_ids: [
      "sound_earlier_than_scripted",
      "partial_longer_than_scripted",
      "regression_after_improvement",
      "contradiction_after_sound",
      "copied_wording_without_evidence"
    ],
    evaluator_follows_evidence: cases.every((testCase) =>
      testCase.decision.evaluator_reasoning_quality_preserved
    ),
    exact_turn_reasoning_labels_absent:
      exactTurnReasoningLabelsAbsent,
    exact_label_field_schema_rejection_passed:
      exactLabelFieldSchemaRejectionPassed,
    sound_gate_overrides_trajectory_expectation:
      cases.find((testCase) =>
        testCase.case_id === "sound_earlier_than_scripted"
      )?.decision.sound_gate_override_applied === true,
    revision_immediate_when_sound_reached:
      cases.find((testCase) =>
        testCase.case_id === "sound_earlier_than_scripted"
      )?.decision.revision_required_immediately === true,
    cases,
    passed:
      cases.every((testCase) => testCase.passed) &&
      exactTurnReasoningLabelsAbsent &&
      exactLabelFieldSchemaRejectionPassed,
    provider_calls_made: 0
  };
}

function compileEvaluatorV5Request(contract: TargetEvidenceContractV5) {
  const sourceStudentTurn = {
    source_student_turn_id: "synthetic_e2a32_student_turn_1",
    source_sequence_index: 2
  };
  const studentMessage =
    "Option C is wrong. Equal forward and reverse rates mean there is no net concentration change, but the equilibrium concentrations can still be different.";
  const legacyInput = {
    schema_version: ACTIVITY_RESPONSE_EVALUATOR_INPUT_SCHEMA_VERSION,
    case_id: "e2a32_chemistry_equilibrium_turn_1",
    session_public_id: "synthetic_e2a32_session_1",
    student_public_id: "synthetic_e2a32_student_1",
    assessment_public_id: "synthetic_e2a32_assessment_1",
    concept_unit_id: CONCEPT_ID,
    activity_attempt_id: "synthetic_e2a32_activity_1",
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
      profile_condition: "synthetic_frozen_e2a32_trajectory",
      distractor_role: "selected_distractor",
      safe_activity_prompt:
        "Explain whether equal forward and reverse reaction rates require equal reactant and product concentrations."
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
        "Repeating equilibrium vocabulary is insufficient without independently explaining the rate-versus-concentration boundary."
    },
    target_evidence_contract: contract,
    complete_visible_formative_conversation: {
      dialogue_public_id: "synthetic_e2a32_dialogue_1",
      activity_attempt_public_id: "synthetic_e2a32_activity_1",
      turns: [
        {
          actor: "assistant",
          sequence_index: 1,
          message:
            "Consider option C. Explain what equal forward and reverse rates do and do not imply about concentrations."
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
    throw new Error("e2a32_evaluator_model_config_missing");
  }
  const request = {
    agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
    model_config: modelConfig,
    instructions: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_INSTRUCTIONS_V5,
    input: providerInput,
    output_schema: ProductionTurnEvidenceEvaluatorOutputV5Schema,
    schema_name:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    client_request_id: "e2a32_compile_only_evaluator_turn_1",
    timeout_ms: 90_000,
    metadata: {
      evaluation_phase: "e2a32_compile_only_no_live",
      role: "evidence_evaluator",
      session_id: "E2A32-CHEMICAL-EQUILIBRIUM",
      turn_number: "1",
      prompt_version:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
      prompt_hash:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
      execution_authorized: "false"
    }
  } satisfies StructuredAgentRequest<typeof providerInput, unknown>;
  const projection = {
    request_compilation_version: "e2a32-evaluator-v5-request-v1",
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
    domain_contract_version: "e2a32-held-out-domain-v1",
    domain: "chemistry",
    topic: "dynamic_chemical_equilibrium",
    concept_id: CONCEPT_ID,
    item_id: ITEM_ID,
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    distractor_option: OPTION_LABEL,
    distractor_claim: DISTRACTOR_CLAIM,
    scenario:
      "A closed reaction mixture has reached dynamic equilibrium at a fixed temperature. The student must distinguish equal opposing reaction rates from equal concentrations.",
    held_out_scope:
      "exact_dynamic_equilibrium_rate_concentration_scenario_anchor_and_trajectory",
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
    "chemistry",
    "dynamic_equilibrium",
    "equal_rates_not_equal_concentrations",
    "equilibrium_constant"
  ];
  const structuralTags = [
    "equal_process_rates_vs_unequal_state_values"
  ];
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
      passed:
        exactMatchCount === 0 &&
        normalizedMatchCount === 0 &&
        maximumTokenOverlap < 0.85 &&
        semanticOverlap.length === 0 &&
        structuralOverlap.length === 0
    };
  });
  return {
    analysis_version: "e2a32-held-out-overlap-analysis-v1",
    comparison_scope: "E2A.24_through_E2A.31",
    methods: {
      exact: "byte-equal comparison of bounded content strings",
      normalized:
        "case-folded punctuation-normalized whitespace-collapsed comparison",
      token:
        "deterministic token Jaccard with a pass threshold below 0.85",
      structural:
        "frozen content-structure tag comparison",
      semantic:
        "frozen concept-tag comparison without embeddings or provider calls"
    },
    held_out_scope: heldOutDomain().held_out_scope,
    candidate_semantic_tags: semanticTags,
    candidate_structural_tags: structuralTags,
    planned_text_count: plannedTexts.length,
    stage_results: stageResults,
    passed: stageResults.every((result) => result.passed),
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
    budget_version: "e2a32-bounded-canary-budget-v1",
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
    integrity_version: "e2a32-candidate-integrity-v1",
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
    integrity_version: "e2a32-protected-source-integrity-v1",
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
    passed: mismatches.length === 0,
    mismatches
  };
}

function buildArtifactContract() {
  return {
    artifact_contract_version: "e2a32-artifact-contract-v1",
    required_artifacts: E2A32_ARTIFACT_NAMES,
    required_count: E2A32_ARTIFACT_NAMES.length,
    immutable_provider_outputs_required_after_future_live_execution: true,
    human_review_packet_required_after_future_live_execution: true,
    live_execution_in_this_phase: false,
    provider_calls_made: 0
  };
}

function buildFrozenProtocol(input: {
  trajectoryEnvelope: TrajectoryEnvelopeContract;
  targetContract: TargetEvidenceContractV5;
  aliasValidation: ReturnType<typeof validateAliasResolution>;
  evaluatorRequest: ReturnType<typeof compileEvaluatorV5Request>;
  regressions: ReturnType<typeof runE2A32TrajectoryRegressions>;
  overlap: ReturnType<typeof runOverlapAnalysis>;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
  candidate: ReturnType<typeof candidateIntegrity>;
  protectedSources: ReturnType<typeof protectedSourceIntegrity>;
}) {
  const protocol = {
    protocol_version: E2A32_PROTOCOL_VERSION,
    preparation_version: E2A32_PREPARATION_VERSION,
    protocol_state: "frozen_preparation_only",
    execution_authorized: false,
    live_execution_performed: false,
    domain: heldOutDomain(),
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    trajectory_envelope_hash: stableHash(input.trajectoryEnvelope),
    future_canary_template_hash: stableHash(
      buildFutureCanaryProtocolTemplate(input.trajectoryEnvelope)
    ),
    target_evidence_contract_version:
      TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    target_evidence_contract_hash: stableHash(input.targetContract),
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_prompt_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
    evaluator_prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    evaluator_request_hash:
      input.evaluatorRequest.canonical_request_hash,
    reference_and_stance_resolver_version:
      ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V3,
    stance_resolver_version: ANCHOR_STANCE_RESOLUTION_VERSION,
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
      alias_resolution_passed: input.aliasValidation.passed,
      evaluator_v5_request_compiled: input.evaluatorRequest.passed,
      overlap_analysis_passed: input.overlap.passed,
      budget_validated: input.budget.arithmetic_valid,
      artifact_contract_valid:
        input.artifactContract.required_count ===
        E2A32_ARTIFACT_NAMES.length,
      candidate_integrity_passed: input.candidate.passed,
      evaluator_v5_unchanged:
        input.protectedSources.evaluator_v5_unchanged,
      tutor_candidate_unchanged:
        input.protectedSources.tutor_candidate_unchanged,
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
    throw new Error("e2a32_protected_source_integrity_failed");
  }
  const candidate = candidateIntegrity();
  if (!candidate.passed) throw new Error("e2a32_candidate_integrity_failed");
  const aliasContract = buildAliasContract();
  const targetContract = buildTargetEvidenceContract(aliasContract);
  const aliasValidation = validateAliasResolution(aliasContract);
  if (!aliasValidation.passed) {
    throw new Error("e2a32_alias_resolution_validation_failed");
  }
  const trajectoryEnvelope = buildTrajectoryEnvelope();
  const futureTemplate =
    buildFutureCanaryProtocolTemplate(trajectoryEnvelope);
  const regressions =
    runE2A32TrajectoryRegressions(trajectoryEnvelope);
  if (!regressions.passed) {
    throw new Error("e2a32_trajectory_regressions_failed");
  }
  const evaluatorRequest = compileEvaluatorV5Request(targetContract);
  if (!evaluatorRequest.passed) {
    throw new Error("e2a32_evaluator_v5_request_failed");
  }
  const overlap = runOverlapAnalysis(targetContract);
  if (!overlap.passed) throw new Error("e2a32_overlap_analysis_failed");
  const budget = buildBudget();
  if (!budget.arithmetic_valid) throw new Error("e2a32_budget_invalid");
  const artifactContract = buildArtifactContract();
  const protocol = buildFrozenProtocol({
    trajectoryEnvelope,
    targetContract,
    aliasValidation,
    evaluatorRequest,
    regressions,
    overlap,
    budget,
    artifactContract,
    candidate,
    protectedSources: protectedBefore
  });
  if (!protocol.passed) throw new Error("e2a32_protocol_gate_failed");
  const protectedAfter = protectedSourceIntegrity();
  if (
    !protectedAfter.passed ||
    stableHash(protectedBefore.actual_sha256) !==
      stableHash(protectedAfter.actual_sha256)
  ) {
    throw new Error("e2a32_protected_source_changed");
  }
  if (networkRequestCount !== 0) {
    throw new Error("e2a32_network_request_detected");
  }
  const identityBody = {
    identity_version: "e2a32-composite-runtime-identity-v1",
    application_git_commit: currentGitCommit(),
    protocol_hash: protocol.protocol_hash,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA256,
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    trajectory_envelope_hash: stableHash(trajectoryEnvelope),
    trajectory_envelope_source_sha256: fileSha256(
      "src/lib/evaluation/formative/trajectory-envelope-v1.ts"
    ),
    e2a32_protocol_source_sha256: fileSha256(
      "src/lib/evaluation/formative/e2a32-held-out-protocol.ts"
    ),
    target_evidence_contract_hash: stableHash(targetContract),
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V3,
    stance_resolver_version: ANCHOR_STANCE_RESOLUTION_VERSION,
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
    targetContract,
    trajectoryEnvelope,
    futureTemplate,
    regressions,
    evaluatorRequest,
    overlap,
    budget,
    artifactContract,
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
    guard_version: "e2a32-provider-call-guard-v1",
    execution_authorized: false,
    provider_executor_constructed: false,
    provider_calls_made: 0,
    network_requests_made: all.networkRequestCount,
    fetch_guard_required: true,
    passed: all.networkRequestCount === 0
  };
  const summary = {
    summary_version: E2A32_PREPARATION_VERSION,
    status: "e2a32_protocol_frozen_not_authorized_not_executed",
    run_id: runId,
    passed: true,
    protocol_hash: all.protocol.protocol_hash,
    composite_runtime_identity_hash:
      all.identity.composite_runtime_identity_hash,
    held_out_domain: heldOutDomain().domain,
    held_out_topic: heldOutDomain().topic,
    trajectory_envelope_version: TRAJECTORY_ENVELOPE_VERSION,
    deterministic_case_count: all.regressions.case_count,
    deterministic_regressions_passed: all.regressions.passed,
    early_sound_immediate_revision:
      all.regressions.revision_immediate_when_sound_reached,
    evaluator_follows_evidence:
      all.regressions.evaluator_follows_evidence,
    overlap_analysis_passed: all.overlap.passed,
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
    e2a32_ready_for_separate_authorization: true
  };
  return {
    "freeze-manifest.json": {
      manifest_version: E2A32_PREPARATION_VERSION,
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
    "future-canary-protocol-template.json": all.futureTemplate,
    "held-out-domain.json": heldOutDomain(),
    "target-evidence-contract.json": all.targetContract,
    "alias-contract.json": all.aliasContract,
    "alias-resolution-validation.json": all.aliasValidation,
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

export function validateE2A32Artifacts(
  runDirectory: string,
  allowValidationArtifactMissing = false
) {
  const missing = E2A32_ARTIFACT_NAMES.filter((name) =>
    !(
      allowValidationArtifactMissing &&
      name === "artifact-validation.json"
    ) &&
    !existsSync(path.join(runDirectory, name))
  );
  const unexpected = readdirSync(runDirectory).filter((name) =>
    !E2A32_ARTIFACT_NAMES.includes(
      name as typeof E2A32_ARTIFACT_NAMES[number]
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
    TrajectoryEnvelopeContractSchema.parse(readJson(
      path.join(runDirectory, "trajectory-envelope-contract.json")
    ));
    TargetEvidenceContractV5Schema.parse(readJson(
      path.join(runDirectory, "target-evidence-contract.json")
    ));
    ActiveAnchorAliasContractSchema.parse(readJson(
      path.join(runDirectory, "alias-contract.json")
    ));
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
      regressions.case_count !== 5 ||
      regressions.evaluator_follows_evidence !== true ||
      regressions.sound_gate_overrides_trajectory_expectation !== true ||
      regressions.revision_immediate_when_sound_reached !== true
    ) {
      semanticIssues.push("trajectory_regressions_invalid");
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
    validation_version: "e2a32-artifact-validation-v1",
    required_artifact_count: E2A32_ARTIFACT_NAMES.length,
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

export function writeE2A32PreparationArtifacts(input: {
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
  const beforeSelf = validateE2A32Artifacts(input.runDirectory, true);
  if (!beforeSelf.passed) {
    throw new Error(
      `e2a32_artifact_validation_failed:${beforeSelf.semantic_issues.join("|")}`
    );
  }
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    {
      ...beforeSelf,
      actual_artifact_count: E2A32_ARTIFACT_NAMES.length
    }
  );
  const validation = validateE2A32Artifacts(input.runDirectory);
  if (!validation.passed) {
    throw new Error(
      `e2a32_final_artifact_validation_failed:${validation.semantic_issues.join("|")}`
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

export function makeE2A32RunId() {
  const timestamp = new Date().toISOString().replace(/[-:.Z]/gu, "");
  return `e2a32_${timestamp}_${randomBytes(4).toString("hex")}`;
}

export function inspectE2A32Run(runDirectory: string) {
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
    validation: validateE2A32Artifacts(runDirectory)
  };
}
