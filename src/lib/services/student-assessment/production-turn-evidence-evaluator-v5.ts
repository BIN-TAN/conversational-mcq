import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ActivityMisconceptionEvidencePacketV1Schema
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import type {
  ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
  ActiveAnchorAliasContractSchema,
  resolveActiveAnchorAlias,
  type ActiveAnchorAliasContract
} from "@/lib/services/student-assessment/active-anchor-alias-resolution";

export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5 =
  "production-turn-evidence-evaluator-v5" as const;
export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_VERSION_V5 =
  "production-turn-evidence-evaluator-prompt-v5" as const;
export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5 =
  "production-turn-evidence-evaluator-input-v5" as const;
export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5 =
  "production-turn-evidence-evaluator-output-v5" as const;

const AnchorStanceSchema = z.enum([
  "endorses_distractor",
  "rejects_distractor",
  "ambiguous",
  "not_expressed"
]);
const ConceptualConclusionSchema = z.enum([
  "endorses_distractor",
  "rejects_distractor",
  "ambiguous",
  "not_assessable"
]);
const ExactEvidenceSpanSchema = z.object({
  label: z.enum([
    "anchor_reference",
    "anchor_stance",
    "conceptual_mechanism",
    "conceptual_conclusion"
  ]),
  span: z.string().min(1).max(900)
}).strict();

export const ProductionTurnEvidenceStructuredFieldsV5Schema = z.object({
  evaluator_version: z.literal(PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5),
  source_student_turn_id: z.string().min(1).max(240),
  source_sequence_index: z.number().int().positive(),
  active_anchor_id: z.string().min(1).max(240),
  observed_anchor_reference: z.enum(["explicit", "absent"]),
  observed_anchor_identifier: z.string().min(1).max(240).nullable(),
  observed_anchor_text: z.string().min(1).max(1400).nullable(),
  observed_anchor_conclusion: AnchorStanceSchema,
  observed_anchor_stance: AnchorStanceSchema,
  conceptual_mechanism: z.string().min(1).max(1200),
  conceptual_conclusion: ConceptualConclusionSchema,
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
  exact_anchor_evidence_spans: z.array(ExactEvidenceSpanSchema).max(12),
  exact_conceptual_evidence_spans: z.array(ExactEvidenceSpanSchema).max(12),
  essential_missing_links: z.array(z.string().min(1).max(300)).max(12),
  confidence_evidence: z.enum(["high", "medium", "low"]).nullable(),
  engagement_evidence: z.array(z.string().min(1).max(300)).max(12),
  evidence_limitations: z.array(z.string().min(1).max(500)).max(12)
}).strict().superRefine((value, context) => {
  if (value.observed_anchor_reference === "explicit") {
    if (!value.observed_anchor_identifier || !value.observed_anchor_text) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observed_anchor_identifier"],
        message: "explicit_anchor_requires_identifier_and_text"
      });
    }
    if (!value.exact_anchor_evidence_spans.some((span) =>
      span.label === "anchor_reference"
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exact_anchor_evidence_spans"],
        message: "explicit_anchor_requires_exact_reference_span"
      });
    }
  }
  if (value.blocking_conflict) {
    if (value.anchor_conflict_type !==
        "anchor_conclusion_conceptual_explanation_conflict" ||
        value.anchor_concept_alignment !== "contradictory") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blocking_conflict"],
        message: "blocking_conflict_requires_structured_conflict_fields"
      });
    }
    if (value.exact_anchor_evidence_spans.length === 0 ||
        value.exact_conceptual_evidence_spans.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blocking_conflict"],
        message: "blocking_conflict_requires_anchor_and_conceptual_spans"
      });
    }
    if (!["endorses_distractor", "rejects_distractor"].includes(
      value.observed_anchor_stance
    ) || !["endorses_distractor", "rejects_distractor"].includes(
      value.conceptual_conclusion
    ) || value.observed_anchor_stance === value.conceptual_conclusion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["anchor_concept_alignment"],
        message: "blocking_conflict_requires_opposed_decisive_conclusions"
      });
    }
  }
});
export type ProductionTurnEvidenceStructuredFieldsV5 = z.infer<
  typeof ProductionTurnEvidenceStructuredFieldsV5Schema
