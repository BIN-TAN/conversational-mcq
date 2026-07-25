import { z } from "zod";
import {
  LlmStudentRenderedIntentSchema,
  type LlmStudentRenderedIntent
} from "./e2a-schemas";

export const SELF_CORRECTION_INTENT_ENVELOPE_VERSION =
  "self-correction-intent-envelope-v2" as const;

export const SelfCorrectionVisibleBehaviorV2Schema = z.enum([
  "self_correction",
  "reflection_or_uncertainty",
  "unsupported_understanding_claim",
  "ordinary_response"
]);
export type SelfCorrectionVisibleBehaviorV2 = z.infer<
  typeof SelfCorrectionVisibleBehaviorV2Schema
>;

export const SelfCorrectionConceptualEvidenceStatusV2Schema = z.enum([
  "not_evaluated",
  "no_conceptual_update",
  "conceptual_update",
  "contradictory_conceptual_update"
]);
export type SelfCorrectionConceptualEvidenceStatusV2 = z.infer<
  typeof SelfCorrectionConceptualEvidenceStatusV2Schema
>;

export const SelfCorrectionIntentEnvelopeContractV2Schema = z.object({
  contract_version: z.literal(SELF_CORRECTION_INTENT_ENVELOPE_VERSION),
  authority_policy: z.object({
    visible_behavior_is_primary_for_interaction_intent: z.literal(true),
    simulator_metadata_is_non_authoritative: z.literal(true),
    exact_metadata_label_equality_required: z.literal(false),
    conceptual_evidence_is_evaluated_separately: z.literal(true),
    correction_language_alone_is_not_conceptual_evidence: z.literal(true)
  }).strict(),
  allowed_visible_behavior: z.tuple([
    z.literal("self_correction"),
    z.literal("reflection_or_uncertainty")
  ]),
  compatible_evidence_status: z.tuple([
    z.literal("not_evaluated"),
    z.literal("no_conceptual_update"),
    z.literal("conceptual_update"),
    z.literal("contradictory_conceptual_update")
  ]),
  prohibited_visible_behavior: z.tuple([
    z.literal("unsupported_understanding_claim")
  ]),
  metadata_policy: z.object({
    retained_for_audit: z.literal(true),
    may_disagree_with_visible_behavior: z.literal(true),
    may_not_create_self_correction_intent: z.literal(true),
    may_not_create_conceptual_evidence: z.literal(true),
    may_not_override_visible_behavior: z.literal(true)
  }).strict()
}).strict();
export type SelfCorrectionIntentEnvelopeContractV2 = z.infer<
  typeof SelfCorrectionIntentEnvelopeContractV2Schema
>;

export const SelfCorrectionIntentEnvelopeInputV2Schema = z.object({
  visible_message: z.string().min(1).max(5000),
  simulator_metadata: z.object({
    rendered_intent: LlmStudentRenderedIntentSchema,
    expressed_evidence_level: z.enum([
      "none",
      "minimal",
      "partial",
      "substantive"
    ]),
    claims_understanding: z.boolean()
  }).strict(),
  conceptual_evidence: z.object({
    status: SelfCorrectionConceptualEvidenceStatusV2Schema,
    source: z.enum([
      "not_evaluated",
      "evaluator_v5",
      "deterministic_fixture",
      "immutable_provider_output_replay"
    ]),
    observable_evidence_present: z.boolean(),
    independent_application_present: z.boolean(),
    contradiction_present: z.boolean()
  }).strict()
}).strict();
export type SelfCorrectionIntentEnvelopeInputV2 = z.infer<
  typeof SelfCorrectionIntentEnvelopeInputV2Schema
>;

const CompatibilityBasisSchema = z.enum([
  "visible_correction_intent",
  "visible_reflection_intent",
  "visible_uncertainty",
  "conceptual_evidence_update"
]);

