import { z } from "zod";

export const SELF_CORRECTION_INTENT_VERSION =
  "self-correction-intent-v1" as const;

export const SelfCorrectionIntentContractV1Schema = z.object({
  contract_version: z.literal(SELF_CORRECTION_INTENT_VERSION),
  intent_label: z.literal("self_correction_intent"),
  active_topic_terms: z.array(z.string().min(2).max(160)).min(1).max(80),
  active_anchor_aliases: z.array(z.string().min(1).max(500)).min(1).max(80),
  unrelated_topic_terms: z.array(z.string().min(2).max(160)).max(80),
  evidence_policy: z.object({
    correction_language_alone_is_not_evidence: z.literal(true),
    revised_evidence_must_be_evaluated: z.literal(true),
    latest_valid_evidence_has_precedence: z.literal(true),
    earlier_evidence_remains_historical: z.literal(true),
    copied_correction_language_is_not_independent_evidence: z.literal(true)
  }).strict(),
  routing_policy: z.object({
    valid_self_correction_maps_to:
      z.literal("evaluate_revised_evidence"),
    correction_without_evidence_maps_to:
      z.literal("request_revision_evidence"),
    topic_changed_correction_maps_to:
      z.literal("retain_prior_and_redirect_topic"),
    valid_self_correction_prohibited_routes: z.tuple([
      z.literal("off_topic"),
      z.literal("unrelated"),
      z.literal("new_question")
    ])
  }).strict()
}).strict();
export type SelfCorrectionIntentContractV1 = z.infer<
  typeof SelfCorrectionIntentContractV1Schema
>;

export const SelfCorrectionIntentResolutionV1Schema = z.object({
  resolver_version: z.literal(SELF_CORRECTION_INTENT_VERSION),
  intent: z.enum([
    "self_correction_intent",
    "no_self_correction_intent"
  ]),
  correction_scope: z.enum([
    "active_response",
    "topic_changed",
    "indeterminate",
    "not_applicable"
  ]),
  evidence_status: z.enum([
    "revised_evidence_present",
    "correction_claim_only",
    "copied_correction_language",
    "topic_changed",
    "not_applicable"
  ]),
  downstream_disposition: z.enum([
    "evaluate_revised_evidence",
    "request_revision_evidence",
    "retain_prior_and_redirect_topic",
    "continue_normal_evaluation"
  ]),
  downstream_interaction_intent: z.enum([
    "ordinary_conceptual_response",
    "off_topic_response"
  ]),
  latest_valid_evidence_eligible: z.boolean(),
  correction_language_is_not_evidence: z.literal(true),
  explicit_prior_response_reference: z.boolean(),
  active_topic_evidence_present: z.boolean(),
  active_anchor_reference_present: z.boolean(),
  unrelated_topic_evidence_present: z.boolean(),
  copied_correction_language_detected: z.boolean(),
  prohibited_route_classifications: z.array(
    z.enum(["off_topic", "unrelated", "new_question"])
  ).max(3),
  exact_intent_spans: z.array(z.object({
    label: z.literal("self_correction_intent"),
    span: z.string().min(1).max(500),
    start_index: z.number().int().nonnegative()
  }).strict()).max(12),
  limitation_codes: z.array(z.enum([
    "self_correction_without_revised_evidence",
    "copied_correction_language_without_independent_evidence",
    "correction_changed_topic",
    "no_self_correction_intent_detected"
  ])).max(4)
}).strict();
export type SelfCorrectionIntentResolutionV1 = z.infer<
  typeof SelfCorrectionIntentResolutionV1Schema
>;

type TextMatch = {
  start_index: number;
  end_index: number;
  span: string;
};

