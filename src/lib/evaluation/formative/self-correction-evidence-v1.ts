import { z } from "zod";
import {
  ProfileUpdateDispositionSchema
} from "@/lib/services/student-assessment/turn-evidence-profile-update";
import {
  type SelfCorrectionIntentContractV1,
  resolveSelfCorrectionIntentV1
} from "./self-correction-intent-v1";

export const SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION =
  "self-correction-evidence-contract-v1" as const;
export const SELF_CORRECTION_INTENT_SIGNAL_VERSION =
  "self-correction-intent-signal-v1" as const;

const ReasoningQualitySchema = z.enum([
  "insufficient",
  "misconception",
  "partial",
  "sound"
]);
const AnchorApplicationSchema = z.enum([
  "absent",
  "implicit",
  "explicit"
]);
const AnchorStanceSchema = z.enum([
  "not_expressed",
  "ambiguous",
  "endorses_distractor",
  "rejects_distractor"
]);
const AnchorConsistencySchema = z.enum([
  "not_assessable",
  "consistent_with_conceptual_reasoning",
  "contradictory_to_conceptual_reasoning",
  "unresolved"
]);
const MisconceptionStatusSchema = z.enum([
  "persists",
  "uncertain",
  "resolved_for_current_anchor"
]);

export const SelfCorrectionEvidenceContractV1Schema = z.object({
  contract_version: z.literal(SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION),
  separation_policy: z.object({
    intent_is_not_conceptual_evidence: z.literal(true),
    answer_revision_is_not_reasoning_evidence: z.literal(true),
    anchor_reference_alone_is_not_conceptual_evidence: z.literal(true),
    copied_or_formulaic_language_is_not_independent_evidence: z.literal(true),
    observable_evidence_is_required_for_profile_update: z.literal(true),
    misconception_or_contradiction_evidence_may_reopen_profile: z.literal(true),
    sound_update_requires_complete_consistent_evidence: z.literal(true)
  }).strict(),
  profile_policy: z.object({
    no_conceptual_update_with_prior_profile:
      z.literal("preserve_prior_profile"),
    no_conceptual_update_without_prior_profile:
      z.literal("initialize_unresolved_profile"),
    latest_valid_evidence:
      z.literal("update_from_latest_evidence"),
    regression_after_resolved_profile:
      z.literal("reopen_from_latest_contradiction")
  }).strict()
}).strict();
export type SelfCorrectionEvidenceContractV1 = z.infer<
  typeof SelfCorrectionEvidenceContractV1Schema
>;

export const SelfCorrectionIntentSignalV1Schema = z.object({
  signal_version: z.literal(SELF_CORRECTION_INTENT_SIGNAL_VERSION),
  source_resolver_version: z.string().min(1).max(160),
  self_correction_intent: z.boolean(),
  explicit_prior_response_reference: z.boolean(),
  exact_intent_spans: z.array(z.object({
    span: z.string().min(1).max(500),
    start_index: z.number().int().nonnegative()
  }).strict()).max(16)
}).strict();
export type SelfCorrectionIntentSignalV1 = z.infer<
  typeof SelfCorrectionIntentSignalV1Schema
>;

export const SelfCorrectionConceptualEvidenceObservationV1Schema = z.object({
  evidence_source: z.enum([
    "evaluator_v5",
    "immutable_provider_output_replay",
    "deterministic_fixture"
  ]),
  evidence_kind: z.enum([
    "none",
    "answer_revision_only",
    "conceptual_reasoning",
    "anchor_stance_evidence",
    "contradictory_reasoning",
    "copied_or_formulaic"
  ]),
  reasoning_quality: ReasoningQualitySchema,
  observable_evidence_spans: z.array(z.object({
    label: z.string().min(1).max(120),
    span: z.string().min(1).max(900)
  }).strict()).max(24),
  independent_application_present: z.boolean(),
  copied_or_formulaic_language_detected: z.boolean(),
  topic_relevant: z.boolean(),
  anchor_application: AnchorApplicationSchema,
  anchor_stance: AnchorStanceSchema,
  anchor_consistency: AnchorConsistencySchema,
  misconception_status: MisconceptionStatusSchema,
  essential_missing_links: z.array(z.string().min(1).max(240)).max(24),
  contradictions: z.array(z.string().min(1).max(240)).max(24),
  prior_profile_status: z.enum([
    "unresolved",
    "persists",
    "resolved_for_current_anchor"
  ]).nullable()
}).strict();
export type SelfCorrectionConceptualEvidenceObservationV1 = z.infer<
  typeof SelfCorrectionConceptualEvidenceObservationV1Schema
