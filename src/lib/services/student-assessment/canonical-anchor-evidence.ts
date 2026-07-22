import { z } from "zod";
import {
  ActiveAnchorAliasContractSchema,
  type ActiveAnchorAliasContract
} from "./active-anchor-alias-resolution";
import {
  ProductionTurnEvidenceStructuredFieldsV5Schema,
  type ProductionTurnEvidenceStructuredFieldsV5
} from "./production-turn-evidence-evaluator-v5";

export const CANONICAL_ANCHOR_EVIDENCE_VERSION =
  "canonical-anchor-evidence-v1" as const;

export const CanonicalAnchorApplicationSchema = z.enum([
  "absent",
  "implicit",
  "explicit"
]);
export const CanonicalAnchorStanceSchema = z.enum([
  "endorses_distractor",
  "rejects_distractor",
  "ambiguous",
  "not_expressed"
]);
export const CanonicalAnchorMatchTypeSchema = z.enum([
  "absent",
  "exact_identifier",
  "exact_option_text",
  "contract_alias",
  "contract_paraphrase",
  "contextual_pronoun",
  "evaluator_structured_evidence"
]);
export const CanonicalAnchorEvidenceSpanSchema = z.object({
  label: z.enum(["anchor_reference", "anchor_stance"]),
  span: z.string().min(1).max(900),
  start_index: z.number().int().nonnegative()
}).strict();

export const CanonicalAnchorEvidenceSchema = z.object({
  canonicalization_version: z.literal(CANONICAL_ANCHOR_EVIDENCE_VERSION),
  anchor_id: z.string().min(1).max(240),
  anchor_label: z.string().min(1).max(24),
  anchor_text: z.string().min(1).max(1400),
  matched_alias: z.string().min(1).max(500).nullable(),
  match_type: CanonicalAnchorMatchTypeSchema,
  application: CanonicalAnchorApplicationSchema,
  stance: CanonicalAnchorStanceSchema,
  evidence_spans: z.array(CanonicalAnchorEvidenceSpanSchema).max(24),
  source_turn_id: z.string().min(1).max(240),
  source_sequence_index: z.number().int().positive(),
  confidence: z.enum(["high", "medium", "low"]).nullable()
}).strict().superRefine((value, context) => {
  if (value.application === "explicit" && value.evidence_spans.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidence_spans"],
      message: "explicit_canonical_anchor_requires_evidence_span"
    });
  }
  if (value.application === "absent" && value.match_type !== "absent") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["match_type"],
      message: "absent_canonical_anchor_requires_absent_match_type"
    });
  }
});
export type CanonicalAnchorEvidence = z.infer<
  typeof CanonicalAnchorEvidenceSchema
>;

export class CanonicalAnchorEvidenceError extends Error {
  readonly issue_codes: string[];

  constructor(issueCodes: string[]) {
    super(`canonical_anchor_evidence_invalid:${issueCodes.join("|")}`);
    this.name = "CanonicalAnchorEvidenceError";
    this.issue_codes = issueCodes;
  }
}

function exactSpanIndex(message: string, span: string) {
  const exact = message.indexOf(span);
  if (exact >= 0) return exact;
  return message.toLocaleLowerCase("en-CA")
    .indexOf(span.toLocaleLowerCase("en-CA"));
}

function uniqueSpans(
  spans: z.infer<typeof CanonicalAnchorEvidenceSpanSchema>[]
) {
  const seen = new Set<string>();
  return spans.filter((span) => {
    const key = `${span.label}:${span.start_index}:${span.span}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function canonicalizeEvaluatorAnchorEvidenceV1(input: {
  structured_turn_evidence: ProductionTurnEvidenceStructuredFieldsV5;
  contract: ActiveAnchorAliasContract;
  source_message: string;
  expected_source_turn_id: string;
  expected_source_sequence_index: number;
}): CanonicalAnchorEvidence {
  const structured = ProductionTurnEvidenceStructuredFieldsV5Schema.parse(
    input.structured_turn_evidence
  );
  const contract = ActiveAnchorAliasContractSchema.parse(input.contract);
  const issues: string[] = [];

  if (structured.active_anchor_id !== contract.active_anchor_id) {
    issues.push("canonical_anchor_id_mismatch");
  }
  if (structured.source_student_turn_id !== input.expected_source_turn_id) {
    issues.push("canonical_source_turn_mismatch");
  }
  if (structured.source_sequence_index !==
      input.expected_source_sequence_index) {
    issues.push("canonical_source_sequence_mismatch");
  }

  const evidenceSpans = structured.exact_anchor_evidence_spans
    .filter((entry) =>
      entry.label === "anchor_reference" || entry.label === "anchor_stance"
    )
    .map((entry) => {
      const startIndex = exactSpanIndex(input.source_message, entry.span);
      if (startIndex < 0) {
        issues.push(`canonical_evidence_span_not_in_source:${entry.label}`);
      }
      return {
        label: entry.label as "anchor_reference" | "anchor_stance",
        span: entry.span,
        start_index: Math.max(0, startIndex)
      };
    });

  if (structured.observed_anchor_reference === "explicit" &&
      !evidenceSpans.some((entry) => entry.label === "anchor_reference")) {
    issues.push("canonical_explicit_anchor_span_missing");
  }
  if (["endorses_distractor", "rejects_distractor"].includes(
    structured.observed_anchor_stance
  ) && !evidenceSpans.some((entry) => entry.label === "anchor_stance")) {
    issues.push("canonical_decisive_stance_span_missing");
  }
  if (issues.length > 0) throw new CanonicalAnchorEvidenceError(issues);

  return CanonicalAnchorEvidenceSchema.parse({
    canonicalization_version: CANONICAL_ANCHOR_EVIDENCE_VERSION,
    anchor_id: contract.active_anchor_id,
    anchor_label: contract.option_label,
    anchor_text: contract.option_text,
    matched_alias: structured.observed_anchor_identifier,
    match_type: structured.observed_anchor_reference === "explicit"
      ? "evaluator_structured_evidence"
      : "absent",
    application: structured.observed_anchor_reference === "explicit"
      ? "explicit"
      : "absent",
    stance: structured.observed_anchor_stance,
    evidence_spans: uniqueSpans(evidenceSpans),
    source_turn_id: structured.source_student_turn_id,
    source_sequence_index: structured.source_sequence_index,
    confidence: structured.confidence_evidence
  });
}
