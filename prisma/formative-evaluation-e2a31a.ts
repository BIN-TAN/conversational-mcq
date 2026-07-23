import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  canonicalStructuredAgentRequestHash,
  PROVIDER_TRANSPORT_RETRY_LIMITS,
  PROVIDER_TRANSPORT_RETRY_POLICY_VERSION
} from "../src/lib/llm/provider-transport-retry";
import type {
  StructuredAgentRequest
} from "../src/lib/llm/providers/types";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  ACTIVITY_MISCONCEPTION_EVIDENCE_SCHEMA_VERSION,
  ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME
} from "../src/lib/services/student-assessment/activity-misconception-evidence";
import {
  ACTIVITY_RESPONSE_EVALUATOR_INPUT_SCHEMA_VERSION
} from "../src/lib/services/student-assessment/activity-misconception-evidence-live";
import {
  ActiveAnchorAliasContractSchema,
  type ActiveAnchorAliasContract
} from "../src/lib/services/student-assessment/active-anchor-alias-resolution";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
  resolveActiveAnchorAliasV2
} from "../src/lib/services/student-assessment/active-anchor-alias-resolution-v2";
import {
  ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
  SOUND_GATE_ANCHOR_CONSISTENCY_VERSION
} from "../src/lib/services/student-assessment/anchor-conclusion-consistency";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2
} from "../src/lib/services/student-assessment/anchor-contradiction-propagation-v2";
import {
  ANCHOR_PARITY_RECONCILIATION_VERSION
} from "../src/lib/services/student-assessment/anchor-parity-reconciliation";
import {
  CANONICAL_ANCHOR_EVIDENCE_VERSION
} from "../src/lib/services/student-assessment/canonical-anchor-evidence";
import {
  FORMATIVE_ACTIVITY_SCHEMA_VERSION
} from "../src/lib/services/student-assessment/formative-activity-design";
import {
  PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3
} from "../src/lib/services/student-assessment/pre-tutor-profile-finalization-v3";
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
} from "../src/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V6,
  TARGET_EVIDENCE_CONTRACT_VERSION_V5,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
  TargetEvidenceContractV5Schema,
  type TargetEvidenceContractV5
} from "../src/lib/services/student-assessment/target-evidence-contract-v5";
import {
  E2A24_CANDIDATE_PATH,
  evaluateE2A24Candidate
} from "../src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate";

const VERSION = "e2a31a-ecology-held-out-protocol-freeze-v1" as const;
const PROTOCOL_VERSION =
  "e2a31-ecology-anchor-normalization-canary-v2" as const;
const ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a31a-ecology-held-out-protocol-freeze"
);
const CANDIDATE_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const CANDIDATE_FILE_SHA =
  "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2";
const APPROVED_V2_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";
const E2A30A_PREDECESSOR_RUN = path.join(
  ".data",
  "e2a30a-anchor-canonicalization",
  "e2a30a_20260722T233107245Z_d6b54054"
);
const E2A30A_PREDECESSOR_IDENTITY_HASH =
  "d6b54054b19b3abcd1494f8893ced303a8bf3eb0e668f6842871435ccd98cf34";
const E2A30A_PREDECESSOR_APPLICATION_COMMIT =
  "f109606dc885003e523b338059910107e1d923ea";
const ITEM_ID = "ecology_trophic_cascade_item_1";
const CONCEPT_ID = "ecology_top_predator_indirect_effects";
const OPTION_LABEL = "D";
const DISTRACTOR_CLAIM =
  "Removing the predator must increase the prey population because fewer prey are eaten.";
const CANONICAL_ANCHOR_ID = `${ITEM_ID}:option:${OPTION_LABEL}`;

const EXPECTED_PROTECTED_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    CANDIDATE_FILE_SHA,
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/services/student-assessment/canonical-anchor-evidence.ts":
    "bb03fd71ba544d9ffab2ce5c650fc036d3525d7f29a3718bcbd015c620c07fd2",
  "src/lib/services/student-assessment/active-anchor-alias-resolution-v2.ts":
    "4df5bd76487ae081ce9a5d538f6f8a405fdabcc91a95b3200c0d9b891904a700",
  "src/lib/services/student-assessment/anchor-parity-reconciliation.ts":
    "d1955ad715ab7a89b86ddf0c1af4fae7c01f8402b23a1747e68ba5372dd13726",
  "src/lib/services/student-assessment/target-evidence-contract-v5.ts":
    "775dd493ce68a11223ec5407bd3fb4a146315e13dfbd566ab5b5159b9e8e2a6a",
  "src/lib/llm/provider-transport-retry.ts":
    "f34048338902c2c670909ece2bf0cd476f01176f1dfee1f3c8d4fbe85d60c3e6"
} as const;

const HISTORICAL_INPUTS = [
  {
    stage: "E2A.24",
    files: [
      ".data/e2a24-autonomous-formative-dialogue-architecture/e2a24_20260720220102_1324ebaf/cross-domain-target-contracts.json"
    ],
    semantic_tags: [
      "reliability_validity", "correlation_causation",
      "screening_predictive_value", "voltage_current_resistance"
    ],
    content_structure_tags: ["construct_boundary", "causal_boundary"]
  },
  {
    stage: "E2A.25",
    files: [
      ".data/e2a25-autonomous-dialogue-live-canary/e2a25_20260721000435_bf179fb6/session-designs.json"
    ],
    semantic_tags: [
      "phoneme_allophone", "sunk_cost", "binary_search"
    ],
    content_structure_tags: ["classification_boundary", "decision_boundary"]
  },
  {
    stage: "E2A.26",
    files: [
      ".data/e2a26-semantic-oracle-calibration/e2a26_20260721222943_37b534d9/calibration-corpus.jsonl"
    ],
    semantic_tags: [
      "semantic_oracle", "evidence_envelope", "assessment_reasoning"
    ],
    content_structure_tags: ["evidence_quality_calibration"]
  },
  {
    stage: "E2A.27",
    files: [
      ".data/e2a27-geometrical-optics-anchor-consistency-canary/e2a27_20260722061521_9bd4a441/session-designs.json"
    ],
    semantic_tags: [
      "geometrical_optics", "converging_lens", "object_distance"
    ],
    content_structure_tags: ["optical_boundary"]
  },
  {
    stage: "E2A.28",
    files: [
      ".data/e2a28-antimicrobial-resistance-contradiction-canary/e2a28_20260722083935_6ecb39bb/session-designs.json",
      "src/lib/evaluation/formative/e2a28a-semantic-anchor-consistency.ts"
    ],
    semantic_tags: [
      "antimicrobial_resistance", "selection_existing_variation",
      "ecology", "population_growth_generic_calibration"
    ],
    content_structure_tags: ["selection_not_intentional_adaptation"]
  },
  {
    stage: "E2A.29",
    files: [
      ".data/e2a29-electrical-circuits-anchor-contradiction-canary/e2a29_20260722120813_3fd136e6/session-designs.json"
    ],
    semantic_tags: [
      "electrical_circuits", "series_current_conservation"
    ],
    content_structure_tags: ["conserved_quantity"]
  },
  {
    stage: "E2A.30",
    files: [
      ".data/e2a30-thermal-physics-transport-autonomous-canary/e2a30_20260722212059_c1f72790/session-designs.json"
    ],
    semantic_tags: [
      "thermal_physics", "temperature_heat_transfer", "touch_sensation"
    ],
    content_structure_tags: ["state_vs_transfer_rate"]
  }
] as const;

