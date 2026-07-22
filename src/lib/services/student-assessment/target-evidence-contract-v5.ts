import { z } from "zod";
import type {
  ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  buildActiveAnchorAliasContract,
  resolveActiveAnchorAlias,
  ActiveAnchorAliasContractSchema
} from "@/lib/services/student-assessment/active-anchor-alias-resolution";
import {
  ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
  AnchorContradictionPropagationResultV2Schema,
  assertBlockingAnchorConflictPropagatedV2,
  propagateAnchorContradictionV2,
  type AnchorContradictionPropagationResultV2
} from "@/lib/services/student-assessment/anchor-contradiction-propagation-v2";
import type {
  AnchorResolutionStatus
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import {
  isBlockingAnchorConflictLimitation
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  ProductionTurnEvidenceStructuredFieldsV5Schema,
  type ProductionTurnEvidenceStructuredFieldsV5
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
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

export const TARGET_EVIDENCE_CONTRACT_VERSION_V5 =
  "target-evidence-contract-v4" as const;
export const TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V5 =
  "turn-evidence-profile-mapper-v5" as const;
export const PROFILE_CONSISTENCY_POLICY_VERSION_V5 =
  "turn-evidence-profile-consistency-v5" as const;
export const TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6 =
  "turn-evidence-profile-mapper-v6" as const;
export const PROFILE_CONSISTENCY_POLICY_VERSION_V6 =
  "turn-evidence-profile-consistency-v6" as const;

export const TargetEvidenceContractV5Schema = TargetEvidenceContractV3Schema
  .omit({ contract_version: true })
  .extend({
    contract_version: z.literal(TARGET_EVIDENCE_CONTRACT_VERSION_V5),
    active_anchor_alias_contract: ActiveAnchorAliasContractSchema
  }).strict();
export type TargetEvidenceContractV5 = z.infer<
  typeof TargetEvidenceContractV5Schema
>;

export const TargetEvidenceAdjudicationV5Schema =
  TargetEvidenceAdjudicationV3Schema.omit({
    evaluator_version: true,
    target_evidence_contract_version: true,
    anchor_interpretation: true
  }).extend({
    evaluator_version: z.literal(PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5),
    target_evidence_contract_version: z.literal(
      TARGET_EVIDENCE_CONTRACT_VERSION_V5
    ),
    structured_turn_evidence: ProductionTurnEvidenceStructuredFieldsV5Schema,
    anchor_alias_resolution: z.object({
      resolver_version: z.literal("active-anchor-alias-resolution-v1"),
      active_anchor_id: z.string().min(1),
      observed_anchor_reference: z.enum(["explicit", "absent"]),
      observed_anchor_identifier: z.string().min(1).nullable(),
      observed_anchor_text: z.string().min(1).nullable(),
      observed_anchor_conclusion: z.enum([
        "endorses_distractor", "rejects_distractor", "ambiguous",
        "not_expressed"
      ]),
      observed_anchor_stance: z.enum([
        "endorses_distractor", "rejects_distractor", "ambiguous",
        "not_expressed"
      ]),
      anchor_aliases_detected: z.array(z.string().min(1)).max(24),
      exact_anchor_evidence_spans: z.array(z.object({
        label: z.literal("anchor_reference"),
        span: z.string().min(1).max(900),
        start_index: z.number().int().nonnegative()
      }).strict()).max(24),
      exact_stance_evidence_spans: z.array(z.object({
        label: z.literal("anchor_stance"),
        span: z.string().min(1).max(900),
        start_index: z.number().int().nonnegative()
      }).strict()).max(24),
      ambiguous_due_to_multiple_stances: z.boolean(),
      direct_reference_mapped_absent: z.boolean()
    }).strict(),
    anchor_propagation: AnchorContradictionPropagationResultV2Schema
  }).strict();
export type TargetEvidenceAdjudicationV5 = z.infer<
  typeof TargetEvidenceAdjudicationV5Schema
>;

export type TurnEvidenceObservationV5 = TurnEvidenceObservationV3 & {
  structured_contradictions:
    AnchorContradictionPropagationResultV2["structured_contradictions"];
  contradiction_propagation_version:
    typeof ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2;
};

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function v3Contract(contract: TargetEvidenceContractV5) {
  const { active_anchor_alias_contract: _aliases, ...rest } = contract;
  void _aliases;
  return TargetEvidenceContractV3Schema.parse({
    ...rest,
    contract_version: "target-evidence-contract-v2"
  });
}

export function buildActivityTargetEvidenceContractV5(input: {
  concept_id: string;
  item_id: string;
  distractor_option: string;
  distractor_claim: string;
  packet: ActivityMisconceptionEvidencePacketV1;
}) {
  const legacy = buildActivityTargetEvidenceContractV3(input);
  return TargetEvidenceContractV5Schema.parse({
    ...legacy,
    contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    active_anchor_alias_contract: buildActiveAnchorAliasContract({
      active_anchor_id: legacy.active_anchor_id,
      option_label: input.distractor_option,
      option_text: input.distractor_claim,
      accepted_paraphrases: legacy.acceptable_anchor_paraphrases
    })
  });
}

export class TargetEvidenceEvaluatorParityErrorV5 extends Error {
  readonly issue_codes: string[];
  constructor(issueCodes: string[]) {
    super(`target_evidence_evaluator_parity_v5_failed:${issueCodes.join("|")}`);
    this.name = "TargetEvidenceEvaluatorParityErrorV5";
    this.issue_codes = issueCodes;
  }
}

export function buildTargetEvidenceAdjudicationFromEvaluatorOutputV5(input: {
  latest_student_message: string;
  packet: ActivityMisconceptionEvidencePacketV1;
  structured_turn_evidence: ProductionTurnEvidenceStructuredFieldsV5;
  contract: TargetEvidenceContractV5;
  expected_source_student_turn_id: string;
  expected_source_sequence_index: number;
  prior_visible_message?: string | null;
  prior_anchor_resolution_status?: AnchorResolutionStatus | null;
}) {
  const contract = TargetEvidenceContractV5Schema.parse(input.contract);
  const structured = ProductionTurnEvidenceStructuredFieldsV5Schema.parse(
    input.structured_turn_evidence
  );
  const base = buildTargetEvidenceAdjudicationFromActivityPacketV3({
    latest_student_message: input.latest_student_message,
    packet: input.packet,
    contract: v3Contract(contract),
    prior_anchor_resolution_status: input.prior_anchor_resolution_status
  });
  const {
    anchor_interpretation: _legacyAnchorInterpretation,
    ...baseWithoutLegacyAnchorInterpretation
  } = base;
  void _legacyAnchorInterpretation;
  const aliases = resolveActiveAnchorAlias({
    message: input.latest_student_message,
    contract: contract.active_anchor_alias_contract,
    prior_visible_message: input.prior_visible_message
  });
  const parityIssues: string[] = [];
  if (aliases.observed_anchor_reference !== structured.observed_anchor_reference) {
    parityIssues.push("explicit_anchor_not_detected");
  }
  if (aliases.observed_anchor_stance !== structured.observed_anchor_stance) {
    parityIssues.push("anchor_stance_not_detected");
  }
  if (aliases.active_anchor_id !== structured.active_anchor_id) {
    parityIssues.push("active_anchor_id_mismatch");
  }
  if (structured.source_student_turn_id !==
      input.expected_source_student_turn_id) {
    parityIssues.push("cross_artifact_source_student_turn_disagreement");
  }
  if (structured.source_sequence_index !==
      input.expected_source_sequence_index) {
    parityIssues.push("cross_artifact_source_sequence_disagreement");
  }
  if (input.packet.misconception_evidence_update.limitations.some(
    isBlockingAnchorConflictLimitation
  ) && !structured.blocking_conflict) {
    parityIssues.push("contradiction_not_structured");
  }
  if (parityIssues.length > 0) {
    throw new TargetEvidenceEvaluatorParityErrorV5(parityIssues);
  }
  const exactAnchorSpans = [
    ...aliases.exact_anchor_evidence_spans.map((entry) => ({
      label: entry.label,
      span: entry.span
    })),
    ...aliases.exact_stance_evidence_spans.map((entry) => ({
      label: entry.label,
      span: entry.span
    }))
  ];
  const criterionResults = base.criterion_results.map((criterion) => {
    if (criterion.criterion_id !== "active_anchor_application") {
      return criterion;
    }
    const satisfied = aliases.observed_anchor_reference === "explicit";
    return {
      ...criterion,
      satisfied,
      exact_evidence_spans: satisfied ? exactAnchorSpans : []
    };
  });
  const propagation = propagateAnchorContradictionV2({
    contract,
    structured_evidence: structured,
    anchor_application: aliases.observed_anchor_reference === "explicit"
      ? "explicit" : "absent",
    anchor_stance: aliases.observed_anchor_stance,
    exact_anchor_spans: exactAnchorSpans,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V5
  });
  assertBlockingAnchorConflictPropagatedV2(propagation);
  return TargetEvidenceAdjudicationV5Schema.parse({
    ...baseWithoutLegacyAnchorInterpretation,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    target_evidence_contract_version: TARGET_EVIDENCE_CONTRACT_VERSION_V5,
    criterion_results: criterionResults,
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
          ? [
              ...structured.exact_anchor_evidence_spans,
              ...structured.exact_conceptual_evidence_spans
            ].map((entry) => ({ label: entry.label, span: entry.span }))
          : prior?.exact_evidence_spans ?? []
      };
    }),
    coherent_conclusion: base.coherent_conclusion && !propagation.blocking,
    structured_turn_evidence: structured,
    anchor_alias_resolution: aliases,
    anchor_propagation: propagation
  });
}