>;

const SelfCorrectionEvidenceReasonCodeSchema = z.enum([
  "self_correction_intent_present",
  "self_correction_intent_absent",
  "intent_not_used_as_conceptual_evidence",
  "no_observable_conceptual_evidence",
  "answer_revision_not_reasoning_evidence",
  "anchor_reference_without_reasoning_not_evidence",
  "copied_language_not_independent_evidence",
  "off_topic_evidence_not_profile_eligible",
  "conceptual_evidence_update_allowed",
  "misconception_evidence_not_sound",
  "blocking_contradiction_present",
  "essential_missing_links_present",
  "sound_update_allowed",
  "prior_profile_preserved",
  "prior_profile_initialized_unresolved",
  "prior_profile_updated_from_latest_evidence",
  "prior_profile_reopened"
]);

export const SelfCorrectionEvidenceResolutionV1Schema = z.object({
  resolver_version: z.literal(SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION),
  self_correction_intent: z.boolean(),
  conceptual_evidence_update: z.boolean(),
  conceptual_evidence_quality: z.enum([
    "none",
    "answer_revision_only",
    "copied_insufficient",
    "misconception",
    "partial",
    "sound",
    "contradictory"
  ]),
  observable_conceptual_evidence_present: z.boolean(),
  independent_conceptual_evidence_present: z.boolean(),
  profile_update_eligible: z.boolean(),
  profile_update_disposition: ProfileUpdateDispositionSchema,
  latest_valid_evidence_eligible: z.boolean(),
  sound_update_eligible: z.boolean(),
  revision_ready: z.boolean(),
  intent_and_evidence_separated: z.literal(true),
  correction_language_alone_is_not_understanding: z.literal(true),
  reason_codes: z.array(SelfCorrectionEvidenceReasonCodeSchema).min(2).max(16)
}).strict();
export type SelfCorrectionEvidenceResolutionV1 = z.infer<
  typeof SelfCorrectionEvidenceResolutionV1Schema
>;

const SUPPLEMENTAL_INTENT_PATTERNS = [
  /\bi\s+was\s+(?:wrong|mistaken)\b/giu,
  /\bi\s+(?:may|might)\s+have\s+been\s+(?:wrong|mistaken)\b/giu,
  /\bi\s+meant\s+(?:option\s+)?[a-z0-9]+\b/giu,
  /\bi\s+changed\s+my\s+(?:answer|reasoning|explanation|view)\b/giu
] as const;

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export function buildSelfCorrectionEvidenceContractV1():
  SelfCorrectionEvidenceContractV1 {
  return SelfCorrectionEvidenceContractV1Schema.parse({
    contract_version: SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
    separation_policy: {
      intent_is_not_conceptual_evidence: true,
      answer_revision_is_not_reasoning_evidence: true,
      anchor_reference_alone_is_not_conceptual_evidence: true,
      copied_or_formulaic_language_is_not_independent_evidence: true,
      observable_evidence_is_required_for_profile_update: true,
      misconception_or_contradiction_evidence_may_reopen_profile: true,
      sound_update_requires_complete_consistent_evidence: true
    },
    profile_policy: {
      no_conceptual_update_with_prior_profile: "preserve_prior_profile",
      no_conceptual_update_without_prior_profile:
        "initialize_unresolved_profile",
      latest_valid_evidence: "update_from_latest_evidence",
      regression_after_resolved_profile: "reopen_from_latest_contradiction"
    }
  });
}

