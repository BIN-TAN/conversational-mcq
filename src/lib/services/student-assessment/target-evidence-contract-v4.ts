import { z } from "zod";
import type {
  ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION,
  AnchorContradictionPropagationResultSchema,
  EvaluatorAnchorObservationV4Schema,
  assertBlockingAnchorConflictPropagated,
  propagateAnchorContradiction,
  type StructuredAnchorContradiction
} from "@/lib/services/student-assessment/anchor-contradiction-propagation";
import type {
  AnchorResolutionStatus,
  ConceptualPosition
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import type {
  TurnEvidenceObservation
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  TargetEvidenceAdjudicationV3Schema,
  TargetEvidenceContractV3Schema,
  buildActivityTargetEvidenceContractV3,
  buildTargetEvidenceAdjudicationFromActivityPacketV3,
  mapTargetEvidenceAdjudicationToObservationV3,
  type TurnEvidenceObservationV3
} from "@/lib/services/student-assessment/target-evidence-contract-v3";

export const TARGET_EVIDENCE_CONTRACT_VERSION_V4 =
  "target-evidence-contract-v3" as const;
export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4 =
  "production-turn-evidence-evaluator-v4" as const;
export const TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V4 =
  "turn-evidence-profile-mapper-v4" as const;
export const PROFILE_CONSISTENCY_POLICY_VERSION_V4 =
  "turn-evidence-profile-consistency-v4" as const;

export const TargetEvidenceContractV4Schema = TargetEvidenceContractV3Schema
  .omit({ contract_version: true })
  .extend({
    contract_version: z.literal(TARGET_EVIDENCE_CONTRACT_VERSION_V4)
  }).strict();
export type TargetEvidenceContractV4 = z.infer<
  typeof TargetEvidenceContractV4Schema
>;

export const TargetEvidenceAdjudicationV4Schema =
  TargetEvidenceAdjudicationV3Schema.omit({
    evaluator_version: true,
    target_evidence_contract_version: true,
    anchor_interpretation: true
  }).extend({
    evaluator_version: z.literal(
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4
    ),
    target_evidence_contract_version: z.literal(
      TARGET_EVIDENCE_CONTRACT_VERSION_V4
    ),
    anchor_observation: EvaluatorAnchorObservationV4Schema,
    anchor_propagation: AnchorContradictionPropagationResultSchema
  }).strict();
export type TargetEvidenceAdjudicationV4 = z.infer<
  typeof TargetEvidenceAdjudicationV4Schema
>;

export type TurnEvidenceObservationV4 = TurnEvidenceObservationV3 & {
  structured_contradictions: StructuredAnchorContradiction[];
  contradiction_propagation_version:
    typeof ANCHOR_CONTRADICTION_PROPAGATION_VERSION;
};

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function exactMatches(message: string, patterns: RegExp[]) {
  return patterns.flatMap((pattern) => [...message.matchAll(pattern)].map(
    (match) => ({ index: match.index ?? 0, span: match[0].trim() })
  )).sort((left, right) => left.index - right.index);
}

function conceptualPositionFromPacketV4(input: {
  packet: ActivityMisconceptionEvidencePacketV1;
  observed_stance: "not_expressed" | "ambiguous" |
    "endorses_distractor" | "rejects_distractor";
}) : ConceptualPosition {
  const packet = input.packet;
  const narrative = [
    packet.student_activity_response.student_response_text_redacted_or_safe_summary,
    packet.misconception_evidence_update.safe_internal_rationale,
    ...packet.misconception_evidence_update.limitations
  ].join(" ").toLocaleLowerCase("en-CA");
  const conflictRecognized = /\b(?:conflict(?:s|ed|ing)?|contradict(?:s|ed|ing|ory)?|inconsisten\w*|despite|does not align|did not align)\b/u
    .test(narrative);
  if (conflictRecognized && input.observed_stance === "endorses_distractor") {
    return "rejects_distractor";
  }
  if (conflictRecognized && input.observed_stance === "rejects_distractor") {
    return "endorses_distractor";
  }
  const status = packet.misconception_evidence_update.status;
  if ([
    "misconception_unsupported",
    "boundary_understanding_improved",
    "independent_evidence_supported",
    "no_actionable_misconception_evidence"
  ].includes(status)) return "rejects_distractor";
  if ([
    "misconception_persisted",
    "conceptual_entry_gap_remains"
  ].includes(status)) return "endorses_distractor";
  return "ambiguous";
}

function normalizeAnchorObservationV4(input: {
  latest_student_message: string;
  packet: ActivityMisconceptionEvidencePacketV1;
  contract: TargetEvidenceContractV4;
}) {
  const message = input.latest_student_message.trim();
  const option = escapeRegex(input.contract.distractor_option);
  const referencePatterns = [
    new RegExp(`\\boption\\s+${option}\\b`, "giu"),
    new RegExp(`\\bchoice\\s+${option}\\b`, "giu"),
    /\b(?:that|this)\s+(?:option|choice|claim|statement|distractor)\b/giu
  ];
  const endorsementPatterns = [
    new RegExp(`\\b(?:option\\s+)?${option}\\s+(?:is|was|seems|looks|remains|as)?\\s*(?:appropriate|apropriate|correct|right|valid|reasonable|acceptable|best)\\b`, "giu"),
    new RegExp(`\\b(?:that|this|it)\\s+(?:makes?|made)\\s+(?:option\\s+)?${option}\\s+(?:seem\\s+)?(?:appropriate|apropriate|correct|right|valid|reasonable|acceptable)\\b`, "giu"),
    new RegExp(`\\b(?:choose|chose|select|selected|accept|accepted|prefer|preferred)\\s+(?:option\\s+)?${option}\\b`, "giu")
  ];
  const rejectionPatterns = [
    new RegExp(`\\b(?:option\\s+)?${option}\\s+(?:is|was|seems|looks|remains)?\\s*(?:wrong|incorrect|inappropriate|invalid|unsupported|not (?:appropriate|correct|right|valid))\\b`, "giu"),
    new RegExp(`\\b(?:reject|rejected|rejecting)\\s+(?:option\\s+)?${option}\\b`, "giu"),
    new RegExp(`\\b(?:do not|don't|would not|wouldn't|should not|shouldn't)\\s+(?:choose|select|accept)\\s+(?:option\\s+)?${option}\\b`, "giu"),
    new RegExp(`\\b(?:revise|rewrite|correct|fix)\\s+(?:option\\s+)?${option}\\b`, "giu"),
    new RegExp(`\\b(?:option\\s+)?${option}\\b[\\s,;:\\-]{0,4}(?:i\\s+)?(?:would|will|should)?\\s*(?:revise|rewrite|correct|fix)\\s+it\\b`, "giu"),
    /\b(?:that|this)\s+(?:claim|choice|statement|option)\s+(?:is|was)?\s*(?:wrong|incorrect|inappropriate|invalid|unsupported|does not fit)\b/giu
  ];
  const references = exactMatches(message, referencePatterns);
  const endorsements = exactMatches(message, endorsementPatterns);
  const rejections = exactMatches(message, rejectionPatterns);
  const correction = /\b(?:actually|rather|i mean|correction|on second thought)\b/iu
    .test(message);
  const uncertain = /\b(?:maybe|perhaps|not sure|uncertain|might|i think)\b/iu
    .test(message);
  let stance: "not_expressed" | "ambiguous" |
    "endorses_distractor" | "rejects_distractor" = "not_expressed";
  if (endorsements.length > 0 && rejections.length > 0) {
    const lastEndorsement = endorsements.at(-1)!.index;
    const lastRejection = rejections.at(-1)!.index;
    stance = correction
      ? lastRejection > lastEndorsement
        ? "rejects_distractor" : "endorses_distractor"
      : "ambiguous";
  } else if (endorsements.length > 0) {
    stance = uncertain ? "ambiguous" : "endorses_distractor";
  } else if (rejections.length > 0) {
    stance = uncertain ? "ambiguous" : "rejects_distractor";
  } else if (references.length > 0) {
    stance = "ambiguous";
  }
  const quotedRejection = /["“][^"”]*option\s+[a-z][^"”]*["”][^.!?]{0,180}\b(?:that|this)\s+(?:claim|choice|statement)\s+(?:is|was)?\s*(?:wrong|incorrect|unsupported)\b/iu
    .test(message);
  if (quotedRejection) stance = "rejects_distractor";
  // Hedging after a complete conclusion lowers confidence, but does not erase
  // the observable stance. This preserves "option B ... I think" as an
  // endorsement while still allowing explicit uncertainty to remain ambiguous.
  if (/\bi think\b/iu.test(message) &&
      !/\b(?:not sure|uncertain|maybe|perhaps)\b/iu.test(message)) {
    if (endorsements.length > 0 && rejections.length === 0) {
      stance = "endorses_distractor";
    }
    if (rejections.length > 0 && endorsements.length === 0) {
      stance = "rejects_distractor";
    }
  }

  const conceptualConclusion = conceptualPositionFromPacketV4({
    packet: input.packet,
    observed_stance: stance
  });
  const alignment = stance === "ambiguous" ||
      conceptualConclusion === "ambiguous"
    ? "unresolved" as const
    : stance === "not_expressed" || conceptualConclusion === "not_assessable"
      ? "not_assessable" as const
      : stance === conceptualConclusion
        ? "aligned" as const
        : "contradictory" as const;
  const blocking = alignment === "contradictory";
  const stanceMatches = stance === "endorses_distractor"
    ? endorsements
    : stance === "rejects_distractor" ? rejections : [];
  const hasConceptualEvidence = input.packet.evidence_elicited.elicited &&
    input.packet.evidence_elicited.types.some((type) => type !== "none");
  const spans = [
    ...references.map((entry) => ({
      label: "anchor_reference" as const,
      span: entry.span.slice(0, 900)
    })),
    ...stanceMatches.map((entry) => ({
      label: "anchor_stance" as const,
      span: entry.span.slice(0, 900)
    })),
    ...(hasConceptualEvidence ? [{
      label: "conceptual_explanation" as const,
      span: message.slice(0, 900)
    }] : [])
  ];
  return EvaluatorAnchorObservationV4Schema.parse({
    observation_version: "production-turn-anchor-observation-v4",
    active_anchor_id: input.contract.active_anchor_id,
    observed_anchor_application: references.length > 0
      ? "explicit" : stanceMatches.length > 0 ? "implicit" : "absent",
    observed_anchor_stance: stance,
    conceptual_conclusion: conceptualConclusion,
    anchor_concept_alignment: alignment,
    anchor_conflict_type: blocking
      ? "anchor_conclusion_conceptual_explanation_conflict" : null,
    blocking_conflict: blocking,
    exact_supporting_spans: unique(spans.map((entry) =>
      JSON.stringify(entry)
    )).map((entry) => JSON.parse(entry) as { label: string; span: string }),
    evidence_source: "deterministic_v4_normalization"
  });
}

function v3Contract(contract: TargetEvidenceContractV4) {
  return TargetEvidenceContractV3Schema.parse({
    ...contract,
    contract_version: "target-evidence-contract-v2"
  });
}

export function buildActivityTargetEvidenceContractV4(input: {
  concept_id: string;
  item_id: string;
  distractor_option: string;
  distractor_claim: string;
  packet: ActivityMisconceptionEvidencePacketV1;
}): TargetEvidenceContractV4 {
  const legacy = buildActivityTargetEvidenceContractV3(input);
  return TargetEvidenceContractV4Schema.parse({
    ...legacy,
    contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V4
  });
}

export function buildTargetEvidenceAdjudicationFromActivityPacketV4(input: {
  latest_student_message: string;
  packet: ActivityMisconceptionEvidencePacketV1;
  contract: TargetEvidenceContractV4;
  prior_anchor_resolution_status?: AnchorResolutionStatus | null;
}) {
  const contract = TargetEvidenceContractV4Schema.parse(input.contract);
  const base = buildTargetEvidenceAdjudicationFromActivityPacketV3({
    latest_student_message: input.latest_student_message,
    packet: input.packet,
    contract: v3Contract(contract),
    prior_anchor_resolution_status: input.prior_anchor_resolution_status
  });
  const observation = normalizeAnchorObservationV4(input);
  const propagation = propagateAnchorContradiction({
    contract,
    evaluator_observation: observation,
    source_evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V4
  });
  assertBlockingAnchorConflictPropagated(propagation);
  const { anchor_interpretation: _legacyAnchorInterpretation, ...baseV4 } =
    base;
  void _legacyAnchorInterpretation;
  return TargetEvidenceAdjudicationV4Schema.parse({
    ...baseV4,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
    target_evidence_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V4,
    contradiction_results: contract.contradiction_criteria.map((criterion) => {
      const propagated = propagation.structured_contradictions.some((entry) =>
        entry.contradiction_type === criterion.contradiction_id
      );
      const prior = base.contradiction_results.find((entry) =>
        entry.contradiction_id === criterion.contradiction_id
      );
      return {
        contradiction_id: criterion.contradiction_id,
        present: propagated || prior?.present === true,
        exact_evidence_spans: propagated
          ? observation.exact_supporting_spans
          : prior?.exact_evidence_spans ?? []
      };
    }),
    coherent_conclusion: base.coherent_conclusion && !propagation.blocking,
    anchor_observation: observation,
    anchor_propagation: propagation
  });
}

export function mapTargetEvidenceAdjudicationToObservationV4(input: {
  contract: TargetEvidenceContractV4;
  adjudication: TargetEvidenceAdjudicationV4;
  interaction_intent: TurnEvidenceObservation["interaction_intent"];
  confidence_evidence?: "high" | "medium" | "low" | null;
}): TurnEvidenceObservationV4 {
  const contract = TargetEvidenceContractV4Schema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationV4Schema.parse(
    input.adjudication
  );
  const propagation = assertBlockingAnchorConflictPropagated(
    adjudication.anchor_propagation
  );
  const {
    anchor_observation: _anchorObservation,
    anchor_propagation: _anchorPropagation,
    ...legacyAdjudication
  } = adjudication;
  void _anchorObservation;
  void _anchorPropagation;
  const base = mapTargetEvidenceAdjudicationToObservationV3({
    contract: v3Contract(contract),
    adjudication: TargetEvidenceAdjudicationV3Schema.parse({
      ...legacyAdjudication,
      evaluator_version: "production-turn-evidence-evaluator-v3",
      target_evidence_contract_version: "target-evidence-contract-v2",
      anchor_interpretation: propagation.anchor_interpretation
    }),
    interaction_intent: input.interaction_intent,
    confidence_evidence: input.confidence_evidence
  });
  if (input.interaction_intent !== "ordinary_conceptual_response") {
    return {
      ...base,
      structured_contradictions: [],
      contradiction_propagation_version:
        ANCHOR_CONTRADICTION_PROPAGATION_VERSION
    };
  }
  const contradictionIds = propagation.structured_contradictions.map(
    (entry) => entry.contradiction_type
  );
  return {
    ...base,
    reasoning_quality: propagation.blocking ? "partial" : base.reasoning_quality,
    anchor_application: propagation.anchor_application,
    anchor_stance: propagation.anchor_stance,
    anchor_consistency: propagation.anchor_consistency,
    anchor_resolution_status: propagation.anchor_resolution_status,
    misconception_status: propagation.blocking
      ? "uncertain" : base.misconception_status,
    essential_missing_links: unique([
      ...base.essential_missing_links,
      ...(propagation.blocking ? [
        "anchor_conclusion_consistency",
        "anchor_resolution_against_distractor"
      ] : [])
    ]),
    contradictions: unique([...base.contradictions, ...contradictionIds]),
    observable_evidence_spans: unique([
      ...base.observable_evidence_spans,
      ...adjudication.anchor_observation.exact_supporting_spans
    ].map((entry) => JSON.stringify(entry))).map((entry) =>
      JSON.parse(entry) as { label: string; span: string }
    ),
    structured_contradictions:
      propagation.structured_contradictions,
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION
  };
}

export class TargetEvidenceConsistencyErrorV4 extends Error {
  readonly issue_codes: string[];

  constructor(issueCodes: string[]) {
    super(`target_evidence_profile_inconsistent_v4:${issueCodes.join("|")}`);
    this.name = "TargetEvidenceConsistencyErrorV4";
    this.issue_codes = issueCodes;
  }
}

export function assertTargetEvidenceObservationConsistentV4(input: {
  contract: TargetEvidenceContractV4;
  adjudication: TargetEvidenceAdjudicationV4;
  observation: TurnEvidenceObservationV4;
}) {
  const contract = TargetEvidenceContractV4Schema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationV4Schema.parse(
    input.adjudication
  );
  const propagation = assertBlockingAnchorConflictPropagated(
    adjudication.anchor_propagation
  );
  const issues: string[] = [];
  if (propagation.blocking) {
    if (input.observation.structured_contradictions.length === 0) {
      issues.push("blocking_anchor_conflict_not_structured");
    }
    if (!input.observation.contradictions.includes(
      "anchor_conclusion_conceptual_explanation_conflict"
    )) issues.push("blocking_anchor_conflict_not_promoted");
    if (input.observation.reasoning_quality === "sound") {
      issues.push("blocking_anchor_conflict_marked_sound");
    }
    if (input.observation.anchor_consistency ===
        "consistent_with_conceptual_reasoning") {
      issues.push("blocking_anchor_conflict_marked_consistent");
    }
    if (input.observation.anchor_resolution_status ===
        "resolved_against_distractor") {
      issues.push("blocking_anchor_conflict_marked_resolved");
    }
  }
  if (adjudication.anchor_observation.observed_anchor_application ===
      "explicit" && input.observation.anchor_application !== "explicit") {
    issues.push("explicit_anchor_reference_lost");
  }
  if (input.observation.reasoning_quality === "sound" && (
    input.observation.anchor_application !== "explicit" ||
    input.observation.anchor_stance !== contract.required_anchor_stance ||
    input.observation.anchor_consistency !==
      "consistent_with_conceptual_reasoning" ||
    input.observation.anchor_resolution_status !==
      "resolved_against_distractor" ||
    input.observation.contradictions.length > 0 ||
    input.observation.essential_missing_links.length > 0
  )) issues.push("sound_profile_has_blocking_condition");
  if (issues.length > 0) throw new TargetEvidenceConsistencyErrorV4(issues);
  return {
    policy_version: PROFILE_CONSISTENCY_POLICY_VERSION_V4,
    passed: true as const,
    blocking_conflict: propagation.blocking,
    structured_contradiction_count:
      input.observation.structured_contradictions.length,
    anchor_application: input.observation.anchor_application,
    anchor_stance: input.observation.anchor_stance,
    anchor_consistency: input.observation.anchor_consistency,
    anchor_resolution_status: input.observation.anchor_resolution_status,
    contradictions: input.observation.contradictions
  };
}
