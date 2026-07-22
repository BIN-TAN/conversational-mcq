import { z } from "zod";
import {
  ActiveAnchorAliasContractSchema,
  resolveActiveAnchorAlias,
  type ActiveAnchorAliasContract
} from "./active-anchor-alias-resolution";
import {
  CANONICAL_ANCHOR_EVIDENCE_VERSION,
  CanonicalAnchorEvidenceSchema,
  CanonicalAnchorMatchTypeSchema,
  CanonicalAnchorStanceSchema,
  type CanonicalAnchorEvidence
} from "./canonical-anchor-evidence";

export const ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2 =
  "active-anchor-alias-resolution-v2" as const;

const IndependentTextResolutionSchema = z.object({
  observed_anchor_reference: z.enum(["explicit", "absent"]),
  observed_anchor_stance: CanonicalAnchorStanceSchema,
  matched_alias: z.string().min(1).max(500).nullable(),
  match_type: CanonicalAnchorMatchTypeSchema
}).strict();

export const ActiveAnchorAliasResolutionV2Schema = z.object({
  resolver_version: z.literal(ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2),
  active_anchor_id: z.string().min(1).max(240),
  canonical_anchor_id: z.string().min(1).max(240),
  matched_alias: z.string().min(1).max(500).nullable(),
  match_type: CanonicalAnchorMatchTypeSchema,
  evidence_span: z.string().min(1).max(900).nullable(),
  stance: CanonicalAnchorStanceSchema,
  observed_anchor_reference: z.enum(["explicit", "absent"]),
  observed_anchor_identifier: z.string().min(1).max(500).nullable(),
  observed_anchor_text: z.string().min(1).max(900).nullable(),
  observed_anchor_conclusion: CanonicalAnchorStanceSchema,
  observed_anchor_stance: CanonicalAnchorStanceSchema,
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
  }).strict()).max(24),
  ambiguous_due_to_multiple_stances: z.boolean(),
  direct_reference_mapped_absent: z.boolean(),
  independent_text_resolution: IndependentTextResolutionSchema,
  independent_application_conflict: z.boolean(),
  independent_stance_conflict: z.boolean(),
  canonical_anchor_evidence: CanonicalAnchorEvidenceSchema
}).strict();
export type ActiveAnchorAliasResolutionV2 = z.infer<
  typeof ActiveAnchorAliasResolutionV2Schema
>;

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("en-CA");
}

function classifyMatchType(input: {
  alias: string | null;
  contract: ActiveAnchorAliasContract;
}): z.infer<typeof CanonicalAnchorMatchTypeSchema> {
  if (!input.alias) return "absent";
  const alias = normalized(input.alias);
  if (input.contract.accepted_identifiers.some((entry) =>
    normalized(entry) === alias
  )) return "exact_identifier";
  if (normalized(input.contract.option_text) === alias) return "exact_option_text";
  if (input.contract.accepted_aliases.some((entry) =>
    normalized(entry) === alias
  )) return "contract_alias";
  if (input.contract.accepted_paraphrases.some((entry) =>
    normalized(entry) === alias
  )) return "contract_paraphrase";
  if (input.contract.pronoun_resolution_context.accepted_pronouns.some((entry) =>
    normalized(entry) === alias
  )) return "contextual_pronoun";
  return "contract_alias";
}

function decisive(stance: string) {
  return stance === "endorses_distractor" || stance === "rejects_distractor";
}

function refineIndependentStance(input: {
  message: string;
  reference: "explicit" | "absent";
  stance: z.infer<typeof CanonicalAnchorStanceSchema>;
  match_type: z.infer<typeof CanonicalAnchorMatchTypeSchema>;
}) {
  if (input.reference === "absent" || decisive(input.stance)) return input.stance;
  const message = input.message.toLocaleLowerCase("en-CA");
  if (/\b(?:wrong|incorrect|false|invalid|unsupported|reject|does not work|doesn't work|cannot be right|can't be right|not true)\b/u.test(message)) {
    return "rejects_distractor" as const;
  }
  if (/\b(?:correct|right|true|valid|choose|select|pick|makes sense|is accurate|must be|probably is)\b/u.test(message)) {
    return "endorses_distractor" as const;
  }
  if (["exact_option_text", "contract_alias", "contract_paraphrase"].includes(
    input.match_type
  ) && !/[?]$/u.test(input.message.trim())) {
    return "endorses_distractor" as const;
  }
  return input.stance;
}

export function resolveActiveAnchorAliasV2(input: {
  message: string;
  contract: ActiveAnchorAliasContract;
  source_turn_id: string;
  source_sequence_index: number;
  prior_visible_message?: string | null;
  evaluator_canonical_evidence?: CanonicalAnchorEvidence;
}): ActiveAnchorAliasResolutionV2 {
  const contract = ActiveAnchorAliasContractSchema.parse(input.contract);
  const independent = resolveActiveAnchorAlias({
    message: input.message,
    contract,
    prior_visible_message: input.prior_visible_message
  });
  const independentMatchType = classifyMatchType({
    alias: independent.observed_anchor_identifier,
    contract
  });
  const independentStance = refineIndependentStance({
    message: input.message,
    reference: independent.observed_anchor_reference,
    stance: independent.observed_anchor_stance,
    match_type: independentMatchType
  });
  const canonical = input.evaluator_canonical_evidence
    ? CanonicalAnchorEvidenceSchema.parse(input.evaluator_canonical_evidence)
    : CanonicalAnchorEvidenceSchema.parse({
        canonicalization_version: CANONICAL_ANCHOR_EVIDENCE_VERSION,
        anchor_id: contract.active_anchor_id,
        anchor_label: contract.option_label,
        anchor_text: contract.option_text,
        matched_alias: independent.observed_anchor_identifier,
        match_type: independentMatchType,
        application: independent.observed_anchor_reference === "explicit"
          ? "explicit"
          : "absent",
        stance: independentStance,
        evidence_spans: [
          ...independent.exact_anchor_evidence_spans,
          ...independent.exact_stance_evidence_spans
        ],
        source_turn_id: input.source_turn_id,
        source_sequence_index: input.source_sequence_index,
        confidence: null
      });

  const independentApplicationConflict =
    independent.observed_anchor_reference === "explicit" &&
    canonical.application === "absent";
  const independentStanceConflict =
    independent.observed_anchor_reference === "explicit" &&
    decisive(independentStance) &&
    decisive(canonical.stance) &&
    independentStance !== canonical.stance;

  return ActiveAnchorAliasResolutionV2Schema.parse({
    resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION_V2,
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
      ...independent.anchor_aliases_detected,
      ...(canonical.matched_alias ? [canonical.matched_alias] : [])
    ])],
    exact_anchor_evidence_spans: canonical.evidence_spans.filter((entry) =>
      entry.label === "anchor_reference"
    ),
    exact_stance_evidence_spans: canonical.evidence_spans.filter((entry) =>
      entry.label === "anchor_stance"
    ),
    ambiguous_due_to_multiple_stances:
      independent.ambiguous_due_to_multiple_stances,
    direct_reference_mapped_absent: false,
    independent_text_resolution: {
      observed_anchor_reference: independent.observed_anchor_reference,
      observed_anchor_stance: independentStance,
      matched_alias: independent.observed_anchor_identifier,
      match_type: independentMatchType
    },
    independent_application_conflict: independentApplicationConflict,
    independent_stance_conflict: independentStanceConflict,
    canonical_anchor_evidence: canonical
  });
}
