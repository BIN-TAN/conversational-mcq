import { z } from "zod";
import {
  AnchorApplicationSchema,
  AnchorConsistencySchema,
  AnchorInterpretationContractSchema,
  AnchorInterpretationSchema,
  AnchorResolutionStatusSchema,
  AnchorStanceSchema
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";

export const ANCHOR_CONTRADICTION_PROPAGATION_VERSION =
  "anchor-contradiction-propagation-v1" as const;

const ExactEvidenceSpanSchema = z.object({
  label: z.string().min(1).max(120),
  span: z.string().min(1).max(900)
}).strict();

export const EvaluatorAnchorObservationV4Schema = z.object({
  observation_version: z.literal("production-turn-anchor-observation-v4"),
  active_anchor_id: z.string().min(1).max(240),
  observed_anchor_application: AnchorApplicationSchema,
  observed_anchor_stance: AnchorStanceSchema,
  conceptual_conclusion: z.enum([
    "not_assessable",
    "ambiguous",
    "endorses_distractor",
    "rejects_distractor"
  ]),
  anchor_concept_alignment: z.enum([
    "not_assessable",
    "aligned",
    "contradictory",
    "unresolved"
  ]),
  anchor_conflict_type: z.literal(
    "anchor_conclusion_conceptual_explanation_conflict"
  ).nullable(),
  blocking_conflict: z.boolean(),
  exact_supporting_spans: z.array(ExactEvidenceSpanSchema).max(12),
  evidence_source: z.enum([
    "structured_evaluator_fields",
    "deterministic_v4_normalization"
  ])
}).strict();
export type EvaluatorAnchorObservationV4 = z.infer<
  typeof EvaluatorAnchorObservationV4Schema
>;

export const StructuredAnchorContradictionSchema = z.object({
  contradiction_type: z.literal(
    "anchor_conclusion_conceptual_explanation_conflict"
  ),
  anchor_id: z.string().min(1).max(240),
  anchor_text: z.string().min(1).max(1400),
  observed_anchor_stance: AnchorStanceSchema,
  conceptual_claim: z.enum([
    "endorses_distractor",
    "rejects_distractor"
  ]),
  conflicting_evidence_spans: z.array(ExactEvidenceSpanSchema).min(1).max(12),
  blocking: z.literal(true),
  source_evaluator_version: z.string().min(1),
  mapper_version: z.string().min(1)
}).strict();
export type StructuredAnchorContradiction = z.infer<
  typeof StructuredAnchorContradictionSchema
>;

export const AnchorContradictionPropagationResultSchema = z.object({
  propagation_version: z.literal(ANCHOR_CONTRADICTION_PROPAGATION_VERSION),
  anchor_application: AnchorApplicationSchema,
  anchor_stance: AnchorStanceSchema,
  anchor_consistency: AnchorConsistencySchema,
  anchor_resolution_status: AnchorResolutionStatusSchema,
  structured_contradictions: z.array(StructuredAnchorContradictionSchema),
  blocking: z.boolean(),
  revision_ready: z.boolean(),
  anchor_interpretation: AnchorInterpretationSchema
}).strict();
export type AnchorContradictionPropagationResult = z.infer<
  typeof AnchorContradictionPropagationResultSchema
>;

export class AnchorContradictionPropagationError extends Error {
  readonly issue_codes: string[];

  constructor(issueCodes: string[]) {
    super(`anchor_contradiction_propagation_failed:${issueCodes.join("|")}`);
    this.name = "AnchorContradictionPropagationError";
    this.issue_codes = issueCodes;
  }
}

export function propagateAnchorContradiction(input: {
  contract: z.infer<typeof AnchorInterpretationContractSchema>;
  evaluator_observation: EvaluatorAnchorObservationV4;
  source_evaluator_version: string;
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
  const evaluator = EvaluatorAnchorObservationV4Schema.parse(
    input.evaluator_observation
  );
  if (evaluator.active_anchor_id !== contract.active_anchor_id) {
    throw new AnchorContradictionPropagationError([
      "evaluator_anchor_id_mismatch"
    ]);
  }

  const blocking = evaluator.blocking_conflict;
  const conflictSpans = evaluator.exact_supporting_spans;
  if (blocking && conflictSpans.length === 0) {
    throw new AnchorContradictionPropagationError([
      "blocking_conflict_without_exact_evidence_span"
    ]);
  }
  if (blocking && (
    evaluator.anchor_conflict_type !==
      "anchor_conclusion_conceptual_explanation_conflict" ||
    evaluator.anchor_concept_alignment !== "contradictory" ||
    !["endorses_distractor", "rejects_distractor"].includes(
      evaluator.observed_anchor_stance
    ) ||
    !["endorses_distractor", "rejects_distractor"].includes(
      evaluator.conceptual_conclusion
    ) ||
    evaluator.observed_anchor_stance === evaluator.conceptual_conclusion
  )) {
    throw new AnchorContradictionPropagationError([
      "blocking_conflict_fields_inconsistent"
    ]);
  }

  const structured = blocking
    ? [StructuredAnchorContradictionSchema.parse({
        contradiction_type:
          "anchor_conclusion_conceptual_explanation_conflict",
        anchor_id: contract.active_anchor_id,
        anchor_text: contract.active_anchor_text,
        observed_anchor_stance: evaluator.observed_anchor_stance,
        conceptual_claim: evaluator.conceptual_conclusion,
        conflicting_evidence_spans: conflictSpans,
        blocking: true,
        source_evaluator_version: input.source_evaluator_version,
        mapper_version: input.mapper_version
      })]
    : [];

  const anchorConsistency = blocking
    ? "contradictory_to_conceptual_reasoning" as const
    : evaluator.anchor_concept_alignment === "aligned"
      ? "consistent_with_conceptual_reasoning" as const
      : evaluator.anchor_concept_alignment === "unresolved"
        ? "unresolved" as const
        : "not_assessable" as const;
  const resolution = blocking
    ? "contradictory" as const
    : evaluator.observed_anchor_stance === contract.required_anchor_stance &&
        anchorConsistency === "consistent_with_conceptual_reasoning"
      ? "resolved_against_distractor" as const
      : "unresolved" as const;
  const contradictionIds = structured.map((entry) =>
    entry.contradiction_type
  );

  return AnchorContradictionPropagationResultSchema.parse({
    propagation_version: ANCHOR_CONTRADICTION_PROPAGATION_VERSION,
    anchor_application: evaluator.observed_anchor_application,
    anchor_stance: evaluator.observed_anchor_stance,
    anchor_consistency: anchorConsistency,
    anchor_resolution_status: resolution,
    structured_contradictions: structured,
    blocking,
    revision_ready: !blocking &&
      evaluator.observed_anchor_application === "explicit" &&
      evaluator.observed_anchor_stance === contract.required_anchor_stance &&
      anchorConsistency === "consistent_with_conceptual_reasoning" &&
      resolution === "resolved_against_distractor",
    anchor_interpretation: {
      interpretation_version: "anchor-conclusion-consistency-v1",
      anchor_application: evaluator.observed_anchor_application,
      anchor_stance: evaluator.observed_anchor_stance,
      anchor_consistency: anchorConsistency,
      anchor_resolution_status: resolution,
      anchor_reference_spans: evaluator.exact_supporting_spans
        .filter((entry) => entry.label === "anchor_reference")
        .map((entry) => entry.span),
      anchor_stance_spans: evaluator.exact_supporting_spans
        .filter((entry) => entry.label === "anchor_stance")
        .map((entry) => entry.span),
      blocking_limitations: [],
      contradictions: contradictionIds,
      clarification_required: blocking ||
        evaluator.observed_anchor_stance === "ambiguous"
    }
  });
}

export function assertBlockingAnchorConflictPropagated(
  result: AnchorContradictionPropagationResult
) {
  const parsed = AnchorContradictionPropagationResultSchema.parse(result);
  if (!parsed.blocking) return parsed;
  const issues = [
    parsed.structured_contradictions.length === 0
      ? "blocking_conflict_missing_structured_record" : "",
    parsed.anchor_consistency === "consistent_with_conceptual_reasoning"
      ? "blocking_conflict_marked_consistent" : "",
    parsed.anchor_resolution_status === "resolved_against_distractor"
      ? "blocking_conflict_marked_resolved" : "",
    parsed.revision_ready ? "blocking_conflict_revision_ready" : ""
  ].filter(Boolean);
  if (issues.length > 0) throw new AnchorContradictionPropagationError(issues);
  return parsed;
}
