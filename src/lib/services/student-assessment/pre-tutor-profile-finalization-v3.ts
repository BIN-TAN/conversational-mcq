import { z } from "zod";
import {
  assertEvidenceFirstProfileIsFresh,
  createTopicDialogueTurnEvidenceProfile,
  selectEvidenceFirstTopicDialogueRoute,
  type TopicDialogueCumulativeEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V6,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
  TargetEvidenceAdjudicationV5Schema,
  TargetEvidenceContractV5Schema,
  assertTargetEvidenceObservationConsistentV6,
  mapTargetEvidenceAdjudicationToObservationV6,
  type TargetEvidenceAdjudicationV5,
  type TargetEvidenceContractV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import {
  LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
  MIXED_INTENT_EVIDENCE_RETENTION_VERSION,
  NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION,
  TURN_EVIDENCE_OBSERVATION_VERSION,
  applyConceptualApplicabilityToTurnProfile,
  assertProfileUpdateDispositionCoherent,
  classifyConceptualEvidenceApplicability,
  createLearningProfileUpdateDispositionRecordV1,
  createTurnEvidenceObservationRecordV1,
  determineProfileUpdateDisposition,
  integrateTopicDialogueEvidenceProfileWithDisposition,
  isUnsupportedUnderstandingClaim,
  normalizeUnsupportedUnderstandingObservation
} from "@/lib/services/student-assessment/turn-evidence-profile-update";
import {
  TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2,
  reconcileTurnEvidenceLayersV2,
  type AuthoritativeProfileLayerViewV2,
  type TurnObservationLayerViewV2
} from "@/lib/services/student-assessment/turn-evidence-cross-artifact-consistency";

export const PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3 =
  "pre-tutor-profile-finalization-v3" as const;

export const PreTutorProfileFinalizationAttestationV3Schema = z.object({
  finalization_version: z.literal(PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  evaluator_version: z.literal(PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5),
  profile_mapper_version: z.literal(TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6),
  profile_consistency_version: z.literal(
    PROFILE_CONSISTENCY_POLICY_VERSION_V6
  ),
  turn_observation_version: z.literal(TURN_EVIDENCE_OBSERVATION_VERSION),
  profile_update_contract_version: z.literal(
    LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION
  ),
  cross_artifact_consistency_version: z.literal(
    TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2
  ),
  nonconceptual_preservation_version: z.literal(
    NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION
  ),
  mixed_intent_retention_version: z.literal(
    MIXED_INTENT_EVIDENCE_RETENTION_VERSION
  ),
  evaluator_schema_valid: z.literal(true),
  target_contract_applied: z.literal(true),
  turn_observation_constructed: z.literal(true),
  profile_update_disposition_applied: z.literal(true),
  cross_artifact_consistency_passed: z.literal(true),
  profile_consistency_passed: z.literal(true),
  cumulative_profile_updated: z.literal(true),
  sound_gate_executed: z.literal(true),
  platform_mode_finalized: z.literal(true),
  latest_turn_freshness_passed: z.literal(true),
  tutor_dispatch_permitted: z.boolean(),
  execution_order: z.tuple([
    z.literal("student_response_persisted"),
    z.literal("visible_history_reconstructed"),
    z.literal("evaluator_request_dispatched"),
    z.literal("evaluator_output_validated"),
    z.literal("conceptual_observation_normalized"),
    z.literal("conceptual_evidence_applicability_classified"),
    z.literal("profile_update_disposition_selected"),
    z.literal("turn_observation_constructed"),
    z.literal("turn_profile_constructed"),
    z.literal("cumulative_profile_updated"),
    z.literal("profile_update_record_constructed"),
    z.literal("semantic_layers_reconciled"),
    z.literal("sound_gate_executed"),
    z.literal("platform_mode_finalized"),
    z.literal("profile_freshness_verified")
  ])
}).strict();
export type PreTutorProfileFinalizationAttestationV3 = z.infer<
  typeof PreTutorProfileFinalizationAttestationV3Schema
>;

function turnLayerView(input: {
  artifact_type: TurnObservationLayerViewV2["artifact_type"];
  source_student_turn_id: string;
  source_sequence_index: number;
  applicability: ReturnType<typeof classifyConceptualEvidenceApplicability>;
  observation: ReturnType<
    typeof normalizeUnsupportedUnderstandingObservation
  >;
}): TurnObservationLayerViewV2 {
  return {
    artifact_type: input.artifact_type,
    source_student_turn_id: input.source_student_turn_id,
    source_sequence_index: input.source_sequence_index,
    conceptual_evidence_applicability: input.applicability,
    anchor_application: input.observation.anchor_application,
    anchor_stance: input.observation.anchor_stance,
    anchor_consistency: input.observation.anchor_consistency,
    anchor_resolution_status: input.observation.anchor_resolution_status,
    reasoning_quality: input.observation.reasoning_quality,
    contradictions: input.observation.contradictions
  };
}

function authoritativeLayerView(input: {
  artifact_type: AuthoritativeProfileLayerViewV2["artifact_type"];
  cumulative: TopicDialogueCumulativeEvidenceProfile;
}): AuthoritativeProfileLayerViewV2 {
  return {
    artifact_type: input.artifact_type,
    authoritative_profile_id:
      input.cumulative.current_conceptual_profile_snapshot_id,
    reasoning_quality: input.cumulative.current_reasoning_quality,
    anchor_application: input.cumulative.current_anchor_application,
    misconception_status: input.cumulative.current_misconception_status,
    revision_readiness: input.cumulative.current_revision_readiness
  };
}

export function finalizeEvidenceFirstTurnBeforeTutorV3(input: {
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
  latest_student_message: string;
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
  const contract = TargetEvidenceContractV5Schema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationV5Schema.parse(
    input.adjudication
  );
  const mappedObservation = mapTargetEvidenceAdjudicationToObservationV6({
    contract,
    adjudication,
    interaction_intent: input.interaction_intent,
    confidence_evidence: input.confidence_evidence
  });
  const consistency = assertTargetEvidenceObservationConsistentV6({
    contract,
    adjudication,
    observation: mappedObservation
  });
  const unsupportedUnderstandingClaim = isUnsupportedUnderstandingClaim(
    input.latest_student_message
  );
  const observation = normalizeUnsupportedUnderstandingObservation({
    observation: mappedObservation,
    latest_student_message: input.latest_student_message
  });
  const conceptualEvidenceApplicability =
    classifyConceptualEvidenceApplicability({
      observation,
      unsupported_understanding_claim: unsupportedUnderstandingClaim
    });
  const disposition = determineProfileUpdateDisposition({
    prior: input.prior_cumulative_profile,
    observation,
    conceptual_evidence_applicability: conceptualEvidenceApplicability
  });
  const observationRecord = createTurnEvidenceObservationRecordV1({
    source_student_turn_id: input.source_student_turn_id,
    source_sequence_index: input.source_sequence_index,
    observation,
    conceptual_evidence_applicability: conceptualEvidenceApplicability,
    profile_update_disposition: disposition,
    unsupported_understanding_claim: unsupportedUnderstandingClaim,
    created_at: input.created_at
  });
  const baseProfile = createTopicDialogueTurnEvidenceProfile({
    source_student_turn_id: input.source_student_turn_id,
    source_sequence_index: input.source_sequence_index,
    concept_id: input.concept_id,
    distractor_anchor: input.distractor_anchor,
    observation,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    created_at: input.created_at
  });
  const profile = applyConceptualApplicabilityToTurnProfile({
    profile: baseProfile,
    observation,
    conceptual_evidence_applicability: conceptualEvidenceApplicability
  });
  const cumulative = integrateTopicDialogueEvidenceProfileWithDisposition({
    prior: input.prior_cumulative_profile,
    current: profile,
    disposition
  });
  const updateRecord = createLearningProfileUpdateDispositionRecordV1({
    prior: input.prior_cumulative_profile,
    current_profile: profile,
    resulting_profile: cumulative,
    observation_record: observationRecord,
    disposition,
    created_at: input.created_at
  });
  const updateConsistency = assertProfileUpdateDispositionCoherent({
    prior: input.prior_cumulative_profile,
    current_profile: profile,
    resulting_profile: cumulative,
    observation_record: observationRecord,
    update_record: updateRecord
  });
  const route = selectEvidenceFirstTopicDialogueRoute({ profile, cumulative });
  assertEvidenceFirstProfileIsFresh({
    profile,
    route,
    cumulative,
    latest_student_turn_id: input.latest_accepted_student_turn_id,
    latest_sequence_index: input.latest_accepted_sequence_index
  });
  const turnViews = ([
    "evaluator_observation",
    "anchor_resolution_observation",
    "contradiction_observation",
    "normalized_turn_observation"
  ] as const).map((artifactType) => turnLayerView({
    artifact_type: artifactType,
    source_student_turn_id: input.source_student_turn_id,
    source_sequence_index: input.source_sequence_index,
    applicability: conceptualEvidenceApplicability,
    observation
  }));
  const authoritativeViews = ([
    "resulting_profile",
    "cumulative_profile",
    "sound_gate_input",
    "platform_mode_input"
  ] as const).map((artifactType) => authoritativeLayerView({
    artifact_type: artifactType,
    cumulative
  }));
  if (route.selected_mode === "remain_in_dialogue" &&
      input.interaction_intent === "ordinary_conceptual_response") {
    authoritativeViews.push(authoritativeLayerView({
      artifact_type: "tutor_input_profile",
      cumulative
    }));
  }
  const crossArtifactConsistency = reconcileTurnEvidenceLayersV2({
    turn_observation: observationRecord,
    update_record: updateRecord,
    turn_observation_views: turnViews,
    authoritative_profile_views: authoritativeViews
  });
  const tutorDispatchPermitted = route.selected_mode === "remain_in_dialogue" &&
    input.interaction_intent === "ordinary_conceptual_response";
  const attestation = PreTutorProfileFinalizationAttestationV3Schema.parse({
    finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3,
    source_student_turn_id: profile.source_student_turn_id,
    source_sequence_index: profile.source_sequence_index,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    profile_mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6,
    profile_consistency_version: PROFILE_CONSISTENCY_POLICY_VERSION_V6,
    turn_observation_version: TURN_EVIDENCE_OBSERVATION_VERSION,
    profile_update_contract_version:
      LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
    cross_artifact_consistency_version:
      TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2,
    nonconceptual_preservation_version:
      NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION,
    mixed_intent_retention_version: MIXED_INTENT_EVIDENCE_RETENTION_VERSION,
    evaluator_schema_valid: true,
    target_contract_applied: true,
    turn_observation_constructed: true,
    profile_update_disposition_applied: true,
    cross_artifact_consistency_passed: true,
    profile_consistency_passed: true,
    cumulative_profile_updated: true,
    sound_gate_executed: true,
    platform_mode_finalized: true,
    latest_turn_freshness_passed: true,
    tutor_dispatch_permitted: tutorDispatchPermitted,
    execution_order: [
      "student_response_persisted",
      "visible_history_reconstructed",
      "evaluator_request_dispatched",
      "evaluator_output_validated",
      "conceptual_observation_normalized",
      "conceptual_evidence_applicability_classified",
      "profile_update_disposition_selected",
      "turn_observation_constructed",
      "turn_profile_constructed",
      "cumulative_profile_updated",
      "profile_update_record_constructed",
      "semantic_layers_reconciled",
      "sound_gate_executed",
      "platform_mode_finalized",
      "profile_freshness_verified"
    ]
  });
  return {
    observation,
    observation_record: observationRecord,
    conceptual_evidence_applicability: conceptualEvidenceApplicability,
    profile_update_disposition: disposition,
    profile_update_record: updateRecord,
    consistency,
    update_consistency: updateConsistency,
    profile,
    cumulative,
    route,
    cross_artifact_consistency: crossArtifactConsistency,
    attestation
  };
}
