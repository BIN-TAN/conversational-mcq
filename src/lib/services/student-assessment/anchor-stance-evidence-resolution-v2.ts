import { z } from "zod";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
  ActiveAnchorAliasContractSchema,
  ActiveAnchorAliasResolutionSchema,
  type ActiveAnchorAliasContract,
  type ActiveAnchorAliasResolution
} from "./active-anchor-alias-resolution";
import {
  ANCHOR_STANCE_RESOLUTION_VERSION,
  resolveAnchorStanceV1
} from "./anchor-stance-resolution-v1";
import {
  CanonicalAnchorStanceSchema
} from "./canonical-anchor-evidence";

export const ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION =
  "anchor-stance-evidence-contract-v2" as const;
export const ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION =
  "anchor-stance-evidence-resolution-v2" as const;

const AnchorStanceEvidenceCueCodeSchema = z.enum([
  "direct_agreement",
  "direct_disagreement",
  "direct_endorsement",
  "direct_rejection",
  "negated_agreement",
  "negated_disagreement",
  "contrastive_endorsement",
  "contrastive_rejection",
  "uncertainty",
  "prior_reasoning_continuity",
  "baseline_v1_decisive",
  "no_decisive_stance"
]);

const AnchorStanceEvidenceResolutionBasisSchema = z.enum([
  "not_expressed",
  "direct_agreement",
  "direct_disagreement",
  "direct_endorsement",
  "direct_rejection",
  "negation",
  "contrast",
  "uncertainty",
  "prior_student_reasoning",
  "baseline_v1",
  "insufficient_evidence"
]);

const AnchorStanceEvidenceSpanSchema = z.object({
  label: z.literal("anchor_stance"),
  span: z.string().min(1).max(900),
  start_index: z.number().int().nonnegative()
}).strict();

export const AnchorStanceEvidenceResolutionV2Schema = z.object({
  evidence_contract_version: z.literal(
    ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION
  ),
  resolver_version: z.literal(
    ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION
  ),
  reference_resolver_version: z.literal(
    ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION
  ),
  baseline_stance_resolver_version: z.literal(
    ANCHOR_STANCE_RESOLUTION_VERSION
  ),
  active_anchor_id: z.string().min(1).max(240),
  anchor_reference: z.enum(["explicit", "absent"]),
  observed_anchor_stance: CanonicalAnchorStanceSchema,
  resolution_basis: AnchorStanceEvidenceResolutionBasisSchema,
  cue_codes: z.array(AnchorStanceEvidenceCueCodeSchema).max(32),
  direct_agreement_detected: z.boolean(),
  direct_disagreement_detected: z.boolean(),
  direct_endorsement_detected: z.boolean(),
  direct_rejection_detected: z.boolean(),
  uncertainty_detected: z.boolean(),
  negation_detected: z.boolean(),
  contrast_detected: z.boolean(),
  discourse_resolution_applied: z.boolean(),
  prior_reasoning_considered: z.boolean(),
  prior_reasoning_used: z.boolean(),
  ambiguous_due_to_conflicting_stances: z.boolean(),
  baseline_observed_anchor_stance: CanonicalAnchorStanceSchema,
  exact_stance_evidence_spans: z.array(
    AnchorStanceEvidenceSpanSchema
  ).max(32)
}).strict();
export type AnchorStanceEvidenceResolutionV2 = z.infer<
  typeof AnchorStanceEvidenceResolutionV2Schema
>;

export type PriorStudentAnchorStanceEvidence = {
  message: string;
  reference_resolution: ActiveAnchorAliasResolution;
  stance: z.infer<typeof CanonicalAnchorStanceSchema>;
};

