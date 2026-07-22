import { z } from "zod";
import {
  assertEvidenceFirstProfileIsFresh,
  createTopicDialogueTurnEvidenceProfile,
  integrateTopicDialogueEvidenceProfile,
  selectEvidenceFirstTopicDialogueRoute,
  type TopicDialogueCumulativeEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  TargetEvidenceAdjudicationV5Schema,
  TargetEvidenceContractV5Schema,
  assertTargetEvidenceObservationConsistentV5,
  mapTargetEvidenceAdjudicationToObservationV5,
  type TargetEvidenceAdjudicationV5,
  type TargetEvidenceContractV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import {
  TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION,
  reconcileAuthoritativeTurnEvidenceViews
} from "@/lib/services/student-assessment/turn-evidence-cross-artifact-consistency";

export const PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V2 =
  "pre-tutor-profile-finalization-v2" as const;

export const PreTutorProfileFinalizationAttestationV2Schema = z.object({
  finalization_version: z.literal(PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V2),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  evaluator_schema_valid: z.literal(true),
  target_contract_applied: z.literal(true),
  anchor_aliases_applied: z.literal(true),
  anchor_interpretation_completed: z.literal(true),
  blocking_conflicts_propagated: z.literal(true),
  profile_constructed: z.literal(true),
  cross_artifact_consistency_version: z.literal(
    TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION
  ),
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
    z.literal("structured_fields_normalized"),
    z.literal("anchor_aliases_applied"),
    z.literal("anchor_application_and_stance_finalized"),
    z.literal("conflicts_propagated"),
    z.literal("turn_profile_constructed"),
    z.literal("authoritative_views_reconciled"),
    z.literal("profile_consistency_validated"),
    z.literal("cumulative_profile_updated"),
    z.literal("sound_gate_executed"),
    z.literal("platform_mode_finalized"),
    z.literal("profile_freshness_verified")
  ])
}).strict();
export type PreTutorProfileFinalizationAttestationV2 = z.infer<
  typeof PreTutorProfileFinalizationAttestationV2Schema
>;

export function finalizeEvidenceFirstTurnBeforeTutorV2(input: {
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
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
  const observation = mapTargetEvidenceAdjudicationToObservationV5({
    contract,
    adjudication,
    interaction_intent: input.interaction_intent,
    confidence_evidence: input.confidence_evidence
  });
  const consistency = assertTargetEvidenceObservationConsistentV5({
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
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
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
  const authoritativeResult = {
    source_student_turn_id: profile.source_student_turn_id,
    source_sequence_index: profile.source_sequence_index,
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5,
    anchor_application: observation.anchor_application,
    anchor_stance: observation.anchor_stance,
    anchor_consistency: observation.anchor_consistency,
    anchor_resolution_status: observation.anchor_resolution_status,
    contradictions: observation.contradictions,
    reasoning_quality: observation.reasoning_quality,
    revision_readiness: profile.revision_readiness,
    platform_mode: route.selected_mode
  } as const;
  const evaluatorView = {
    ...authoritativeResult,
    source_student_turn_id:
      adjudication.structured_turn_evidence.source_student_turn_id,
    source_sequence_index:
      adjudication.structured_turn_evidence.source_sequence_index,
    anchor_application:
      adjudication.structured_turn_evidence.observed_anchor_reference ===
        "explicit" ? "explicit" as const : "absent" as const,
    anchor_stance:
      adjudication.structured_turn_evidence.observed_anchor_stance
  };
  const anchorResolutionView = {
    ...authoritativeResult,
    anchor_application:
      adjudication.anchor_alias_resolution.observed_anchor_reference ===
        "explicit" ? "explicit" as const : "absent" as const,
    anchor_stance: adjudication.anchor_alias_resolution.observed_anchor_stance
  };
  const crossArtifactConsistency = reconcileAuthoritativeTurnEvidenceViews({
    views: [
      { artifact_type: "evaluator", ...evaluatorView },
      { artifact_type: "anchor_resolution", ...anchorResolutionView },
      { artifact_type: "mapper", ...authoritativeResult },
      { artifact_type: "turn_profile", ...authoritativeResult },
      { artifact_type: "route", ...authoritativeResult }
    ]
  });
  const attestation = PreTutorProfileFinalizationAttestationV2Schema.parse({
    finalization_version: PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V2,
    source_student_turn_id: profile.source_student_turn_id,
    source_sequence_index: profile.source_sequence_index,
    evaluator_schema_valid: true,
    target_contract_applied: true,
    anchor_aliases_applied: true,
    anchor_interpretation_completed: true,
    blocking_conflicts_propagated: true,
    profile_constructed: true,
    cross_artifact_consistency_version:
      TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION,
    cross_artifact_consistency_passed: true,
    profile_consistency_passed: true,
    cumulative_profile_updated: true,
    sound_gate_executed: true,
    platform_mode_finalized: true,
    latest_turn_freshness_passed: true,
    tutor_dispatch_permitted: route.selected_mode === "remain_in_dialogue",
    execution_order: [
      "student_response_persisted",
      "visible_history_reconstructed",
      "evaluator_request_dispatched",
      "evaluator_output_validated",
      "structured_fields_normalized",
      "anchor_aliases_applied",
      "anchor_application_and_stance_finalized",
      "conflicts_propagated",
      "turn_profile_constructed",
      "authoritative_views_reconciled",
      "profile_consistency_validated",
      "cumulative_profile_updated",
      "sound_gate_executed",
      "platform_mode_finalized",
      "profile_freshness_verified"
    ]
  });
  return {
    observation,
    consistency,
    profile,
    cumulative,
    route,
    cross_artifact_consistency: crossArtifactConsistency,
    attestation
  };
}
