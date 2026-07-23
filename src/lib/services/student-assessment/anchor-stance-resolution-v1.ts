import { z } from "zod";
import {
  ActiveAnchorAliasContractSchema,
  ActiveAnchorAliasResolutionSchema,
  type ActiveAnchorAliasContract,
  type ActiveAnchorAliasResolution
} from "./active-anchor-alias-resolution";
import {
  CanonicalAnchorStanceSchema
} from "./canonical-anchor-evidence";

export const ANCHOR_STANCE_RESOLUTION_VERSION =
  "anchor-stance-resolution-v1" as const;

const AnchorStanceCueCodeSchema = z.enum([
  "direct_endorsement",
  "direct_rejection",
  "negated_positive",
  "negated_negative",
  "distractor_role_rejection",
  "contrast_conclusion",
  "uncertainty",
  "prior_reasoning_continuity",
  "bare_anchor_assertion",
  "no_decisive_stance"
]);

const AnchorStanceResolutionBasisSchema = z.enum([
  "not_expressed",
  "direct_endorsement",
  "direct_rejection",
  "negation",
  "contrast",
  "uncertainty",
  "prior_student_reasoning",
  "bare_anchor_assertion",
  "insufficient_evidence"
]);

const AnchorStanceEvidenceSpanSchema = z.object({
  label: z.literal("anchor_stance"),
  span: z.string().min(1).max(900),
  start_index: z.number().int().nonnegative()
}).strict();

export const AnchorStanceResolutionV1Schema = z.object({
  resolver_version: z.literal(ANCHOR_STANCE_RESOLUTION_VERSION),
  active_anchor_id: z.string().min(1).max(240),
  anchor_reference: z.enum(["explicit", "absent"]),
  observed_anchor_stance: CanonicalAnchorStanceSchema,
  resolution_basis: AnchorStanceResolutionBasisSchema,
  cue_codes: z.array(AnchorStanceCueCodeSchema).max(24),
  direct_endorsement_detected: z.boolean(),
  direct_rejection_detected: z.boolean(),
  uncertainty_detected: z.boolean(),
  negation_detected: z.boolean(),
  contrast_detected: z.boolean(),
  discourse_resolution_applied: z.boolean(),
  prior_reasoning_considered: z.boolean(),
  prior_reasoning_used: z.boolean(),
  ambiguous_due_to_conflicting_stances: z.boolean(),
  exact_stance_evidence_spans: z.array(
    AnchorStanceEvidenceSpanSchema
  ).max(24)
}).strict();
export type AnchorStanceResolutionV1 = z.infer<
  typeof AnchorStanceResolutionV1Schema
>;

export type PriorStudentAnchorReasoning = {
  message: string;
  reference_resolution: ActiveAnchorAliasResolution;
  stance: z.infer<typeof CanonicalAnchorStanceSchema>;
};