type DecisiveStance = "endorses_distractor" | "rejects_distractor";
type CueCode = z.infer<typeof AnchorStanceEvidenceCueCodeSchema>;
type DecisiveCue = {
  code: CueCode;
  stance: DecisiveStance;
  start: number;
  end: number;
};
type TextRange = {
  start: number;
  end: number;
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function uniqueStrings(values: string[]) {
  return unique(values.map((value) => value.trim()).filter(Boolean));
}

function aliasPattern(alias: string) {
  const escaped = escapeRegex(alias.trim()).replace(/\s+/gu, "\\s+");
  return alias.trim().length === 1
    ? `\\b${escaped}\\b`
    : `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`;
}

function allMatches(message: string, pattern: RegExp): TextRange[] {
  return [...message.matchAll(pattern)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
}

function quotedRanges(message: string) {
  return [
    ...message.matchAll(/["“][^"”]{1,900}["”]/gu),
    ...message.matchAll(/['‘][^'’]{1,900}['’]/gu)
  ].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
}

function isQuoted(
  position: number,
  ranges: ReturnType<typeof quotedRanges>
) {
  return ranges.some((range) =>
    position >= range.start && position < range.end
  );
}

function sentenceAt(message: string, index: number) {
  const left = Math.max(
    message.lastIndexOf(".", index - 1),
    message.lastIndexOf("!", index - 1),
    message.lastIndexOf("?", index - 1),
    message.lastIndexOf(";", index - 1),
    message.lastIndexOf("\n", index - 1)
  ) + 1;
  const ends = [".", "!", "?", ";", "\n"]
    .map((separator) => message.indexOf(separator, index))
    .filter((candidate) => candidate >= 0);
  const right = ends.length > 0 ? Math.min(...ends) + 1 : message.length;
  return {
    start: left,
    span: message.slice(left, right).trim().slice(0, 900)
  };
}

function decisive(value: string): value is DecisiveStance {
  return value === "endorses_distractor" ||
    value === "rejects_distractor";
}

function buildAnchorExpression(input: {
  contract: ActiveAnchorAliasContract;
  reference: ActiveAnchorAliasResolution;
}) {
  const aliases = uniqueStrings([
    input.reference.observed_anchor_identifier ?? "",
    input.reference.observed_anchor_text ?? "",
    ...input.reference.anchor_aliases_detected,
    ...input.contract.accepted_identifiers,
    input.contract.option_text,
    ...input.contract.accepted_aliases,
    ...input.contract.accepted_paraphrases,
    ...input.contract.pronoun_resolution_context.accepted_pronouns
  ]).sort((left, right) => right.length - left.length);
  return `(?:${aliases.map(aliasPattern).join("|")})`;
}

function cueMatches(input: {
  message: string;
  pattern: RegExp;
  code: CueCode;
  stance: DecisiveStance;
  quoted: ReturnType<typeof quotedRanges>;
  rejectNegatedPrefix?: boolean;
}) {
  return allMatches(input.message, input.pattern)
    .filter((match) => !isQuoted(match.start, input.quoted))
    .filter((match) => {
      if (!input.rejectNegatedPrefix) return true;
      const prefix = input.message.slice(
        Math.max(0, match.start - 36),
        match.start
      );
      return !/\b(?:not|never|no|don't|do not|can't|cannot|wouldn't|would not)\s*$/iu
        .test(prefix);
    })
    .map((match): DecisiveCue => ({
      code: input.code,
      stance: input.stance,
      start: match.start,
      end: match.end
    }));
}

function uncertaintyMatches(input: {
  message: string;
  anchorExpression: string;
  quoted: ReturnType<typeof quotedRanges>;
}) {
  const anchor = input.anchorExpression;
  const patterns = [
    new RegExp(`\\b(?:maybe|perhaps|possibly)\\s+(?:the\\s+)?${anchor}`, "giu"),
    new RegExp(`\\b(?:i(?:\\s+am|'m)?\\s+)?(?:am\\s+)?(?:still\\s+)?(?:not\\s+sure|unsure|uncertain|undecided)\\s+(?:about\\s+)?(?:the\\s+)?${anchor}`, "giu"),
    new RegExp(`\\b(?:i\\s+)?(?:might|may|could)\\s+(?:agree|disagree)\\s+with\\s+(?:the\\s+)?${anchor}`, "giu"),
    new RegExp(`${anchor}\\s+(?:might|may|could)\\s+(?:still\\s+)?(?:be\\s+)?(?:correct|right|valid|true|wrong|incorrect|possible|plausible)`, "giu"),
    new RegExp(`\\b(?:not\\s+sure|unsure|uncertain|undecided)[\\s\\S]{0,100}${anchor}`, "giu"),
    new RegExp(`${anchor}[\\s\\S]{0,100}\\b(?:not\\s+sure|unsure|uncertain|undecided|could\\s+go\\s+either\\s+way)\\b`, "giu")
  ];
  const matches = patterns.flatMap((pattern) =>
    allMatches(input.message, pattern)
  ).filter((match) => !isQuoted(match.start, input.quoted));
  if (matches.length > 0) return matches;
  const trimmed = input.message.trim();
  return trimmed.endsWith("?") &&
      new RegExp(anchor, "iu").test(trimmed)
    ? [{
        start: Math.max(0, input.message.lastIndexOf("?")),
        end: input.message.length
      }]
    : [];
}

function resolveFromPriorReasoning(input: {
  message: string;
  prior: PriorStudentAnchorStanceEvidence[];
}) {
  const continuity =
    /\b(?:still|same view|same answer|unchanged|as before|continue to think|stand by (?:that|it|my answer)|keep my (?:view|answer))\b/iu
      .test(input.message);
  if (!continuity) return null;
  return [...input.prior].reverse().find((entry) => decisive(entry.stance)) ??
    null;
}

function baselineCues(input: {
  message: string;
  stance: DecisiveStance;
  spans: Array<{ start_index: number; span: string }>;
}): DecisiveCue[] {
  if (input.spans.length === 0) {
    return [{
      code: "baseline_v1_decisive",
      stance: input.stance,
      start: 0,
      end: input.message.length
    }];
  }
  return input.spans.map((span) => ({
    code: "baseline_v1_decisive",
    stance: input.stance,
    start: span.start_index,
    end: span.start_index + span.span.length
  }));
}

function basisForCue(cue: DecisiveCue) {
  if (cue.code === "direct_agreement") return "direct_agreement" as const;
  if (cue.code === "direct_disagreement") {
    return "direct_disagreement" as const;
  }
  if (
    cue.code === "negated_agreement" ||
    cue.code === "negated_disagreement"
  ) return "negation" as const;
  if (
    cue.code === "contrastive_endorsement" ||
    cue.code === "contrastive_rejection"
  ) return "contrast" as const;
  if (cue.code === "baseline_v1_decisive") return "baseline_v1" as const;
  return cue.stance === "endorses_distractor"
    ? "direct_endorsement" as const
    : "direct_rejection" as const;
}

export function resolveAnchorStanceEvidenceV2(input: {
  message: string;
  contract: ActiveAnchorAliasContract;
  reference_resolution: ActiveAnchorAliasResolution;
  prior_student_reasoning?: PriorStudentAnchorStanceEvidence[];
}): AnchorStanceEvidenceResolutionV2 {
  const contract = ActiveAnchorAliasContractSchema.parse(input.contract);
  const reference = ActiveAnchorAliasResolutionSchema.parse(
    input.reference_resolution
  );
  const message = input.message.trim();
  const prior = input.prior_student_reasoning ?? [];
  const baseline = resolveAnchorStanceV1({
    message,
    contract,
    reference_resolution: reference,
    prior_student_reasoning: prior
  });

  if (reference.observed_anchor_reference === "absent") {
    return AnchorStanceEvidenceResolutionV2Schema.parse({
      evidence_contract_version: ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION,
      resolver_version: ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
      reference_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
      baseline_stance_resolver_version: ANCHOR_STANCE_RESOLUTION_VERSION,
      active_anchor_id: contract.active_anchor_id,
      anchor_reference: "absent",
      observed_anchor_stance: "not_expressed",
      resolution_basis: "not_expressed",
      cue_codes: ["no_decisive_stance"],
      direct_agreement_detected: false,
      direct_disagreement_detected: false,
      direct_endorsement_detected: false,
      direct_rejection_detected: false,
      uncertainty_detected: false,
      negation_detected: false,
      contrast_detected: false,
      discourse_resolution_applied: false,
      prior_reasoning_considered: prior.length > 0,
      prior_reasoning_used: false,
      ambiguous_due_to_conflicting_stances: false,
      baseline_observed_anchor_stance:
        baseline.observed_anchor_stance,
      exact_stance_evidence_spans: []
    });
  }

  const anchor = buildAnchorExpression({ contract, reference });
  const quoted = quotedRanges(message);
  const positive = "(?:accurate|correct|right|valid|reasonable|appropriate|best|true)";
  const negative = "(?:wrong|incorrect|inaccurate|invalid|unsupported|false)";
  const anaphor =
    "(?:it|that|this|that\\s+(?:option|choice|answer|claim)|this\\s+(?:option|choice|answer|claim)|the\\s+(?:option|choice|answer|claim))";
  const cues: DecisiveCue[] = [
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:i\\s+)?(?:still\\s+|now\\s+|definitely\\s+|strongly\\s+|fully\\s+)?agree(?:d|s|ing)?\\s+with\\s+(?:the\\s+)?${anchor}`, "giu"),
      code: "direct_agreement",
      stance: "endorses_distractor",
      quoted,
      rejectNegatedPrefix: true
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:i\\s+)?(?:still\\s+|now\\s+|definitely\\s+|strongly\\s+|fully\\s+)?disagree(?:d|s|ing)?\\s+with\\s+(?:the\\s+)?${anchor}`, "giu"),
      code: "direct_disagreement",
      stance: "rejects_distractor",
      quoted,
      rejectNegatedPrefix: true
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:i\\s+)?(?:do\\s+not|don't|cannot|can't|would\\s+not|wouldn't|will\\s+not|won't)\\s+agree\\s+with\\s+(?:the\\s+)?${anchor}`, "giu"),
      code: "negated_agreement",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:i\\s+)?(?:do\\s+not|don't|cannot|can't|would\\s+not|wouldn't|will\\s+not|won't)\\s+disagree\\s+with\\s+(?:the\\s+)?${anchor}`, "giu"),
      code: "negated_disagreement",
      stance: "endorses_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:i\\s+)?(?:do\\s+not|don't|cannot|can't|would\\s+not|wouldn't|will\\s+not|won't|should\\s+not|shouldn't)\\s+(?:keep|choose|select|pick|accept|endorse|retain)\\s+(?:the\\s+)?${anchor}`, "giu"),
      code: "direct_rejection",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`${anchor}\\s+(?:still\\s+)?(?:is|was|remains|seems|looks|sounds)\\s+(?:still\\s+|clearly\\s+|definitely\\s+|probably\\s+)?${positive}`, "giu"),
      code: "direct_endorsement",
      stance: "endorses_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`${anchor}\\s+(?:still\\s+)?(?:is|was|remains|seems|looks|sounds)\\s+(?:still\\s+|clearly\\s+|definitely\\s+|probably\\s+)?${negative}`, "giu"),
      code: "direct_rejection",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`${anchor}\\s+(?:does|did)\\s+not\\s+make\\s+sense`, "giu"),
      code: "direct_rejection",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`${anchor}[\\s\\S]{0,80}\\b(?:tempting|plausible|appealing|sounds?\\s+right)[\\s\\S]{0,50}\\b(?:but|yet|however)[\\s\\S]{0,50}\\b${negative}`, "giu"),
      code: "contrastive_rejection",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:but|however|yet|nevertheless)[,\\s]+(?:(?:it|that|this|the\\s+(?:option|choice|answer|claim))\\s+(?:is|was|seems|looks|sounds)?\\s*)?${negative}`, "giu"),
      code: "contrastive_rejection",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:but|however|yet|nevertheless|instead|rather)[,\\s]+${anaphor}\\s+(?:still\\s+)?(?:is|was|seems|looks|sounds)?\\s*${negative}`, "giu"),
      code: "contrastive_rejection",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:but|however|yet|nevertheless|instead|rather)[,\\s]+${anaphor}\\s+(?:still\\s+)?(?:is|was|seems|looks|sounds)?\\s*${positive}`, "giu"),
      code: "contrastive_endorsement",
      stance: "endorses_distractor",
      quoted
    }),
    ...(decisive(baseline.observed_anchor_stance) &&
        !baseline.prior_reasoning_used
      ? baselineCues({
          message,
          stance: baseline.observed_anchor_stance,
          spans: baseline.exact_stance_evidence_spans
        })
      : [])
  ];
  const uncertainty = uncertaintyMatches({
    message,
    anchorExpression: anchor,
    quoted
  });
  const contrast = allMatches(
    message,
    /\b(?:but|however|yet|although|even though|nevertheless|instead|rather)\b/giu
  );
  const correction = allMatches(
    message,
    /\b(?:actually|on second thought|i mean|correction|rather)\b/giu
  );
  const latestDiscourseBoundary = Math.max(
    contrast.at(-1)?.start ?? -1,
    correction.at(-1)?.start ?? -1
  );
  const cuesAfterBoundary = latestDiscourseBoundary >= 0
    ? cues.filter((cue) => cue.start >= latestDiscourseBoundary)
    : [];
  const uncertaintyAfterBoundary = latestDiscourseBoundary >= 0
    ? uncertainty.filter((entry) => entry.start >= latestDiscourseBoundary)
    : [];
  const priorResolution = resolveFromPriorReasoning({
    message,
    prior
  });

  let stance: z.infer<typeof CanonicalAnchorStanceSchema> = "ambiguous";
  let basis: z.infer<typeof AnchorStanceEvidenceResolutionBasisSchema> =
    "insufficient_evidence";
  let priorUsed = false;
  let discourseApplied = false;
  let conflicting = false;
  let selectedCue: DecisiveCue | null = null;

  if (latestDiscourseBoundary >= 0) {
    discourseApplied = true;
    if (uncertaintyAfterBoundary.length > 0) {
      stance = "ambiguous";
      basis = "uncertainty";
    } else if (cuesAfterBoundary.length > 0) {
      selectedCue = [...cuesAfterBoundary].sort((left, right) =>
        left.start - right.start || left.end - right.end
      ).at(-1) ?? null;
      stance = selectedCue?.stance ?? "ambiguous";
      basis = selectedCue ? "contrast" : "insufficient_evidence";
    } else if (uncertainty.length > 0) {
      stance = "ambiguous";
      basis = "uncertainty";
    }
  } else if (uncertainty.length > 0) {
    stance = "ambiguous";
    basis = "uncertainty";
  } else if (cues.length > 0) {
    const stances = new Set(cues.map((cue) => cue.stance));
    conflicting = stances.size > 1;
    if (!conflicting) {
      selectedCue = [...cues].sort((left, right) =>
        left.start - right.start || left.end - right.end
      ).at(-1) ?? null;
      stance = selectedCue?.stance ?? "ambiguous";
      basis = selectedCue
        ? basisForCue(selectedCue)
        : "insufficient_evidence";
    }
  } else if (priorResolution) {
    stance = priorResolution.stance;
    basis = "prior_student_reasoning";
    priorUsed = true;
    discourseApplied = true;
  } else if (decisive(baseline.observed_anchor_stance)) {
    stance = baseline.observed_anchor_stance;
    basis = "baseline_v1";
  }

  const directAgreement = cues.some((cue) =>
    cue.code === "direct_agreement" ||
    cue.code === "negated_disagreement"
  );
  const directDisagreement = cues.some((cue) =>
    cue.code === "direct_disagreement" ||
    cue.code === "negated_agreement"
  );
  const evidencePositions = unique([
    ...cues.map((cue) => cue.start),
    ...uncertainty.map((entry) => entry.start),
    ...(priorUsed && reference.exact_anchor_evidence_spans[0]
      ? [reference.exact_anchor_evidence_spans[0].start_index]
      : [])
  ]);
  const exactSpans = uniqueStrings(evidencePositions.map((position) => {
    const sentence = sentenceAt(message, position);
    return `${sentence.start}:${sentence.span}`;
  })).map((entry) => {
    const separator = entry.indexOf(":");
    return {
      label: "anchor_stance" as const,
      start_index: Number(entry.slice(0, separator)),
      span: entry.slice(separator + 1)
    };
  }).filter((entry) => entry.span.length > 0);
  const cueCodes = unique([
    ...cues.map((cue) => cue.code),
    ...(uncertainty.length > 0 ? ["uncertainty" as const] : []),
    ...(priorUsed ? ["prior_reasoning_continuity" as const] : []),
    ...(cues.length === 0 && uncertainty.length === 0 && !priorUsed
      ? ["no_decisive_stance" as const]
      : [])
  ]);

  return AnchorStanceEvidenceResolutionV2Schema.parse({
    evidence_contract_version: ANCHOR_STANCE_EVIDENCE_CONTRACT_VERSION,
    resolver_version: ANCHOR_STANCE_EVIDENCE_RESOLUTION_VERSION,
    reference_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
    baseline_stance_resolver_version: ANCHOR_STANCE_RESOLUTION_VERSION,
    active_anchor_id: contract.active_anchor_id,
    anchor_reference: "explicit",
    observed_anchor_stance: stance,
    resolution_basis: basis,
    cue_codes: cueCodes,
    direct_agreement_detected: directAgreement,
    direct_disagreement_detected: directDisagreement,
    direct_endorsement_detected: cues.some((cue) =>
      cue.stance === "endorses_distractor"
    ),
    direct_rejection_detected: cues.some((cue) =>
      cue.stance === "rejects_distractor"
    ),
    uncertainty_detected: uncertainty.length > 0,
    negation_detected: cues.some((cue) =>
      cue.code === "negated_agreement" ||
      cue.code === "negated_disagreement"
    ) || baseline.negation_detected,
    contrast_detected: contrast.length > 0,
    discourse_resolution_applied: discourseApplied,
    prior_reasoning_considered: prior.length > 0,
    prior_reasoning_used: priorUsed,
    ambiguous_due_to_conflicting_stances: conflicting,
    baseline_observed_anchor_stance: baseline.observed_anchor_stance,
    exact_stance_evidence_spans: exactSpans
  });
}
