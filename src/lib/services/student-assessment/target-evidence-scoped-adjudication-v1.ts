import { z } from "zod";
import type {
  ActivityMisconceptionEvidencePacketV1
} from "./activity-misconception-evidence";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
  ActiveAnchorAliasResolutionV2Schema,
} from "./active-anchor-alias-resolution-v2";
import {
  ActiveAnchorAliasResolutionSchema,
  resolveActiveAnchorAlias,
  type ActiveAnchorAliasContract
} from "./active-anchor-alias-resolution";
import {
  AnchorParityReconciliationResultSchema,
  reconcileCanonicalAnchorParityV1
} from "./anchor-parity-reconciliation";
import {
  AnchorContradictionPropagationResultV2Schema,
  assertBlockingAnchorConflictPropagatedV2,
  propagateAnchorContradictionV2
} from "./anchor-contradiction-propagation-v2";
import type {
  AnchorResolutionStatus
} from "./anchor-conclusion-consistency";
import {
  isBlockingAnchorConflictLimitation
} from "./anchor-conclusion-consistency";
import {
  AnchorStanceScopeResolutionV1Schema,
  resolveAnchorStanceScopeV1
} from "./anchor-stance-scope-resolution-v1";
import {
  canonicalizeEvaluatorAnchorEvidenceV1
} from "./canonical-anchor-evidence";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
  ProductionTurnEvidenceStructuredFieldsV5Schema,
  type ProductionTurnEvidenceStructuredFieldsV5
} from "./production-turn-evidence-evaluator-v5";
import {
  TARGET_EVIDENCE_CONTRACT_VERSION_V5,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V5,
  TargetEvidenceAdjudicationV5Schema,
  TargetEvidenceContractV5Schema,
  TargetEvidenceEvaluatorParityErrorV5,
  type TargetEvidenceContractV5
} from "./target-evidence-contract-v5";
import {
  TargetEvidenceContractV3Schema,
  buildTargetEvidenceAdjudicationFromActivityPacketV3
} from "./target-evidence-contract-v3";

export const TARGET_EVIDENCE_SCOPED_ADJUDICATION_VERSION =
  "target-evidence-scoped-adjudication-v1" as const;

export const TargetEvidenceScopedAdjudicationV1Schema = z.object({
  integration_version: z.literal(
    TARGET_EVIDENCE_SCOPED_ADJUDICATION_VERSION
  ),
  anchor_stance_scope_resolution: AnchorStanceScopeResolutionV1Schema,
  compatibility_projection: z.object({
    schema_version: z.literal(
      "active-anchor-alias-resolution-v2-scoped-compatibility-v1"
    ),
    legacy_schema_retained_for_downstream_contract: z.literal(true),
    lexical_polarity_without_anchor_attachment_ignored: z.literal(true)
  }).strict(),
  adjudication: TargetEvidenceAdjudicationV5Schema
}).strict();
export type TargetEvidenceScopedAdjudicationV1 = z.infer<
  typeof TargetEvidenceScopedAdjudicationV1Schema
>;

function decisive(value: string) {
  return value === "endorses_distractor" ||
    value === "rejects_distractor";
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("en-CA");
}

function classifyMatchType(input: {
  alias: string | null;
  contract: ActiveAnchorAliasContract;
}) {
  if (!input.alias) return "absent" as const;
  const alias = normalized(input.alias);
  if (input.contract.accepted_identifiers.some((entry) =>
    normalized(entry) === alias
  )) return "exact_identifier" as const;
  if (normalized(input.contract.option_text) === alias) {
    return "exact_option_text" as const;
  }
  if (input.contract.accepted_aliases.some((entry) =>
    normalized(entry) === alias
  )) return "contract_alias" as const;
  if (input.contract.accepted_paraphrases.some((entry) =>
    normalized(entry) === alias
  )) return "contract_paraphrase" as const;
  if (input.contract.pronoun_resolution_context.accepted_pronouns.some(
    (entry) => normalized(entry) === alias
  )) return "contextual_pronoun" as const;
  return "contract_alias" as const;
}

