import { z } from "zod";
import {
  AnchorApplicationSchema,
  AnchorConsistencySchema,
  AnchorInterpretationContractSchema,
  AnchorInterpretationSchema,
  AnchorResolutionStatusSchema,
  AnchorStanceSchema
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  ProductionTurnEvidenceStructuredFieldsV5Schema
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  StructuredAnchorContradictionSchema
} from "@/lib/services/student-assessment/anchor-contradiction-propagation";

export const ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2 =
  "anchor-contradiction-propagation-v2" as const;

export const AnchorContradictionPropagationResultV2Schema = z.object({
  propagation_version: z.literal(ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2),
  anchor_application: AnchorApplicationSchema,
  anchor_stance: AnchorStanceSchema,
  anchor_consistency: AnchorConsistencySchema,
  anchor_resolution_status: AnchorResolutionStatusSchema,
  structured_contradictions: z.array(StructuredAnchorContradictionSchema),
  blocking: z.boolean(),
  revision_ready: z.boolean(),
  anchor_interpretation: AnchorInterpretationSchema
}).strict();
export type AnchorContradictionPropagationResultV2 = z.infer<
  typeof AnchorContradictionPropagationResultV2Schema
>;

export class AnchorContradictionPropagationV2Error extends Error {
  readonly issue_codes: string[];
  constructor(issueCodes: string[]) {
    super(`anchor_contradiction_propagation_v2_failed:${issueCodes.join("|")}`);
    this.name = "AnchorContradictionPropagationV2Error";
    this.issue_codes = issueCodes;
  }
}

export function propagateAnchorContradictionV2(input: {
  contract: z.infer<typeof AnchorInterpretationContractSchema>;
  structured_evidence: z.infer<
    typeof ProductionTurnEvidenceStructuredFieldsV5Schema
  >;
  anchor_application: z.infer<typeof AnchorApplicationSchema>;
  anchor_stance: z.infer<typeof AnchorStanceSchema>;
  exact_anchor_spans: Array<{ label: string; span: string }>;
  mapper_version: string;
}) {
  const contract = AnchorInterpretationContractSchema.parse({
    active_anchor_id: input.contract.active_anchor_id,
    active_anchor_text: input.contract.active_anchor_text,
    active_anchor_type: input.contract.active_anchor_type,
    distractor_option: input.contract.distractor_option,
    distractor_claim: input.contract.distractor_claim,
    required_anchor_stance: input.contract.required_anchor_stance,
    acceptable_anchor_paraphrases:
      input.contract.acceptable_anchor_paraphrases,
    prohibited_anchor_stances: input.contract.prohibited_anchor_stances,
    anchor_resolution_criteria: input.contract.anchor_resolution_criteria,
    anchor_contradiction_criteria:
      input.contract.anchor_contradiction_criteria,
    ambiguity_resolution_policy: input.contract.ambiguity_resolution_policy
  });
  const evidence = ProductionTurnEvidenceStructuredFieldsV5Schema.parse(
    input.structured_evidence
  );
  const issues: string[] = [];
  if (evidence.active_anchor_id !== contract.active_anchor_id) {
    issues.push("evaluator_anchor_id_mismatch");
  }
  if (evidence.blocking_conflict && (
    evidence.anchor_conflict_type !==
      "anchor_conclusion_conceptual_explanation_conflict" ||
    evidence.anchor_concept_alignment !== "contradictory" ||
    evidence.exact_anchor_evidence_spans.length === 0 ||
    evidence.exact_conceptual_evidence_spans.length === 0
  )) issues.push("blocking_conflict_fields_inconsistent");
  if (issues.length > 0) {
    throw new AnchorContradictionPropagationV2Error(issues);
  }

  const blocking = evidence.blocking_conflict;
  const conflictingSpans = [
    ...evidence.exact_anchor_evidence_spans,
    ...evidence.exact_conceptual_evidence_spans
  ].map((entry) => ({ label: entry.label, span: entry.span }));
  const structured = blocking ? [StructuredAnchorContradictionSchema.parse({
    contradiction_type:
      "anchor_conclusion_conceptual_explanation_conflict",
    anchor_id: contract.active_anchor_id,
    anchor_text: contract.active_anchor_text,
    observed_anchor_stance: input.anchor_stance,
    conceptual_claim: evidence.conceptual_conclusion,
    conflicting_evidence_spans: conflictingSpans,
    blocking: true,
    source_evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    mapper_version: input.mapper_version
  })] : [];
  const anchorConsistency = blocking
    ? "contradictory_to_conceptual_reasoning" as const
    : evidence.anchor_concept_alignment === "aligned"
      ? "consistent_with_conceptual_reasoning" as const
      : evidence.anchor_concept_alignment === "unresolved"
        ? "unresolved" as const
        : "not_assessable" as const;
  const resolution = blocking
    ? "contradictory" as const
    : input.anchor_stance === contract.required_anchor_stance &&
        anchorConsistency === "consistent_with_conceptual_reasoning"
      ? "resolved_against_distractor" as const
      : "unresolved" as const;
  const revisionReady = !blocking && input.anchor_application === "explicit" &&
    input.anchor_stance === contract.required_anchor_stance &&
    anchorConsistency === "consistent_with_conceptual_reasoning" &&
    resolution === "resolved_against_distractor";

  return AnchorContradictionPropagationResultV2Schema.parse({
    propagation_version: ANCHOR_CONTRADICTION_PROPAGATION_VERSION_V2,
    anchor_application: input.anchor_application,
    anchor_stance: input.anchor_stance,
    anchor_consistency: anchorConsistency,
    anchor_resolution_status: resolution,
    structured_contradictions: structured,
    blocking,
    revision_ready: revisionReady,
    anchor_interpretation: {
      interpretation_version: "anchor-conclusion-consistency-v1",
      anchor_application: input.anchor_application,
      anchor_stance: input.anchor_stance,
      anchor_consistency: anchorConsistency,
      anchor_resolution_status: resolution,
      anchor_reference_spans: input.exact_anchor_spans
        .filter((entry) => entry.label === "anchor_reference")
        .map((entry) => entry.span),
      anchor_stance_spans: input.exact_anchor_spans
        .filter((entry) => entry.label === "anchor_stance")
        .map((entry) => entry.span),
      blocking_limitations: [],
      contradictions: structured.map((entry) => entry.contradiction_type),
      clarification_required: blocking || input.anchor_stance === "ambiguous"
    }
  });
}

export function assertBlockingAnchorConflictPropagatedV2(
  value: AnchorContradictionPropagationResultV2
) {
  const result = AnchorContradictionPropagationResultV2Schema.parse(value);
  const issues = result.blocking ? [
    result.structured_contradictions.length === 0
      ? "blocking_conflict_missing_structured_record" : "",
    result.anchor_resolution_status !== "contradictory"
      ? "blocking_conflict_not_finalized_contradictory" : "",
    result.revision_ready ? "blocking_conflict_revision_ready" : ""
  ].filter(Boolean) : [];
  if (issues.length > 0) {
    throw new AnchorContradictionPropagationV2Error(issues);
  }
  return result;
}
