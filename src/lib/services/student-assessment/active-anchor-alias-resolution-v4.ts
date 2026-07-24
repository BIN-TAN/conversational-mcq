import { z } from "zod";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
  ActiveAnchorAliasContractSchema,
  ActiveAnchorAliasResolutionSchema,
  resolveActiveAnchorAlias,
  type ActiveAnchorAliasContract
} from "./active-anchor-alias-resolution";
import {
  ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
  AnchorStanceEvidenceResolutionV2Schema,
  resolveAnchorStanceEvidenceV2,
  type PriorStudentAnchorStanceEvidence
} from "./anchor-stance-evidence-resolution-v2";
import {
  CANONICAL_ANCHOR_EVIDENCE_VERSION,
  CanonicalAnchorEvidenceSchema,
  CanonicalAnchorMatchTypeSchema,
  type CanonicalAnchorEvidence
} from "./canonical-anchor-evidence";

export const ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4 =
  "active-anchor-alias-resolution-v4" as const;

const IndependentReferenceResolutionSchema = z.object({
  resolver_version: z.literal(ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION),
  observed_anchor_reference: z.enum(["explicit", "absent"]),
  matched_alias: z.string().min(1).max(500).nullable(),
  match_type: CanonicalAnchorMatchTypeSchema
}).strict();

export const ActiveAnchorAliasResolutionV4Schema = z.object({
  resolver_version: z.literal(ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4),
  reference_resolver_version: z.literal(
    ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION
  ),
  stance_evidence_resolver_version: z.literal(
    ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION
  ),
  active_anchor_id: z.string().min(1).max(240),
  canonical_anchor_id: z.string().min(1).max(240),
  matched_alias: z.string().min(1).max(500).nullable(),
  match_type: CanonicalAnchorMatchTypeSchema,
  evidence_span: z.string().min(1).max(900).nullable(),
  stance: z.enum([
    "endorses_distractor",
    "rejects_distractor",
    "ambiguous",
    "not_expressed"
  ]),
  observed_anchor_reference: z.enum(["explicit", "absent"]),
  observed_anchor_identifier: z.string().min(1).max(500).nullable(),
  observed_anchor_text: z.string().min(1).max(900).nullable(),
  observed_anchor_conclusion: z.enum([
    "endorses_distractor",
    "rejects_distractor",
    "ambiguous",
    "not_expressed"
  ]),
  observed_anchor_stance: z.enum([
    "endorses_distractor",
    "rejects_distractor",
    "ambiguous",
    "not_expressed"
  ]),
  anchor_aliases_detected: z.array(z.string().min(1).max(500)).max(24),
  exact_anchor_evidence_spans: z.array(z.object({
    label: z.literal("anchor_reference"),
    span: z.string().min(1).max(900),
    start_index: z.number().int().nonnegative()
  }).strict()).max(24),
  exact_stance_evidence_spans: z.array(z.object({
    label: z.literal("anchor_stance"),
    span: z.string().min(1).max(900),
    start_index: z.number().int().nonnegative()
  }).strict()).max(32),
  ambiguous_due_to_multiple_stances: z.boolean(),
  direct_reference_mapped_absent: z.boolean(),
  independent_reference_resolution: IndependentReferenceResolutionSchema,
  independent_stance_evidence_resolution:
    AnchorStanceEvidenceResolutionV2Schema,
  independent_application_conflict: z.boolean(),
  independent_stance_conflict: z.boolean(),
  canonical_anchor_evidence: CanonicalAnchorEvidenceSchema
}).strict();
export type ActiveAnchorAliasResolutionV4 = z.infer<
  typeof ActiveAnchorAliasResolutionV4Schema
>;

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

function decisive(value: string) {
  return value === "endorses_distractor" ||
    value === "rejects_distractor";
}

function resolvePriorReasoning(input: {
  messages: string[];
  contract: ActiveAnchorAliasContract;
  prior_visible_message?: string | null;
}): PriorStudentAnchorStanceEvidence[] {
  return input.messages.map((message) => {
    const reference = resolveActiveAnchorAlias({
      message,
      contract: input.contract,
      prior_visible_message: input.prior_visible_message
    });
    const stance = resolveAnchorStanceEvidenceV2({
      message,
      contract: input.contract,
      reference_resolution: reference
    });
    return {
      message,
      reference_resolution: reference,
      stance: stance.observed_anchor_stance
    };
  });
}

