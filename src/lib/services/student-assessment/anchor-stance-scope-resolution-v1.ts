import { z } from "zod";
import {
  ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
  ActiveAnchorAliasContractSchema,
  ActiveAnchorAliasResolutionSchema,
  type ActiveAnchorAliasContract,
  type ActiveAnchorAliasResolution
} from "./active-anchor-alias-resolution";
import {
  CanonicalAnchorStanceSchema
} from "./canonical-anchor-evidence";

export const ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION =
  "anchor-stance-scope-resolution-v1" as const;

const PolaritySchema = z.enum(["positive", "negative", "uncertain"]);
const PolarityCueTypeSchema = z.enum([
  "agreement",
  "disagreement",
  "selection",
  "rejection",
  "positive_lexical",
  "negative_lexical",
  "uncertainty",
  "negation"
]);
const AnchorAttachmentSchema = z.enum([
  "anchor_targeted",
  "non_anchor",
  "ambiguous"
]);
const AnchorAttachmentBasisSchema = z.enum([
  "explicit_anchor_predication",
  "explicit_anchor_speech_act",
  "anchor_pronoun_after_reference",
  "within_anchor_scoped_expression",
  "non_anchor_entity",
  "no_anchor_attachment",
  "unclear_attachment"
]);
const ScopeResolutionBasisSchema = z.enum([
  "not_expressed",
  "direct_endorsement",
  "direct_rejection",
  "negation",
  "contrast",
  "uncertainty",
  "prior_student_reasoning",
  "insufficient_anchor_targeted_evidence"
]);

const PolarityCueSchema = z.object({
  cue_id: z.string().min(1).max(120),
  cue_type: PolarityCueTypeSchema,
  polarity: PolaritySchema,
  span: z.string().min(1).max(900),
  start_index: z.number().int().nonnegative(),
  end_index: z.number().int().positive()
}).strict();

const AnchorAttachmentDecisionSchema = z.object({
  cue_id: z.string().min(1).max(120),
  attachment: AnchorAttachmentSchema,
  attachment_basis: AnchorAttachmentBasisSchema,
  superseded_by_specific_anchor_scope: z.boolean(),
  suppressed_by_uncertainty_scope: z.boolean()
}).strict();

const AnchorStanceEvidenceSpanSchema = z.object({
  label: z.literal("anchor_stance"),
  span: z.string().min(1).max(900),
  start_index: z.number().int().nonnegative()
}).strict();

export const AnchorStanceScopeResolutionV1Schema = z.object({
  resolver_version: z.literal(ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION),
  reference_resolver_version: z.literal(
    ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION
  ),
  active_anchor_id: z.string().min(1).max(240),
  anchor_reference: z.enum(["explicit", "absent"]),
  polarity_detection: z.object({
    cue_count: z.number().int().nonnegative(),
    cues: z.array(PolarityCueSchema).max(96)
  }).strict(),
  anchor_target_attachment: z.object({
    decisions: z.array(AnchorAttachmentDecisionSchema).max(96),
    anchor_targeted_cue_count: z.number().int().nonnegative(),
    non_anchor_cue_count: z.number().int().nonnegative(),
    ambiguous_attachment_count: z.number().int().nonnegative()
  }).strict(),
  stance_classification: z.object({
    observed_anchor_stance: CanonicalAnchorStanceSchema,
    resolution_basis: ScopeResolutionBasisSchema,
    decisive_anchor_cue_ids: z.array(z.string().min(1).max(120)).max(64),
    ignored_non_anchor_cue_ids: z.array(z.string().min(1).max(120)).max(64),
    uncertainty_anchor_cue_ids: z.array(z.string().min(1).max(120)).max(64),
    contrast_detected: z.boolean(),
    negation_detected: z.boolean(),
    prior_reasoning_considered: z.boolean(),
    prior_reasoning_used: z.boolean(),
    ambiguous_due_to_conflicting_anchor_stances: z.boolean()
  }).strict(),
  exact_stance_evidence_spans: z.array(
    AnchorStanceEvidenceSpanSchema
  ).max(64)
}).strict();
export type AnchorStanceScopeResolutionV1 = z.infer<
  typeof AnchorStanceScopeResolutionV1Schema
>;

export type PriorScopedAnchorStance = {
  stance: z.infer<typeof CanonicalAnchorStanceSchema>;
};