export function resolveSelfCorrectionIntentSignalV1(input: {
  message: string;
  intent_contract: SelfCorrectionIntentContractV1;
}): SelfCorrectionIntentSignalV1 {
  const legacy = resolveSelfCorrectionIntentV1({
    message: input.message,
    contract: input.intent_contract
  });
  const supplementalMatches = SUPPLEMENTAL_INTENT_PATTERNS.flatMap((pattern) =>
    [...input.message.matchAll(pattern)].map((match) => ({
      span: match[0].trim().slice(0, 500),
      start_index: match.index ?? 0
    }))
  );
  const allSpans = [
    ...legacy.exact_intent_spans.map((entry) => ({
      span: entry.span,
      start_index: entry.start_index
    })),
    ...supplementalMatches
  ].filter((entry, index, all) =>
    all.findIndex((candidate) =>
      candidate.span === entry.span &&
      candidate.start_index === entry.start_index
    ) === index
  );
  return SelfCorrectionIntentSignalV1Schema.parse({
    signal_version: SELF_CORRECTION_INTENT_SIGNAL_VERSION,
    source_resolver_version:
      `${legacy.resolver_version}+supplemental-intent-scope-v1`,
    self_correction_intent:
      legacy.intent === "self_correction_intent" || allSpans.length > 0,
    explicit_prior_response_reference:
      legacy.explicit_prior_response_reference ||
      /\b(?:i\s+was\s+(?:wrong|mistaken)|i\s+meant)\b/iu.test(input.message),
    exact_intent_spans: allSpans
  });
}

function evidenceQuality(
  evidence: SelfCorrectionConceptualEvidenceObservationV1,
  conceptualUpdate: boolean
): SelfCorrectionEvidenceResolutionV1["conceptual_evidence_quality"] {
  if (evidence.copied_or_formulaic_language_detected ||
      evidence.evidence_kind === "copied_or_formulaic") {
    return "copied_insufficient";
  }
  if (evidence.evidence_kind === "answer_revision_only") {
    return "answer_revision_only";
  }
  if (!conceptualUpdate) return "none";
  if (evidence.contradictions.length > 0 ||
      evidence.anchor_consistency ===
        "contradictory_to_conceptual_reasoning") {
    return "contradictory";
  }
  return evidence.reasoning_quality === "insufficient"
    ? "none"
    : evidence.reasoning_quality;
}