export function resolveActiveAnchorAliasV4(input: {
  message: string;
  contract: ActiveAnchorAliasContract;
  source_turn_id: string;
  source_sequence_index: number;
  prior_visible_message?: string | null;
  prior_student_reasoning?: string[];
  evaluator_canonical_evidence?: CanonicalAnchorEvidence;
}): ActiveAnchorAliasResolutionV4 {
  const contract = ActiveAnchorAliasContractSchema.parse(input.contract);
  const reference = ActiveAnchorAliasResolutionSchema.parse(
    resolveActiveAnchorAlias({
      message: input.message,
      contract,
      prior_visible_message: input.prior_visible_message
    })
  );
  const matchType = classifyMatchType({
    alias: reference.observed_anchor_identifier,
    contract
  });
  const prior = resolvePriorReasoning({
    messages: input.prior_student_reasoning ?? [],
    contract,
    prior_visible_message: input.prior_visible_message
  });
  const stance = resolveAnchorStanceEvidenceV2({
    message: input.message,
    contract,
    reference_resolution: reference,
    prior_student_reasoning: prior
  });
  const canonical = input.evaluator_canonical_evidence
    ? CanonicalAnchorEvidenceSchema.parse(input.evaluator_canonical_evidence)
    : CanonicalAnchorEvidenceSchema.parse({
        canonicalization_version: CANONICAL_ANCHOR_EVIDENCE_VERSION,
        anchor_id: contract.active_anchor_id,
        anchor_label: contract.option_label,
        anchor_text: contract.option_text,
        matched_alias: reference.observed_anchor_identifier,
        match_type: matchType,
        application: reference.observed_anchor_reference === "explicit"
          ? "explicit"
          : "absent",
        stance: stance.observed_anchor_stance,
        evidence_spans: [
          ...reference.exact_anchor_evidence_spans,
          ...stance.exact_stance_evidence_spans
        ],
        source_turn_id: input.source_turn_id,
        source_sequence_index: input.source_sequence_index,
        confidence: null
      });
  const independentApplicationConflict =
    reference.observed_anchor_reference === "explicit" &&
    canonical.application === "absent";
  const independentStanceConflict =
    reference.observed_anchor_reference === "explicit" &&
    decisive(stance.observed_anchor_stance) &&
    decisive(canonical.stance) &&
    stance.observed_anchor_stance !== canonical.stance;

  return ActiveAnchorAliasResolutionV4Schema.parse({
    resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V4,
    reference_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
    stance_evidence_resolver_version:
      ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    active_anchor_id: canonical.anchor_id,
    canonical_anchor_id: canonical.anchor_id,
    matched_alias: canonical.matched_alias,
    match_type: canonical.match_type,
    evidence_span: canonical.evidence_spans[0]?.span ?? null,
    stance: canonical.stance,
    observed_anchor_reference: canonical.application === "explicit"
      ? "explicit"
      : "absent",
    observed_anchor_identifier: canonical.matched_alias,
    observed_anchor_text: canonical.evidence_spans[0]?.span ?? null,
    observed_anchor_conclusion: canonical.stance,
    observed_anchor_stance: canonical.stance,
    anchor_aliases_detected: [...new Set([
      ...reference.anchor_aliases_detected,
      ...(canonical.matched_alias ? [canonical.matched_alias] : [])
    ])],
    exact_anchor_evidence_spans: canonical.evidence_spans.filter((entry) =>
      entry.label === "anchor_reference"
    ),
    exact_stance_evidence_spans: canonical.evidence_spans.filter((entry) =>
      entry.label === "anchor_stance"
    ),
    ambiguous_due_to_multiple_stances:
      stance.ambiguous_due_to_conflicting_stances,
    direct_reference_mapped_absent: false,
    independent_reference_resolution: {
      resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
      observed_anchor_reference: reference.observed_anchor_reference,
      matched_alias: reference.observed_anchor_identifier,
      match_type: matchType
    },
    independent_stance_evidence_resolution: stance,
    independent_application_conflict: independentApplicationConflict,
    independent_stance_conflict: independentStanceConflict,
    canonical_anchor_evidence: canonical
  });
}