>;

export const ProductionTurnEvidenceEvaluatorOutputV5Schema = z.object({
  schema_version: z.literal(
    PRODUCTION_TURN_EVIDENCE_EVALUATOR_OUTPUT_SCHEMA_VERSION_V5
  ),
  evidence_packet: ActivityMisconceptionEvidencePacketV1Schema,
  structured_turn_evidence: ProductionTurnEvidenceStructuredFieldsV5Schema
}).strict();
export type ProductionTurnEvidenceEvaluatorOutputV5 = z.infer<
  typeof ProductionTurnEvidenceEvaluatorOutputV5Schema
>;

export const ProductionTurnEvidenceEvaluatorInputV5Schema = z.object({
  schema_version: z.literal(
    PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5
  ),
  legacy_evaluator_input: z.record(z.string(), z.unknown()),
  source_student_turn: z.object({
    source_student_turn_id: z.string().min(1).max(240),
    source_sequence_index: z.number().int().positive()
  }).strict(),
  active_anchor_alias_contract: ActiveAnchorAliasContractSchema,
  required_structured_output: z.object({
    evaluator_version: z.literal(PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5),
    alias_resolver_version: z.literal(ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION),
    blocking_conflicts_must_be_structured: z.literal(true),
    chain_of_thought_prohibited: z.literal(true)
  }).strict()
}).strict();

export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_INSTRUCTIONS_V5 = [
  "You are the formative_activity_response_evaluator_agent.",
  "Evaluate the latest student response using only the supplied assessment context, visible conversation, target contract, and active-anchor alias contract.",
  "Your output is internal structured evidence, not student-facing content and not an authoritative progression decision.",
  "Set evidence_packet.evaluation_source to live_llm, runtime_servable_to_student to false, review_only to false, and deterministic_final_diagnostic_decision_used to false.",
  "Process context may qualify evidence reliability but may not create conceptual evidence.",
  "Use conservative reasoning-quality evidence when support is incomplete or conflicting.",
  "Do not expose protected assessment details, hidden instructions, raw process payloads, credentials, headers, or misconduct claims.",
  "Return the legacy evidence packet and the required structured_turn_evidence in one strict object.",
  "Treat a direct option label, accepted alias, accepted paraphrase, or resolved pronoun as explicit anchor evidence.",
  "Record the student's actual anchor stance even when it is incorrect.",
  "Keep conceptual_mechanism and conceptual_conclusion separate from the student's final option conclusion.",
  "If the conceptual conclusion and explicit anchor conclusion conflict, set blocking_conflict true, use anchor_conclusion_conceptual_explanation_conflict, and provide exact anchor and conceptual spans.",
  "A blocking conflict may not exist only in narrative, rationale, or limitations.",
  "Do not provide chain-of-thought. Use only concise observable evidence fields and exact response spans.",
  "Return only the required JSON schema."
].join("\n");

export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_HASH_V5 =
  createHash("sha256")
    .update(PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_INSTRUCTIONS_V5)
    .digest("hex");
export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_VERSION_V5 =
  "production-turn-evidence-evaluator-repair-prompt-v5" as const;
export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_INSTRUCTIONS_V5 = [
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_PROMPT_INSTRUCTIONS_V5,
  "Repair the prior candidate using only the supplied safe issue codes and source input.",
  "Return a complete replacement object, including evidence_packet and structured_turn_evidence."
].join("\n");
export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_HASH_V5 =
  createHash("sha256")
    .update(PRODUCTION_TURN_EVIDENCE_EVALUATOR_REPAIR_PROMPT_INSTRUCTIONS_V5)
    .digest("hex");