export function mapTargetEvidenceAdjudicationToObservationV5(input: {
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
  interaction_intent: TurnEvidenceObservation["interaction_intent"];
  confidence_evidence?: "high" | "medium" | "low" | null;
}): TurnEvidenceObservationV5 {
  const contract = TargetEvidenceContractV5Schema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationV5Schema.parse(
    input.adjudication
  );
  const propagation = assertBlockingAnchorConflictPropagatedV2(
    adjudication.anchor_propagation
  );
  const {
    structured_turn_evidence: _structuredTurnEvidence,
    anchor_alias_resolution: _anchorAliasResolution,
    anchor_propagation: _anchorPropagation,
    ...legacyAdjudication
  } = adjudication;
  void _structuredTurnEvidence;
  void _anchorAliasResolution;
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
        ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2
    };
  }
  const structuredIds = propagation.structured_contradictions.map((entry) =>
    entry.contradiction_type
  );
  return {
    ...base,
    reasoning_quality: propagation.blocking && base.reasoning_quality === "sound"
      ? "partial" : base.reasoning_quality,
    anchor_application: propagation.anchor_application,
    anchor_stance: propagation.anchor_stance,
    anchor_consistency: propagation.anchor_consistency,
    anchor_resolution_status: propagation.anchor_resolution_status,
    misconception_status: propagation.blocking ? "uncertain" :
      base.misconception_status,
    essential_missing_links: unique([
      ...base.essential_missing_links,
      ...adjudication.structured_turn_evidence.essential_missing_links,
      ...(propagation.blocking ? [
        "anchor_conclusion_consistency",
        "anchor_resolution_against_distractor"
      ] : [])
    ]),
    contradictions: unique([...base.contradictions, ...structuredIds]),
    observable_evidence_spans: unique([
      ...base.observable_evidence_spans,
      ...adjudication.structured_turn_evidence.exact_anchor_evidence_spans,
      ...adjudication.structured_turn_evidence.exact_conceptual_evidence_spans
    ].map((entry) => JSON.stringify(entry))).map((entry) =>
      JSON.parse(entry) as { label: string; span: string }
    ),
    evidence_limitations: unique([
      ...base.evidence_limitations,
      ...adjudication.structured_turn_evidence.evidence_limitations
    ]),
    structured_contradictions: propagation.structured_contradictions,
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2
  };
}