export const SelfCorrectionIntentEnvelopeResolutionV2Schema = z.object({
  resolver_version: z.literal(SELF_CORRECTION_INTENT_ENVELOPE_VERSION),
  visible_behavior: SelfCorrectionVisibleBehaviorV2Schema,
  self_correction_intent: z.boolean(),
  reflection_intent: z.boolean(),
  uncertainty_present: z.boolean(),
  unsupported_understanding_claim: z.boolean(),
  conceptual_evidence_status:
    SelfCorrectionConceptualEvidenceStatusV2Schema,
  conceptual_evidence_update: z.boolean(),
  misconception_remains: z.boolean(),
  profile_update_eligible: z.boolean(),
  simulator_metadata_rendered_intent: LlmStudentRenderedIntentSchema,
  simulator_metadata_is_authoritative: z.literal(false),
  metadata_alignment: z.enum([
    "aligned",
    "compatible_disagreement",
    "incompatible"
  ]),
  compatibility_basis: z.array(CompatibilityBasisSchema).max(4),
  accepted_by_intent_envelope: z.boolean(),
  exact_metadata_label_equality_required: z.literal(false),
  conceptual_evidence_evaluated_separately: z.literal(true),
  correction_language_alone_is_not_conceptual_evidence: z.literal(true),
  reason_codes: z.array(z.enum([
    "visible_self_correction_detected",
    "visible_reflection_detected",
    "visible_uncertainty_detected",
    "unsupported_understanding_claim_detected",
    "simulator_metadata_aligned",
    "simulator_metadata_disagrees_but_is_non_authoritative",
    "no_conceptual_evidence_update",
    "conceptual_evidence_update_present",
    "contradictory_update_keeps_misconception_open",
    "visible_behavior_outside_envelope"
  ])).min(2).max(12)
}).strict();
export type SelfCorrectionIntentEnvelopeResolutionV2 = z.infer<
  typeof SelfCorrectionIntentEnvelopeResolutionV2Schema
>;