const REQUIRED_FREEZE_ARTIFACTS = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "target-evidence-contract.json",
  "ecology-alias-contract.json",
  "alias-example-validation.json",
  "compiled-evaluator-v5-request.json",
  "overlap-analysis.json",
  "budget.json",
  "artifact-contract.json",
  "candidate-integrity.json",
  "predecessor-runtime-identity.json",
  "protected-source-integrity.json",
  "composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json",
  "artifact-validation.json"
] as const;

let networkRequestCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a31a_network_request_prohibited");
};

type JsonRecord = Record<string, unknown>;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha(relativePath: string) {
  return sha256(readFileSync(path.join(process.cwd(), relativePath)));
}

function applicationGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function normalizedText(value: string) {
  return value
    .toLocaleLowerCase("en-CA")
    .replace(/_/gu, " ")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokens(value: string) {
  return new Set(normalizedText(value).split(" ").filter((entry) =>
    entry.length > 2
  ));
}

function tokenJaccard(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  const intersection = [...a].filter((entry) => b.has(entry)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function extractJsonStrings(value: unknown, output: Set<string>) {
  if (typeof value === "string") {
    if (value.trim().length >= 20 && value.length <= 5_000) {
      output.add(value.trim());
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => extractJsonStrings(entry, output));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as JsonRecord).forEach((entry) =>
      extractJsonStrings(entry, output)
    );
  }
}

function stringsFromHistoricalFile(relativePath: string) {
  const filePath = path.join(process.cwd(), relativePath);
  if (!existsSync(filePath)) {
    throw new Error(`e2a31a_historical_input_missing:${relativePath}`);
  }
  const output = new Set<string>();
  const text = readFileSync(filePath, "utf8");
  if (relativePath.endsWith(".jsonl")) {
    text.split(/\r?\n/gu).filter(Boolean).forEach((line) =>
      extractJsonStrings(JSON.parse(line), output)
    );
  } else if (relativePath.endsWith(".json")) {
    extractJsonStrings(JSON.parse(text), output);
  } else {
    for (const match of text.matchAll(/["'`]([^"'`\n]{20,5000})["'`]/gu)) {
      output.add(match[1].trim());
    }
  }
  return output;
}

function buildEcologyAliasContract(): ActiveAnchorAliasContract {
  return ActiveAnchorAliasContractSchema.parse({
    resolver_version: "active-anchor-alias-resolution-v1",
    active_anchor_id: CANONICAL_ANCHOR_ID,
    option_label: OPTION_LABEL,
    option_text: DISTRACTOR_CLAIM,
    accepted_identifiers: [
      OPTION_LABEL,
      `option ${OPTION_LABEL}`,
      `choice ${OPTION_LABEL}`,
      `answer ${OPTION_LABEL}`
    ],
    accepted_aliases: [
      "the direct-predation claim",
      "the guaranteed prey-increase claim",
      "the predator-removal claim"
    ],
    accepted_paraphrases: [
      "removing the predator must increase prey abundance",
      "fewer predators always means more prey",
      "less predation guarantees a larger prey population",
      "the prey population must rise because fewer prey are eaten"
    ],
    negative_or_contrast_forms: [
      `not option ${OPTION_LABEL}`,
      `reject option ${OPTION_LABEL}`,
      `option ${OPTION_LABEL} is wrong`,
      "the guaranteed prey-increase claim is unsupported",
      "the predator-removal claim is wrong"
    ],
    pronoun_resolution_context: {
      active_anchor_is_current_topic: true,
      accepted_pronouns: [
        "that option",
        "that choice",
        "that answer",
        "that claim",
        "that prediction"
      ],
      require_active_anchor_antecedent: true
    }
  });
}

function buildEcologyTargetEvidenceContract(
  aliasContract: ActiveAnchorAliasContract
): TargetEvidenceContractV5 {
  return TargetEvidenceContractV5Schema.parse({
    contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    concept_id: CONCEPT_ID,
    item_id: ITEM_ID,
    distractor_option: OPTION_LABEL,
    distractor_claim: DISTRACTOR_CLAIM,
    target_conceptual_relationships: [
      "Removing a top predator can change prey abundance through both direct predation and indirect food-web pathways.",
      "A reduction in immediate predation does not by itself determine the direction of the prey population response."
    ],
    required_mechanisms: [
      "Identify at least one indirect pathway involving another consumer, competitor, resource, or lower trophic level that can offset or reverse the direct release from predation.",
      "Connect the indirect pathway to why prey abundance is not guaranteed to increase after predator removal."
    ],
    acceptable_equivalent_explanations: [
      "Predator removal can increase another consumer that competes with or consumes the focal prey.",
      "Predator removal can alter resources or lower trophic levels in a way that limits the focal prey.",
      "The net prey response depends on interacting direct and indirect effects rather than the direct predation rate alone."
    ],
    required_anchor_application:
      `Apply the food-web mechanism directly to ${ITEM_ID} option ${OPTION_LABEL} and reject its guaranteed prey-increase conclusion.`,
    prohibited_contradictions: [
      DISTRACTOR_CLAIM,
      "Immediate predation rate alone guarantees the direction of prey abundance after predator removal."
    ],
    revision_ready_criteria: [
      "target_conceptual_relationship",
      "required_mechanism",
      "active_anchor_application",
      "coherent_conclusion"
    ],
    optional_deepening_criteria: ["optional_food_web_pathway_detail"],
    evidence_limitations: [
      "This isolated synthetic contract tests one predator-removal misconception and does not support broad claims about ecology mastery."
    ],
    criteria: [
      {
        criterion_id: "target_conceptual_relationship",
        criterion_kind: "conceptual_relationship",
        description:
          "The response distinguishes direct predation release from the net prey response produced by the wider food web.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "direct and indirect effects can point in different directions",
          "fewer prey eaten does not guarantee more prey overall"
        ]
      },
      {
        criterion_id: "required_mechanism",
        criterion_kind: "required_mechanism",
        description:
          "The response explains at least one plausible indirect consumer, competitor, or resource pathway affecting the focal prey.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "another consumer increases and affects the prey",
          "resource availability changes through the food web"
        ]
      },
      {
        criterion_id: "active_anchor_application",
        criterion_kind: "anchor_application",
        description:
          `The response applies the mechanism to option ${OPTION_LABEL} or an accepted ecology-specific alias.`,
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          `reject option ${OPTION_LABEL}`,
          "reject the guaranteed prey-increase claim"
        ]
      },
      {
        criterion_id: "coherent_conclusion",
        criterion_kind: "coherent_conclusion",
        description:
          "The response coherently rejects the guaranteed prey-increase conclusion and does not retain direct-predation-only reasoning.",
        essential_for_revision: true,
        acceptable_evidence_patterns: [
          "the prey might increase, decrease, or remain similar depending on indirect effects"
        ]
      },
      {
        criterion_id: "optional_food_web_pathway_detail",
        criterion_kind: "optional_deepening",
        description:
          "The response traces a concrete multi-step trophic or resource pathway.",
        essential_for_revision: false,
        acceptable_evidence_patterns: [
          "predator removal changes another population, which changes prey resources or mortality"
        ]
      }
    ],
    contradiction_criteria: [
      {
        contradiction_id: "active_distractor_claim_retained",
        description: DISTRACTOR_CLAIM,
        observable_patterns: [
          `option ${OPTION_LABEL} is correct`,
          "fewer predators always means more prey"
        ]
      },
      {
        contradiction_id: "direct_predation_only_determines_prey_abundance",
        description:
          "The response treats reduced immediate predation as sufficient to guarantee an increase in prey abundance.",
        observable_patterns: [
          "the prey must increase because fewer are eaten"
        ]
      },
      {
        contradiction_id:
          "anchor_conclusion_conceptual_explanation_conflict",
        description:
          `The response explains an indirect food-web pathway that defeats a guaranteed increase but still endorses option ${OPTION_LABEL}.`,
        observable_patterns: [
          "indirect effects could reduce prey, but option D is still correct"
        ]
      }
    ],
    active_anchor_id: CANONICAL_ANCHOR_ID,
    active_anchor_text:
      `${ITEM_ID} option ${OPTION_LABEL}: ${DISTRACTOR_CLAIM}`,
    active_anchor_type: "distractor_option",
    required_anchor_stance: "rejects_distractor",
    acceptable_anchor_paraphrases: [
      ...aliasContract.accepted_aliases,
      ...aliasContract.accepted_paraphrases
    ],
    prohibited_anchor_stances: [
      "not_expressed",
      "ambiguous",
      "endorses_distractor"
    ],
    anchor_resolution_criteria: [
      `Explicitly apply the indirect food-web reasoning to option ${OPTION_LABEL} or an accepted alias and reject the guaranteed increase claim.`
    ],
    anchor_contradiction_criteria: [
      `Endorsing option ${OPTION_LABEL} conflicts with explaining that indirect food-web effects can offset or reverse reduced predation.`,
      `Rejecting option ${OPTION_LABEL} without a food-web mechanism is not sufficient for a sound result.`
    ],
    ambiguity_resolution_policy:
      "Do not infer that an option label is a typo. Mixed, implicit, or contradictory conclusions require clarification before progression.",
    active_anchor_alias_contract: aliasContract
  });
}

const ALIAS_EXAMPLES = [
  {
    example_id: "endorsement_identifier",
    category: "explicit_endorsement",
    message:
      "I choose option D because fewer prey are eaten after the predator is removed.",
    prior_visible_message: null,
    expected_stance: "endorses_distractor"
  },
  {
    example_id: "endorsement_named_alias",
    category: "explicit_endorsement",
    message: "The guaranteed prey-increase claim is correct.",
    prior_visible_message: null,
    expected_stance: "endorses_distractor"
  },
  {
    example_id: "rejection_identifier",
    category: "explicit_rejection",
    message:
      "I reject option D because indirect food-web effects can offset reduced predation.",
    prior_visible_message: null,
    expected_stance: "rejects_distractor"
  },
  {
    example_id: "rejection_named_alias",
    category: "explicit_rejection",
    message:
      "The predator-removal claim is wrong because the net prey response depends on the wider food web.",
    prior_visible_message: null,
    expected_stance: "rejects_distractor"
  },
  {
    example_id: "pronoun_rejection",
    category: "pronoun",
    message:
      "That claim is wrong because another consumer or resource pathway can change the prey outcome.",
    prior_visible_message:
      "Consider option D and its claim that predator removal must increase prey abundance.",
    expected_stance: "rejects_distractor"
  },
  {
    example_id: "pronoun_endorsement",
    category: "pronoun",
    message: "That option still seems right because fewer prey are eaten.",
    prior_visible_message: "We are evaluating option D.",
    expected_stance: "endorses_distractor"
  },
  {
    example_id: "paraphrase_rejection",
    category: "paraphrase",
    message:
      "Fewer predators always means more prey is wrong because indirect effects can reverse that direction.",
    prior_visible_message: null,
    expected_stance: "rejects_distractor"
  },
  {
    example_id: "paraphrase_endorsement",
    category: "paraphrase",
    message:
      "Less predation guarantees a larger prey population seems right.",
    prior_visible_message: null,
    expected_stance: "endorses_distractor"
  }
] as const;

function validateAliasExamples(aliasContract: ActiveAnchorAliasContract) {
  const results = ALIAS_EXAMPLES.map((example, index) => {
    const result = resolveActiveAnchorAliasV2({
      message: example.message,
      contract: aliasContract,
      prior_visible_message: example.prior_visible_message,
      source_turn_id: `synthetic_e2a31a_alias_${example.example_id}`,
      source_sequence_index: index + 1
    });
    const passed = result.canonical_anchor_id === CANONICAL_ANCHOR_ID &&
      result.observed_anchor_reference === "explicit" &&
      result.observed_anchor_stance === example.expected_stance &&
      result.exact_anchor_evidence_spans.length > 0;
    return {
      ...example,
      resolver_version: result.resolver_version,
      observed_anchor_reference: result.observed_anchor_reference,
      observed_anchor_identifier: result.observed_anchor_identifier,
      observed_anchor_stance: result.observed_anchor_stance,
      match_type: result.match_type,
      exact_anchor_evidence_span_count:
        result.exact_anchor_evidence_spans.length,
      passed
    };
  });
  return {
    validation_version: "e2a31a-ecology-alias-example-validation-v1",
    canonical_anchor_id: CANONICAL_ANCHOR_ID,
    explicit_endorsement_examples: ALIAS_EXAMPLES.filter((entry) =>
      entry.category === "explicit_endorsement"
    ).map((entry) => entry.example_id),
    explicit_rejection_examples: ALIAS_EXAMPLES.filter((entry) =>
      entry.category === "explicit_rejection"
    ).map((entry) => entry.example_id),
    pronoun_examples: ALIAS_EXAMPLES.filter((entry) =>
      entry.category === "pronoun"
    ).map((entry) => entry.example_id),
    paraphrase_examples: ALIAS_EXAMPLES.filter((entry) =>
      entry.category === "paraphrase"
    ).map((entry) => entry.example_id),
    results,
    passed: results.every((entry) => entry.passed),
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
}

function compileEvaluatorV5Request(contract: TargetEvidenceContractV5) {
  const sourceStudentTurn = {
    source_student_turn_id: "synthetic_e2a31_student_turn_1",
    source_sequence_index: 2
  };
  const syntheticStudentMessage =
    "I choose option D because removing the predator means fewer prey are eaten, so the prey population must increase.";
  const legacyEvaluatorInput = {
    schema_version: ACTIVITY_RESPONSE_EVALUATOR_INPUT_SCHEMA_VERSION,
    case_id: "e2a31_ecology_anchor_endorsement_turn_1",
    session_public_id: "synthetic_e2a31_session_1",
    student_public_id: "synthetic_e2a31_student_1",
    assessment_public_id: "synthetic_e2a31_assessment_1",
    concept_unit_id: CONCEPT_ID,
    activity_attempt_id: "synthetic_e2a31_activity_1",
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
      profile_condition: "synthetic_frozen_e2a31_trajectory",
      distractor_role: "selected_distractor",
      safe_activity_prompt:
        "Explain why reduced direct predation does not guarantee that the prey population will increase."
    },
    student_activity_response: {
      safe_response_summary: syntheticStudentMessage,
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
        "Unsupported option selection is insufficient without an independently explained food-web mechanism."
    },
    target_evidence_contract: contract,
    complete_visible_formative_conversation: {
      dialogue_public_id: "synthetic_e2a31_dialogue_1",
      activity_attempt_public_id: "synthetic_e2a31_activity_1",
      turns: [
        {
          actor: "assistant",
          sequence_index: 1,
          message:
            "Consider the claim in option D. Explain how removing a top predator could affect prey through the wider food web."
        },
        {
          actor: "student",
          sequence_index: 2,
          source_student_turn_id: sourceStudentTurn.source_student_turn_id,
          message: syntheticStudentMessage
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
    legacy_evaluator_input: legacyEvaluatorInput,
    source_student_turn: sourceStudentTurn,
    active_anchor_alias_contract: contract.active_anchor_alias_contract
  });
  ProductionTurnEvidenceEvaluatorInputV5Schema.parse(providerInput);
  const candidate = evaluateE2A24Candidate();
  const modelConfig = candidate.full_candidate.roles[
    "formative_activity_response_evaluator_agent"
  ];
  if (!modelConfig) {
    throw new Error("e2a31a_evaluator_model_config_missing");
  }
  const executableRequest = {
    agent_name: ACTIVITY_RESPONSE_EVALUATOR_AGENT_NAME,
    model_config: modelConfig,
    instructions: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_INSTRUCTIONS_V5,
    input: providerInput,
    output_schema: ProductionTurnEvidenceEvaluatorOutputV5Schema,
    schema_name: PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    client_request_id: "e2a31a_compile_only_evaluator_turn_1",
    timeout_ms: 90_000,
    metadata: {
      evaluation_phase: "e2a31_compile_only_no_live",
      role: "evidence_evaluator",
      session_id: "E2A31-ECOLOGY",
      turn_number: "1",
      prompt_version:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
      prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
      execution_authorized: "false"
    }
  } satisfies StructuredAgentRequest<
    typeof providerInput,
    unknown
  >;
  const canonicalRequestHash = canonicalStructuredAgentRequestHash(
    executableRequest
  );
  const requestProjection = {
    request_compilation_version: "e2a31a-evaluator-v5-request-v1",
    compilation_mode: "compile_only_no_provider",
    agent_name: executableRequest.agent_name,
    model_config: executableRequest.model_config,
    prompt_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
    prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    repair_prompt_hash:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    input_schema_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
    output_schema_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    schema_name: executableRequest.schema_name,
    client_request_id: executableRequest.client_request_id,
    timeout_ms: executableRequest.timeout_ms,
    metadata: executableRequest.metadata,
    input: executableRequest.input,
    canonical_request_hash: canonicalRequestHash,
    output_schema_runtime_validation_present: true,
    provider_dispatch_performed: false
  };
  const oldEvaluatorContracts = JSON.stringify(requestProjection).match(
    /production-turn-evidence-evaluator-(?:prompt-|input-|output-)?v[1-4]\b/gu
  ) ?? [];
  return {
    ...requestProjection,
    old_evaluator_contract_matches: [...new Set(oldEvaluatorContracts)],
    passed:
      oldEvaluatorContracts.length === 0 &&
      requestProjection.evaluator_version ===
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5 &&
      requestProjection.schema_name ===
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5 &&
      requestProjection.input.source_student_turn.source_student_turn_id ===
        sourceStudentTurn.source_student_turn_id &&
      requestProjection.input.source_student_turn.source_sequence_index ===
        sourceStudentTurn.source_sequence_index,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
}

function runOverlapAnalysis(contract: TargetEvidenceContractV5) {
  const plannedTexts = [
    "Removing a top predator can produce indirect ecosystem effects; prey abundance is not determined only by immediate predation rate.",
    DISTRACTOR_CLAIM,
    "A lake loses its top predatory fish. Explain why the focal prey population is not guaranteed to increase simply because direct predation has fallen.",
    ...contract.target_conceptual_relationships,
    ...contract.required_mechanisms
  ];
  const candidateSemanticTags = [
    "ecology", "trophic_cascade", "top_predator_removal",
    "indirect_food_web_effect", "prey_abundance", "non_guaranteed_response"
  ];
  const candidateContentStructureTags = [
    "direct_release_plus_indirect_countervailing_path",
    "non_monotonic_population_response"
  ];
  const rows = HISTORICAL_INPUTS.map((entry) => {
    const historicalStrings = new Set<string>();
    entry.files.forEach((file) => {
      stringsFromHistoricalFile(file).forEach((value) =>
        historicalStrings.add(value)
      );
    });
    let exactMatchCount = 0;
    let normalizedMatchCount = 0;
    let maximumTokenOverlap = 0;
    for (const planned of plannedTexts) {
      for (const historical of historicalStrings) {
        if (planned === historical) exactMatchCount += 1;
        if (normalizedText(planned) === normalizedText(historical)) {
          normalizedMatchCount += 1;
        }
        maximumTokenOverlap = Math.max(
          maximumTokenOverlap,
          tokenJaccard(planned, historical)
        );
      }
    }
    const semanticTagOverlap = candidateSemanticTags.filter((tag) =>
      entry.semantic_tags.includes(tag as never)
    );
    const contentStructureOverlap = candidateContentStructureTags.filter(
      (tag) => entry.content_structure_tags.includes(tag as never)
    );
    const broadDomainOverlap = entry.stage === "E2A.28" &&
      entry.semantic_tags.includes("ecology");
    const scenarioSemanticOverlap = semanticTagOverlap.some((tag) =>
      tag !== "ecology"
    );
    const passed = exactMatchCount === 0 &&
      normalizedMatchCount === 0 &&
      maximumTokenOverlap < 0.85 &&
      contentStructureOverlap.length === 0 &&
      !scenarioSemanticOverlap;
    return {
      stage: entry.stage,
      source_files: entry.files.map((file) => ({
        path: file,
        sha256: fileSha(file)
      })),
      historical_string_count: historicalStrings.size,
      exact_match_count: exactMatchCount,
      normalized_match_count: normalizedMatchCount,
      token_overlap_maximum: Number(maximumTokenOverlap.toFixed(4)),
      content_structural_overlap_tags: contentStructureOverlap,
      semantic_tag_overlap: semanticTagOverlap,
      broad_domain_overlap: broadDomainOverlap,
      exact_scenario_semantic_overlap: scenarioSemanticOverlap,
      passed
    };
  });
  const broadEcologyCalibration = rows.some((entry) =>
    entry.stage === "E2A.28" && entry.broad_domain_overlap
  );
  return {
    analysis_version: "e2a31a-held-out-overlap-analysis-v1",
    held_out_scope:
      "exact_ecology_trophic_cascade_scenario_anchor_and_trajectory",
    comparison_scope: "E2A.24_through_E2A.30_including_correction_corpora",
    methods: {
      exact: "byte-equal comparison of bounded content-bearing strings",
      normalized:
        "case-folded punctuation-normalized whitespace-collapsed comparison",
      token:
        "deterministic token Jaccard with pass threshold below 0.85",
      structural:
        "frozen content-causal-structure tag comparison; shared runtime trajectory structure is intentionally excluded",
      semantic:
        "deterministic frozen concept-tag comparison without embeddings or provider calls"
    },
    planned_text_count: plannedTexts.length,
    candidate_semantic_tags: candidateSemanticTags,
    candidate_content_structure_tags: candidateContentStructureTags,
    stage_results: rows,
    broad_ecology_domain_previously_seen_in_deterministic_calibration:
      broadEcologyCalibration,
    broad_domain_disclosure:
      "E2A.28a used the label ecology_population_growth in a generic no-live calibration corpus; E2A.31 is held out only at the exact trophic-cascade scenario, anchor, and trajectory level.",
    exact_scenario_previously_seen: false,
    passed: rows.every((entry) => entry.passed),
    limitations: [
      "The semantic check is a frozen deterministic concept-tag audit, not an embedding or human equivalence judgment.",
      "Shared evaluator, contradiction, clarification, and sound-gate structure is expected and is not treated as content overlap."
    ],
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
}

function buildBudget() {
  return {
    budget_version: "e2a31-frozen-budget-v1",
    status: "frozen_not_authorized",
    execution_authorized: false,
    maximum: {
      sessions: 1,
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
    },
    expected_normal: {
      student_turns: 6,
      simulator_calls: 6,
      evidence_evaluator_calls: 6,
      initial_tutor_calls: 5,
      tutor_semantic_regenerations: 0,
      logical_generation_calls: 17,
      adapter_attempts_without_transport_failure: 17
    },
    retry_policy_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    retry_backoff_ms: PROVIDER_TRANSPORT_RETRY_LIMITS.backoff_ms,
    pre_call_and_pre_retry_budget_enforcement_required: true,
    provider_calls_made: 0
  };
}

function buildArtifactContract() {
  return {
    artifact_contract_version:
      "e2a31-complete-ecology-turn-transport-evidence-contract-v1",
    status: "frozen_not_authorized",
    execution_authorized: false,
    inherits: "e2a30-complete-turn-transport-evidence-contract-v1",
    freeze_artifacts_required: [...REQUIRED_FREEZE_ARTIFACTS],
    future_live_artifacts_additionally_require: [
      "ecology-target-evidence-contract.json",
      "ecology-alias-resolution-results.jsonl",
      "canonical-anchor-evidence-results.jsonl",
      "anchor-parity-reconciliation-results.jsonl",
      "evaluator-v5-request-identities.jsonl",
      "overlap-analysis-binding.json",
      "budget-ledger.json",
      "human-review-packet.json"
    ],
    every_logical_generation_call_requires: [
      "logical_call_id",
      "canonical_request_hash",
      "source_binding_hash",
      "adapter_attempt_traces",
      "transport_retry_count",
      "semantic_regeneration_count",
      "accepted_result_identity_or_explicit_failure",
      "exactly_once_semantic_effect_receipt_when_accepted",
      "budget_before_and_after_each_attempt"
    ],
    evaluator_turn_requires: [
      "source_student_turn_id",
      "source_sequence_index",
      "evaluator_version",
      "input_schema_version",
      "output_schema_version",
      "active_anchor_alias_contract_hash",
      "canonical_anchor_evidence",
      "resolver_v2_result",
      "parity_reconciliation_result"
    ],
    no_chain_of_thought: true,
    no_secrets_or_environment_values: true,
    no_raw_credentials_or_headers: true,
    no_provider_call_authorized_by_this_contract: true
  };
}

function buildFrozenProtocol(input: {
  targetContractHash: string;
  aliasContractHash: string;
  aliasExamplesHash: string;
  evaluatorRequestHash: string;
  overlapAnalysisHash: string;
  artifactContractHash: string;
  budgetHash: string;
}) {
  return {
    protocol_version: PROTOCOL_VERSION,
    freeze_version: VERSION,
    status: "frozen_not_authorized_not_executed",
    execution_authorized: false,
    live_execution_performed: false,
    provider_calls_made: 0,
    session_count: 1,
    domain: "ecology",
    held_out_scope:
      "exact_ecology_trophic_cascade_scenario_anchor_and_trajectory",
    broad_domain_previously_seen_in_deterministic_calibration: true,
    concept:
      "Removing a top predator can produce indirect ecosystem effects; prey abundance is not determined only by immediate predation rate.",
    natural_initial_activity:
      "A lake loses its top predatory fish. Explain why the focal prey population is not guaranteed to increase simply because direct predation has fallen.",
    canonical_anchor: {
      anchor_id: CANONICAL_ANCHOR_ID,
      option_label: OPTION_LABEL,
      distractor_text: DISTRACTOR_CLAIM,
      required_final_stance: "rejects_distractor"
    },
    mechanism_criteria: [
      "Distinguish direct predation release from the net food-web response.",
      "Explain at least one indirect consumer, competitor, resource, or trophic pathway.",
      "Connect the indirect pathway to why prey increase is not guaranteed."
    ],
    sound_criteria: [
      "Apply the mechanism explicitly to the canonical option-D anchor or an accepted alias.",
      "Coherently reject the guaranteed prey-increase claim.",
      "Retain no direct-predation-only contradiction.",
      "Provide independently supported reasoning rather than copied wording."
    ],
    contradiction_criteria: [
      "An indirect mechanism that can offset prey increase conflicts with a final endorsement of option D.",
      "Treating reduced predation as sufficient to guarantee prey increase retains the active misconception."
    ],
    frozen_student_turn_count: 6,
    frozen_trajectory: [
      {
        checkpoint: 1,
        student_turn: 1,
        role: "explicit_anchor_endorsement",
        envelope: ["misconception"]
      },
      {
        checkpoint: 2,
        student_turn: 2,
        role: "partial_food_web_mechanism",
        envelope: ["misconception", "partial"]
      },
      {
        checkpoint: 3,
        student_turn: 3,
        role: "correct_indirect_mechanism_with_wrong_anchor_conclusion",
        envelope: ["misconception", "partial"]
      },
      {
        checkpoint: 4,
        student_turn: 3,
        role: "structured_mechanism_conclusion_contradiction",
        required_structured_conflict: true
      },
      {
        checkpoint: 5,
        student_turn: 4,
        role: "autonomous_clarification",
        envelope: ["insufficient", "partial"]
      },
      {
        checkpoint: 6,
        student_turn: 5,
        role: "mechanism_reconstruction",
        envelope: ["partial"]
      },
      {
        checkpoint: 7,
        student_turn: 6,
        role: "independent_coherent_anchor_rejection",
        envelope: ["sound"]
      },
      {
        checkpoint: 8,
        student_turn: 6,
        role: "immediate_revision",
        revision_required_immediately: true
      }
    ],
    required_runtime: {
      target_evidence_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
      evaluator_input_schema:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
      evaluator_output_schema:
        PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
      canonical_anchor_evidence_version: CANONICAL_ANCHOR_EVIDENCE_VERSION,
      resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
      parity_policy_version: ANCHOR_PARITY_RECONCILIATION_VERSION,
      contradiction_propagation_version:
        ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
      profile_mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
      profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V6,
      pre_tutor_finalization_version:
        PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3,
      anchor_conclusion_consistency_version:
        ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
      sound_gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
      transport_recovery_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
      provider_concurrency: 1
    },
    component_hashes: {
      target_evidence_contract: input.targetContractHash,
      ecology_alias_contract: input.aliasContractHash,
      alias_example_validation: input.aliasExamplesHash,
      compiled_evaluator_v5_request: input.evaluatorRequestHash,
      overlap_analysis: input.overlapAnalysisHash,
      artifact_contract: input.artifactContractHash,
      budget: input.budgetHash
    },
    candidate_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    approved_v2_hash: APPROVED_V2_HASH,
    candidate_approved: false,
    candidate_activated: false
  };
}

function candidateIntegrity() {
  const evaluation = evaluateE2A24Candidate();
  const candidateRaw = readFileSync(E2A24_CANDIDATE_PATH, "utf8");
  const passed =
    evaluation.candidate_configuration_hash === CANDIDATE_HASH &&
    evaluation.candidate_file_sha256 === CANDIDATE_FILE_SHA &&
    sha256(candidateRaw) === CANDIDATE_FILE_SHA &&
    evaluation.approved_v2_hash === APPROVED_V2_HASH &&
    evaluation.candidate_approved === false &&
    evaluation.candidate_activated === false;
  return {
    candidate_configuration_hash: evaluation.candidate_configuration_hash,
    candidate_file_sha256: evaluation.candidate_file_sha256,
    approved_v2_hash: evaluation.approved_v2_hash,
    candidate_approved: evaluation.candidate_approved,
    candidate_activated: evaluation.candidate_activated,
    passed
  };
}

function predecessorRuntimeIdentityIntegrity() {
  const relativePath = path.join(
    E2A30A_PREDECESSOR_RUN,
    "composite-runtime-identity.json"
  );
  const filePath = path.join(process.cwd(), relativePath);
  if (!existsSync(filePath)) {
    throw new Error("e2a31a_predecessor_runtime_identity_missing");
  }
  const identity = readJson<JsonRecord>(filePath);
  const recordedHash = identity.composite_runtime_identity_hash;
  const identityBody = { ...identity };
  delete identityBody.composite_runtime_identity_hash;
  const recomputedHash = stableHash(identityBody);
  const passed =
    recordedHash === E2A30A_PREDECESSOR_IDENTITY_HASH &&
    recomputedHash === E2A30A_PREDECESSOR_IDENTITY_HASH &&
    identity.tutor_candidate_hash === CANDIDATE_HASH &&
    identity.tutor_candidate_file_sha256 === CANDIDATE_FILE_SHA &&
    identity.application_git_commit === E2A30A_PREDECESSOR_APPLICATION_COMMIT;
  return {
    integrity_version: "e2a31a-predecessor-runtime-identity-v1",
    source_artifact: relativePath,
    source_artifact_sha256: fileSha(relativePath),
    expected_composite_runtime_identity_hash:
      E2A30A_PREDECESSOR_IDENTITY_HASH,
    recorded_composite_runtime_identity_hash: recordedHash,
    recomputed_composite_runtime_identity_hash: recomputedHash,
    predecessor_e2a31_protocol_hash: identity.e2a31_protocol_hash,
    predecessor_application_git_commit: identity.application_git_commit,
    candidate_configuration_hash: identity.tutor_candidate_hash,
    passed
  };
}

function protectedSourceIntegrity() {
  const actual = Object.fromEntries(
    Object.keys(EXPECTED_PROTECTED_HASHES).map((file) => [file, fileSha(file)])
  );
  const mismatches = Object.entries(EXPECTED_PROTECTED_HASHES)
    .filter(([file, expected]) => actual[file] !== expected)
    .map(([file, expected]) => ({
      file,
      expected_sha256: expected,
      actual_sha256: actual[file]
    }));
  return {
    integrity_version: "e2a31a-protected-source-integrity-v1",
    expected_sha256: EXPECTED_PROTECTED_HASHES,
    actual_sha256: actual,
    mismatches,
    passed: mismatches.length === 0
  };
}

function buildCompositeRuntimeIdentity(input: {
  protocolHash: string;
  targetContractHash: string;
  aliasContractHash: string;
  evaluatorRequestHash: string;
  overlapAnalysisHash: string;
  artifactContractHash: string;
  budgetHash: string;
  predecessor: ReturnType<typeof predecessorRuntimeIdentityIntegrity>;
  protectedSources: ReturnType<typeof protectedSourceIntegrity>;
}) {
  const identity = {
    identity_version: "e2a31a-composite-runtime-identity-v1",
    application_git_commit: applicationGitCommit(),
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_file_sha256: CANDIDATE_FILE_SHA,
    approved_v2_hash: APPROVED_V2_HASH,
    predecessor_e2a30a_composite_runtime_identity_hash:
      input.predecessor.recorded_composite_runtime_identity_hash,
    predecessor_e2a31_outline_protocol_hash:
      input.predecessor.predecessor_e2a31_protocol_hash,
    predecessor_runtime_identity_artifact_sha256:
      input.predecessor.source_artifact_sha256,
    e2a31_protocol_hash: input.protocolHash,
    ecology_target_evidence_contract_hash: input.targetContractHash,
    ecology_alias_contract_hash: input.aliasContractHash,
    compiled_evaluator_v5_request_hash: input.evaluatorRequestHash,
    overlap_analysis_hash: input.overlapAnalysisHash,
    artifact_contract_hash: input.artifactContractHash,
    budget_hash: input.budgetHash,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    evaluator_prompt_version:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5,
    evaluator_prompt_hash: PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5,
    evaluator_input_schema:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
    evaluator_output_schema:
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5,
    target_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    canonical_anchor_evidence_version: CANONICAL_ANCHOR_EVIDENCE_VERSION,
    anchor_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
    anchor_parity_version: ANCHOR_PARITY_RECONCILIATION_VERSION,
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
    profile_mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
    profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V6,
    pre_tutor_finalization_version:
      PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3,
    transport_retry_version: PROVIDER_TRANSPORT_RETRY_POLICY_VERSION,
    protected_source_hashes: input.protectedSources.actual_sha256,
    freeze_harness_sha256: fileSha("prisma/formative-evaluation-e2a31a.ts")
  };
  return {
    ...identity,
    composite_runtime_identity_hash: stableHash(identity)
  };
}

function validateTargetScope(input: {
  contract: TargetEvidenceContractV5;
  aliasExamples: ReturnType<typeof validateAliasExamples>;
}) {
  const serialized = normalizedText(JSON.stringify({
    contract: input.contract,
    examples: input.aliasExamples.results.map((entry) => ({
      category: entry.category,
      message: entry.message,
      prior_visible_message: entry.prior_visible_message
    }))
  }));
  const forbidden = [
    "electrical circuit", "thermal physics", "antimicrobial resistance",
    "geometrical optics", "binary search", "item response theory",
    "theta invariance"
  ];
  const forbiddenHits = forbidden.filter((entry) =>
    serialized.includes(normalizedText(entry))
  );
  return {
    scope_validation_version: "e2a31a-ecology-target-scope-v1",
    canonical_anchor_id_matches:
      input.contract.active_anchor_id === CANONICAL_ANCHOR_ID &&
      input.contract.active_anchor_alias_contract.active_anchor_id ===
        CANONICAL_ANCHOR_ID,
    option_label_matches:
      input.contract.distractor_option === OPTION_LABEL &&
      input.contract.active_anchor_alias_contract.option_label === OPTION_LABEL,
    forbidden_cross_domain_alias_hits: forbiddenHits,
    passed: forbiddenHits.length === 0 &&
      input.contract.active_anchor_id === CANONICAL_ANCHOR_ID &&
      input.contract.active_anchor_alias_contract.active_anchor_id ===
        CANONICAL_ANCHOR_ID
  };
}

function buildAll() {
  const protectedBefore = protectedSourceIntegrity();
  if (!protectedBefore.passed) {
    throw new Error("e2a31a_protected_source_integrity_failed");
  }
  const candidate = candidateIntegrity();
  if (!candidate.passed) throw new Error("e2a31a_candidate_integrity_failed");
  const predecessor = predecessorRuntimeIdentityIntegrity();
  if (!predecessor.passed) {
    throw new Error("e2a31a_predecessor_runtime_identity_failed");
  }
  const aliasContract = buildEcologyAliasContract();
  const targetContract = buildEcologyTargetEvidenceContract(aliasContract);
  const aliasExamples = validateAliasExamples(aliasContract);
  if (!aliasExamples.passed) {
    const failed = aliasExamples.results.filter((entry) => !entry.passed)
      .map((entry) => entry.example_id);
    throw new Error(`e2a31a_alias_examples_failed:${failed.join("|")}`);
  }
  const evaluatorRequest = compileEvaluatorV5Request(targetContract);
  if (!evaluatorRequest.passed) {
    throw new Error("e2a31a_evaluator_v5_request_compilation_failed");
  }
  const overlap = runOverlapAnalysis(targetContract);
  if (!overlap.passed) throw new Error("e2a31a_overlap_analysis_failed");
  const targetScope = validateTargetScope({
    contract: targetContract,
    aliasExamples
  });
  if (!targetScope.passed) throw new Error("e2a31a_target_scope_failed");
  const budget = buildBudget();
  const maximum = budget.maximum;
  if (maximum.logical_generation_calls !==
        maximum.simulator_calls + maximum.evidence_evaluator_calls +
          maximum.initial_tutor_calls + maximum.tutor_semantic_regenerations ||
      maximum.adapter_attempts !== maximum.logical_generation_calls *
        maximum.adapter_attempts_per_logical_call ||
      maximum.total_tokens !== maximum.input_tokens + maximum.output_tokens ||
      maximum.transport_retries_per_logical_call !== 2 ||
      maximum.provider_concurrency !== 1) {
    throw new Error("e2a31a_budget_arithmetic_failed");
  }
  const artifactContract = buildArtifactContract();
  const hashes = {
    targetContract: stableHash(targetContract),
    aliasContract: stableHash(aliasContract),
    aliasExamples: stableHash(aliasExamples),
    evaluatorRequest: stableHash(evaluatorRequest),
    overlap: stableHash(overlap),
    artifactContract: stableHash(artifactContract),
    budget: stableHash(budget)
  };
  const protocol = buildFrozenProtocol({
    targetContractHash: hashes.targetContract,
    aliasContractHash: hashes.aliasContract,
    aliasExamplesHash: hashes.aliasExamples,
    evaluatorRequestHash: hashes.evaluatorRequest,
    overlapAnalysisHash: hashes.overlap,
    artifactContractHash: hashes.artifactContract,
    budgetHash: hashes.budget
  });
  const protocolHash = stableHash(protocol);
  const identity = buildCompositeRuntimeIdentity({
    protocolHash,
    targetContractHash: hashes.targetContract,
    aliasContractHash: hashes.aliasContract,
    evaluatorRequestHash: hashes.evaluatorRequest,
    overlapAnalysisHash: hashes.overlap,
    artifactContractHash: hashes.artifactContract,
    budgetHash: hashes.budget,
    predecessor,
    protectedSources: protectedBefore
  });
  const protectedAfter = protectedSourceIntegrity();
  if (!protectedAfter.passed ||
      stableHash(protectedBefore.actual_sha256) !==
        stableHash(protectedAfter.actual_sha256)) {
    throw new Error("e2a31a_protected_source_changed_during_freeze");
  }
  if (networkRequestCount !== 0) {
    throw new Error("e2a31a_network_request_detected");
  }
  return {
    candidate,
    predecessor,
    protectedSources: protectedAfter,
    aliasContract,
    targetContract,
    aliasExamples,
    evaluatorRequest,
    overlap,
    targetScope,
    budget,
    artifactContract,
    protocol,
    protocolHash,
    identity
  };
}

function artifactValues(all: ReturnType<typeof buildAll>, runId: string) {
  const manifest = {
    manifest_version: VERSION,
    run_id: runId,
    created_at: new Date().toISOString(),
    execution_mode: "deterministic_compile_only_no_provider",
    application_git_commit: all.identity.application_git_commit,
    protocol_hash: all.protocolHash,
    composite_runtime_identity_hash:
      all.identity.composite_runtime_identity_hash,
    candidate_configuration_hash: CANDIDATE_HASH,
    candidate_approved: false,
    candidate_activated: false,
    e2a31_executed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
  const providerGuard = {
    guard_version: "e2a31a-provider-call-guard-v1",
    execution_authorized: false,
    provider_executor_constructed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    fetch_guard_installed: true,
    passed: networkRequestCount === 0
  };
  const summary = {
    summary_version: VERSION,
    status: "e2a31a_ecology_protocol_frozen_not_authorized_not_executed",
    run_id: runId,
    passed: true,
    protocol_hash: all.protocolHash,
    composite_runtime_identity_hash:
      all.identity.composite_runtime_identity_hash,
    target_evidence_contract_hash: stableHash(all.targetContract),
    ecology_alias_contract_hash: stableHash(all.aliasContract),
    evaluator_v5_request_compiled: all.evaluatorRequest.passed,
    old_evaluator_contract_count:
      all.evaluatorRequest.old_evaluator_contract_matches.length,
    alias_examples_passed: all.aliasExamples.passed,
    overlap_analysis_passed: all.overlap.passed,
    broad_ecology_calibration_overlap_disclosed:
      all.overlap.broad_ecology_domain_previously_seen_in_deterministic_calibration,
    exact_scenario_previously_seen: all.overlap.exact_scenario_previously_seen,
    target_scope_passed: all.targetScope.passed,
    budget_validated: true,
    candidate_integrity_passed: all.candidate.passed,
    predecessor_runtime_identity_passed: all.predecessor.passed,
    predecessor_e2a30a_composite_runtime_identity_hash:
      all.predecessor.recorded_composite_runtime_identity_hash,
    protected_source_integrity_passed: all.protectedSources.passed,
    artifact_validation_required: true,
    e2a31_executed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    candidate_approved: false,
    candidate_activated: false
  };
  return {
    "freeze-manifest.json": manifest,
    "frozen-protocol.json": all.protocol,
    "frozen-protocol.sha256": `${all.protocolHash}\n`,
    "target-evidence-contract.json": all.targetContract,
    "ecology-alias-contract.json": all.aliasContract,
    "alias-example-validation.json": all.aliasExamples,
    "compiled-evaluator-v5-request.json": all.evaluatorRequest,
    "overlap-analysis.json": all.overlap,
    "budget.json": all.budget,
    "artifact-contract.json": all.artifactContract,
    "candidate-integrity.json": all.candidate,
    "predecessor-runtime-identity.json": all.predecessor,
    "protected-source-integrity.json": all.protectedSources,
    "composite-runtime-identity.json": all.identity,
    "provider-call-guard.json": providerGuard,
    "summary.json": summary
  };
}

function validateArtifacts(runDir: string, allowValidationMissing = false) {
  const missing = REQUIRED_FREEZE_ARTIFACTS.filter((name) =>
    !(allowValidationMissing && name === "artifact-validation.json") &&
    !existsSync(path.join(runDir, name))
  );
  const unexpected = readdirSync(runDir).filter((name) =>
    !REQUIRED_FREEZE_ARTIFACTS.includes(
      name as typeof REQUIRED_FREEZE_ARTIFACTS[number]
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
  const unsafeArtifacts = readdirSync(runDir).filter((name) => {
    const filePath = path.join(runDir, name);
    if (!statSync(filePath).isFile()) return false;
    const content = readFileSync(filePath, "utf8");
    return unsafePatterns.some((pattern) => pattern.test(content));
  });
  let semanticIssues: string[] = [];
  try {
    TargetEvidenceContractV5Schema.parse(readJson(
      path.join(runDir, "target-evidence-contract.json")
    ));
    ActiveAnchorAliasContractSchema.parse(readJson(
      path.join(runDir, "ecology-alias-contract.json")
    ));
    const compiled = readJson<JsonRecord>(path.join(
      runDir,
      "compiled-evaluator-v5-request.json"
    ));
    ProductionTurnEvidenceEvaluatorInputV5Schema.parse(compiled.input);
    const protocol = readJson<JsonRecord>(path.join(runDir, "frozen-protocol.json"));
    const protocolHash = readFileSync(
      path.join(runDir, "frozen-protocol.sha256"),
      "utf8"
    ).trim();
    if (stableHash(protocol) !== protocolHash) {
      semanticIssues.push("protocol_hash_mismatch");
    }
    const identity = readJson<JsonRecord>(path.join(
      runDir,
      "composite-runtime-identity.json"
    ));
    const identityHash = identity.composite_runtime_identity_hash;
    const identityBody = { ...identity };
    delete identityBody.composite_runtime_identity_hash;
    if (stableHash(identityBody) !== identityHash) {
      semanticIssues.push("composite_identity_hash_mismatch");
    }
    if (compiled.passed !== true ||
        (compiled.old_evaluator_contract_matches as unknown[]).length !== 0) {
      semanticIssues.push("compiled_evaluator_request_invalid");
    }
    const overlap = readJson<JsonRecord>(path.join(runDir, "overlap-analysis.json"));
    if (overlap.passed !== true) semanticIssues.push("overlap_analysis_failed");
    const predecessor = readJson<JsonRecord>(path.join(
      runDir,
      "predecessor-runtime-identity.json"
    ));
    if (predecessor.passed !== true ||
        predecessor.recorded_composite_runtime_identity_hash !==
          E2A30A_PREDECESSOR_IDENTITY_HASH ||
        predecessor.recomputed_composite_runtime_identity_hash !==
          E2A30A_PREDECESSOR_IDENTITY_HASH) {
      semanticIssues.push("predecessor_runtime_identity_failed");
    }
    const guard = readJson<JsonRecord>(path.join(runDir, "provider-call-guard.json"));
    if (guard.passed !== true || guard.provider_calls_made !== 0 ||
        guard.network_requests_made !== 0) {
      semanticIssues.push("provider_call_guard_failed");
    }
  } catch (error) {
    semanticIssues = [
      ...semanticIssues,
      `artifact_parse_failed:${error instanceof Error ? error.message : "unknown"}`
    ];
  }
  return {
    validation_version: "e2a31a-artifact-validation-v1",
    passed:
      missing.length === 0 && unexpected.length === 0 &&
      unsafeArtifacts.length === 0 && semanticIssues.length === 0,
    required_artifact_count: REQUIRED_FREEZE_ARTIFACTS.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    unsafe_artifacts: unsafeArtifacts,
    semantic_issues: semanticIssues,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount
  };
}

function writeArtifacts(
  runDir: string,
  all: ReturnType<typeof buildAll>,
  runId: string
) {
  mkdirSync(runDir, { recursive: false });
  const values = artifactValues(all, runId);
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === "string") {
      writeFileSync(path.join(runDir, name), value, "utf8");
    } else {
      writeJson(path.join(runDir, name), value);
    }
  }
  const beforeSelf = validateArtifacts(runDir, true);
  if (!beforeSelf.passed) {
    throw new Error(
      `e2a31a_artifact_validation_failed:${[
        ...beforeSelf.missing_artifacts,
        ...beforeSelf.unexpected_artifacts,
        ...beforeSelf.unsafe_artifacts,
        ...beforeSelf.semantic_issues
      ].join("|")}`
    );
  }
  writeJson(path.join(runDir, "artifact-validation.json"), beforeSelf);
  const finalValidation = validateArtifacts(runDir);
  if (!finalValidation.passed) {
    throw new Error("e2a31a_final_artifact_validation_failed");
  }
  writeJson(path.join(runDir, "artifact-validation.json"), finalValidation);
  return finalValidation;
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:.]/gu, "");
  return `e2a31a_${stamp}_${randomBytes(4).toString("hex")}`;
}

function run() {
  const all = buildAll();
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  const runId = createRunId();
  const runDir = path.join(ARTIFACT_ROOT, runId);
  const artifactValidation = writeArtifacts(runDir, all, runId);
  return {
    ...(artifactValues(all, runId)["summary.json"] as JsonRecord),
    run_directory: runDir,
    artifact_validation: artifactValidation
  };
}

function smoke(suite: string) {
  const allowed = new Set([
    "all", "target-contract", "alias-contract", "evaluator-request",
    "overlap", "budget", "artifact", "composite-identity",
    "candidate-integrity", "provider-call-guard"
  ]);
  if (!allowed.has(suite)) {
    throw new Error(`e2a31a_unknown_smoke_suite:${suite}`);
  }
  const all = buildAll();
  let artifactValidationPassed = true;
  if (suite === "all" || suite === "artifact") {
    const tempRoot = path.join(
      process.cwd(),
      ".data",
      `e2a31a-smoke-temp-${randomBytes(4).toString("hex")}`
    );
    mkdirSync(tempRoot, { recursive: false });
    const runDir = path.join(tempRoot, "fixture");
    try {
      artifactValidationPassed = writeArtifacts(
        runDir,
        all,
        "e2a31a_smoke_fixture"
      ).passed;
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
  const passed =
    all.candidate.passed &&
    all.predecessor.passed &&
    all.protectedSources.passed &&
    all.aliasExamples.passed &&
    all.evaluatorRequest.passed &&
    all.overlap.passed &&
    all.targetScope.passed &&
    artifactValidationPassed &&
    networkRequestCount === 0;
  if (!passed) throw new Error(`e2a31a_smoke_failed:${suite}`);
  return {
    smoke_version: "e2a31a-smoke-v1",
    suite,
    passed,
    protocol_hash: all.protocolHash,
    composite_runtime_identity_hash:
      all.identity.composite_runtime_identity_hash,
    target_evidence_contract_hash: stableHash(all.targetContract),
    ecology_alias_contract_hash: stableHash(all.aliasContract),
    predecessor_runtime_identity_passed: all.predecessor.passed,
    predecessor_e2a30a_composite_runtime_identity_hash:
      all.predecessor.recorded_composite_runtime_identity_hash,
    evaluator_v5_request_compiled: all.evaluatorRequest.passed,
    old_evaluator_contract_count:
      all.evaluatorRequest.old_evaluator_contract_matches.length,
    overlap_analysis_passed: all.overlap.passed,
    broad_ecology_calibration_overlap_disclosed:
      all.overlap.broad_ecology_domain_previously_seen_in_deterministic_calibration,
    artifact_validation_passed: artifactValidationPassed,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    e2a31_executed: false,
    candidate_approved: false,
    candidate_activated: false
  };
}

function latestRun() {
  if (!existsSync(ARTIFACT_ROOT)) return null;
  return readdirSync(ARTIFACT_ROOT).filter((name) => name.startsWith("e2a31a_"))
    .sort().at(-1) ?? null;
}

try {
  const command = process.argv[2] ?? "smoke";
  const suiteIndex = process.argv.indexOf("--suite");
  const suite = suiteIndex >= 0
    ? process.argv[suiteIndex + 1] ?? "all"
    : "all";
  if (command === "run") {
    console.log(JSON.stringify(run(), null, 2));
  } else if (command === "smoke") {
    console.log(JSON.stringify(smoke(suite), null, 2));
  } else if (command === "report") {
    const runIndex = process.argv.indexOf("--run");
    const runId = runIndex >= 0 ? process.argv[runIndex + 1] : latestRun();
    if (!runId) throw new Error("e2a31a_run_not_found");
    const runDir = path.join(ARTIFACT_ROOT, runId);
    console.log(JSON.stringify({
      summary: readJson(path.join(runDir, "summary.json")),
      artifact_validation: readJson(
        path.join(runDir, "artifact-validation.json")
      )
    }, null, 2));
  } else {
    throw new Error(`e2a31a_unknown_command:${command}`);
  }
} finally {
  globalThis.fetch = originalFetch;
}