export class TargetEvidenceConsistencyErrorV5 extends Error {
  readonly issue_codes: string[];
  constructor(issueCodes: string[]) {
    super(`target_evidence_profile_inconsistent_v5:${issueCodes.join("|")}`);
    this.name = "TargetEvidenceConsistencyErrorV5";
    this.issue_codes = issueCodes;
  }
}

export function assertTargetEvidenceObservationConsistentV5(input: {
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
  observation: TurnEvidenceObservationV5;
}) {
  const contract = TargetEvidenceContractV5Schema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationV5Schema.parse(
    input.adjudication
  );
  const propagation = assertBlockingAnchorConflictPropagatedV2(
    adjudication.anchor_propagation
  );
  const issues: string[] = [];
  if (adjudication.anchor_alias_resolution.direct_reference_mapped_absent) {
    issues.push("explicit_anchor_not_detected");
  }
  if (input.observation.anchor_application !== propagation.anchor_application) {
    issues.push("cross_artifact_anchor_application_disagreement");
  }
  if (input.observation.anchor_stance !== propagation.anchor_stance) {
    issues.push("cross_artifact_anchor_stance_disagreement");
  }
  if (input.observation.anchor_consistency !== propagation.anchor_consistency) {
    issues.push("cross_artifact_anchor_consistency_disagreement");
  }
  if (input.observation.anchor_resolution_status !==
      propagation.anchor_resolution_status) {
    issues.push("cross_artifact_resolution_status_disagreement");
  }
  if (propagation.blocking && (
    input.observation.structured_contradictions.length === 0 ||
    input.observation.reasoning_quality === "sound" ||
    input.observation.anchor_resolution_status !== "contradictory"
  )) issues.push("blocking_conflict_not_structured");
  if (input.observation.reasoning_quality === "sound" && (
    input.observation.anchor_application !== "explicit" ||
    input.observation.anchor_stance !== contract.required_anchor_stance ||
    input.observation.anchor_consistency !==
      "consistent_with_conceptual_reasoning" ||
    input.observation.anchor_resolution_status !==
      "resolved_against_distractor" ||
    input.observation.contradictions.length > 0 ||
    input.observation.essential_missing_links.length > 0
  )) issues.push("false_sound");
  const revisionReadiness = input.observation.reasoning_quality === "sound" &&
    input.observation.essential_missing_links.length === 0 &&
    input.observation.contradictions.length === 0;
  if (issues.length > 0) throw new TargetEvidenceConsistencyErrorV5(issues);
  return {
    policy_version: PROFILE_CONSISTENCY_POLICY_VERSION_V5,
    passed: true as const,
    evaluator_version: adjudication.evaluator_version,
    anchor_application: input.observation.anchor_application,
    anchor_stance: input.observation.anchor_stance,
    anchor_consistency: input.observation.anchor_consistency,
    anchor_resolution_status: input.observation.anchor_resolution_status,
    contradictions: input.observation.contradictions,
    structured_contradiction_count:
      input.observation.structured_contradictions.length,
    reasoning_quality: input.observation.reasoning_quality,
    revision_readiness: revisionReadiness
  };
}

