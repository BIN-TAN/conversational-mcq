import { z } from "zod";
import {
  ActiveAnchorAliasContractSchema,
  type ActiveAnchorAliasContract
} from "./active-anchor-alias-resolution";
import {
  ActiveAnchorAliasResolutionV2Schema,
  type ActiveAnchorAliasResolutionV2
} from "./active-anchor-alias-resolution-v2";
import {
  CanonicalAnchorEvidenceSchema,
  type CanonicalAnchorEvidence
} from "./canonical-anchor-evidence";

export const ANCHOR_PARITY_RECONCILIATION_VERSION =
  "anchor-parity-reconciliation-v1" as const;

export const AnchorParityIssueCodeSchema = z.enum([
  "canonical_anchor_id_mismatch",
  "canonical_application_disagreement",
  "canonical_stance_disagreement",
  "source_turn_mismatch",
  "source_sequence_mismatch",
  "explicit_anchor_evidence_span_missing"
]);

export const AnchorParityReconciliationResultSchema = z.object({
  policy_version: z.literal(ANCHOR_PARITY_RECONCILIATION_VERSION),
  passed: z.boolean(),
  evaluator_canonical_anchor_id: z.string().min(1),
  resolver_canonical_anchor_id: z.string().min(1),
  target_canonical_anchor_id: z.string().min(1),
  evaluator_application: z.enum(["absent", "implicit", "explicit"]),
  resolver_application: z.enum(["absent", "implicit", "explicit"]),
  evaluator_stance: z.enum([
    "endorses_distractor", "rejects_distractor", "ambiguous", "not_expressed"
  ]),
  resolver_stance: z.enum([
    "endorses_distractor", "rejects_distractor", "ambiguous", "not_expressed"
  ]),
  source_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  evidence_provenance_preserved: z.boolean(),
  issue_codes: z.array(AnchorParityIssueCodeSchema)
}).strict();
export type AnchorParityReconciliationResult = z.infer<
  typeof AnchorParityReconciliationResultSchema
>;

export function reconcileCanonicalAnchorParityV1(input: {
  evaluator_evidence: CanonicalAnchorEvidence;
  resolver_result: ActiveAnchorAliasResolutionV2;
  target_contract: ActiveAnchorAliasContract;
  expected_source_turn_id: string;
  expected_source_sequence_index: number;
}): AnchorParityReconciliationResult {
  const evaluator = CanonicalAnchorEvidenceSchema.parse(input.evaluator_evidence);
  const resolver = ActiveAnchorAliasResolutionV2Schema.parse(
    input.resolver_result
  );
  const target = ActiveAnchorAliasContractSchema.parse(input.target_contract);
  const issues: z.infer<typeof AnchorParityIssueCodeSchema>[] = [];

  if (evaluator.anchor_id !== target.active_anchor_id ||
      resolver.canonical_anchor_id !== target.active_anchor_id ||
      evaluator.anchor_id !== resolver.canonical_anchor_id) {
    issues.push("canonical_anchor_id_mismatch");
  }
  if (evaluator.application !==
      resolver.canonical_anchor_evidence.application ||
      resolver.independent_application_conflict) {
    issues.push("canonical_application_disagreement");
  }
  if (evaluator.stance !== resolver.stance ||
      resolver.independent_stance_conflict) {
    issues.push("canonical_stance_disagreement");
  }
  if (evaluator.source_turn_id !== input.expected_source_turn_id ||
      resolver.canonical_anchor_evidence.source_turn_id !==
        input.expected_source_turn_id) {
    issues.push("source_turn_mismatch");
  }
  if (evaluator.source_sequence_index !== input.expected_source_sequence_index ||
      resolver.canonical_anchor_evidence.source_sequence_index !==
        input.expected_source_sequence_index) {
    issues.push("source_sequence_mismatch");
  }
  if (evaluator.application === "explicit" &&
      evaluator.evidence_spans.length === 0) {
    issues.push("explicit_anchor_evidence_span_missing");
  }

  return AnchorParityReconciliationResultSchema.parse({
    policy_version: ANCHOR_PARITY_RECONCILIATION_VERSION,
    passed: issues.length === 0,
    evaluator_canonical_anchor_id: evaluator.anchor_id,
    resolver_canonical_anchor_id: resolver.canonical_anchor_id,
    target_canonical_anchor_id: target.active_anchor_id,
    evaluator_application: evaluator.application,
    resolver_application: resolver.canonical_anchor_evidence.application,
    evaluator_stance: evaluator.stance,
    resolver_stance: resolver.stance,
    source_turn_id: evaluator.source_turn_id,
    source_sequence_index: evaluator.source_sequence_index,
    evidence_provenance_preserved: evaluator.evidence_spans.length > 0 ||
      evaluator.application === "absent",
    issue_codes: issues
  });
}
