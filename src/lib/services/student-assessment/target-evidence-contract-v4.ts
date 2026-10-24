import { z } from "zod";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION,
  AnchorContradictionPropagationResultSchema,
  EvaluatorAnchorObservationV4Schema,
  assertBlockingAnchorConflictPropagated,
  type StructuredAnchorContradiction
} from "@/lib/services/student-assessment/anchor-contradiction-propagation";
import type {
  TurnEvidenceObservation
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  TargetEvidenceAdjudicationV3Schema,
  TargetEvidenceContractV3Schema,
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

function v3Contract(contract: TargetEvidenceContractV4) {
  return TargetEvidenceContractV3Schema.parse({
    ...contract,
    contract_version: "target-evidence-contract-v2"
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
