import { createHash } from "node:crypto";
import { z } from "zod";
import {
  TopicDialogueAnchorApplicationSchema,
  TopicDialogueCumulativeEvidenceProfileSchema,
  TopicDialogueInteractionIntentSchema,
  TopicDialogueMisconceptionStatusSchema,
  TopicDialogueReasoningQualitySchema,
  TopicDialogueTurnEvidenceProfileSchema,
  type TopicDialogueCumulativeEvidenceProfile,
  type TopicDialogueTurnEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import type {
  TurnEvidenceObservationV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";

export const TURN_EVIDENCE_OBSERVATION_VERSION =
  "turn-evidence-observation-v1" as const;
export const LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION =
  "learning-profile-update-disposition-v1" as const;
export const NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION =
  "nonconceptual-profile-preservation-v1" as const;
export const MIXED_INTENT_EVIDENCE_RETENTION_VERSION =
  "mixed-intent-evidence-retention-v1" as const;

export const ConceptualEvidenceApplicabilitySchema = z.enum([
  "applicable",
  "not_assessable_nonconceptual",
  "mixed_intent",
  "insufficient_observable_evidence"
]);
export type ConceptualEvidenceApplicability = z.infer<
  typeof ConceptualEvidenceApplicabilitySchema
>;

export const ProfileUpdateDispositionSchema = z.enum([
  "update_from_latest_evidence",
  "preserve_prior_profile",
  "reopen_from_latest_contradiction",
  "initialize_unresolved_profile"
]);
export type ProfileUpdateDisposition = z.infer<
  typeof ProfileUpdateDispositionSchema
>;

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
const AnchorResolutionStatusSchema = z.enum([
  "unresolved",
  "resolved_against_distractor",
  "regressed",
  "contradictory"
]);

export const TurnEvidenceObservationRecordV1Schema = z.object({
  observation_version: z.literal(TURN_EVIDENCE_OBSERVATION_VERSION),
  observation_id: z.string().regex(/^teo_[a-f0-9]{24}$/u),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  interaction_intent: TopicDialogueInteractionIntentSchema,
  conceptual_evidence_applicability: ConceptualEvidenceApplicabilitySchema,
  evidence_spans: z.array(z.object({
    label: z.string().min(1).max(120),
    span: z.string().min(1).max(900)
  }).strict()).max(24),
  anchor_references_observed: z.object({
    anchor_application: TopicDialogueAnchorApplicationSchema,
    anchor_stance: AnchorStanceSchema,
    anchor_consistency: AnchorConsistencySchema,
    anchor_resolution_status: AnchorResolutionStatusSchema
  }).strict(),
  reasoning_evidence_observed: z.object({
    reasoning_quality: TopicDialogueReasoningQualitySchema,
    misconception_status: TopicDialogueMisconceptionStatusSchema,
    essential_missing_links: z.array(z.string().min(1).max(240)).max(24)
  }).strict(),
  contradictions_observed: z.object({
    contradiction_ids: z.array(z.string().min(1).max(240)).max(24),
    structured_contradiction_count: z.number().int().nonnegative()
  }).strict(),
  evidence_limitations: z.array(z.string().min(1).max(240)).max(24),
  unsupported_understanding_claim: z.boolean(),
  profile_update_disposition: ProfileUpdateDispositionSchema,
  created_at: z.string().datetime()
}).strict();
export type TurnEvidenceObservationRecordV1 = z.infer<
  typeof TurnEvidenceObservationRecordV1Schema
>;

export const LearningProfileUpdateDispositionRecordV1Schema = z.object({
  update_contract_version: z.literal(
    LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION
  ),
  prior_authoritative_profile_id: z.string().min(1).nullable(),
  latest_turn_observation_id: z.string().min(1),
  update_disposition: ProfileUpdateDispositionSchema,
  fields_updated: z.array(z.string().min(1).max(120)).max(24),
  fields_preserved: z.array(z.string().min(1).max(120)).max(24),
  fields_reopened: z.array(z.string().min(1).max(120)).max(24),
  resulting_authoritative_profile_id: z.string().min(1),
  reason: z.string().min(1).max(500),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  preservation_provenance: z.object({
    preservation_policy_version: z.literal(
      NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION
    ),
    preserved_from_profile_snapshot_id: z.string().min(1),
    preserved_after_student_turn_id: z.string().min(1),
    preservation_reason: z.string().min(1).max(300),
    immediate_intent: TopicDialogueInteractionIntentSchema
  }).strict().nullable(),
  mixed_intent_retention_version: z.literal(
    MIXED_INTENT_EVIDENCE_RETENTION_VERSION
  ),
  created_at: z.string().datetime()
}).strict();
export type LearningProfileUpdateDispositionRecordV1 = z.infer<
  typeof LearningProfileUpdateDispositionRecordV1Schema
>;

const GENERIC_UNSUPPORTED_UNDERSTANDING =
  /^(?:okay[, ]*)?(?:i\s+)?(?:now\s+)?(?:understand|understand\s+now|get\s+it|got\s+it|see)(?:\s+(?:it|now))?[.!]?$/iu;

function stableId(prefix: string, value: unknown) {
  return `${prefix}_${createHash("sha256")
    .update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function isUnsupportedUnderstandingClaim(message: string) {
  return GENERIC_UNSUPPORTED_UNDERSTANDING.test(message.trim());
}

export function normalizeUnsupportedUnderstandingObservation(input: {
  observation: TurnEvidenceObservationV5;
  latest_student_message: string;
}) {
  if (!isUnsupportedUnderstandingClaim(input.latest_student_message)) {
    return input.observation;
  }
  return {
    ...input.observation,
    reasoning_quality: "insufficient" as const,
    anchor_application: "absent" as const,
    anchor_stance: "not_expressed" as const,
    anchor_consistency: "not_assessable" as const,
    anchor_resolution_status: "unresolved" as const,
    misconception_status: "uncertain" as const,
    essential_missing_links: ["observable_conceptual_evidence"],
    contradictions: [],
    structured_contradictions: [],
    observable_evidence_spans: [],
    evidence_limitations: unique([
      ...input.observation.evidence_limitations,
      "unsupported_understanding_claim_is_not_conceptual_evidence"
    ])
  } satisfies TurnEvidenceObservationV5;
}

export function classifyConceptualEvidenceApplicability(input: {
  observation: TurnEvidenceObservationV5;
  unsupported_understanding_claim?: boolean;
}): ConceptualEvidenceApplicability {
  if (input.unsupported_understanding_claim) {
    return "insufficient_observable_evidence";
  }
  const observation = input.observation;
  const meaningfulConceptualEvidence =
    observation.reasoning_quality !== "insufficient" && (
      observation.observable_evidence_spans.length > 0 ||
      observation.anchor_application !== "absent" ||
      observation.contradictions.length > 0 ||
      observation.structured_contradictions.length > 0
    );
  if (observation.interaction_intent !== "ordinary_conceptual_response") {
    return meaningfulConceptualEvidence
      ? "mixed_intent"
      : "not_assessable_nonconceptual";
  }
  return meaningfulConceptualEvidence
    ? "applicable"
    : "insufficient_observable_evidence";
}

export function determineProfileUpdateDisposition(input: {
  prior: TopicDialogueCumulativeEvidenceProfile | null;
  observation: TurnEvidenceObservationV5;
  conceptual_evidence_applicability: ConceptualEvidenceApplicability;
}): ProfileUpdateDisposition {
  const applicable = input.conceptual_evidence_applicability === "applicable" ||
    input.conceptual_evidence_applicability === "mixed_intent";
  if (!applicable) {
    return input.prior
      ? "preserve_prior_profile"
      : "initialize_unresolved_profile";
  }
  const reopening = Boolean(
    input.prior?.current_misconception_status ===
      "resolved_for_current_anchor" && (
      input.observation.misconception_status === "persists" ||
      input.observation.contradictions.length > 0 ||
      input.observation.structured_contradictions.length > 0
    )
  );
  return reopening
    ? "reopen_from_latest_contradiction"
    : "update_from_latest_evidence";
}

export function createTurnEvidenceObservationRecordV1(input: {
  source_student_turn_id: string;
  source_sequence_index: number;
  observation: TurnEvidenceObservationV5;
  conceptual_evidence_applicability: ConceptualEvidenceApplicability;
  profile_update_disposition: ProfileUpdateDisposition;
  unsupported_understanding_claim: boolean;
  created_at?: string;
}) {
  const core = {
    source_student_turn_id: input.source_student_turn_id,
    source_sequence_index: input.source_sequence_index,
    interaction_intent: input.observation.interaction_intent,
    conceptual_evidence_applicability:
      input.conceptual_evidence_applicability,
    evidence_spans: input.observation.observable_evidence_spans,
    anchor_references_observed: {
      anchor_application: input.observation.anchor_application,
      anchor_stance: input.observation.anchor_stance,
      anchor_consistency: input.observation.anchor_consistency,
      anchor_resolution_status: input.observation.anchor_resolution_status
    },
    reasoning_evidence_observed: {
      reasoning_quality: input.observation.reasoning_quality,
      misconception_status: input.observation.misconception_status,
      essential_missing_links: input.observation.essential_missing_links
    },
    contradictions_observed: {
      contradiction_ids: input.observation.contradictions,
      structured_contradiction_count:
        input.observation.structured_contradictions.length
    },
    evidence_limitations: input.observation.evidence_limitations,
    unsupported_understanding_claim: input.unsupported_understanding_claim,
    profile_update_disposition: input.profile_update_disposition
  };
  return TurnEvidenceObservationRecordV1Schema.parse({
    observation_version: TURN_EVIDENCE_OBSERVATION_VERSION,
    observation_id: stableId("teo", core),
    ...core,
    created_at: input.created_at ?? new Date().toISOString()
  });
}

export function applyConceptualApplicabilityToTurnProfile(input: {
  profile: TopicDialogueTurnEvidenceProfile;
  observation: TurnEvidenceObservationV5;
  conceptual_evidence_applicability: ConceptualEvidenceApplicability;
}) {
  const conceptuallyApplicable =
    input.conceptual_evidence_applicability === "applicable" ||
    input.conceptual_evidence_applicability === "mixed_intent";
  const revisionReady = conceptuallyApplicable &&
    input.observation.reasoning_quality === "sound" &&
    input.observation.anchor_application === "explicit" &&
    input.observation.anchor_stance === "rejects_distractor" &&
    input.observation.anchor_consistency ===
      "consistent_with_conceptual_reasoning" &&
    input.observation.anchor_resolution_status ===
      "resolved_against_distractor" &&
    input.observation.misconception_status ===
      "resolved_for_current_anchor" &&
    input.observation.essential_missing_links.length === 0 &&
    input.observation.contradictions.length === 0;
  return TopicDialogueTurnEvidenceProfileSchema.parse({
    ...input.profile,
    revision_readiness: revisionReady
  });
}

export function integrateTopicDialogueEvidenceProfileWithDisposition(input: {
  prior: TopicDialogueCumulativeEvidenceProfile | null;
  current: TopicDialogueTurnEvidenceProfile;
  disposition: ProfileUpdateDisposition;
}) {
  const prior = input.prior;
  const current = input.current;
  const preserve = input.disposition === "preserve_prior_profile";
  if (preserve && !prior) {
    throw new Error("profile_preservation_requires_prior_profile");
  }
  const usePrior = preserve && prior !== null;
  const currentConceptualSnapshot = usePrior
    ? prior.current_conceptual_profile_snapshot_id
    : current.profile_snapshot_id;
  const reopened = input.disposition === "reopen_from_latest_contradiction";
  return TopicDialogueCumulativeEvidenceProfileSchema.parse({
    cumulative_profile_version: "topic-dialogue-cumulative-evidence-profile-v1",
    latest_turn_profile_snapshot_id: current.profile_snapshot_id,
    current_conceptual_profile_snapshot_id: currentConceptualSnapshot,
    current_reasoning_quality: usePrior
      ? prior.current_reasoning_quality
      : current.reasoning_quality,
    current_anchor_application: usePrior
      ? prior.current_anchor_application
      : current.anchor_application,
    current_misconception_status: usePrior
      ? prior.current_misconception_status
      : current.misconception_status,
    current_revision_readiness: usePrior
      ? prior.current_revision_readiness
      : current.revision_readiness,
    current_transfer_readiness: usePrior
      ? prior.current_transfer_readiness
      : current.transfer_readiness,
    current_completion_readiness: usePrior
      ? prior.current_completion_readiness
      : current.completion_readiness,
    historical_profile_snapshot_ids: unique([
      ...(prior?.historical_profile_snapshot_ids ?? []),
      current.profile_snapshot_id
    ]),
    historical_misconception_snapshot_ids: unique([
      ...(prior?.historical_misconception_snapshot_ids ?? []),
      ...(current.misconception_status === "persists"
        ? [current.profile_snapshot_id]
        : [])
    ]),
    misconception_reopened_count:
      (prior?.misconception_reopened_count ?? 0) + (reopened ? 1 : 0),
    latest_evidence_precedence: true,
    updated_at: current.created_at
  });
}

export function createLearningProfileUpdateDispositionRecordV1(input: {
  prior: TopicDialogueCumulativeEvidenceProfile | null;
  current_profile: TopicDialogueTurnEvidenceProfile;
  resulting_profile: TopicDialogueCumulativeEvidenceProfile;
  observation_record: TurnEvidenceObservationRecordV1;
  disposition: ProfileUpdateDisposition;
  created_at?: string;
}) {
  const conceptualFields = [
    "current_reasoning_quality",
    "current_anchor_application",
    "current_misconception_status",
    "current_revision_readiness",
    "current_transfer_readiness",
    "current_completion_readiness"
  ];
  const preserving = input.disposition === "preserve_prior_profile";
  const reopening = input.disposition === "reopen_from_latest_contradiction";
  const priorProfileId = input.prior?.current_conceptual_profile_snapshot_id ??
    null;
  const reason = preserving
    ? "The latest accepted turn supplied no assessable conceptual evidence, so the prior conceptual profile remains authoritative."
    : reopening
      ? "The latest accepted conceptual evidence contradicts a previously resolved anchor and reopens the profile."
      : input.disposition === "initialize_unresolved_profile"
        ? "No prior topic-dialogue profile exists and the latest turn does not support a conceptual update."
        : input.observation_record.conceptual_evidence_applicability ===
            "mixed_intent"
          ? "Conceptual evidence was retained before the immediate intent route was applied."
          : "The latest assessable conceptual evidence updates the authoritative profile.";
  return LearningProfileUpdateDispositionRecordV1Schema.parse({
    update_contract_version: LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
    prior_authoritative_profile_id: priorProfileId,
    latest_turn_observation_id: input.observation_record.observation_id,
    update_disposition: input.disposition,
    fields_updated: preserving ? ["latest_turn_profile_snapshot_id"] : [
      "latest_turn_profile_snapshot_id",
      ...conceptualFields
    ],
    fields_preserved: preserving ? conceptualFields : [],
    fields_reopened: reopening
      ? ["current_misconception_status", "current_revision_readiness"]
      : [],
    resulting_authoritative_profile_id:
      input.resulting_profile.current_conceptual_profile_snapshot_id,
    reason,
    source_student_turn_id: input.current_profile.source_student_turn_id,
    source_sequence_index: input.current_profile.source_sequence_index,
    preservation_provenance: preserving && priorProfileId ? {
      preservation_policy_version: NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION,
      preserved_from_profile_snapshot_id: priorProfileId,
      preserved_after_student_turn_id:
        input.current_profile.source_student_turn_id,
      preservation_reason: reason,
      immediate_intent: input.current_profile.interaction_intent
    } : null,
    mixed_intent_retention_version: MIXED_INTENT_EVIDENCE_RETENTION_VERSION,
    created_at: input.created_at ?? input.current_profile.created_at
  });
}

export function assertProfileUpdateDispositionCoherent(input: {
  prior: TopicDialogueCumulativeEvidenceProfile | null;
  current_profile: TopicDialogueTurnEvidenceProfile;
  resulting_profile: TopicDialogueCumulativeEvidenceProfile;
  observation_record: TurnEvidenceObservationRecordV1;
  update_record: LearningProfileUpdateDispositionRecordV1;
}) {
  const issues: string[] = [];
  const disposition = input.update_record.update_disposition;
  const priorProfileId = input.prior?.current_conceptual_profile_snapshot_id ??
    null;
  if (input.update_record.latest_turn_observation_id !==
      input.observation_record.observation_id) {
    issues.push("latest_turn_observation_id_mismatch");
  }
  if (input.update_record.resulting_authoritative_profile_id !==
      input.resulting_profile.current_conceptual_profile_snapshot_id) {
    issues.push("resulting_authoritative_profile_id_mismatch");
  }
  if (disposition === "preserve_prior_profile") {
    if (!priorProfileId) issues.push("preservation_without_prior_profile");
    if (priorProfileId !==
        input.resulting_profile.current_conceptual_profile_snapshot_id) {
      issues.push("preserved_profile_identity_changed");
    }
    if (!input.update_record.preservation_provenance) {
      issues.push("preservation_provenance_missing");
    }
  }
  if (disposition === "initialize_unresolved_profile" && input.prior) {
    issues.push("unresolved_initialization_with_prior_profile");
  }
  if ((disposition === "update_from_latest_evidence" ||
      disposition === "reopen_from_latest_contradiction") &&
      input.resulting_profile.current_conceptual_profile_snapshot_id !==
        input.current_profile.profile_snapshot_id) {
    issues.push("latest_conceptual_evidence_not_authoritative");
  }
  if (input.observation_record.conceptual_evidence_applicability ===
      "mixed_intent" && disposition === "preserve_prior_profile") {
    issues.push("mixed_intent_conceptual_evidence_discarded");
  }
  if (issues.length > 0) {
    throw new Error(
      `learning_profile_update_disposition_inconsistent:${issues.join("|")}`
    );
  }
  return {
    update_contract_version: LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
    passed: true as const,
    disposition,
    resulting_authoritative_profile_id:
      input.resulting_profile.current_conceptual_profile_snapshot_id
  };
}