const SELF_CORRECTION_PATTERNS = [
  /\bi\s+(?:was|am)\s+(?:wrong|mistaken)\b/iu,
  /\bi\s+(?:may|might)\s+have\s+been\s+(?:wrong|mistaken)\b/iu,
  /\bi\s+(?:think|realize|recognize|see)\s+(?:that\s+)?(?:i\s+)?(?:was|am)\s+(?:wrong|mistaken)\b/iu,
  /\bi\s+(?:think\s+)?(?:need|want|would like|have)\s+to\s+(?:change|correct|revise|update|rethink)\b/iu,
  /\b(?:let me|i(?:'ll| will))\s+(?:change|correct|revise|update|restate|rethink)\b/iu,
  /\bi\s+(?:changed|am changing|would change)\s+(?:my\s+)?(?:answer|choice|reasoning|explanation|view|response|what i said)\b/iu,
  /\bi\s+(?:choose|would choose|will choose|am choosing)\s+(?:another|a different)\s+(?:answer|choice|option)\b/iu,
  /\bi\s+meant\s+(?:option\s+)?[a-z0-9]+\b/iu,
  /\b(?:my\s+)?(?:previous|earlier|original|first)\s+(?:answer|choice|reasoning|explanation|view|response)\s+(?:was|is)\s+(?:wrong|mistaken|incomplete)\b/iu,
  /\bwhat\s+i\s+said\s+(?:before|earlier)?\s*(?:was|is)?\s*(?:wrong|mistaken|incomplete)\b/iu,
  /\b(?:correction|revision)\s*[:,-]/iu
] as const;

const REFLECTION_PATTERNS = [
  /\b(?:actually|on second thought|looking back|thinking again)\b/iu,
  /\bi\s+(?:need|want)\s+to\s+(?:reconsider|rethink|reflect)\b/iu,
  /\bi\s+(?:am|feel)\s+less\s+sure\b/iu
] as const;

const UNCERTAINTY_PATTERNS = [
  /\b(?:i\s+am|i'm|i\s+remain|still)\s+(?:not sure|unsure|uncertain)\b/iu,
  /\bi\s+(?:do not|don't)\s+know\b/iu,
  /\b(?:maybe|perhaps|might|may)\b/iu,
  /\bnot\s+sure\s+anymore\b/iu
] as const;

const UNSUPPORTED_UNDERSTANDING_PATTERNS = [
  /\bi\s+(?:understand|get|see)\s+(?:it\s+)?now\b/iu,
  /\bthat\s+makes\s+sense\s+now\b/iu,
  /\bi\s+(?:fully|completely)\s+understand\b/iu
] as const;

const CONCEPTUAL_STOP_WORDS = new Set([
  "a", "about", "actually", "again", "an", "and", "answer", "another",
  "because", "before", "but", "change", "changed", "choice", "choose",
  "correct", "different", "earlier", "explanation", "i", "is", "it", "meant",
  "my", "now", "option", "previous", "reasoning", "response", "said", "that",
  "the", "think", "this", "to", "was", "what", "wrong", "would"
]);

function normalize(value: string) {
  return value
    .toLocaleLowerCase("en-CA")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function matchesAny(message: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(message));
}

export function classifyVisibleSelfCorrectionBehaviorV2(message: string): {
  visible_behavior: SelfCorrectionVisibleBehaviorV2;
  self_correction_intent: boolean;
  reflection_intent: boolean;
  uncertainty_present: boolean;
  unsupported_understanding_claim: boolean;
} {
  const selfCorrection = matchesAny(message, SELF_CORRECTION_PATTERNS);
  const reflection = matchesAny(message, REFLECTION_PATTERNS);
  const uncertainty = matchesAny(message, UNCERTAINTY_PATTERNS);
  const unsupported = matchesAny(
    message,
    UNSUPPORTED_UNDERSTANDING_PATTERNS
  );
  let visibleBehavior: SelfCorrectionVisibleBehaviorV2 = "ordinary_response";
  if (selfCorrection) {
    visibleBehavior = "self_correction";
  } else if (reflection || uncertainty) {
    visibleBehavior = "reflection_or_uncertainty";
  } else if (unsupported) {
    visibleBehavior = "unsupported_understanding_claim";
  }
  return {
    visible_behavior: visibleBehavior,
    self_correction_intent: selfCorrection,
    reflection_intent: reflection,
    uncertainty_present: uncertainty,
    unsupported_understanding_claim: unsupported
  };
}

export function visibleMessageContainsConceptualEvidenceCandidateV2(
  message: string
) {
  const becauseClause = message.match(/\bbecause\b(.+)$/iu)?.[1];
  if (!becauseClause) return false;
  const tokens = normalize(becauseClause).split(" ").filter((token) =>
    token.length > 2 && !CONCEPTUAL_STOP_WORDS.has(token)
  );
  return tokens.length >= 3 &&
    /\b(?:does not|doesn't|cannot|can't|may|might|limits?|differs?|affects?|proves?|supports?|requires?|means?)\b/iu
      .test(becauseClause);
}

export function buildSelfCorrectionIntentEnvelopeContractV2():
  SelfCorrectionIntentEnvelopeContractV2 {
  return SelfCorrectionIntentEnvelopeContractV2Schema.parse({
    contract_version: SELF_CORRECTION_INTENT_ENVELOPE_VERSION,
    authority_policy: {
      visible_behavior_is_primary_for_interaction_intent: true,
      simulator_metadata_is_non_authoritative: true,
      exact_metadata_label_equality_required: false,
      conceptual_evidence_is_evaluated_separately: true,
      correction_language_alone_is_not_conceptual_evidence: true
    },
    allowed_visible_behavior: [
      "self_correction",
      "reflection_or_uncertainty"
    ],
    compatible_evidence_status: [
      "not_evaluated",
      "no_conceptual_update",
      "conceptual_update",
      "contradictory_conceptual_update"
    ],
    prohibited_visible_behavior: ["unsupported_understanding_claim"],
    metadata_policy: {
      retained_for_audit: true,
      may_disagree_with_visible_behavior: true,
      may_not_create_self_correction_intent: true,
      may_not_create_conceptual_evidence: true,
      may_not_override_visible_behavior: true
    }
  });
}

function metadataMatchesVisibleBehavior(
  metadata: LlmStudentRenderedIntent,
  behavior: SelfCorrectionVisibleBehaviorV2
) {
  if (behavior === "self_correction") {
    return metadata === "revision_evidence";
  }
  if (behavior === "reflection_or_uncertainty") {
    return metadata === "partial_explanation" ||
      metadata === "conceptual_confusion";
  }
  if (behavior === "unsupported_understanding_claim") {
    return metadata === "unsupported_understanding_claim";
  }
  return ![
    "revision_evidence",
    "unsupported_understanding_claim"
  ].includes(metadata);
}

export function resolveSelfCorrectionIntentEnvelopeV2(input: {
  contract: SelfCorrectionIntentEnvelopeContractV2;
  observation: SelfCorrectionIntentEnvelopeInputV2;
}): SelfCorrectionIntentEnvelopeResolutionV2 {
  const contract = SelfCorrectionIntentEnvelopeContractV2Schema.parse(
    input.contract
  );
  const observation = SelfCorrectionIntentEnvelopeInputV2Schema.parse(
    input.observation
  );
  const visible = classifyVisibleSelfCorrectionBehaviorV2(
    observation.visible_message
  );
  const conceptualUpdate = [
    "conceptual_update",
    "contradictory_conceptual_update"
  ].includes(observation.conceptual_evidence.status);
  const contradiction = observation.conceptual_evidence.status ===
      "contradictory_conceptual_update" ||
    observation.conceptual_evidence.contradiction_present;
  const compatibilityBasis: Array<z.infer<typeof CompatibilityBasisSchema>> = [];
  if (visible.self_correction_intent) {
    compatibilityBasis.push("visible_correction_intent");
  }
  if (visible.reflection_intent) {
    compatibilityBasis.push("visible_reflection_intent");
  }
  if (visible.uncertainty_present) {
    compatibilityBasis.push("visible_uncertainty");
  }
  if (conceptualUpdate) {
    compatibilityBasis.push("conceptual_evidence_update");
  }
  const visibleAllowed = contract.allowed_visible_behavior.includes(
    visible.visible_behavior as "self_correction" |
      "reflection_or_uncertainty"
  );
  const accepted = !visible.unsupported_understanding_claim &&
    (visibleAllowed || conceptualUpdate);
  const metadataAligned = metadataMatchesVisibleBehavior(
    observation.simulator_metadata.rendered_intent,
    visible.visible_behavior
  );
  const metadataAlignment = metadataAligned
    ? "aligned"
    : accepted
      ? "compatible_disagreement"
      : "incompatible";
  const reasons:
    SelfCorrectionIntentEnvelopeResolutionV2["reason_codes"] = [];
  if (visible.self_correction_intent) {
    reasons.push("visible_self_correction_detected");
  }
  if (visible.reflection_intent) reasons.push("visible_reflection_detected");
  if (visible.uncertainty_present) reasons.push("visible_uncertainty_detected");
  if (visible.unsupported_understanding_claim) {
    reasons.push("unsupported_understanding_claim_detected");
  }
  reasons.push(metadataAligned
    ? "simulator_metadata_aligned"
    : "simulator_metadata_disagrees_but_is_non_authoritative");
  if (conceptualUpdate) {
    reasons.push("conceptual_evidence_update_present");
  } else {
    reasons.push("no_conceptual_evidence_update");
  }
  if (contradiction) {
    reasons.push("contradictory_update_keeps_misconception_open");
  }
  if (!accepted) reasons.push("visible_behavior_outside_envelope");

  return SelfCorrectionIntentEnvelopeResolutionV2Schema.parse({
    resolver_version: SELF_CORRECTION_INTENT_ENVELOPE_VERSION,
    ...visible,
    conceptual_evidence_status: observation.conceptual_evidence.status,
    conceptual_evidence_update: conceptualUpdate,
    misconception_remains: contradiction,
    profile_update_eligible:
      conceptualUpdate &&
      observation.conceptual_evidence.observable_evidence_present &&
      observation.conceptual_evidence.independent_application_present,
    simulator_metadata_rendered_intent:
      observation.simulator_metadata.rendered_intent,
    simulator_metadata_is_authoritative: false,
    metadata_alignment: metadataAlignment,
    compatibility_basis: compatibilityBasis,
    accepted_by_intent_envelope: accepted,
    exact_metadata_label_equality_required: false,
    conceptual_evidence_evaluated_separately: true,
    correction_language_alone_is_not_conceptual_evidence: true,
    reason_codes: reasons
  });
}