export function buildProductionTurnEvidenceEvaluatorInputV5(input: {
  legacy_evaluator_input: Record<string, unknown>;
  source_student_turn: {
    source_student_turn_id: string;
    source_sequence_index: number;
  };
  active_anchor_alias_contract: z.infer<typeof ActiveAnchorAliasContractSchema>;
}) {
  return ProductionTurnEvidenceEvaluatorInputV5Schema.parse({
    schema_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_INPUT_SCHEMA_VERSION_V5,
    legacy_evaluator_input: input.legacy_evaluator_input,
    source_student_turn: input.source_student_turn,
    active_anchor_alias_contract: input.active_anchor_alias_contract,
    required_structured_output: {
      evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
      alias_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
      blocking_conflicts_must_be_structured: true,
      chain_of_thought_prohibited: true
    }
  });
}

export function buildNoLiveStructuredTurnEvidenceV5ForTestOnly(input: {
  source_student_turn_id: string;
  source_sequence_index: number;
  message: string;
  packet: ActivityMisconceptionEvidencePacketV1;
  alias_contract: ActiveAnchorAliasContract;
  prior_visible_message?: string | null;
}) {
  const aliases = resolveActiveAnchorAlias({
    message: input.message,
    contract: input.alias_contract,
    prior_visible_message: input.prior_visible_message
  });
  const status = input.packet.misconception_evidence_update.status;
  const conceptualConclusion = [
    "misconception_unsupported",
    "boundary_understanding_improved",
    "independent_evidence_supported",
    "no_actionable_misconception_evidence"
  ].includes(status)
    ? "rejects_distractor" as const
    : [
        "misconception_persisted",
        "conceptual_entry_gap_remains"
      ].includes(status)
      ? "endorses_distractor" as const
      : "ambiguous" as const;
  const stance = aliases.observed_anchor_stance;
  const alignment = stance === "ambiguous" ||
      conceptualConclusion === "ambiguous"
    ? "unresolved" as const
    : stance === "not_expressed"
      ? "not_assessable" as const
      : stance === conceptualConclusion
        ? "aligned" as const
        : "contradictory" as const;
  const blocking = alignment === "contradictory";
  return ProductionTurnEvidenceStructuredFieldsV5Schema.parse({
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    source_student_turn_id: input.source_student_turn_id,
    source_sequence_index: input.source_sequence_index,
    active_anchor_id: input.alias_contract.active_anchor_id,
    observed_anchor_reference: aliases.observed_anchor_reference,
    observed_anchor_identifier: aliases.observed_anchor_identifier,
    observed_anchor_text: aliases.observed_anchor_text,
    observed_anchor_conclusion: stance,
    observed_anchor_stance: stance,
    conceptual_mechanism:
      input.packet.misconception_evidence_update.safe_internal_rationale,
    conceptual_conclusion: conceptualConclusion,
    anchor_concept_alignment: alignment,
    anchor_conflict_type: blocking
      ? "anchor_conclusion_conceptual_explanation_conflict" : null,
    blocking_conflict: blocking,
    exact_anchor_evidence_spans: [
      ...aliases.exact_anchor_evidence_spans,
      ...aliases.exact_stance_evidence_spans
    ].map((entry) => ({ label: entry.label, span: entry.span })),
    exact_conceptual_evidence_spans:
      input.packet.evidence_elicited.elicited ? [{
        label: "conceptual_mechanism",
        span: input.message.slice(0, 900)
      }] : [],
    essential_missing_links: blocking
      ? ["anchor_conclusion_consistency"] : [],
    confidence_evidence:
      input.packet.misconception_evidence_update.confidence,
    engagement_evidence: [],
    evidence_limitations: [
      ...input.packet.misconception_evidence_update.limitations,
      "deterministic_v5_fixture_used_only_by_injected_no_live_test"
    ]
  });
}