/**
 * V6 keeps evaluator V5 intact while separating immediate intent from the
 * conceptual observation. The platform can therefore retain valid conceptual
 * evidence in mixed-intent turns and represent pure non-conceptual turns as
 * non-assessable without comparing them to a different semantic layer.
 */
export function mapTargetEvidenceAdjudicationToObservationV6(input: {
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
  interaction_intent: TurnEvidenceObservation["interaction_intent"];
  confidence_evidence?: "high" | "medium" | "low" | null;
}): TurnEvidenceObservationV5 {
  const contract = TargetEvidenceContractV5Schema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationV5Schema.parse(
    input.adjudication
  );
  const propagation = assertBlockingAnchorConflictPropagatedV2(
    adjudication.anchor_propagation
  );
  const {
    structured_turn_evidence: _structuredTurnEvidence,
    anchor_alias_resolution: _anchorAliasResolution,
    anchor_propagation: _anchorPropagation,
    ...legacyAdjudication
  } = adjudication;
  void _structuredTurnEvidence;
  void _anchorAliasResolution;
  void _anchorPropagation;
  const base = mapTargetEvidenceAdjudicationToObservationV3({
    contract: v3Contract(contract),
    adjudication: TargetEvidenceAdjudicationV3Schema.parse({
      ...legacyAdjudication,
      evaluator_version: "production-turn-evidence-evaluator-v3",
      target_evidence_contract_version: "target-evidence-contract-v2",
      anchor_interpretation: propagation.anchor_interpretation
    }),
    interaction_intent: "ordinary_conceptual_response",
    confidence_evidence: input.confidence_evidence
  });
  const structuredIds = propagation.structured_contradictions.map((entry) =>
    entry.contradiction_type
  );
  return {
    ...base,
    interaction_intent: input.interaction_intent,
    reasoning_quality: propagation.blocking && base.reasoning_quality === "sound"
      ? "partial" : base.reasoning_quality,
    anchor_application: propagation.anchor_application,
    anchor_stance: propagation.anchor_stance,
    anchor_consistency: propagation.anchor_consistency,
    anchor_resolution_status: propagation.anchor_resolution_status,
    misconception_status: propagation.blocking ? "uncertain" :
      base.misconception_status,
    essential_missing_links: unique([
      ...base.essential_missing_links,
      ...adjudication.structured_turn_evidence.essential_missing_links,
      ...(propagation.blocking ? [
        "anchor_conclusion_consistency",
        "anchor_resolution_against_distractor"
      ] : [])
    ]),
    contradictions: unique([...base.contradictions, ...structuredIds]),
    observable_evidence_spans: unique([
      ...base.observable_evidence_spans,
      ...adjudication.structured_turn_evidence.exact_anchor_evidence_spans,
      ...adjudication.structured_turn_evidence.exact_conceptual_evidence_spans
    ].map((entry) => JSON.stringify(entry))).map((entry) =>
      JSON.parse(entry) as { label: string; span: string }
    ),
    evidence_limitations: unique([
      ...base.evidence_limitations,
      ...adjudication.structured_turn_evidence.evidence_limitations
    ]),
    structured_contradictions: propagation.structured_contradictions.map(
      (entry) => ({
        ...entry,
        mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6
      })
    ),
    contradiction_propagation_version:
      ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2
  };
}

export function assertTargetEvidenceObservationConsistentV6(input: {
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
  observation: TurnEvidenceObservationV5;
}) {
  const result = assertTargetEvidenceObservationConsistentV5(input);
  return {
    ...result,
    policy_version: PROFILE_CONSISTENCY_POLICY_VERSION_V6,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
    semantic_layer: "latest_turn_observation" as const
  };
}