function v3Contract(contract: TargetEvidenceContractV5) {
  const { active_anchor_alias_contract: _aliases, ...rest } = contract;
  void _aliases;
  return TargetEvidenceContractV3Schema.parse({
    ...rest,
    contract_version: "target-evidence-contract-v2"
  });
}

/**
 * Keeps the established V5 adjudication wire shape while replacing only the
 * legacy whole-message lexical stance check with a scope-attached decision.
 * The full scoped result is returned beside the compatibility projection.
 */
export function buildTargetEvidenceScopedAdjudicationV1(input: {
  latest_student_message: string;
  packet: ActivityMisconceptionEvidencePacketV1;
  structured_turn_evidence: ProductionTurnEvidenceStructuredFieldsV5;
  contract: TargetEvidenceContractV5;
  expected_source_student_turn_id: string;
  expected_source_sequence_index: number;
  prior_visible_message?: string | null;
  prior_anchor_resolution_status?: AnchorResolutionStatus | null;
  prior_student_anchor_stances?: Array<{
    stance:
      | "endorses_distractor"
      | "rejects_distractor"
      | "ambiguous"
      | "not_expressed";
  }>;
}): TargetEvidenceScopedAdjudicationV1 {
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

  const canonicalAnchor = canonicalizeEvaluatorAnchorEvidenceV1({
    structured_turn_evidence: structured,
    contract: contract.active_anchor_alias_contract,
    source_message: input.latest_student_message,
    expected_source_turn_id: input.expected_source_student_turn_id,
    expected_source_sequence_index: input.expected_source_sequence_index
  });
  const reference = ActiveAnchorAliasResolutionSchema.parse(
    resolveActiveAnchorAlias({
      message: input.latest_student_message,
      contract: contract.active_anchor_alias_contract,
      prior_visible_message: input.prior_visible_message
    })
  );
  const scopedStance = resolveAnchorStanceScopeV1({
    message: input.latest_student_message,
    contract: contract.active_anchor_alias_contract,
    reference_resolution: reference,
    prior_student_reasoning: input.prior_student_anchor_stances
  });

  const scopedIndependentStance =
    scopedStance.stance_classification.observed_anchor_stance;
  const independentMatchType = classifyMatchType({
    alias: reference.observed_anchor_identifier,
    contract: contract.active_anchor_alias_contract
  });
  const aliases = ActiveAnchorAliasResolutionV2Schema.parse({
    resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
    active_anchor_id: canonicalAnchor.anchor_id,
    canonical_anchor_id: canonicalAnchor.anchor_id,
    matched_alias: canonicalAnchor.matched_alias,
    match_type: canonicalAnchor.match_type,
    evidence_span: canonicalAnchor.evidence_spans[0]?.span ?? null,
    stance: canonicalAnchor.stance,
    observed_anchor_reference:
      canonicalAnchor.application === "explicit" ? "explicit" : "absent",
    observed_anchor_identifier: canonicalAnchor.matched_alias,
    observed_anchor_text:
      canonicalAnchor.evidence_spans[0]?.span ?? null,
    observed_anchor_conclusion: canonicalAnchor.stance,
    observed_anchor_stance: canonicalAnchor.stance,
    anchor_aliases_detected: [...new Set([
      ...reference.anchor_aliases_detected,
      ...(canonicalAnchor.matched_alias
        ? [canonicalAnchor.matched_alias]
        : [])
    ])],
    exact_anchor_evidence_spans: canonicalAnchor.evidence_spans.filter(
      (entry) => entry.label === "anchor_reference"
    ),
    exact_stance_evidence_spans: canonicalAnchor.evidence_spans.filter(
      (entry) => entry.label === "anchor_stance"
    ),
    ambiguous_due_to_multiple_stances:
      scopedStance.stance_classification
        .ambiguous_due_to_conflicting_anchor_stances,
    direct_reference_mapped_absent: false,
    independent_text_resolution: {
      observed_anchor_reference: reference.observed_anchor_reference,
      observed_anchor_stance: scopedIndependentStance,
      matched_alias: reference.observed_anchor_identifier,
      match_type: independentMatchType
    },
    independent_application_conflict:
      reference.observed_anchor_reference === "explicit" &&
      canonicalAnchor.application === "absent",
    independent_stance_conflict:
      reference.observed_anchor_reference === "explicit" &&
      decisive(scopedIndependentStance) &&
      decisive(canonicalAnchor.stance) &&
      scopedIndependentStance !== canonicalAnchor.stance,
    canonical_anchor_evidence: canonicalAnchor
  });
  const parity = reconcileCanonicalAnchorParityV1({
    evaluator_evidence: canonicalAnchor,
    resolver_result: aliases,
    target_contract: contract.active_anchor_alias_contract,
    expected_source_turn_id: input.expected_source_student_turn_id,
    expected_source_sequence_index: input.expected_source_sequence_index
  });
  const parityIssues: string[] = parity.issue_codes.map((issue) => {
    if (issue === "canonical_application_disagreement") {
      return "explicit_anchor_not_detected";
    }
    if (issue === "canonical_stance_disagreement") {
      return "anchor_stance_not_detected";
    }
    if (issue === "canonical_anchor_id_mismatch") {
      return "active_anchor_id_mismatch";
    }
    if (issue === "source_turn_mismatch") {
      return "cross_artifact_source_student_turn_disagreement";
    }
    if (issue === "source_sequence_mismatch") {
      return "cross_artifact_source_sequence_disagreement";
    }
    return "explicit_anchor_evidence_span_missing";
  });
  if (input.packet.misconception_evidence_update.limitations.some(
    isBlockingAnchorConflictLimitation
  ) && !structured.blocking_conflict) {
    parityIssues.push("contradiction_not_structured");
  }
  if (parityIssues.length > 0) {
    throw new TargetEvidenceEvaluatorParityErrorV5(parityIssues);
  }

  const exactAnchorSpans = canonicalAnchor.evidence_spans.map((entry) => ({
    label: entry.label,
    span: entry.span
  }));
  const criterionResults = base.criterion_results.map((criterion) => {
    if (criterion.criterion_id !== "active_anchor_application") {
      return criterion;
    }
    const satisfied = canonicalAnchor.application === "explicit";
    return {
      ...criterion,
      satisfied,
      exact_evidence_spans: satisfied ? exactAnchorSpans : []
    };
  });
  const propagation = propagateAnchorContradictionV2({
    contract,
    structured_evidence: structured,
    anchor_application: canonicalAnchor.application,
    anchor_stance: canonicalAnchor.stance,
    exact_anchor_spans: exactAnchorSpans,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V5
  });
  assertBlockingAnchorConflictPropagatedV2(propagation);
  const adjudication = TargetEvidenceAdjudicationV5Schema.parse({
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
    canonical_anchor_evidence: canonicalAnchor,
    anchor_alias_resolution: aliases,
    anchor_parity_reconciliation: AnchorParityReconciliationResultSchema.parse(
      parity
    ),
    anchor_propagation: AnchorContradictionPropagationResultV2Schema.parse(
      propagation
    )
  });

  return TargetEvidenceScopedAdjudicationV1Schema.parse({
    integration_version: TARGET_EVIDENCE_SCOPED_ADJUDICATION_VERSION,
    anchor_stance_scope_resolution: scopedStance,
    compatibility_projection: {
      schema_version:
        "active-anchor-alias-resolution-v2-scoped-compatibility-v1",
      legacy_schema_retained_for_downstream_contract: true,
      lexical_polarity_without_anchor_attachment_ignored: true
    },
    adjudication
  });
}
