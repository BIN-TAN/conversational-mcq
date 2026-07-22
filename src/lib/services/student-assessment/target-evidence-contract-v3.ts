import { z } from "zod";
import type {
  ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  AnchorInterpretationContractSchema,
  AnchorInterpretationSchema,
  classifyAnchorConclusion,
  evaluateAnchorConsistentSoundGate,
  type AnchorResolutionStatus,
  type ConceptualPosition
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import {
  TargetEvidenceAdjudicationSchema,
  TargetEvidenceContractSchema,
  buildActivityTargetEvidenceContract
} from "@/lib/services/student-assessment/target-evidence-contract";
import type {
  TurnEvidenceObservation
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";

export const TARGET_EVIDENCE_CONTRACT_VERSION_V3 =
  "target-evidence-contract-v2" as const;
export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V3 =
  "production-turn-evidence-evaluator-v3" as const;
export const TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V3 =
  "turn-evidence-profile-mapper-v3" as const;
export const PROFILE_CONSISTENCY_POLICY_VERSION_V3 =
  "turn-evidence-profile-consistency-v3" as const;

export const TargetEvidenceContractV3Schema = TargetEvidenceContractSchema
  .omit({ contract_version: true })
  .extend(AnchorInterpretationContractSchema.shape)
  .extend({
    contract_version: z.literal(TARGET_EVIDENCE_CONTRACT_VERSION_V3)
  }).strict();
export type TargetEvidenceContractV3 = z.infer<
  typeof TargetEvidenceContractV3Schema
>;

export const TargetEvidenceAdjudicationV3Schema =
  TargetEvidenceAdjudicationSchema.omit({
    evaluator_version: true,
    target_evidence_contract_version: true
  }).extend({
    evaluator_version: z.literal(
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V3
    ),
    target_evidence_contract_version: z.literal(
      TARGET_EVIDENCE_CONTRACT_VERSION_V3
    ),
    anchor_interpretation: AnchorInterpretationSchema
  }).strict();
export type TargetEvidenceAdjudicationV3 = z.infer<
  typeof TargetEvidenceAdjudicationV3Schema
>;

export type TurnEvidenceObservationV3 = TurnEvidenceObservation & {
  anchor_stance: TargetEvidenceAdjudicationV3["anchor_interpretation"]["anchor_stance"];
  anchor_consistency: TargetEvidenceAdjudicationV3["anchor_interpretation"]["anchor_consistency"];
  anchor_resolution_status: TargetEvidenceAdjudicationV3["anchor_interpretation"]["anchor_resolution_status"];
  anchor_conclusion_consistency_version: string;
  sound_gate_version: string;
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function exactMessageSpan(label: string, message: string) {
  return [{ label, span: message.trim().slice(0, 900) }];
}

function yes(value: "yes" | "no" | "partial" | "not_applicable") {
  return value === "yes";
}

function conceptualPositionFromPacket(
  packet: ActivityMisconceptionEvidencePacketV1
): ConceptualPosition {
  const status = packet.misconception_evidence_update.status;
  if ([
    "misconception_unsupported",
    "boundary_understanding_improved",
    "independent_evidence_supported",
    "no_actionable_misconception_evidence"
  ].includes(status)) return "rejects_distractor";
  if ([
    "misconception_persisted",
    "conceptual_entry_gap_remains",
    "reasoning_boundary_still_blurred"
  ].includes(status)) return "endorses_distractor";
  if (["misconception_weakened", "conceptual_entry_improved"].includes(
    status
  )) return "ambiguous";
  return "not_assessable";
}

export function buildActivityTargetEvidenceContractV3(input: {
  concept_id: string;
  item_id: string;
  distractor_option: string;
  distractor_claim: string;
  packet: ActivityMisconceptionEvidencePacketV1;
}): TargetEvidenceContractV3 {
  const legacy = buildActivityTargetEvidenceContract(input);
  return TargetEvidenceContractV3Schema.parse({
    ...legacy,
    contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V3,
    active_anchor_id: `${input.item_id}:option:${input.distractor_option}`,
    active_anchor_text:
      `${input.item_id} option ${input.distractor_option}: ${input.distractor_claim}`,
    active_anchor_type: "distractor_option",
    required_anchor_stance: "rejects_distractor",
    acceptable_anchor_paraphrases: [
      `option ${input.distractor_option}`,
      `choice ${input.distractor_option}`,
      "that option",
      "that choice",
      "the active distractor"
    ],
    prohibited_anchor_stances: [
      "not_expressed",
      "ambiguous",
      "endorses_distractor"
    ],
    anchor_resolution_criteria: [
      "Apply the target mechanism to the active distractor and reject the distractor without requiring canonical wording."
    ],
    anchor_contradiction_criteria: [
      "An explicit distractor endorsement conflicts with conceptual reasoning that rejects the distractor.",
      "An explicit distractor rejection conflicts with conceptual reasoning that retains the distractor mechanism."
    ],
    ambiguity_resolution_policy:
      "Do not guess that an option label is a typo. Mixed or ambiguous anchor conclusions require clarification before progression.",
    contradiction_criteria: [
      ...legacy.contradiction_criteria,
      {
        contradiction_id:
          "anchor_conclusion_conceptual_explanation_conflict",
        description:
          "The observable anchor conclusion conflicts with the conceptual explanation.",
        observable_patterns: []
      }
    ]
  });
}

export function buildTargetEvidenceAdjudicationFromActivityPacketV3(input: {
  latest_student_message: string;
  packet: ActivityMisconceptionEvidencePacketV1;
  contract: TargetEvidenceContractV3;
  prior_anchor_resolution_status?: AnchorResolutionStatus | null;
}): TargetEvidenceAdjudicationV3 {
  const contract = TargetEvidenceContractV3Schema.parse(input.contract);
  const flags = input.packet.evidence_elicited;
  const update = input.packet.misconception_evidence_update;
  const responseKind = input.packet.student_activity_response.response_kind;
  const relationship = yes(flags.student_explained_target_boundary) ||
    yes(flags.student_reconstructed_concept_independently);
  const mechanism = yes(flags.student_repaired_reasoning_link) ||
    yes(flags.student_identified_hidden_assumption) ||
    (relationship && update.evidence_quality === "high");
  const conceptualPosition = conceptualPositionFromPacket(input.packet);
  const interpretation = classifyAnchorConclusion({
    contract,
    student_message: input.latest_student_message,
    conceptual_position: conceptualPosition,
    evidence_limitations: update.limitations,
    prior_anchor_resolution_status: input.prior_anchor_resolution_status
  });
  const resolutionStatus = conceptualPosition === "rejects_distractor";
  const contradictionStatus = conceptualPosition === "endorses_distractor";
  const coherentConclusion = resolutionStatus &&
    responseKind === "substantive";
  const criterionTruth = new Map<string, boolean>([
    ["target_conceptual_relationship", relationship],
    ["required_mechanism", mechanism],
    ["active_anchor_application",
      interpretation.anchor_application === "explicit"],
    ["coherent_conclusion", coherentConclusion]
  ]);
  return TargetEvidenceAdjudicationV3Schema.parse({
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V3,
    target_evidence_contract_version: contract.contract_version,
    criterion_results: contract.criteria.map((criterion) => {
      const satisfied = criterion.criterion_kind === "optional_deepening"
        ? false
        : criterionTruth.get(criterion.criterion_id) ?? false;
      return {
        criterion_id: criterion.criterion_id,
        satisfied,
        exact_evidence_spans: satisfied
          ? exactMessageSpan(criterion.criterion_id,
              input.latest_student_message)
          : [],
        confidence: update.confidence
      };
    }),
    contradiction_results: contract.contradiction_criteria.map(
      (criterion) => {
        const anchorConflict = criterion.contradiction_id ===
          "anchor_conclusion_conceptual_explanation_conflict" &&
          interpretation.contradictions.includes(criterion.contradiction_id);
        const activeDistractorRetained = criterion.contradiction_id ===
          "active_distractor_claim_retained" && contradictionStatus;
        const present = anchorConflict || activeDistractorRetained;
        return {
          contradiction_id: criterion.contradiction_id,
          present,
          exact_evidence_spans: present
            ? exactMessageSpan(criterion.contradiction_id,
                input.latest_student_message)
            : []
        };
      }
    ),
    evidence_quality: update.evidence_quality,
    coherent_conclusion: coherentConclusion,
    limitations: update.limitations,
    anchor_interpretation: interpretation
  });
}

export class TargetEvidenceConsistencyErrorV3 extends Error {
  readonly issue_codes: string[];

  constructor(issueCodes: string[]) {
    super(`target_evidence_profile_inconsistent_v3:${issueCodes.join("|")}`);
    this.name = "TargetEvidenceConsistencyErrorV3";
    this.issue_codes = issueCodes;
  }
}

export function mapTargetEvidenceAdjudicationToObservationV3(input: {
  contract: TargetEvidenceContractV3;
  adjudication: TargetEvidenceAdjudicationV3;
  interaction_intent: TurnEvidenceObservation["interaction_intent"];
  confidence_evidence?: "high" | "medium" | "low" | null;
}): TurnEvidenceObservationV3 {
  const contract = TargetEvidenceContractV3Schema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationV3Schema.parse(
    input.adjudication
  );
  const issues: string[] = [];
  const criteriaById = new Map(contract.criteria.map((criterion) => [
    criterion.criterion_id,
    criterion
  ]));
  const resultsById = new Map<string,
    typeof adjudication.criterion_results[number]>();
  for (const result of adjudication.criterion_results) {
    if (!criteriaById.has(result.criterion_id)) {
      issues.push(`unknown_criterion:${result.criterion_id}`);
    }
    if (resultsById.has(result.criterion_id)) {
      issues.push(`duplicate_criterion:${result.criterion_id}`);
    }
    if (result.satisfied && result.exact_evidence_spans.length === 0) {
      issues.push(`satisfied_criterion_without_span:${result.criterion_id}`);
    }
    resultsById.set(result.criterion_id, result);
  }
  for (const criterion of contract.criteria) {
    if (!resultsById.has(criterion.criterion_id)) {
      issues.push(`criterion_result_missing:${criterion.criterion_id}`);
    }
  }
  const contradictionIds = new Set(
    contract.contradiction_criteria.map((entry) => entry.contradiction_id)
  );
  for (const contradiction of adjudication.contradiction_results) {
    if (!contradictionIds.has(contradiction.contradiction_id)) {
      issues.push(`unknown_contradiction:${contradiction.contradiction_id}`);
    }
    if (contradiction.present &&
        contradiction.exact_evidence_spans.length === 0) {
      issues.push(
        `present_contradiction_without_span:${contradiction.contradiction_id}`
      );
    }
  }
  if (issues.length > 0) throw new TargetEvidenceConsistencyErrorV3(issues);

  const interpretation = adjudication.anchor_interpretation;
  if (input.interaction_intent !== "ordinary_conceptual_response") {
    return {
      interaction_intent: input.interaction_intent,
      reasoning_quality: "insufficient",
      anchor_application: "absent",
      anchor_stance: "not_expressed",
      anchor_consistency: "not_assessable",
      anchor_resolution_status: "unresolved",
      misconception_status: "uncertain",
      essential_missing_links: ["no_new_conceptual_evidence"],
      contradictions: [],
      observable_evidence_spans: [],
      confidence_evidence: input.confidence_evidence ?? null,
      evidence_limitations: unique([
        ...adjudication.limitations,
        "immediate_intent_route_has_priority"
      ]),
      anchor_conclusion_consistency_version:
        interpretation.interpretation_version,
      sound_gate_version: evaluateAnchorConsistentSoundGate({
        all_essential_conceptual_relationships_satisfied: false,
        required_mechanism_demonstrated: false,
        coherent_conclusion: false,
        essential_missing_links: ["no_new_conceptual_evidence"],
        contradictions: [],
        interpretation
      }).gate_version
    };
  }

  const satisfied = contract.criteria.filter((criterion) =>
    resultsById.get(criterion.criterion_id)?.satisfied
  );
  const essentialMissing = contract.criteria.filter((criterion) =>
    criterion.essential_for_revision &&
    !resultsById.get(criterion.criterion_id)?.satisfied
  ).map((entry) => entry.criterion_id);
  if (interpretation.anchor_stance !== contract.required_anchor_stance) {
    essentialMissing.push("required_anchor_rejection");
  }
  if (interpretation.anchor_consistency !==
      "consistent_with_conceptual_reasoning") {
    essentialMissing.push("anchor_conclusion_consistency");
  }
  if (interpretation.anchor_resolution_status !==
      "resolved_against_distractor") {
    essentialMissing.push("anchor_resolution_against_distractor");
  }
  const contradictions = adjudication.contradiction_results.filter(
    (entry) => entry.present
  ).map((entry) => entry.contradiction_id);
  const conceptualCriteria = contract.criteria.filter((criterion) =>
    criterion.criterion_kind === "conceptual_relationship"
  );
  const mechanismCriteria = contract.criteria.filter((criterion) =>
    criterion.criterion_kind === "required_mechanism"
  );
  const soundGate = evaluateAnchorConsistentSoundGate({
    all_essential_conceptual_relationships_satisfied:
      conceptualCriteria.length > 0 && conceptualCriteria.every((criterion) =>
        resultsById.get(criterion.criterion_id)?.satisfied
      ),
    required_mechanism_demonstrated:
      mechanismCriteria.length > 0 && mechanismCriteria.every((criterion) =>
        resultsById.get(criterion.criterion_id)?.satisfied
      ),
    coherent_conclusion: adjudication.coherent_conclusion,
    essential_missing_links: unique(essentialMissing),
    contradictions,
    interpretation
  });
  const reasoningQuality: TurnEvidenceObservation["reasoning_quality"] =
    soundGate.passed
      ? "sound"
      : interpretation.anchor_consistency ===
          "contradictory_to_conceptual_reasoning"
        ? "partial"
        : contradictions.length > 0
          ? "misconception"
          : satisfied.length > 0 ? "partial" : "insufficient";
  const spans = satisfied.flatMap((criterion) =>
    resultsById.get(criterion.criterion_id)?.exact_evidence_spans ?? []
  );
  return {
    interaction_intent: input.interaction_intent,
    reasoning_quality: reasoningQuality,
    anchor_application: interpretation.anchor_application,
    anchor_stance: interpretation.anchor_stance,
    anchor_consistency: interpretation.anchor_consistency,
    anchor_resolution_status: interpretation.anchor_resolution_status,
    misconception_status: soundGate.passed
      ? "resolved_for_current_anchor"
      : contradictions.includes("active_distractor_claim_retained")
        ? "persists" : "uncertain",
    essential_missing_links: unique(essentialMissing),
    contradictions: unique(contradictions),
    observable_evidence_spans: spans,
    confidence_evidence: input.confidence_evidence ?? null,
    evidence_limitations: unique([
      ...contract.evidence_limitations,
      ...adjudication.limitations,
      ...contract.optional_deepening_criteria.filter((criterionId) =>
        !resultsById.get(criterionId)?.satisfied
      ).map((criterionId) => `optional_deepening_missing:${criterionId}`)
    ]),
    anchor_conclusion_consistency_version:
      interpretation.interpretation_version,
    sound_gate_version: soundGate.gate_version
  };
}

export function assertTargetEvidenceObservationConsistentV3(input: {
  contract: TargetEvidenceContractV3;
  adjudication: TargetEvidenceAdjudicationV3;
  observation: TurnEvidenceObservationV3;
}) {
  const satisfied = new Set(input.adjudication.criterion_results
    .filter((entry) => entry.satisfied)
    .map((entry) => entry.criterion_id));
  const issues = input.observation.essential_missing_links.filter((entry) =>
    satisfied.has(entry)
  ).map((entry) => `criterion_satisfied_and_missing:${entry}`);
  const interpretation = input.adjudication.anchor_interpretation;
  if (interpretation.anchor_application === "explicit" &&
      input.observation.anchor_application !== "explicit") {
    issues.push("explicit_anchor_evidence_not_mapped_explicit");
  }
  if (interpretation.blocking_limitations.length > 0 &&
      !input.observation.contradictions.includes(
        "anchor_conclusion_conceptual_explanation_conflict"
      )) {
    issues.push("blocking_anchor_conflict_not_promoted");
  }
  if (input.observation.reasoning_quality === "sound" && (
    input.observation.essential_missing_links.length > 0 ||
    input.observation.contradictions.length > 0 ||
    input.observation.anchor_application !== "explicit" ||
    input.observation.anchor_stance !== "rejects_distractor" ||
    input.observation.anchor_consistency !==
      "consistent_with_conceptual_reasoning" ||
    input.observation.anchor_resolution_status !==
      "resolved_against_distractor"
  )) issues.push("sound_profile_has_blocking_anchor_condition");
  if (issues.length > 0) throw new TargetEvidenceConsistencyErrorV3(issues);
  return {
    policy_version: PROFILE_CONSISTENCY_POLICY_VERSION_V3,
    passed: true,
    satisfied_criteria: [...satisfied],
    essential_missing_links: input.observation.essential_missing_links,
    contradictions: input.observation.contradictions,
    anchor_application: input.observation.anchor_application,
    anchor_stance: input.observation.anchor_stance,
    anchor_consistency: input.observation.anchor_consistency,
    anchor_resolution_status: input.observation.anchor_resolution_status,
    optional_deepening_blocks_revision: false
  };
}
