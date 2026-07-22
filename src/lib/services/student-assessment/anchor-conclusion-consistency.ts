import { z } from "zod";

export const ANCHOR_CONCLUSION_CONSISTENCY_VERSION =
  "anchor-conclusion-consistency-v1" as const;
export const SOUND_GATE_ANCHOR_CONSISTENCY_VERSION =
  "sound-gate-anchor-consistency-v1" as const;

export const AnchorApplicationSchema = z.enum([
  "absent",
  "implicit",
  "explicit"
]);
export const AnchorStanceSchema = z.enum([
  "not_expressed",
  "ambiguous",
  "endorses_distractor",
  "rejects_distractor"
]);
export const AnchorConsistencySchema = z.enum([
  "not_assessable",
  "consistent_with_conceptual_reasoning",
  "contradictory_to_conceptual_reasoning",
  "unresolved"
]);
export const AnchorResolutionStatusSchema = z.enum([
  "unresolved",
  "resolved_against_distractor",
  "regressed",
  "contradictory"
]);
export const RequiredAnchorStanceSchema = z.literal("rejects_distractor");
export const ActiveAnchorTypeSchema = z.enum([
  "distractor_option",
  "item",
  "distractor_claim"
]);

export type AnchorApplication = z.infer<typeof AnchorApplicationSchema>;
export type AnchorStance = z.infer<typeof AnchorStanceSchema>;
export type AnchorConsistency = z.infer<typeof AnchorConsistencySchema>;
export type AnchorResolutionStatus = z.infer<
  typeof AnchorResolutionStatusSchema
>;

export const AnchorInterpretationContractSchema = z.object({
  active_anchor_id: z.string().min(1).max(240),
  active_anchor_text: z.string().min(1).max(1400),
  active_anchor_type: ActiveAnchorTypeSchema,
  distractor_option: z.string().min(1).max(20),
  distractor_claim: z.string().min(1).max(1000),
  required_anchor_stance: RequiredAnchorStanceSchema,
  acceptable_anchor_paraphrases: z.array(z.string().min(1).max(500)).max(20),
  prohibited_anchor_stances: z.array(
    z.enum(["not_expressed", "ambiguous", "endorses_distractor"])
  ).min(1),
  anchor_resolution_criteria: z.array(z.string().min(1).max(500)).min(1),
  anchor_contradiction_criteria: z.array(z.string().min(1).max(500)).min(1),
  ambiguity_resolution_policy: z.string().min(1).max(700)
}).strict();
export type AnchorInterpretationContract = z.infer<
  typeof AnchorInterpretationContractSchema
>;

export const AnchorInterpretationSchema = z.object({
  interpretation_version: z.literal(ANCHOR_CONCLUSION_CONSISTENCY_VERSION),
  anchor_application: AnchorApplicationSchema,
  anchor_stance: AnchorStanceSchema,
  anchor_consistency: AnchorConsistencySchema,
  anchor_resolution_status: AnchorResolutionStatusSchema,
  anchor_reference_spans: z.array(z.string().min(1).max(900)).max(12),
  anchor_stance_spans: z.array(z.string().min(1).max(900)).max(12),
  blocking_limitations: z.array(z.string().min(1).max(500)).max(12),
  contradictions: z.array(z.string().min(1).max(240)).max(12),
  clarification_required: z.boolean()
}).strict();
export type AnchorInterpretation = z.infer<typeof AnchorInterpretationSchema>;

export type ConceptualPosition =
  | "not_assessable"
  | "ambiguous"
  | "endorses_distractor"
  | "rejects_distractor";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function matchingSpans(message: string, patterns: RegExp[]) {
  const spans: Array<{ index: number; span: string }> = [];
  for (const pattern of patterns) {
    for (const match of message.matchAll(pattern)) {
      if (match.index === undefined) continue;
      spans.push({ index: match.index, span: match[0].trim().slice(0, 900) });
    }
  }
  return spans.sort((left, right) => left.index - right.index);
}