type DecisiveStance = "endorses_distractor" | "rejects_distractor";
type Cue = {
  code: z.infer<typeof AnchorStanceCueCodeSchema>;
  stance: DecisiveStance;
  start: number;
  end: number;
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function aliasPattern(alias: string) {
  const escaped = escapeRegex(alias.trim()).replace(/\s+/gu, "\\s+");
  return alias.trim().length === 1
    ? `\\b${escaped}\\b`
    : `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`;
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

function allMatches(message: string, pattern: RegExp) {
  return [...message.matchAll(pattern)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
}

function cueMatches(input: {
  message: string;
  pattern: RegExp;
  code: Cue["code"];
  stance: DecisiveStance;
  quoted: ReturnType<typeof quotedRanges>;
}) {
  return allMatches(input.message, input.pattern)
    .filter((match) => !input.quoted.some((range) =>
      match.start >= range.start && match.start < range.end
    ))
    .map((match): Cue => ({
      code: input.code,
      stance: input.stance,
      start: match.start,
      end: match.end
    }));
}

function decisive(value: string): value is DecisiveStance {
  return value === "endorses_distractor" ||
    value === "rejects_distractor";
}

function normalized(value: string) {
  return value
    .toLocaleLowerCase("en-CA")
    .replace(/[’]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
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
  ]).sort((left, right) => right.length - left.length);
  return `(?:${aliases.map(aliasPattern).join("|")})`;
}

function hasUncertainty(input: {
  message: string;
  anchorExpression: string;
}) {
  const anchor = input.anchorExpression;
  const patterns = [
    new RegExp(`\\b(?:maybe|perhaps|possibly)\\s+(?:the\\s+)?${anchor}`, "iu"),
    new RegExp(`\\b(?:i(?:\\s+am|'m)?\\s+)?(?:am\\s+)?(?:still\\s+)?(?:not\\s+sure|unsure|uncertain|undecided)\\s+(?:about\\s+)?(?:the\\s+)?${anchor}`, "iu"),
    new RegExp(`\\b(?:i\\s+)?(?:might|may|could)\\s+(?:still\\s+)?(?:keep|choose|select|pick|accept|endorse|retain|go\\s+with)\\s+(?:the\\s+)?${anchor}`, "iu"),
    new RegExp(`${anchor}\\s+(?:might|may|could)\\s+(?:still\\s+)?(?:be\\s+)?(?:correct|right|valid|true|wrong|incorrect)`, "iu"),
    new RegExp(`\\b(?:not\\s+sure|unsure|uncertain|undecided)[\\s\\S]{0,100}${anchor}`, "iu"),
    new RegExp(`${anchor}[\\s\\S]{0,100}\\b(?:not\\s+sure|unsure|uncertain|undecided)\\b`, "iu")
  ];
  const matches = patterns.flatMap((pattern) =>
    allMatches(input.message, new RegExp(pattern.source, `${pattern.flags}g`))
  );
  if (matches.length > 0) return matches;
  const trimmed = input.message.trim();
  const questionAboutAnchor = trimmed.endsWith("?") &&
    new RegExp(anchor, "iu").test(trimmed);
  return questionAboutAnchor
    ? [{ start: Math.max(0, trimmed.length - 1), end: trimmed.length }]
    : [];
}

function bareAnchorAssertion(input: {
  message: string;
  contract: ActiveAnchorAliasContract;
}) {
  const candidateAliases = unique([
    input.contract.option_text,
    ...input.contract.accepted_paraphrases
  ]).map(normalized);
  const message = normalized(input.message).replace(/[.!]$/u, "");
  return candidateAliases.some((alias) =>
    message === alias || message.startsWith(`${alias} because `)
  );
}

function resolveFromPriorReasoning(input: {
  message: string;
  prior: PriorStudentAnchorReasoning[];
}) {
  const continuity = /\b(?:still|same view|same answer|unchanged|as before|continue to think|stand by (?:that|it|my answer)|keep my (?:view|answer))\b/iu
    .test(input.message);
  if (!continuity) return null;
  return [...input.prior].reverse().find((entry) => decisive(entry.stance)) ??
    null;
}

export function resolveAnchorStanceV1(input: {
  message: string;
  contract: ActiveAnchorAliasContract;
  reference_resolution: ActiveAnchorAliasResolution;
  prior_student_reasoning?: PriorStudentAnchorReasoning[];
}): AnchorStanceResolutionV1 {
  const contract = ActiveAnchorAliasContractSchema.parse(input.contract);
  const reference = ActiveAnchorAliasResolutionSchema.parse(
    input.reference_resolution
  );
  const message = input.message.trim();
  const prior = input.prior_student_reasoning ?? [];

  if (reference.observed_anchor_reference === "absent") {
    return AnchorStanceResolutionV1Schema.parse({
      resolver_version: ANCHOR_STANCE_RESOLUTION_VERSION,
      active_anchor_id: contract.active_anchor_id,
      anchor_reference: "absent",
      observed_anchor_stance: "not_expressed",
      resolution_basis: "not_expressed",
      cue_codes: ["no_decisive_stance"],
      direct_endorsement_detected: false,
      direct_rejection_detected: false,
      uncertainty_detected: false,
      negation_detected: false,
      contrast_detected: false,
      discourse_resolution_applied: false,
      prior_reasoning_considered: prior.length > 0,
      prior_reasoning_used: false,
      ambiguous_due_to_conflicting_stances: false,
      exact_stance_evidence_spans: []
    });
  }

  const anchor = buildAnchorExpression({ contract, reference });
  const quoted = quotedRanges(message);
  const positive = "(?:accurate|correct|right|valid|reasonable|appropriate|best|true)";
  const negative = "(?:wrong|incorrect|inaccurate|invalid|unsupported|false)";
  const cues: Cue[] = [
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:i\\s+)?(?:would\\s+|will\\s+|still\\s+)?(?:keep|choose|select|pick|accept|endorse|retain)\\s+(?:the\\s+)?${anchor}(?!\\s+as\\s+(?:a|the)\\s+(?:distractor|wrong\\s+option|incorrect\\s+(?:option|answer)))`, "giu"),
      code: "direct_endorsement",
      stance: "endorses_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:i\\s+)?(?:stand\\s+by|go\\s+with)\\s+(?:the\\s+)?${anchor}`, "giu"),
      code: "direct_endorsement",
      stance: "endorses_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`${anchor}\\s+(?:still\\s+)?(?:is|was|remains|seems|looks|sounds)\\s+(?:still\\s+)?(?:clearly\\s+|probably\\s+)?${positive}`, "giu"),
      code: "direct_endorsement",
      stance: "endorses_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`${anchor}\\s+(?:still\\s+)?(?:makes|made)\\s+sense`, "giu"),
      code: "direct_endorsement",
      stance: "endorses_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:i\\s+)?(?:still\\s+)?(?:think|believe)\\s+(?:that\\s+)?${anchor}(?:\\s+(?:is\\s+)?${positive})?`, "giu"),
      code: "direct_endorsement",
      stance: "endorses_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:reject|discard|eliminate|cross\\s+out|rule\\s+out)\\s+(?:the\\s+)?${anchor}`, "giu"),
      code: "direct_rejection",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:do\\s+not|don't|would\\s+not|wouldn't|will\\s+not|won't|should\\s+not|shouldn't)\\s+(?:keep|choose|select|pick|accept|endorse|retain)\\s+(?:the\\s+)?${anchor}`, "giu"),
      code: "direct_rejection",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`${anchor}\\s+(?:still\\s+)?(?:is|was|remains|seems|looks|sounds)\\s+(?:still\\s+)?${negative}`, "giu"),
      code: "direct_rejection",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`${anchor}\\s+(?:is|was|seems|looks|sounds)?\\s*not\\s+${positive}`, "giu"),
      code: "negated_positive",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`${anchor}\\s+(?:is|was|seems|looks|sounds)?\\s*not\\s+${negative}`, "giu"),
      code: "negated_negative",
      stance: "endorses_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:keep|retain|use|include|leave)\\s+(?:the\\s+)?${anchor}\\s+as\\s+(?:a|the)\\s+(?:distractor|wrong\\s+option|incorrect\\s+(?:option|answer))`, "giu"),
      code: "distractor_role_rejection",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`${anchor}\\s+(?:should\\s+)?(?:remain|stay|be\\s+kept)\\s+as\\s+(?:a|the)\\s+distractor`, "giu"),
      code: "distractor_role_rejection",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:but|however|yet|nevertheless|instead|rather)[,\\s]+(?:(?:it|that|the\\s+(?:option|choice|answer|claim))\\s+)?(?:is|was|seems|looks|sounds)?\\s*${negative}`, "giu"),
      code: "contrast_conclusion",
      stance: "rejects_distractor",
      quoted
    }),
    ...cueMatches({
      message,
      pattern: new RegExp(`\\b(?:but|however|yet|nevertheless|instead|rather)[,\\s]+(?:(?:it|that|the\\s+(?:option|choice|answer|claim))\\s+)?(?:is|was|seems|looks|sounds)?\\s*${positive}`, "giu"),
      code: "contrast_conclusion",
      stance: "endorses_distractor",
      quoted
    })
  ];

  const uncertaintyMatches = hasUncertainty({
    message,
    anchorExpression: anchor
  });
  const contrastMatches = allMatches(
    message,
    /\b(?:but|however|yet|although|even though|nevertheless|instead|rather)\b/giu
  );
  const directEndorsement = cues.some((cue) =>
    cue.stance === "endorses_distractor"
  );
  const directRejection = cues.some((cue) =>
    cue.stance === "rejects_distractor"
  );
  const negationDetected = cues.some((cue) =>
    cue.code === "negated_positive" || cue.code === "negated_negative"
  ) || /\bnot\b|\b(?:don't|doesn't|isn't|wasn't|wouldn't|shouldn't|can't)\b/iu
    .test(message);
  const distractorRoleRejection = cues.find((cue) =>
    cue.code === "distractor_role_rejection"
  );
  const lastContrast = contrastMatches.at(-1)?.start ?? -1;
  const decisiveAfterContrast = lastContrast >= 0
    ? cues.filter((cue) => cue.start >= lastContrast)
    : [];
  const uncertaintyAfterContrast = lastContrast >= 0 &&
    uncertaintyMatches.some((match) => match.start > lastContrast);
  const latestCue = [...cues].sort((left, right) =>
    left.start - right.start
  ).at(-1);
  const uncertaintyAfterLatestCue = latestCue
    ? uncertaintyMatches.some((match) => match.start >= latestCue.end)
    : uncertaintyMatches.length > 0;
  const priorResolution = resolveFromPriorReasoning({
    message,
    prior
  });

  let stance: z.infer<typeof CanonicalAnchorStanceSchema> = "ambiguous";
  let basis: z.infer<typeof AnchorStanceResolutionBasisSchema> =
    "insufficient_evidence";
  let priorUsed = false;
  let conflicting = false;
  let discourseApplied = false;

  if (distractorRoleRejection) {
    stance = "rejects_distractor";
    basis = "direct_rejection";
  } else if (decisiveAfterContrast.length > 0) {
    const stances = new Set(decisiveAfterContrast.map((cue) => cue.stance));
    stance = stances.size === 1
      ? decisiveAfterContrast.at(-1)!.stance
      : "ambiguous";
    basis = stances.size === 1 ? "contrast" : "insufficient_evidence";
    conflicting = stances.size > 1;
    discourseApplied = true;
  } else if (uncertaintyAfterContrast || uncertaintyAfterLatestCue) {
    stance = "ambiguous";
    basis = "uncertainty";
    discourseApplied = lastContrast >= 0;
  } else if (cues.length > 0) {
    const stances = new Set(cues.map((cue) => cue.stance));
    if (stances.size === 1) {
      stance = cues.at(-1)!.stance;
      const codes = new Set(cues.map((cue) => cue.code));
      basis = codes.has("negated_positive") || codes.has("negated_negative")
        ? "negation"
        : stance === "endorses_distractor"
          ? "direct_endorsement"
          : "direct_rejection";
    } else {
      stance = "ambiguous";
      basis = "insufficient_evidence";
      conflicting = true;
    }
  } else if (uncertaintyMatches.length > 0) {
    stance = "ambiguous";
    basis = "uncertainty";
  } else if (priorResolution) {
    stance = priorResolution.stance;
    basis = "prior_student_reasoning";
    priorUsed = true;
    discourseApplied = true;
  } else if (bareAnchorAssertion({ message, contract })) {
    stance = "endorses_distractor";
    basis = "bare_anchor_assertion";
  }

  const evidencePositions = [
    ...cues.map((cue) => cue.start),
    ...uncertaintyMatches.map((match) => match.start)
  ];
  if (priorUsed && reference.exact_anchor_evidence_spans[0]) {
    evidencePositions.push(
      reference.exact_anchor_evidence_spans[0].start_index
    );
  }
  const exactSpans = unique(evidencePositions.map((position) => {
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
    ...(uncertaintyMatches.length > 0 ? ["uncertainty"] : []),
    ...(priorUsed ? ["prior_reasoning_continuity"] : []),
    ...(basis === "bare_anchor_assertion" ? ["bare_anchor_assertion"] : []),
    ...(cues.length === 0 && uncertaintyMatches.length === 0 && !priorUsed &&
      basis !== "bare_anchor_assertion" ? ["no_decisive_stance"] : [])
  ]);

  return AnchorStanceResolutionV1Schema.parse({
    resolver_version: ANCHOR_STANCE_RESOLUTION_VERSION,
    active_anchor_id: contract.active_anchor_id,
    anchor_reference: "explicit",
    observed_anchor_stance: stance,
    resolution_basis: basis,
    cue_codes: cueCodes,
    direct_endorsement_detected: directEndorsement,
    direct_rejection_detected: directRejection,
    uncertainty_detected: uncertaintyMatches.length > 0,
    negation_detected: negationDetected,
    contrast_detected: contrastMatches.length > 0,
    discourse_resolution_applied: discourseApplied,
    prior_reasoning_considered: prior.length > 0,
    prior_reasoning_used: priorUsed,
    ambiguous_due_to_conflicting_stances: conflicting,
    exact_stance_evidence_spans: exactSpans
  });
}