export function resolveSelfCorrectionEvidenceV1(input: {
  contract: SelfCorrectionEvidenceContractV1;
  intent_signal: SelfCorrectionIntentSignalV1;
  conceptual_evidence:
    SelfCorrectionConceptualEvidenceObservationV1;
}): SelfCorrectionEvidenceResolutionV1 {
  const contract = SelfCorrectionEvidenceContractV1Schema.parse(
    input.contract
  );
  const intent = SelfCorrectionIntentSignalV1Schema.parse(
    input.intent_signal
  );
  const evidence =
    SelfCorrectionConceptualEvidenceObservationV1Schema.parse(
      input.conceptual_evidence
    );

  const observable = evidence.observable_evidence_spans.length > 0;
  const decisiveAnchorStance =
    evidence.anchor_stance === "endorses_distractor" ||
    evidence.anchor_stance === "rejects_distractor";
  const stanceOrContradictionEvidence = (
    evidence.evidence_kind === "anchor_stance_evidence" ||
    evidence.evidence_kind === "contradictory_reasoning"
  ) && decisiveAnchorStance;
  const independent = evidence.independent_application_present ||
    stanceOrContradictionEvidence;
  const evidenceKindCanUpdate = [
    "conceptual_reasoning",
    "anchor_stance_evidence",
    "contradictory_reasoning"
  ].includes(evidence.evidence_kind);
  const conceptualUpdate =
    evidence.topic_relevant &&
    evidenceKindCanUpdate &&
    evidence.reasoning_quality !== "insufficient" &&
    observable &&
    independent &&
    !evidence.copied_or_formulaic_language_detected;

  const regression = conceptualUpdate &&
    evidence.prior_profile_status === "resolved_for_current_anchor" && (
      evidence.misconception_status === "persists" ||
      evidence.anchor_stance === "endorses_distractor" ||
      evidence.contradictions.length > 0 ||
      evidence.anchor_consistency ===
        "contradictory_to_conceptual_reasoning"
    );
  let disposition: z.infer<typeof ProfileUpdateDispositionSchema>;
  if (!conceptualUpdate) {
    disposition = evidence.prior_profile_status
      ? contract.profile_policy.no_conceptual_update_with_prior_profile
      : contract.profile_policy.no_conceptual_update_without_prior_profile;
  } else {
    disposition = regression
      ? contract.profile_policy.regression_after_resolved_profile
      : contract.profile_policy.latest_valid_evidence;
  }

  const sound =
    conceptualUpdate &&
    evidence.reasoning_quality === "sound" &&
    evidence.independent_application_present &&
    evidence.anchor_application === "explicit" &&
    evidence.anchor_stance === "rejects_distractor" &&
    evidence.anchor_consistency ===
      "consistent_with_conceptual_reasoning" &&
    evidence.misconception_status === "resolved_for_current_anchor" &&
    evidence.essential_missing_links.length === 0 &&
    evidence.contradictions.length === 0;

  const reasons: Array<
    z.infer<typeof SelfCorrectionEvidenceReasonCodeSchema>
  > = [
    intent.self_correction_intent
      ? "self_correction_intent_present"
      : "self_correction_intent_absent",
    "intent_not_used_as_conceptual_evidence"
  ];
  if (!observable) reasons.push("no_observable_conceptual_evidence");
  if (evidence.evidence_kind === "answer_revision_only") {
    reasons.push("answer_revision_not_reasoning_evidence");
  }
  if (evidence.anchor_application !== "absent" &&
      !conceptualUpdate &&
      !evidence.copied_or_formulaic_language_detected) {
    reasons.push("anchor_reference_without_reasoning_not_evidence");
  }
  if (evidence.copied_or_formulaic_language_detected) {
    reasons.push("copied_language_not_independent_evidence");
  }
  if (!evidence.topic_relevant) {
    reasons.push("off_topic_evidence_not_profile_eligible");
  }
  if (conceptualUpdate) {
    reasons.push("conceptual_evidence_update_allowed");
  }
  if (conceptualUpdate && evidence.reasoning_quality === "misconception") {
    reasons.push("misconception_evidence_not_sound");
  }
  if (evidence.contradictions.length > 0 ||
      evidence.anchor_consistency ===
        "contradictory_to_conceptual_reasoning") {
    reasons.push("blocking_contradiction_present");
  }
  if (evidence.essential_missing_links.length > 0) {
    reasons.push("essential_missing_links_present");
  }
  if (sound) reasons.push("sound_update_allowed");
  if (disposition === "preserve_prior_profile") {
    reasons.push("prior_profile_preserved");
  } else if (disposition === "initialize_unresolved_profile") {
    reasons.push("prior_profile_initialized_unresolved");
  } else if (disposition === "update_from_latest_evidence") {
    reasons.push("prior_profile_updated_from_latest_evidence");
  } else {
    reasons.push("prior_profile_reopened");
  }

  return SelfCorrectionEvidenceResolutionV1Schema.parse({
    resolver_version: SELF_CORRECTION_EVIDENCE_CONTRACT_VERSION,
    self_correction_intent: intent.self_correction_intent,
    conceptual_evidence_update: conceptualUpdate,
    conceptual_evidence_quality: evidenceQuality(evidence, conceptualUpdate),
    observable_conceptual_evidence_present: observable,
    independent_conceptual_evidence_present: independent,
    profile_update_eligible: conceptualUpdate,
    profile_update_disposition: disposition,
    latest_valid_evidence_eligible: conceptualUpdate,
    sound_update_eligible: sound,
    revision_ready: sound,
    intent_and_evidence_separated: true,
    correction_language_alone_is_not_understanding: true,
    reason_codes: unique(reasons)
  });
}