function quotedRanges(message: string) {
  const ranges: Array<[number, number]> = [];
  for (const match of message.matchAll(/["“][^"”]{1,900}["”]/gu)) {
    if (match.index === undefined) continue;
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function isInsideQuotedRange(index: number, ranges: Array<[number, number]>) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

export function isBlockingAnchorConflictLimitation(value: string) {
  const lower = value.toLocaleLowerCase("en-CA");
  const anchorReference = /\b(?:anchor|option|choice|assessment reference|final reference|final judgment|conclusion)\b/u
    .test(lower);
  const directConflict = /\b(?:conflict|contradict|inconsisten|does not (?:clearly )?(?:match|align)|not (?:clearly )?aligned|labeling slip|unresolved application|ambiguous application)\b/u
    .test(lower);
  return anchorReference && directConflict;
}

export function classifyAnchorConclusion(input: {
  contract: AnchorInterpretationContract;
  student_message: string;
  conceptual_position: ConceptualPosition;
  evidence_limitations?: string[];
  prior_anchor_resolution_status?: AnchorResolutionStatus | null;
}): AnchorInterpretation {
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
    anchor_contradiction_criteria: input.contract.anchor_contradiction_criteria,
    ambiguity_resolution_policy: input.contract.ambiguity_resolution_policy
  });
  const message = input.student_message.trim();
  const option = escapeRegex(contract.distractor_option);
  const optionReferencePatterns = [
    new RegExp(`\\boption\\s+${option}\\b`, "giu"),
    new RegExp(`\\bchoice\\s+${option}\\b`, "giu"),
    new RegExp(`\\b(?:choose|chose|select|selected|prefer|preferred)\\s+(?:option\\s+)?${option}\\b`, "giu"),
    new RegExp(`\\blean(?:ing)?\\s+toward(?:s)?\\s+(?:option\\s+)?${option}\\b`, "giu")
  ];
  const itemTokens = contract.active_anchor_id.toLocaleLowerCase("en-CA")
    .match(/[a-z0-9]+/gu)?.filter((token) =>
      token.length > 1 && !["item", "option", "current", "anchor"]
        .includes(token)
    ) ?? [];
  const itemReferencePatterns = itemTokens.map((token) =>
    new RegExp(`\\b${escapeRegex(token)}\\b`, "giu")
  );
  const optionReferences = matchingSpans(message, optionReferencePatterns);
  const itemReferences = matchingSpans(message, itemReferencePatterns);
  const paraphraseReferences = contract.acceptable_anchor_paraphrases.flatMap(
    (phrase) => {
      if (phrase.length < 3) return [];
      const index = message.toLocaleLowerCase("en-CA").indexOf(
        phrase.toLocaleLowerCase("en-CA")
      );
      return index < 0 ? [] : [{ index, span: message.slice(
        index, index + phrase.length
      ) }];
    }
  );
  const application: AnchorApplication = optionReferences.length > 0 ||
      itemReferences.length > 0
    ? "explicit"
    : paraphraseReferences.length > 0 ? "implicit" : "absent";

  const quoted = quotedRanges(message);
  const endorsingPatterns = [
    new RegExp(`\\b(?:option\\s+)?${option}\\s+(?:is|remains|seems|looks)?\\s*(?:appropriate|correct|right|valid|reasonable|acceptable|the best choice)\\b`, "giu"),
    new RegExp(`\\b(?:choose|chose|select|selected|prefer|preferred)\\s+(?:option\\s+)?${option}\\b`, "giu"),
    new RegExp(`\\blean(?:ing)?\\s+toward(?:s)?\\s+(?:option\\s+)?${option}\\b`, "giu"),
    new RegExp(`\\b(?:option\\s+)?${option}\\s+(?:still\\s+)?makes\\s+sense\\b`, "giu"),
    /\b(?:that option|that choice|the active distractor)\s+(?:is|seems|remains)?\s*(?:appropriate|correct|right|valid|reasonable|acceptable|makes sense)\b/giu
  ];
  const rejectingPatterns = [
    new RegExp(`\\b(?:option\\s+)?${option}\\s+(?:is|was|remains|seems|looks)?\\s*(?:inappropriate|incorrect|wrong|invalid|unsupported|not appropriate|not correct|not right|not valid)\\b`, "giu"),
    new RegExp(`\\b(?:do not|don't|would not|wouldn't|should not|shouldn't)\\s+(?:choose|select|accept)\\s+(?:option\\s+)?${option}\\b`, "giu"),
    new RegExp(`\\b(?:reject|rejecting|rejected)\\s+(?:option\\s+)?${option}\\b`, "giu"),
    new RegExp(`\\b(?:option\\s+)?${option}\\s+(?:does not|doesn't)\\s+(?:fit|follow|hold|work|make sense)\\b`, "giu"),
    /\b(?:that option|that choice|the active distractor)\s+(?:is|was|seems|remains|should be)?\s*(?:inappropriate|incorrect|wrong|invalid|unsupported|rejected|not appropriate|does not fit)\b/giu
  ];
  const endorsing = matchingSpans(message, endorsingPatterns).filter((entry) =>
    !isInsideQuotedRange(entry.index, quoted)
  );
  const rejecting = matchingSpans(message, rejectingPatterns).filter((entry) =>
    !isInsideQuotedRange(entry.index, quoted)
  );
  const quotedRejection = quoted.length > 0 &&
    /\b(?:that|this)\s+(?:claim|choice|statement|idea)\s+(?:is|was)?\s*(?:wrong|incorrect|inappropriate|unsupported|does not fit)\b/iu.test(message);
  const selfCorrectionToRejection =
    /\b(?:actually|rather|i mean|correction)\b[^.!?]{0,180}\b(?:wrong|incorrect|inappropriate|reject|does not fit)\b/iu.test(message);
  const uncertainty = /\b(?:maybe|perhaps|not sure|uncertain|might have meant|typo)\b/iu
    .test(message);

  let stance: AnchorStance = "not_expressed";
  const stanceSpans: string[] = [];
  if (application !== "absent") {
    if (uncertainty && (endorsing.length > 0 || rejecting.length > 0)) {
      stance = "ambiguous";
      stanceSpans.push(...endorsing.map((entry) => entry.span));
      stanceSpans.push(...rejecting.map((entry) => entry.span));
    } else if (quotedRejection || selfCorrectionToRejection) {
      stance = "rejects_distractor";
      stanceSpans.push(...rejecting.map((entry) => entry.span));
      if (stanceSpans.length === 0) stanceSpans.push(message.slice(0, 900));
    } else if (endorsing.length > 0 && rejecting.length > 0) {
      stance = "ambiguous";
      stanceSpans.push(...endorsing.map((entry) => entry.span));
      stanceSpans.push(...rejecting.map((entry) => entry.span));
    } else if (rejecting.length > 0) {
      stance = "rejects_distractor";
      stanceSpans.push(...rejecting.map((entry) => entry.span));
    } else if (endorsing.length > 0) {
      stance = "endorses_distractor";
      stanceSpans.push(...endorsing.map((entry) => entry.span));
    } else if (input.conceptual_position === "rejects_distractor" &&
        application === "explicit") {
      stance = "rejects_distractor";
      stanceSpans.push(message.slice(0, 900));
    } else {
      stance = "ambiguous";
    }
  }

  let consistency: AnchorConsistency = "not_assessable";
  if (stance === "ambiguous") {
    consistency = "unresolved";
  } else if (stance !== "not_expressed" &&
      input.conceptual_position !== "not_assessable" &&
      input.conceptual_position !== "ambiguous") {
    consistency = stance === input.conceptual_position
      ? "consistent_with_conceptual_reasoning"
      : "contradictory_to_conceptual_reasoning";
  }
  const blockingLimitations = unique(
    (input.evidence_limitations ?? []).filter(isBlockingAnchorConflictLimitation)
  );
  if (blockingLimitations.length > 0 && consistency !==
      "contradictory_to_conceptual_reasoning") {
    consistency = "contradictory_to_conceptual_reasoning";
  }
  const contradictions = consistency ===
      "contradictory_to_conceptual_reasoning"
    ? ["anchor_conclusion_conceptual_explanation_conflict"]
    : [];
  let resolutionStatus: AnchorResolutionStatus = "unresolved";
  if (consistency === "contradictory_to_conceptual_reasoning") {
    resolutionStatus = "contradictory";
  } else if (stance === "rejects_distractor" && consistency ===
      "consistent_with_conceptual_reasoning" &&
      input.conceptual_position === "rejects_distractor") {
    resolutionStatus = "resolved_against_distractor";
  } else if (input.prior_anchor_resolution_status ===
      "resolved_against_distractor" && stance === "endorses_distractor") {
    resolutionStatus = "regressed";
  }

  return AnchorInterpretationSchema.parse({
    interpretation_version: ANCHOR_CONCLUSION_CONSISTENCY_VERSION,
    anchor_application: application,
    anchor_stance: stance,
    anchor_consistency: consistency,
    anchor_resolution_status: resolutionStatus,
    anchor_reference_spans: unique([
      ...optionReferences,
      ...itemReferences,
      ...paraphraseReferences
    ].map((entry) => entry.span)),
    anchor_stance_spans: unique(stanceSpans),
    blocking_limitations: blockingLimitations,
    contradictions,
    clarification_required: stance === "ambiguous" ||
      consistency === "contradictory_to_conceptual_reasoning" ||
      resolutionStatus === "contradictory"
  });
}

export function evaluateAnchorConsistentSoundGate(input: {
  all_essential_conceptual_relationships_satisfied: boolean;
  required_mechanism_demonstrated: boolean;
  coherent_conclusion: boolean;
  essential_missing_links: string[];
  contradictions: string[];
  interpretation: AnchorInterpretation;
}) {
  const failures = unique([
    !input.all_essential_conceptual_relationships_satisfied
      ? "essential_conceptual_relationship_missing" : "",
    !input.required_mechanism_demonstrated
      ? "required_mechanism_missing" : "",
    input.interpretation.anchor_application !== "explicit"
      ? "explicit_anchor_application_missing" : "",
    input.interpretation.anchor_stance !== "rejects_distractor"
      ? "required_anchor_rejection_missing" : "",
    input.interpretation.anchor_consistency !==
      "consistent_with_conceptual_reasoning"
      ? "anchor_conclusion_not_consistent" : "",
    input.interpretation.anchor_resolution_status !==
      "resolved_against_distractor"
      ? "anchor_not_resolved_against_distractor" : "",
    !input.coherent_conclusion ? "coherent_conclusion_missing" : "",
    input.essential_missing_links.length > 0
      ? "essential_missing_links_present" : "",
    input.contradictions.length > 0 ? "contradictions_present" : "",
    input.interpretation.blocking_limitations.length > 0 &&
      input.interpretation.contradictions.length === 0
      ? "blocking_anchor_conflict_not_structured" : ""
  ]);
  return {
    gate_version: SOUND_GATE_ANCHOR_CONSISTENCY_VERSION,
    passed: failures.length === 0,
    failure_codes: failures
  };
}