type CueType = z.infer<typeof PolarityCueTypeSchema>;
type Polarity = z.infer<typeof PolaritySchema>;
type Attachment = z.infer<typeof AnchorAttachmentSchema>;
type AttachmentBasis = z.infer<typeof AnchorAttachmentBasisSchema>;
type CandidateCue = z.infer<typeof PolarityCueSchema> & {
  attachment: Attachment;
  attachment_basis: AttachmentBasis;
};
type TextRange = { start: number; end: number };

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
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

function isQuoted(position: number, ranges: TextRange[]) {
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

function overlaps(left: TextRange, right: TextRange) {
  return left.start < right.end && right.start < left.end;
}

function decisive(value: string): value is
  "endorses_distractor" | "rejects_distractor" {
  return value === "endorses_distractor" ||
    value === "rejects_distractor";
}

function buildAnchorExpression(input: {
  contract: ActiveAnchorAliasContract;
  reference: ActiveAnchorAliasResolution;
}) {
  const aliases = unique([
    input.reference.observed_anchor_identifier ?? "",
    input.reference.observed_anchor_text ?? "",
    ...input.reference.anchor_aliases_detected,
    ...input.contract.accepted_identifiers,
    input.contract.option_text,
    ...input.contract.accepted_aliases,
    ...input.contract.accepted_paraphrases,
    ...input.contract.pronoun_resolution_context.accepted_pronouns
  ].map((value) => value.trim()).filter(Boolean))
    .sort((left, right) => right.length - left.length);
  return `(?:${aliases.map(aliasPattern).join("|")})`;
}

function addMatches(input: {
  message: string;
  pattern: RegExp;
  cue_type: CueType;
  polarity: Polarity;
  attachment: Attachment;
  attachment_basis: AttachmentBasis;
  quoted: TextRange[];
  reject_negated_prefix?: boolean;
}) {
  return allMatches(input.message, input.pattern)
    .filter((match) => !isQuoted(match.start, input.quoted))
    .filter((match) => {
      if (!input.reject_negated_prefix) return true;
      const prefix = input.message.slice(
        Math.max(0, match.start - 48),
        match.start
      );
      return !/\b(?:not|never|no|don't|do not|can't|cannot|wouldn't|would not)\s*$/iu
        .test(prefix);
    })
    .map((match) => ({
      cue_type: input.cue_type,
      polarity: input.polarity,
      span: input.message.slice(match.start, match.end).slice(0, 900),
      start_index: match.start,
      end_index: match.end,
      attachment: input.attachment,
      attachment_basis: input.attachment_basis
    }));
}

function cueId(input: Omit<CandidateCue, "cue_id">, index: number) {
  return [
    "scope",
    index + 1,
    input.cue_type,
    input.polarity,
    input.start_index,
    input.end_index
  ].join("_");
}

function deduplicateCues(
  cues: Array<Omit<CandidateCue, "cue_id">>
): CandidateCue[] {
  const seen = new Set<string>();
  return cues
    .sort((left, right) =>
      left.start_index - right.start_index ||
      left.end_index - right.end_index ||
      left.attachment.localeCompare(right.attachment)
    )
    .filter((cue) => {
      const key = [
        cue.cue_type,
        cue.polarity,
        cue.start_index,
        cue.end_index,
        cue.attachment
      ].join(":");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((cue, index) => ({
      ...cue,
      cue_id: cueId(cue, index)
    }));
}

function classifyResolutionBasis(input: {
  stance: "endorses_distractor" | "rejects_distractor";
  cues: CandidateCue[];
  contrast_applied: boolean;
}) {
  if (input.contrast_applied) return "contrast" as const;
  if (input.cues.some((cue) => cue.cue_type === "negation")) {
    return "negation" as const;
  }
  return input.stance === "endorses_distractor"
    ? "direct_endorsement" as const
    : "direct_rejection" as const;
}

export function resolveAnchorStanceScopeV1(input: {
  message: string;
  contract: ActiveAnchorAliasContract;
  reference_resolution: ActiveAnchorAliasResolution;
  prior_student_reasoning?: PriorScopedAnchorStance[];
}): AnchorStanceScopeResolutionV1 {
  const contract = ActiveAnchorAliasContractSchema.parse(input.contract);
  const reference = ActiveAnchorAliasResolutionSchema.parse(
    input.reference_resolution
  );
  const message = input.message.trim();
  const prior = input.prior_student_reasoning ?? [];
  const anchor = buildAnchorExpression({ contract, reference });
  const quoted = quotedRanges(message);
  const positive =
    "(?:accurate|correct|right|valid|reasonable|appropriate|best|true|sound)";
  const negative =
    "(?:wrong|incorrect|inaccurate|invalid|unsupported|false|flawed)";
  const anaphor =
    "(?:it|that|this|that\\s+(?:option|choice|answer|claim)|this\\s+(?:option|choice|answer|claim)|the\\s+(?:option|choice|answer|claim))";

  const generic = [
    ...addMatches({
      message,
      pattern: /\b(?:accurate|correct|right|valid|reasonable|appropriate|best|true|sound)\b/giu,
      cue_type: "positive_lexical",
      polarity: "positive",
      attachment: "non_anchor",
      attachment_basis: "no_anchor_attachment",
      quoted
    }),
    ...addMatches({
      message,
      pattern: /\b(?:wrong|incorrect|inaccurate|invalid|unsupported|false|flawed)\b/giu,
      cue_type: "negative_lexical",
      polarity: "negative",
      attachment: "non_anchor",
      attachment_basis: "no_anchor_attachment",
      quoted
    }),
    ...addMatches({
      message,
      pattern: /\b(?:maybe|perhaps|possibly|unsure|uncertain|undecided|not sure)\b/giu,
      cue_type: "uncertainty",
      polarity: "uncertain",
      attachment: "non_anchor",
      attachment_basis: "no_anchor_attachment",
      quoted
    })
  ];

  const targeted = reference.observed_anchor_reference === "explicit"
    ? [
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:i\\s+)?(?:still\\s+|now\\s+|definitely\\s+|strongly\\s+)?agree(?:d|s|ing)?\\s+with\\s+(?:the\\s+)?${anchor}`, "giu"),
          cue_type: "agreement",
          polarity: "positive",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_speech_act",
          quoted,
          reject_negated_prefix: true
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:i\\s+)?(?:do\\s+not|don't|cannot|can't|would\\s+not|wouldn't|will\\s+not|won't)\\s+agree\\s+with\\s+(?:the\\s+)?${anchor}`, "giu"),
          cue_type: "negation",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_speech_act",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:i\\s+)?(?:still\\s+|now\\s+|definitely\\s+|strongly\\s+)?disagree(?:d|s|ing)?\\s+with\\s+(?:the\\s+)?${anchor}`, "giu"),
          cue_type: "disagreement",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_speech_act",
          quoted,
          reject_negated_prefix: true
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:i\\s+)?(?:do\\s+not|don't|cannot|can't|would\\s+not|wouldn't|will\\s+not|won't)\\s+disagree\\s+with\\s+(?:the\\s+)?${anchor}`, "giu"),
          cue_type: "negation",
          polarity: "positive",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_speech_act",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:i\\s+)?(?:would\\s+|will\\s+|still\\s+|now\\s+)?(?:keep|choose|select|pick|accept|endorse|retain|go\\s+with|stand\\s+by)\\s+(?:the\\s+)?${anchor}(?!\\s+as\\s+(?:a|the)\\s+(?:distractor|wrong\\s+option|incorrect\\s+(?:option|answer)))`, "giu"),
          cue_type: "selection",
          polarity: "positive",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_speech_act",
          quoted,
          reject_negated_prefix: true
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:i\\s+)?(?:do\\s+not|don't|cannot|can't|would\\s+not|wouldn't|will\\s+not|won't|should\\s+not|shouldn't)\\s+(?:keep|choose|select|pick|accept|endorse|retain|go\\s+with)\\s+(?:the\\s+)?${anchor}`, "giu"),
          cue_type: "negation",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_speech_act",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:reject|rejected|discard|discarded|eliminate|eliminated|cross\\s+out|rule\\s+out)\\s+(?:the\\s+)?${anchor}`, "giu"),
          cue_type: "rejection",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_speech_act",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:keep|retain)\\s+(?:the\\s+)?${anchor}\\s+as\\s+(?:a|the)\\s+(?:distractor|wrong\\s+option|incorrect\\s+(?:option|answer))`, "giu"),
          cue_type: "rejection",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_speech_act",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}\\s+(?:still\\s+)?(?:is|was|remains|seems|looks|sounds)\\s+(?:still\\s+|clearly\\s+|definitely\\s+|probably\\s+)?${positive}`, "giu"),
          cue_type: "positive_lexical",
          polarity: "positive",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_predication",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}\\s+(?:still\\s+)?(?:is|was|remains|seems|looks|sounds)\\s+(?:still\\s+|clearly\\s+|definitely\\s+|probably\\s+)?${negative}`, "giu"),
          cue_type: "negative_lexical",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_predication",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}\\s+(?:is|was|seems|looks|sounds)?\\s*not\\s+${positive}`, "giu"),
          cue_type: "negation",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_predication",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}\\s+(?:is|was|seems|looks|sounds)?\\s*not\\s+${negative}`, "giu"),
          cue_type: "negation",
          polarity: "positive",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_predication",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}\\s+(?:still\\s+)?(?:makes|made)\\s+sense`, "giu"),
          cue_type: "positive_lexical",
          polarity: "positive",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_predication",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}\\s+(?:still\\s+)?does\\s+not\\s+make\\s+sense`, "giu"),
          cue_type: "negation",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_predication",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}\\s+(?:is\\s+)?(?:tempting|plausible|appealing|attractive)[\\s,]{0,4}(?:but|yet|although)[\\s,]{0,4}(?:it\\s+)?(?:is\\s+)?${negative}`, "giu"),
          cue_type: "negative_lexical",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_predication",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}\\s+(?:seems|looks|sounds)\\s+${positive}[\\s,]{0,4}(?:but|yet|although)[\\s,]{0,4}(?:(?:it|that)\\s+)?(?:is\\s+)?${negative}`, "giu"),
          cue_type: "negative_lexical",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_predication",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:i\\s+)?(?:do\\s+not|don't)\\s+(?:think|believe)\\s+(?:that\\s+)?${anchor}(?:\\s+(?:is\\s+)?${positive})?`, "giu"),
          cue_type: "negation",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_speech_act",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:i\\s+)?(?:still\\s+)?(?:think|believe)\\s+(?:that\\s+)?${anchor}(?:\\s+(?:is\\s+)?${positive})?`, "giu"),
          cue_type: "agreement",
          polarity: "positive",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_speech_act",
          quoted,
          reject_negated_prefix: true
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:i(?:\\s+am|'m)?\\s+)?(?:am\\s+)?(?:still\\s+)?(?:not\\s+sure|unsure|uncertain|undecided)\\s+(?:about|whether)?\\s*(?:the\\s+)?${anchor}[\\s\\S]{0,60}`, "giu"),
          cue_type: "uncertainty",
          polarity: "uncertain",
          attachment: "anchor_targeted",
          attachment_basis: "within_anchor_scoped_expression",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:maybe|perhaps|possibly)\\s+(?:the\\s+)?${anchor}[\\s\\S]{0,60}`, "giu"),
          cue_type: "uncertainty",
          polarity: "uncertain",
          attachment: "anchor_targeted",
          attachment_basis: "within_anchor_scoped_expression",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:i\\s+)?(?:might|may|could)\\s+(?:agree|disagree)\\s+with\\s+(?:the\\s+)?${anchor}[\\s\\S]{0,40}`, "giu"),
          cue_type: "uncertainty",
          polarity: "uncertain",
          attachment: "anchor_targeted",
          attachment_basis: "within_anchor_scoped_expression",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`\\b(?:could|might|may)\\s+(?:the\\s+)?${anchor}\\s+(?:still\\s+)?(?:be|seem|sound|look)\\s+(?:correct|right|valid|true|wrong|incorrect|possible|plausible)`, "giu"),
          cue_type: "uncertainty",
          polarity: "uncertain",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_predication",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}\\s+(?:might|may|could)\\s+(?:still\\s+)?(?:be\\s+)?(?:correct|right|valid|true|wrong|incorrect|possible|plausible)`, "giu"),
          cue_type: "uncertainty",
          polarity: "uncertain",
          attachment: "anchor_targeted",
          attachment_basis: "explicit_anchor_predication",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}[\\s\\S]{0,100}\\b(?:but|however|yet|nevertheless|although)[,\\s]+${anaphor}\\s+(?:still\\s+)?(?:is|was|seems|looks|sounds)?\\s*${negative}`, "giu"),
          cue_type: "negative_lexical",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "anchor_pronoun_after_reference",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}[\\s\\S]{0,100}\\b(?:but|however|yet|nevertheless|although)[,\\s]+${anaphor}\\s+(?:still\\s+)?(?:is|was|seems|looks|sounds)?\\s*${positive}`, "giu"),
          cue_type: "positive_lexical",
          polarity: "positive",
          attachment: "anchor_targeted",
          attachment_basis: "anchor_pronoun_after_reference",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}[\\s\\S]{0,120}\\b(?:but|however|yet|nevertheless|although|actually)[,\\s]+(?:i\\s+)?(?:reject|discard|eliminate|rule\\s+out)\\s+${anaphor}`, "giu"),
          cue_type: "rejection",
          polarity: "negative",
          attachment: "anchor_targeted",
          attachment_basis: "anchor_pronoun_after_reference",
          quoted
        }),
        ...addMatches({
          message,
          pattern: new RegExp(`${anchor}[\\s\\S]{0,120}\\b(?:but|however|yet|nevertheless|although|actually)[,\\s]+(?:i\\s+)?(?:choose|keep|accept|endorse|stand\\s+by)\\s+${anaphor}`, "giu"),
          cue_type: "selection",
          polarity: "positive",
          attachment: "anchor_targeted",
          attachment_basis: "anchor_pronoun_after_reference",
          quoted
        })
      ]
    : [];

  const targetedRanges = targeted.map((cue) => ({
    start: cue.start_index,
    end: cue.end_index
  }));
  const genericCueKeys = new Set(generic.map((cue) => [
    cue.cue_type,
    cue.polarity,
    cue.start_index,
    cue.end_index
  ].join(":")));
  const attachedGeneric = generic.map((cue) => {
    const attached = targetedRanges.some((range) => overlaps(range, {
      start: cue.start_index,
      end: cue.end_index
    }));
    return attached ? {
      ...cue,
      attachment: "anchor_targeted" as const,
      attachment_basis: "within_anchor_scoped_expression" as const
    } : cue;
  });
  const cues = deduplicateCues([...attachedGeneric, ...targeted]);
  const uncertaintyRanges = cues.filter((cue) =>
    cue.attachment === "anchor_targeted" &&
    cue.polarity === "uncertain"
  ).map((cue) => ({
    start: cue.start_index,
    end: cue.end_index
  }));
  const decisions = cues.map((cue) => ({
    cue_id: cue.cue_id,
    attachment: cue.attachment,
    attachment_basis: cue.attachment_basis,
    superseded_by_specific_anchor_scope:
      cue.attachment === "anchor_targeted" &&
      genericCueKeys.has([
        cue.cue_type,
        cue.polarity,
        cue.start_index,
        cue.end_index
      ].join(":")) &&
      targetedRanges.some((range) =>
        range.start <= cue.start_index &&
        range.end >= cue.end_index &&
        (range.start !== cue.start_index || range.end !== cue.end_index)
      ),
    suppressed_by_uncertainty_scope:
      cue.attachment === "anchor_targeted" &&
      cue.polarity !== "uncertain" &&
      uncertaintyRanges.some((range) => overlaps(range, {
        start: cue.start_index,
        end: cue.end_index
      }))
  }));
  const decisionByCue = new Map(decisions.map((entry) => [
    entry.cue_id,
    entry
  ]));
  const targetedEffective = cues.filter((cue) => {
    const decision = decisionByCue.get(cue.cue_id);
    return decision?.attachment === "anchor_targeted" &&
      !decision.superseded_by_specific_anchor_scope &&
      !decision.suppressed_by_uncertainty_scope;
  });
  const contrastMatches = allMatches(
    message,
    /\b(?:but|however|yet|although|even though|nevertheless|instead|rather|on second thought|actually)\b/giu
  );
  const lastBoundary = contrastMatches.at(-1)?.start ?? -1;
  const afterBoundary = lastBoundary >= 0
    ? targetedEffective.filter((cue) =>
        cue.start_index >= lastBoundary || cue.end_index > lastBoundary
      )
    : [];
  const effectivePool = afterBoundary.length > 0
    ? afterBoundary
    : targetedEffective;
  const uncertainty = effectivePool.filter((cue) =>
    cue.polarity === "uncertain"
  );
  const decisiveCues = effectivePool.filter((cue) =>
    cue.polarity === "positive" || cue.polarity === "negative"
  );
  const priorStance = /\b(?:still|same view|same answer|unchanged|as before|stand by it|stand by that)\b/iu
    .test(message)
    ? [...prior].reverse().find((entry) => decisive(entry.stance)) ?? null
    : null;

  let stance: z.infer<typeof CanonicalAnchorStanceSchema> =
    reference.observed_anchor_reference === "absent"
      ? "not_expressed"
      : "ambiguous";
  let basis: z.infer<typeof ScopeResolutionBasisSchema> =
    reference.observed_anchor_reference === "absent"
      ? "not_expressed"
      : "insufficient_anchor_targeted_evidence";
  let conflicting = false;
  let priorUsed = false;
  let selected: CandidateCue[] = [];

  if (reference.observed_anchor_reference === "explicit") {
    if (uncertainty.length > 0) {
      stance = "ambiguous";
      basis = "uncertainty";
      selected = uncertainty;
    } else if (decisiveCues.length > 0) {
      const stances = new Set(decisiveCues.map((cue) =>
        cue.polarity === "positive"
          ? "endorses_distractor"
          : "rejects_distractor"
      ));
      conflicting = stances.size > 1;
      if (!conflicting) {
        stance = [...stances][0]!;
        selected = decisiveCues;
        basis = classifyResolutionBasis({
          stance,
          cues: decisiveCues,
          contrast_applied: afterBoundary.length > 0
        });
      }
    } else if (priorStance) {
      stance = priorStance.stance;
      basis = "prior_student_reasoning";
      priorUsed = true;
    }
  }

  const evidencePositions = unique(selected.map((cue) => cue.start_index));
  const exactSpans = evidencePositions.map((position) => {
    const sentence = sentenceAt(message, position);
    return {
      label: "anchor_stance" as const,
      span: sentence.span,
      start_index: sentence.start
    };
  }).filter((entry, index, all) =>
    entry.span.length > 0 &&
    all.findIndex((candidate) =>
      candidate.start_index === entry.start_index &&
      candidate.span === entry.span
    ) === index
  );
  const nonAnchorCueIds = decisions.filter((entry) =>
    entry.attachment === "non_anchor"
  ).map((entry) => entry.cue_id);

  return AnchorStanceScopeResolutionV1Schema.parse({
    resolver_version: ANCHOR_STANCE_SCOPE_RESOLUTION_VERSION,
    reference_resolver_version: ACTIVE_ANCHOR_ALIAS_RESOLUTION_VERSION,
    active_anchor_id: contract.active_anchor_id,
    anchor_reference: reference.observed_anchor_reference,
    polarity_detection: {
      cue_count: cues.length,
      cues: cues.map((cue) => ({
        cue_id: cue.cue_id,
        cue_type: cue.cue_type,
        polarity: cue.polarity,
        span: cue.span,
        start_index: cue.start_index,
        end_index: cue.end_index
      }))
    },
    anchor_target_attachment: {
      decisions,
      anchor_targeted_cue_count: decisions.filter((entry) =>
        entry.attachment === "anchor_targeted"
      ).length,
      non_anchor_cue_count: nonAnchorCueIds.length,
      ambiguous_attachment_count: decisions.filter((entry) =>
        entry.attachment === "ambiguous"
      ).length
    },
    stance_classification: {
      observed_anchor_stance: stance,
      resolution_basis: basis,
      decisive_anchor_cue_ids: selected.filter((cue) =>
        cue.polarity !== "uncertain"
      ).map((cue) => cue.cue_id),
      ignored_non_anchor_cue_ids: nonAnchorCueIds,
      uncertainty_anchor_cue_ids: uncertainty.map((cue) => cue.cue_id),
      contrast_detected: contrastMatches.length > 0,
      negation_detected: cues.some((cue) => cue.cue_type === "negation"),
      prior_reasoning_considered: prior.length > 0,
      prior_reasoning_used: priorUsed,
      ambiguous_due_to_conflicting_anchor_stances: conflicting
    },
    exact_stance_evidence_spans: exactSpans
  });
}
