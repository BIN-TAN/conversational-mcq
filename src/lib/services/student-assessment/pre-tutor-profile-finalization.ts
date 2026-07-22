import { z } from "zod";
import {
  assertEvidenceFirstProfileIsFresh,
  createTopicDialogueTurnEvidenceProfile,
  integrateTopicDialogueEvidenceProfile,
  selectEvidenceFirstTopicDialogueRoute,
  type TopicDialogueCumulativeEvidenceProfile,
  type TopicDialogueTurnEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
  TargetEvidenceAdjudicationV4Schema,
  TargetEvidenceContractV4Schema,
  assertTargetEvidenceObservationConsistentV4,
  mapTargetEvidenceAdjudicationToObservationV4,
  type TargetEvidenceAdjudicationV4,
  type TargetEvidenceContractV4
} from "@/lib/services/student-assessment/target-evidence-contract-v4";
import {
  PreTutorProfileFinalizationAttestationV2Schema,
  type PreTutorProfileFinalizationAttestationV2
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v2";
import {
  PreTutorProfileFinalizationAttestationV3Schema,
  type PreTutorProfileFinalizationAttestationV3
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v3";

export const PRE_TUTOR_PROFILE_FINALIZATION_VERSION =
  "pre-tutor-profile-finalization-v1" as const;

export const PreTutorProfileFinalizationAttestationSchema = z.object({
  finalization_version: z.literal(PRE_TUTOR_PROFILE_FINALIZATION_VERSION),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  evaluator_schema_valid: z.literal(true),
  target_contract_applied: z.literal(true),
  anchor_interpretation_completed: z.literal(true),
  blocking_conflicts_propagated: z.literal(true),
  profile_constructed: z.literal(true),
  profile_consistency_passed: z.literal(true),
  cumulative_profile_updated: z.literal(true),
  sound_gate_executed: z.literal(true),
  platform_mode_finalized: z.literal(true),
  latest_turn_freshness_passed: z.literal(true),
  tutor_dispatch_permitted: z.boolean()
}).strict();
export type PreTutorProfileFinalizationAttestation = z.infer<
  typeof PreTutorProfileFinalizationAttestationSchema
>;

export class PreTutorProfileFinalizationError extends Error {
  readonly issue_codes: string[];

  constructor(issueCodes: string[]) {
    super(`pre_tutor_profile_finalization_failed:${issueCodes.join("|")}`);
    this.name = "PreTutorProfileFinalizationError";
    this.issue_codes = issueCodes;
  }
}

export function finalizeEvidenceFirstTurnBeforeTutor(input: {
  contract: TargetEvidenceContractV4;
  adjudication: TargetEvidenceAdjudicationV4;
  interaction_intent: "task_language_confusion" | "protected_request" |
    "off_topic_response" | "ordinary_conceptual_response";
  confidence_evidence: "high" | "medium" | "low" | null;
  source_student_turn_id: string;
  source_sequence_index: number;
  latest_accepted_student_turn_id: string;
  latest_accepted_sequence_index: number;
  concept_id: string;
  distractor_anchor: string;
  prior_cumulative_profile: TopicDialogueCumulativeEvidenceProfile | null;
  created_at?: string;
}) {
  const contract = TargetEvidenceContractV4Schema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationV4Schema.parse(
    input.adjudication
  );
  const observation = mapTargetEvidenceAdjudicationToObservationV4({
    contract,
    adjudication,
    interaction_intent: input.interaction_intent,
    confidence_evidence: input.confidence_evidence
  });
  const consistency = assertTargetEvidenceObservationConsistentV4({
    contract,
    adjudication,
    observation
  });
  const profile = createTopicDialogueTurnEvidenceProfile({
    source_student_turn_id: input.source_student_turn_id,
    source_sequence_index: input.source_sequence_index,
    concept_id: input.concept_id,
    distractor_anchor: input.distractor_anchor,
    observation,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V4,
    created_at: input.created_at
  });
  const cumulative = integrateTopicDialogueEvidenceProfile({
    prior: input.prior_cumulative_profile,
    current: profile
  });
  const route = selectEvidenceFirstTopicDialogueRoute({ profile, cumulative });
  assertEvidenceFirstProfileIsFresh({
    profile,
    route,
    cumulative,
    latest_student_turn_id: input.latest_accepted_student_turn_id,
    latest_sequence_index: input.latest_accepted_sequence_index
  });
  const tutorDispatchPermitted = route.selected_mode === "remain_in_dialogue";
  const attestation = PreTutorProfileFinalizationAttestationSchema.parse({
    finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION,
    source_student_turn_id: profile.source_student_turn_id,
    source_sequence_index: profile.source_sequence_index,
    evaluator_schema_valid: true,
    target_contract_applied: true,
    anchor_interpretation_completed: true,
    blocking_conflicts_propagated: true,
    profile_constructed: true,
    profile_consistency_passed: true,
    cumulative_profile_updated: true,
    sound_gate_executed: true,
    platform_mode_finalized: true,
    latest_turn_freshness_passed: true,
    tutor_dispatch_permitted: tutorDispatchPermitted
  });
  return { observation, consistency, profile, cumulative, route, attestation };
}

export function assertTutorDispatchUsesFinalizedProfile(input: {
  profile: TopicDialogueTurnEvidenceProfile | null;
  attestation: PreTutorProfileFinalizationAttestation |
    PreTutorProfileFinalizationAttestationV2 |
    PreTutorProfileFinalizationAttestationV3 | null;
  latest_accepted_student_turn_id: string;
  latest_accepted_sequence_index: number;
}) {
  const issues: string[] = [];
  let parsedAttestation: PreTutorProfileFinalizationAttestation |
    PreTutorProfileFinalizationAttestationV2 |
    PreTutorProfileFinalizationAttestationV3 | null = null;
  if (!input.profile) issues.push("latest_profile_missing");
  if (!input.attestation) issues.push("finalization_attestation_missing");
  if (input.profile && (
    input.profile.source_student_turn_id !==
      input.latest_accepted_student_turn_id ||
    input.profile.source_sequence_index !==
      input.latest_accepted_sequence_index
  )) issues.push("latest_profile_source_stale");
  if (input.attestation) {
    const parsedV1 = PreTutorProfileFinalizationAttestationSchema.safeParse(
      input.attestation
    );
    const parsedV2 = PreTutorProfileFinalizationAttestationV2Schema.safeParse(
      input.attestation
    );
    const parsedV3 = PreTutorProfileFinalizationAttestationV3Schema.safeParse(
      input.attestation
    );
    if (!parsedV1.success && !parsedV2.success && !parsedV3.success) {
      issues.push("finalization_attestation_invalid");
    }
    const parsed = parsedV1.success ? parsedV1.data : parsedV2.success
      ? parsedV2.data : parsedV3.success ? parsedV3.data : null;
    parsedAttestation = parsed;
    if (!parsed) {
      // The issue above remains the fail-closed reason.
    } else {
      if (!parsed.profile_consistency_passed) {
        issues.push("profile_consistency_not_passed");
      }
      if (!parsed.platform_mode_finalized) {
        issues.push("platform_mode_not_finalized");
      }
      if (!parsed.tutor_dispatch_permitted) {
        issues.push("tutor_dispatch_not_permitted");
      }
    }
  }
  if (issues.length > 0) throw new PreTutorProfileFinalizationError(issues);
  return {
    finalization_version: parsedAttestation?.finalization_version ??
      PRE_TUTOR_PROFILE_FINALIZATION_VERSION,
    tutor_dispatch_permitted: true as const
  };
}