const SELF_CORRECTION_PATTERNS = [
  /\b(?:i\s+(?:think|realize|recognize|see)|actually|on second thought|looking back)[,\s]+(?:that\s+)?(?:my\s+)?(?:previous|earlier|last|original|first)?\s*(?:answer|reasoning|explanation|choice|view|response)\s+(?:was|is|might be)\s+(?:wrong|incorrect|incomplete|unclear|mistaken)\b/giu,
  /\b(?:i\s+)?(?:was|may have been|might have been)\s+(?:wrong|mistaken)\s+(?:before|earlier|about that)\b/giu,
  /\b(?:i\s+)?(?:need|want|would like|have)\s+to\s+(?:correct|revise|change|update|rethink)\s+(?:my\s+)?(?:previous|earlier|last|original)?\s*(?:answer|reasoning|explanation|choice|view|response)\b/giu,
  /\b(?:let me|i(?:'ll| will))\s+(?:correct|revise|change|update|restate|rethink)\s+(?:my\s+)?(?:previous|earlier|last|original)?\s*(?:answer|reasoning|explanation|choice|view|response)?\b/giu,
  /\b(?:correction|revision)\s*[:,-]\s*/giu
] as const;

const PRIOR_RESPONSE_REFERENCE =
  /\b(?:previous|earlier|last|original|first|before|what i said|my answer|my reasoning|my explanation|my choice|my view|my response)\b/iu;

const COPIED_CORRECTION_FORMS = new Set([
  "i think my previous answer was wrong because",
  "i think my previous answer was wrong",
  "my previous answer was wrong because",
  "my previous answer was wrong",
  "i need to correct my previous answer",
  "let me correct my previous answer",
  "correction"
]);

const CONTENT_STOP_WORDS = new Set([
  "a", "an", "and", "answer", "because", "before", "but", "change",
  "choice", "correct", "correction", "earlier", "explanation", "first",
  "have", "i", "incorrect", "is", "it", "last", "let", "me", "my",
  "original", "previous", "reasoning", "response", "revise", "said",
  "that", "the", "think", "this", "to", "update", "view", "was",
  "what", "wrong"
]);

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalized(value: string) {
  return value
    .toLocaleLowerCase("en-CA")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function phrasePresent(message: string, phrase: string) {
  const source = normalized(message);
  const target = normalized(phrase);
  if (!target) return false;
  return new RegExp(
    `(?:^|\\s)${escapeRegex(target).replace(/\s+/gu, "\\s+")}(?:$|\\s)`,
    "u"
  ).test(source);
}

function collectIntentMatches(message: string): TextMatch[] {
  const matches = SELF_CORRECTION_PATTERNS.flatMap((pattern) =>
    [...message.matchAll(pattern)].map((match) => ({
      start_index: match.index ?? 0,
      end_index: (match.index ?? 0) + match[0].length,
      span: match[0].trim().slice(0, 500)
    }))
  ).sort((left, right) =>
    left.start_index - right.start_index ||
    right.end_index - left.end_index
  );
  return matches.filter((entry, index, all) =>
    all.findIndex((candidate) =>
      candidate.start_index === entry.start_index &&
      candidate.end_index === entry.end_index
    ) === index
  );
}

function independentContentTokens(message: string) {
  return normalized(message).split(" ").filter((token) =>
    token.length > 2 && !CONTENT_STOP_WORDS.has(token)
  );
}

export function buildSelfCorrectionIntentContractV1(input: {
  active_topic_terms: string[];
  active_anchor_aliases: string[];
  unrelated_topic_terms?: string[];
}): SelfCorrectionIntentContractV1 {
  return SelfCorrectionIntentContractV1Schema.parse({
    contract_version: SELF_CORRECTION_INTENT_VERSION,
    intent_label: "self_correction_intent",
    active_topic_terms: unique(input.active_topic_terms),
    active_anchor_aliases: unique(input.active_anchor_aliases),
    unrelated_topic_terms: unique(input.unrelated_topic_terms ?? []),
    evidence_policy: {
      correction_language_alone_is_not_evidence: true,
      revised_evidence_must_be_evaluated: true,
      latest_valid_evidence_has_precedence: true,
      earlier_evidence_remains_historical: true,
      copied_correction_language_is_not_independent_evidence: true
    },
    routing_policy: {
      valid_self_correction_maps_to: "evaluate_revised_evidence",
      correction_without_evidence_maps_to: "request_revision_evidence",
      topic_changed_correction_maps_to: "retain_prior_and_redirect_topic",
      valid_self_correction_prohibited_routes: [
        "off_topic",
        "unrelated",
        "new_question"
      ]
    }
  });
}

export function resolveSelfCorrectionIntentV1(input: {
  message: string;
  contract: SelfCorrectionIntentContractV1;
}): SelfCorrectionIntentResolutionV1 {
  const contract = SelfCorrectionIntentContractV1Schema.parse(input.contract);
  const message = input.message.trim();
  const intentMatches = collectIntentMatches(message);
  const selfCorrection = intentMatches.length > 0;
  const activeTopic = contract.active_topic_terms.some((term) =>
    phrasePresent(message, term)
  );
  const activeAnchor = contract.active_anchor_aliases.some((alias) =>
    phrasePresent(message, alias)
  );
  const unrelated = contract.unrelated_topic_terms.some((term) =>
    phrasePresent(message, term)
  );
  const normalizedMessage = normalized(message);
  const copied = selfCorrection && (
    COPIED_CORRECTION_FORMS.has(normalizedMessage) ||
    /\bbecause$/u.test(normalizedMessage) ||
    independentContentTokens(message).length === 0
  );
  const explicitPriorReference = PRIOR_RESPONSE_REFERENCE.test(message);
  const topicChanged = selfCorrection && unrelated && !activeTopic &&
    !activeAnchor;
  const revisedEvidence = selfCorrection && !topicChanged && !copied &&
    (activeTopic || activeAnchor) &&
    independentContentTokens(message).length >= 3;

  let correctionScope: SelfCorrectionIntentResolutionV1["correction_scope"] =
    "not_applicable";
  let evidenceStatus: SelfCorrectionIntentResolutionV1["evidence_status"] =
    "not_applicable";
  let downstream:
    SelfCorrectionIntentResolutionV1["downstream_disposition"] =
      "continue_normal_evaluation";
  let downstreamIntent:
    SelfCorrectionIntentResolutionV1["downstream_interaction_intent"] =
      "ordinary_conceptual_response";
  const limitations:
    SelfCorrectionIntentResolutionV1["limitation_codes"] = [];

  if (selfCorrection) {
    if (topicChanged) {
      correctionScope = "topic_changed";
      evidenceStatus = "topic_changed";
      downstream = "retain_prior_and_redirect_topic";
      downstreamIntent = "off_topic_response";
      limitations.push("correction_changed_topic");
    } else if (revisedEvidence) {
      correctionScope = "active_response";
      evidenceStatus = "revised_evidence_present";
      downstream = "evaluate_revised_evidence";
    } else {
      correctionScope = activeTopic || activeAnchor
        ? "active_response"
        : "indeterminate";
      evidenceStatus = copied
        ? "copied_correction_language"
        : "correction_claim_only";
      downstream = "request_revision_evidence";
      limitations.push(copied
        ? "copied_correction_language_without_independent_evidence"
        : "self_correction_without_revised_evidence");
    }
  } else {
    limitations.push("no_self_correction_intent_detected");
  }

  return SelfCorrectionIntentResolutionV1Schema.parse({
    resolver_version: SELF_CORRECTION_INTENT_VERSION,
    intent: selfCorrection
      ? "self_correction_intent"
      : "no_self_correction_intent",
    correction_scope: correctionScope,
    evidence_status: evidenceStatus,
    downstream_disposition: downstream,
    downstream_interaction_intent: downstreamIntent,
    latest_valid_evidence_eligible:
      downstream === "evaluate_revised_evidence",
    correction_language_is_not_evidence: true,
    explicit_prior_response_reference: explicitPriorReference,
    active_topic_evidence_present: activeTopic,
    active_anchor_reference_present: activeAnchor,
    unrelated_topic_evidence_present: unrelated,
    copied_correction_language_detected: copied,
    prohibited_route_classifications:
      downstream === "evaluate_revised_evidence"
        ? contract.routing_policy.valid_self_correction_prohibited_routes
        : [],
    exact_intent_spans: intentMatches.map((entry) => ({
      label: "self_correction_intent",
      span: entry.span,
      start_index: entry.start_index
    })),
    limitation_codes: limitations
  });
}
